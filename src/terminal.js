import { ansiColors } from './config.js';
import { pathToFileURL } from 'node:url';
import { isAbsolute } from 'node:path';

const CODES = /\x1b(?:\[[0-9;]*m|\]8;;[^\x1b]*\x1b\\)/g;
const CLOSE_LINK = '\x1b]8;;\x1b\\';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// Adapted from Claude HUD's sanitize.ts and ansi.ts (MIT).
export function labelText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g, '')
    .replace(/[\p{Cc}\p{Bidi_Control}\u2028\u2029]/gu, '')
    .trim();
}

function isWide(code) {
  return code >= 0x1100 && (
    code <= 0x115f || code === 0x2329 || code === 0x232a
    || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f)
    || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe10 && code <= 0xfe19) || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1b000 && code <= 0x1b2ff) || (code >= 0x20000 && code <= 0x3fffd)
  );
}

function cellWidth(segment) {
  if (/\p{Emoji_Presentation}|\uFE0F|\u20e3/u.test(segment)) return 2;
  const visible = segment.replace(/[\p{Mark}\p{Cf}]/gu, '');
  return visible ? (isWide(visible.codePointAt(0)) ? 2 : 1) : 0;
}

export const stripColor = (text) => text.replace(CODES, '');

export function visibleWidth(text) {
  let width = 0;
  for (const { segment } of graphemes.segment(stripColor(text))) width += cellWidth(segment);
  return width;
}

export function truncate(text, width) {
  if (visibleWidth(text) <= width) return text;
  const suffix = '.'.repeat(Math.min(width, 3));
  const limit = width - suffix.length;
  const plain = stripColor(text);
  let used = 0;
  let end = 0;
  for (const { segment } of graphemes.segment(plain)) {
    used += cellWidth(segment);
    if (used > limit) break;
    end += segment.length;
  }

  let result = '';
  let previous = 0;
  let kept = 0;
  let openLink = false;
  for (const match of text.matchAll(CODES)) {
    const chunk = text.slice(previous, match.index);
    if (kept + chunk.length >= end) break;
    result += chunk + match[0];
    if (match[0].startsWith('\x1b]8;;')) openLink = match[0] !== CLOSE_LINK;
    kept += chunk.length;
    previous = match.index + match[0].length;
  }
  result += text.slice(previous, previous + end - kept) + (openLink ? CLOSE_LINK : '') + suffix;
  return result.includes('\x1b') ? result + RESET : result;
}

/** Pack already-rendered segments without splitting labels on user-supplied separators. */
export function pack(parts, separator, width) {
  const rows = [];
  let row = '';
  for (const part of parts.filter(Boolean)) {
    const candidate = row ? row + separator + part : part;
    if (row && width && visibleWidth(candidate) > width) {
      rows.push(truncate(row, width));
      row = part;
    } else {
      row = candidate;
    }
  }
  if (row) rows.push(width ? truncate(row, width) : row);
  return rows;
}

function ansi(color) {
  if (typeof color === 'number') return `\x1b[38;5;${color}m`;
  if (color.startsWith('#')) {
    const rgb = color.slice(1).match(/../g).map((channel) => parseInt(channel, 16));
    return `\x1b[38;2;${rgb.join(';')}m`;
  }
  return `\x1b[${ansiColors.get(color)}m`;
}

export function paint(text, color, enabled) {
  return enabled ? `${ansi(color)}${text}${RESET}` : text;
}

export function bar(percent, width, color, enabled, palette) {
  const filled = Math.round(percent / 100 * width);
  const glyph = (value, fallback) => value && visibleWidth(value) === 1 ? value : fallback;
  const blocks = glyph(palette?.barFilled, '█').repeat(filled);
  const rest = glyph(palette?.barEmpty, '░').repeat(width - filled);
  return enabled ? `${ansi(color)}${blocks}${DIM}${rest}${RESET}` : blocks + rest;
}

export function linkPath(path, text, enabled) {
  if (!enabled || typeof path !== 'string' || !isAbsolute(path) || /[\p{Cc}\p{Bidi_Control}]/u.test(path)) return text;
  return `\x1b]8;;${pathToFileURL(path).href}\x1b\\${text}${CLOSE_LINK}`;
}
