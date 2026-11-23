// @ts-check
import { MAX_TERMINAL_WIDTH, pack, paint, truncate } from './terminal.js';
import { clock, contextPart, duration, memoryPart, tokens, usageParts } from './metrics.js';
import { messages } from './messages.js';

import { DIVIDER, PIPE, expandedRows, formatRows } from './render/layout.js';
import { addedDirs, changedFiles, projectParts } from './render/project.js';

const ACTIVITY = new Set(['tools', 'skills', 'mcp', 'agents', 'tasks']);
const ACTIVITY_OPTIONS = /** @type {const} */ ({ tools: 'showTools', skills: 'showSkills', mcp: 'showMcp' });
const EFFORT = { low: '○', medium: '◔', high: '◑', xhigh: '◕', max: '●' };
/** @typedef {import('./render/types.js').Frame} Frame */

/** @param {string} effort @param {string} format */
function effortText(effort, format) {
  const symbol = Object.hasOwn(EFFORT, effort) ? EFFORT[/** @type {keyof typeof EFFORT} */ (effort)] : '';
  if (!symbol || format === 'text') return effort;
  return format === 'symbol' ? symbol : `${symbol} ${effort}`;
}

/** @param {Frame} frame */
function modelBadge(frame) {
  const { config, state, activity, style } = frame;
  const { display } = config;
  if (!display.showModel) return '';
  const fromTranscript = display.modelSource === 'transcript'
    || (display.modelSource === 'auto' && !state.model);
  let model = display.modelOverride || (fromTranscript && activity?.model) || state.model || 'Antigravity';
  if (display.modelFormat !== 'full') model = model.replace(/\s*\[(?:\d+(?:\.\d+)?[km])(?:\s+context)?\]$/i, '');
  if (display.modelFormat === 'short') model = model.replace(/^(?:Claude|Gemini)\s+/i, '');
  if (display.showEffortLevel && state.effort) {
    const suffix = ` (${state.effort})`;
    if (model.toLowerCase().endsWith(suffix.toLowerCase())) model = model.slice(0, -suffix.length);
    model += ' ' + effortText(state.effort, display.effortFormat);
  }
  if (display.showProvider && display.providerName) model = `${display.providerName} | ${model}`;
  return style(`[${model}]`, 'model');
}

/** @param {Frame} frame */
function costPart(frame) {
  const { words, config, state, style, costTotals } = frame;
  /** @param {number} value */
  const money = (value) => `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`;
  const { display } = config;
  const costs = [
    display.showCost && state.cost !== null ? `${words.cost} ${money(state.cost)}` : '',
    display.showDailyCost && costTotals?.day != null ? `${words.today} ${money(costTotals.day)}` : '',
    display.showWeeklyCost && costTotals?.week != null ? `${words.week} ${money(costTotals.week)}` : '',
  ].filter(Boolean);
  return costs.length ? style(costs.join(PIPE), 'label') : '';
}

/** @param {Frame} frame */
function account(frame) {
  const { config: { display }, state } = frame;
  const plan = display.showAuth ? state.plan : '';
  let user = display.showAuthUser ? state.email : '';
  if (user && !display.authUserFullEmail) user = user.split('@')[0];
  if (user && display.authUserLength) user = truncate(user, display.authUserLength);
  return [plan, user].filter(Boolean).join(' · ');
}

