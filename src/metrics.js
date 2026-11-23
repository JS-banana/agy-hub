// @ts-check
import { bar, visibleWidth } from './terminal.js';
import { percentage } from './state.js';

/** @typedef {import('./render/types.js').Frame} Frame */
/** @typedef {import('./render/types.js').ColorKey} ColorKey */
/** @typedef {import('./state.js').QuotaWindow} QuotaWindow */
const HOUR = 60 * 60 * 1000;
export const WEEK = 7 * 24 * HOUR;

/** @param {number} value */
export function tokens(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}k`;
  return String(value);
}

/** @param {number} ms @param {boolean} [seconds] */
export function duration(ms, seconds = false) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (seconds && ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = hours < 24 ? minutes % 60 : hours % 24;
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

/** @param {number} at @param {Frame} frame */
export function clock(at, frame) {
  const { state, config } = frame;
  /** @type {Intl.DateTimeFormatOptions} */
  const options = { hour: '2-digit', minute: '2-digit' };
  const display = config.display;
  if (display.showClockSeconds) options.second = '2-digit';
  if (display.hourCycle !== 'auto') options.hourCycle = display.hourCycle;
  const locale = config.language === 'en' ? undefined : config.language;
  const date = new Date(at);
  const time = date.toLocaleTimeString(locale, options);
  if (date.toDateString() === new Date(state.now).toDateString()) return time;
  return `${date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })} ${time}`;
}

/** @param {Frame} frame @param {'context'|'usage'|'weekly'|'memory'} key @param {boolean} [align] */
function barLabel(frame, key, align) {
  const { style, words, config } = frame;
  const text = words[key];
  /** @type {(typeof key)[]} */
  const keys = ['context', 'usage', 'weekly'];
  if (config.display.showMemoryUsage) keys.push('memory');
  const gap = align ? Math.max(...keys.map((item) => visibleWidth(words[item]))) - visibleWidth(text) : 0;
  return style(text + ' '.repeat(gap), 'label');
}

/** @param {Frame} frame @param {number} percent @param {ColorKey} shade */
const metricBar = (frame, percent, shade) => bar(percent, frame.barWidth, frame.config.colors[shade], frame.color, frame.config.colors);

/** @param {Frame} frame @param {boolean} compact @param {boolean} [align] */
export function contextPart(frame, compact, align = false) {
  const { state, config, style, words } = frame;
  if (!state.context) return '';
  const { input, cache, tokens: count } = state.context;
  const { display } = config;
  const size = display.autoCompactWindow ?? state.context.size;
  const used = display.autoCompactWindow && count !== null ? percentage(100 * count / display.autoCompactWindow) : state.context.used;
  const ratio = count === null ? '' : size ? `${tokens(count)}/${tokens(size)}` : tokens(count);
  const value = {
    percent: used === null ? ratio : `${used}%`,
    tokens: ratio || (used === null ? '' : `${used}%`),
    remaining: used === null ? '' : `${100 - used}%`,
    both: used === null ? ratio : ratio && size ? `${used}% (${ratio})` : `${used}%`,
  }[display.contextValue];
  if (!value) return '';
  const shade = used === null ? 'context' : used >= display.contextCriticalThreshold ? 'critical'
    : used >= display.contextWarningThreshold ? 'warning' : 'context';
  const details = [];
  if (display.showTokenBreakdown && used !== null && used >= display.contextCriticalThreshold) {
    if (input !== null) details.push(`${words.input}: ${tokens(input)}`);
    if (cache !== null) details.push(`${words.cacheTokens}: ${tokens(cache)}`);
  }
  return [
    compact ? '' : barLabel(frame, 'context', align),
    display.showContextBar && used !== null ? metricBar(frame, used, shade) : '',
    style(value, shade),
    details.length ? style(`(${details.join(', ')})`, 'label') : '',
  ].filter(Boolean).join(' ');
}

/** @param {Frame} frame @param {QuotaWindow} window @param {number} period @param {boolean} compact @param {boolean} [exhausted] */
function resets(frame, window, period, compact, exhausted = false) {
  if (window.reset <= 0) return '';
  const { config, words, state } = frame;
  const { display } = config;
  const relative = duration(window.reset);
  const mode = display.timeFormat;
  const relativeOnly = mode === 'relative' || (exhausted && mode === 'elapsed');
  if (compact && relativeOnly && !exhausted && display.usageBarEnabled && !display.usageCompact) {
    return `${relative} / ${period === WEEK ? '7d' : '5h'}`;
  }
  if (relativeOnly) return display.showResetLabel && !display.usageCompact ? `${words.resetsIn} ${relative}` : relative;
  const time = clock(state.now + window.reset, frame);
  const absolute = config.language === 'en' ? `at ${time}` : time;
  if (mode === 'both') return `${display.showResetLabel ? words.resetsIn + ' ' : ''}${relative}, ${absolute}`;
  if (mode === 'absolute' || exhausted) return display.showResetLabel ? `${words.resets} ${absolute}` : absolute;
  const elapsed = `${percentage(100 * (1 - window.reset / period))}${words.elapsed}`;
  return mode === 'elapsedAndAbsolute' ? `${elapsed}, ${absolute}` : elapsed;
}

/** @param {QuotaWindow | null | undefined} window @param {number} period @param {boolean} enabled */
function pace(window, period, enabled) {
  if (!enabled || !window || window.used === null || window.used < 10 || window.reset <= 0 || window.reset >= period) return '';
  const projected = window.used / (1 - window.reset / period);
  return projected > 100 ? 'critical' : projected >= 90 ? 'usageWarning' : '';
}

/** @param {Frame} frame @param {boolean} compact @param {boolean} [align] */
export function usageParts(frame, compact, align = false) {
  const { state, config, style, words } = frame;
  const { display } = config;
  const { short, weekly, scoped } = state.quota;
  if (!display.showUsage || (scoped && !display.showModelScopedUsage) || (!short && !weekly)) return [];
  const label = barLabel(frame, 'usage', align);
  const exhausted = [short, weekly].find((window) => window?.exhausted);
  if (exhausted) {
    const reset = resets(frame, exhausted, exhausted === short ? 5 * HOUR : WEEK, compact, true);
    const status = display.usageCompact && config.language === 'en' ? 'Limit' : words.limit;
    const warning = style(`⚠ ${status}${reset ? ` (${reset})` : ''}`, 'critical');
    return [compact || display.usageCompact ? warning : `${label} ${warning}`];
  }
  const shortPace = pace(short, 5 * HOUR, display.usagePace);
  const weeklyPace = pace(weekly, WEEK, display.usagePace);
  if (!shortPace && !weeklyPace && Math.max(short?.used ?? 0, weekly?.used ?? 0) < display.usageThreshold
    && short?.amount == null && weekly?.amount == null) return [];

  /** @param {QuotaWindow} window @param {boolean} isWeekly @param {ReturnType<typeof pace>} trend */
  const format = (window, isWeekly, trend) => {
    const period = isWeekly ? WEEK : 5 * HOUR;
    const used = window.used ?? 0;
    const shade = used >= 90 || trend === 'critical' ? 'critical'
      : used >= 75 || trend ? 'usageWarning' : 'usage';
    const name = isWeekly ? barLabel(frame, 'weekly', align && Boolean(short)) : style('5h', 'label');
    const reset = resets(frame, window, period, compact);
    const value = display.usageValue === 'remaining' ? 100 - used : used;
    const amount = window.used === null
      ? new Intl.NumberFormat(config.language, { maximumFractionDigits: 2 }).format(window.amount ?? 0) : '';
    const quotaValue = amount ? (config.language === 'en' ? `${amount} ${words.left}` : `${words.left} ${amount}`) : `${value}%`;
    return [
      display.usageCompact ? style(isWeekly ? '7d:' : '5h:', 'label')
        : isWeekly || !display.usageBarEnabled ? name : '',
      display.usageBarEnabled && !display.usageCompact && window.used !== null ? metricBar(frame, window.used, shade) : '',
      style(quotaValue, shade),
      trend ? style('▲', trend) : '',
      reset ? `(${reset})` : '',
    ].filter(Boolean).join(' ');
  };
  if (!short) {
    if (!weekly) return [];
    const entry = format(weekly, true, weeklyPace);
    return [compact || display.usageCompact ? entry : `${label} ${entry}`];
  }
  const entry = format(short, false, shortPace);
  const parts = [display.usageCompact ? entry : `${label} ${entry}`];
  if (weekly && ((weekly.used ?? 0) >= display.sevenDayThreshold || weeklyPace || weekly.amount !== null)) {
    parts.push(format(weekly, true, weeklyPace));
  }
  return parts;
}

/** @param {Frame} frame @param {boolean} align */
export function memoryPart(frame, align) {
  const { memory, style, config } = frame;
  if (!config.display.showMemoryUsage || !memory) return '';
  const used = percentage(100 * memory.used / memory.total);
  const shade = used >= 90 ? 'critical' : used >= 75 ? 'warning' : 'context';
  /** @param {number} bytes */
  const gib = (bytes) => (bytes / 1024 ** 3).toFixed(1);
  return `${barLabel(frame, 'memory', align)} ${metricBar(frame, used, shade)} ${style(`${gib(memory.used)}/${gib(memory.total)} GiB`, shade)}`;
}
