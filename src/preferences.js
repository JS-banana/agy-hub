import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ansiColors, configPath, normalizeConfig, readConfig } from './config.js';
import { writeObject } from './local-data.js';

const manualOnly = ['externalUsagePath', 'externalUsageWritePath'];
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = (value) => JSON.stringify(value, null, 2);
const hash = (text) => createHash('sha256').update(text).digest('hex');

function readText(path) {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (!info) return null;
  if (!info.isFile()) throw new Error('Expected a regular configuration file.');
  return readFileSync(path, 'utf8');
}

function targetPath(path) {
  return lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() ? realpathSync(path) : path;
}

function parseObject(text) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('Expected a valid JSON object.'); }
  if (!isObject(value)) throw new Error('Expected a valid JSON object.');
  return value;
}

function mergeConfig(base, patch, defaults) {
  const entries = Object.entries(patch).map(([key, value]) => {
    if (!Object.hasOwn(defaults, key) || !isObject(defaults[key]) || !isObject(value)) return [key, value];
    return [key, mergeConfig(isObject(base[key]) ? base[key] : {}, value, defaults[key])];
  });
  return { ...base, ...Object.fromEntries(entries) };
}

function matchesValue(key, value, normalized, fallback) {
  if (isDeepStrictEqual(value, normalized)) return true;
  // Language aliases normalize to a non-default canonical name; text fields are trimmed.
  if (key === 'language') return normalized !== fallback;
  return typeof value === 'string' && (fallback === '' || key === 'colors.barFilled' || key === 'colors.barEmpty')
    && value.trim() === normalized;
}

function inspect(raw, defaults, effective) {
  const unknown = [];
  const invalid = [];
  const unsafe = [];

  function visit(value, fallback, normalized, prefix) {
    for (const [key, entry] of Object.entries(value)) {
      const name = `${prefix}${key}`;
      if (forbidden.has(key)) unsafe.push(name);
      else if (!Object.hasOwn(fallback, key)) unknown.push(name);
      else if (isObject(fallback[key]) && isObject(entry)) visit(entry, fallback[key], normalized[key], `${name}.`);
      else if (!matchesValue(name, entry, normalized[key], fallback[key])) invalid.push(name);
    }
  }

  visit(raw, defaults, effective, '');
  return { valid: unknown.length + invalid.length + unsafe.length === 0, unknown, invalid, unsafe };
}

function check(path, defaults) {
  let text;
  try { text = readText(targetPath(path)); } catch {
    return { valid: false, unknown: [], invalid: [], unsafe: [], error: 'unreadable' };
  }
  try {
    const raw = text === null ? {} : parseObject(text);
    return { ...inspect(raw, defaults, normalizeConfig(raw)), exists: text !== null };
  } catch {
    return { valid: false, unknown: [], invalid: [], unsafe: [], exists: true, error: 'invalid-json' };
  }
}

function withLock(path, createDirectory, operation) {
  const file = targetPath(path);
  if (createDirectory) mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  try { mkdirSync(lock, { mode: 0o700 }); } catch (error) {
    if (error.code === 'ENOENT' && !createDirectory) return { undone: false };
    if (error.code === 'EEXIST') throw new Error(`Configuration is locked at ${lock}.`);
    throw error;
  }
  try { return operation(file, `${file}.undo.json`); } finally { rmdirSync(lock); }
}

function restoreText(path, text) {
  if (text === null) {
    unlinkSync(path);
    return;
  }
  const staged = join(dirname(path), `.agy-hub-${randomUUID()}.tmp`);
  try {
    writeFileSync(staged, text, { flag: 'wx', mode: 0o600 });
    renameSync(staged, path);
  } finally {
    if (lstatSync(staged, { throwIfNoEntry: false })) unlinkSync(staged);
  }
}

function set(path, argument, defaults) {
  const patch = parseObject(argument);
  const restricted = manualOnly.filter((key) => isObject(patch.display) && Object.hasOwn(patch.display, key));
  if (restricted.length) throw new Error(`Edit these file paths directly in the configuration file: ${restricted.map((key) => `display.${key}`).join(', ')}.`);

  return withLock(path, true, (file, undoFile) => {
    const before = readText(file);
    const base = before === null ? {} : parseObject(before);
    const updated = mergeConfig(base, patch, defaults);
    const { valid, unknown, invalid, unsafe } = inspect(updated, defaults, normalizeConfig(updated));
    if (!valid) {
      const problems = [[unknown, 'Unknown keys'], [invalid, 'Invalid values'], [unsafe, 'Unsafe keys']]
        .filter(([keys]) => keys.length).map(([keys, label]) => `${label}: ${keys.map((key) => JSON.stringify(key)).join(', ')}`);
      throw new Error(`${problems.join('. ')}.`);
    }
    if (isDeepStrictEqual(updated, base)) return { updated: false };

    const oldUndo = readText(undoFile);
    writeObject(undoFile, { before, after: hash(`${json(updated)}\n`) });
    try {
      if (readText(file) !== before) throw new Error('Configuration changed while saving. Run config set again.');
      writeObject(file, updated);
    } catch (error) {
      restoreText(undoFile, oldUndo);
      throw error;
    }
    return { updated: true };
  });
}

function undo(path) {
  return withLock(path, false, (file, undoFile) => {
    const saved = readText(undoFile);
    if (saved === null) return { undone: false };
    const { before, after } = parseObject(saved);
    if ((before !== null && typeof before !== 'string') || typeof after !== 'string' || !/^[\da-f]{64}$/.test(after)) {
      throw new Error('Invalid configuration undo record.');
    }
    const current = readText(file);
    if (current !== before) {
      if (current === null || hash(current) !== after) throw new Error('Configuration has changed since the last config set. The undo record was kept.');
      restoreText(file, before);
    }
    unlinkSync(undoFile);
    return { undone: true };
  });
}

export function preferences(action, argument, { path = configPath() } = {}) {
  const defaults = normalizeConfig();
  switch (action) {
    case 'show': return json(readConfig(path));
    case 'schema': return json({ defaults, colorNames: [...ansiColors.keys()], manualOnly: manualOnly.map((key) => `display.${key}`) });
    case 'check': return json(check(path, defaults));
    case 'set': return json(set(path, argument, defaults));
    case 'undo': return json(undo(path));
    default: throw new Error('Expected config show, schema, check, set or undo.');
  }
}