/** @param {Frame} frame @param {boolean} compact */
function header(frame, compact) {
  const { state, config, activity, style } = frame;
  const { display } = config;
  /** @param {string | undefined} value */
  const dim = (value) => value ? style(value, 'label') : '';
  const model = compact ? [modelBadge(frame), contextPart(frame, true)].filter(Boolean).join(' ') : modelBadge(frame);
  const entries = new Map([
    ['model', [model]],
    ['project', projectParts(frame, compact)],
    ['agent', [dim(display.showAgentState ? [state.agent, state.agentState, state.cycleMode,
      state.sandbox ? 'Sandbox' : ''].filter(Boolean).join(' · ') : '')]],
    ['sessionName', [dim(display.showSessionName ? state.title : '')]],
    ['version', [dim(display.showAgyVersion && state.version ? `agy v${state.version}` : '')]],
    ['extra', [dim(frame.extra)]],
    ['duration', [dim(display.showDuration && activity?.started != null ? `⏱️  ${duration(state.now - activity.started, true)}` : '')]],
    ['cost', [config.elementOrder.includes('cost') || compact ? '' : costPart(frame)]],
    ['speed', [dim(display.showSpeed && activity?.speed != null ? `${frame.words.output}: ${activity.speed.toFixed(1)} tok/s` : '')]],
    ['auth', [dim(account(frame))]],
  ]);
  const parts = [...new Set([...config.projectLineOrder, ...entries.keys()])].flatMap((key) => entries.get(key) ?? []);
  const custom = display.customLine ? style(display.customLine, 'custom') : '';
  return display.customLinePosition === 'first' ? [custom, ...parts] : [...parts, custom];
}

/** @param {Frame} frame @param {string} key */
function activityEntries(frame, key) {
  const { state, config, activity, words, style } = frame;
  const { display } = config;
  const activeIcon = style('◐', 'warning');
  const doneIcon = style('✓', 'context');
  if (key === 'tools' || key === 'skills' || key === 'mcp') {
    if (!display[ACTIVITY_OPTIONS[key]]) return [];
    /** @param {Pick<import('./render/types.js').ToolCall, 'kind'>} entry */
    const group = (entry) => (entry.kind ?? 'tools') === key;
    /** @param {string} name */
    const shorten = (name) => display.toolNameMaxLength ? truncate(name, display.toolNameMaxLength) : name;
    const running = activity?.running?.filter(group).slice(-2).map(({ name, target }) =>
      `${activeIcon} ${style(shorten(name), 'model')}${target ? style(`: ${target}`, 'label') : ''}`) ?? [];
    if (key === 'tools' && !activity?.running?.length && state.agentState === 'tool_use') {
      running.push(`${activeIcon} ${style(words.tools, 'model')}`);
    }
    const limit = key === 'skills' ? display.skillsMaxVisible : display.toolsMaxVisible;
    const completed = activity?.completed?.filter(group).slice(0, limit).map(({ name, count }) =>
      `${doneIcon} ${style(shorten(name), 'model')} ${style(`×${count}`, 'label')}`) ?? [];
    return pack([...running, ...completed], PIPE, frame.width);
  }
  if (key === 'agents' && display.showAgents) {
    const ordered = [...state.agents.filter(({ running }) => running), ...state.agents.filter(({ running }) => !running).reverse()];
    return ordered.slice(0, 5).map(({ name, model, role, running, effort, start, end }) => {
      const description = role ? style(`: ${role}`, 'label') : '';
      const until = running ? state.now : end;
      const elapsed = start != null && until != null ? duration(until - start, true) : '';
      const modelLabel = [model, display.showAgentEffort && effort ? effortText(effort, display.effortFormat) : ''].filter(Boolean).join(' ');
      return `${running ? activeIcon : doneIcon} ${style(name, 'git')}${modelLabel ? ` ${style(`[${modelLabel}]`, 'label')}` : ''}`
        + description + (elapsed ? style(` (${elapsed})`, 'label') : '');
    });
  }
  if (key === 'tasks' && display.showTasks) {
    return [[state.tasks ? `${words.tasks} ${state.tasks}` : '',
      state.artifacts ? `${words.artifacts} ${state.artifacts}` : ''].filter(Boolean).map((part) => style(part, 'label')).join(DIVIDER)];
  }
  return [];
}

/** @param {Frame} frame @param {string} key @param {boolean} [align] */
function entriesFor(frame, key, align = false) {
  const { state, config, style, words, activity, environment } = frame;
  const { display } = config;
  switch (key) {
    case 'project': return pack(header(frame, false), DIVIDER, frame.width);
    case 'addedDirs': return display.addedDirsLayout === 'line' ? pack(addedDirs(frame), ' ', frame.width) : [];
    case 'context': return [contextPart(frame, false, align)];
    case 'usage': return pack(usageParts(frame, false, align), PIPE, frame.width);
    case 'memory': return [memoryPart(frame, align)];
    case 'cost': return [costPart(frame)];
    case 'environment': {
      if (!environment || !display.showConfigCounts) return [];
      const counts = /** @type {const} */ ([
        [environment.instructions, 'AGENTS.md / GEMINI.md'], [environment.rules, words.rules],
        [environment.mcp, 'MCPs'], [environment.hooks, words.hooks],
      ]);
      if (counts.reduce((total, [count]) => total + count, 0) < display.environmentThreshold) return [];
      return pack(counts.filter(([count]) => count > 0).map(([count, name]) => style(`${count} ${name}`, 'label')), DIVIDER, frame.width);
    }
    case 'cacheHitRate': {
      const { input, cache, cacheRead } = state.context ?? {};
      const total = (input ?? 0) + (cache ?? 0);
      return display.showCacheHitRate && cacheRead != null && total > 0
        ? [style(`${words.cacheHit} ${Math.round(100 * cacheRead / total)}%`, 'label')] : [];
    }
    case 'promptCache': {
      const cache = state.context?.cache;
      return display.showPromptCache && cache != null && cache > 0 ? [style(`${words.cache} ${tokens(cache)} ${words.tokens}`, 'label')] : [];
    }
    case 'sessionTime': return pack([
      display.showSessionStartDate && activity?.started != null ? style(`${words.start} ${clock(activity.started, frame)}`, 'label') : '',
      display.showLastResponseAt && activity?.lastReply != null ? style(`${words.reply} ${clock(activity.lastReply, frame)}`, 'label') : '',
    ], DIVIDER, frame.width);
    case 'sessionTokens': return display.showSessionTokens && state.input !== null && state.output !== null ? [
      style(`${words.tokens} ${tokens(state.input + state.output)} (${words.input}: ${tokens(state.input)}, ${words.output}: ${tokens(state.output)})`, 'label'),
    ] : [];
    default: return activityEntries(frame, key);
  }
}

/** @param {Frame} frame */
function expanded(frame) {
  const { config, width } = frame;
  const order = config.elementOrder;
  const rows = expandedRows(order, {
    mergeGroups: config.display.mergeGroups, rightAlign: config.display.rightAlign,
    width, isActivity: (key) => ACTIVITY.has(key),
  }, (key, align) => entriesFor(frame, key, align));
  rows.push(...changedFiles(frame).map((line) => ({ line, activity: false })));
  if (!order.includes('sessionTokens')) rows.push(...entriesFor(frame, 'sessionTokens').map((line) => ({ line, activity: false })));
  return rows;
}

/** @param {Frame} frame */
function compact(frame) {
  const parts = [
    ...header(frame, true), ...usageParts(frame, true),
    ...['addedDirs', 'environment', 'sessionTime', 'promptCache', 'cacheHitRate', 'memory', 'sessionTokens', 'cost']
      .flatMap((key) => entriesFor(frame, key)),
  ];
  return [
    ...pack(parts, PIPE, frame.width).map((line) => ({ line, activity: false })),
    ...[...ACTIVITY].flatMap((key) => entriesFor(frame, key).map((line) => ({ line, activity: true }))),
  ];
}

/** @param {Frame['state']} state @param {Frame['config']} config @param {import('./render/types.js').RenderDetails} [details] */
export function render(state, config, { git, activity, memory, environment, costTotals, extra, color = true } = {}) {
  const reportedWidth = state.width == null ? Infinity : Math.min(state.width, MAX_TERMINAL_WIDTH);
  const width = config.forceMaxWidth && config.maxWidth ? config.maxWidth : Math.min(reportedWidth, config.maxWidth ?? Infinity);
  const barWidth = width >= 100 ? 10 : width >= 60 ? 6 : 4;
  /** @type {Frame['style']} */
  const style = (text, key) => paint(text, config.colors[key], color);
  const frame = { state, config, git, activity, memory, environment, costTotals, extra, width, barWidth, color, style,
    words: messages(config.language) };
  const rows = config.lineLayout === 'compact' ? compact(frame) : expanded(frame);
  return formatRows(rows, {
    width, color, separator: config.showSeparators ? (line) => style(line, 'label') : undefined,
  });
}
