import { resolve, relative, isAbsolute, sep } from 'node:path';
import { labelText, linkPath, pack, paint, truncate, visibleWidth } from './terminal.js';
import { clock, contextPart, duration, memoryPart, tokens, usageParts } from './metrics.js';
import { messages } from './messages.js';

const DIVIDER = ' │ ';
const PIPE = ' | ';
const ACTIVITY = new Set(['tools', 'skills', 'mcp', 'agents', 'tasks']);
const EFFORT = { low: '○', medium: '◔', high: '◑', xhigh: '◕', max: '●' };

function effortText(effort, format) {
  const symbol = Object.hasOwn(EFFORT, effort) ? EFFORT[effort] : '';
  if (!symbol || format === 'text') return effort;
  return format === 'symbol' ? symbol : `${symbol} ${effort}`;
}

function projectPath(cwd, levels) {
  const safe = labelText(cwd);
  if (!safe || levels === 'full') return safe;
  return safe.split(/[/\\]/).filter(Boolean).slice(-levels).join('/') || safe;
}

function branchPart(frame, compact) {
  const { config, style, git } = frame;
  const name = labelText(git?.branch);
  if (!name || !(git.vcs === 'jj' ? config.jjStatus.enabled : config.gitStatus.enabled)) return '';
  const isJj = git.vcs === 'jj';
  const opts = isJj ? config.jjStatus : config.gitStatus;
  const fields = [style(name + (opts.showDirty && git.dirty ? '*' : ''), 'gitBranch')];
  if (isJj && opts.showConflicts && git.conflict) fields.push(style('!conflict', 'critical'));
  if (!isJj && opts.showAheadBehind) {
    const { pushWarningThreshold: warn, pushCriticalThreshold: critical } = opts;
    if (git.ahead) {
      const shade = critical > 0 && git.ahead >= critical ? 'critical'
        : warn > 0 && git.ahead >= warn ? 'warning' : 'gitBranch';
      fields.push(style(`↑${git.ahead}`, shade));
    }
    if (git.behind) fields.push(style(`↓${git.behind}`, 'gitBranch'));
  }
  if (!isJj && opts.showFileStats && compact && git.fileStats) {
    for (const [key, symbol] of [['modified', '!'], ['added', '+'], ['deleted', '✘'], ['untracked', '?']]) {
      if (git.fileStats[key]) fields.push(style(`${symbol}${git.fileStats[key]}`, 'gitBranch'));
    }
  }
  if (!compact && opts.showFileStats && git.lineDiff) {
    const diff = [git.lineDiff.added ? style(`+${git.lineDiff.added}`, 'context') : '',
      git.lineDiff.deleted ? style(`-${git.lineDiff.deleted}`, 'critical') : ''].filter(Boolean);
    if (diff.length) fields.push(`[${diff.join(' ')}]`);
  }
  const worktree = opts.showWorktree && labelText(git.worktree);
  return style(isJj ? 'jj:(' : 'git:(', 'git') + fields.join(' ') + style(')', 'git')
    + (worktree ? ' ' + style(`⎇ ${worktree}`, 'git') : '');
}

function addedDirs(frame) {
  const { state, config, style, color } = frame;
  if (!config.display.showAddedDirs) return [];
  return state.addedDirs.map((path) => linkPath(path, style(`+${projectPath(path, 1)}`, 'label'), color && config.display.showLinks));
}

function projectParts(frame, compact) {
  const { state, config, style, color } = frame;
  const { display, pathLevels } = config;
  let project = '';
  if (display.showProject && state.cwd) {
    const path = projectPath(state.cwd, pathLevels);
    const launch = state.launchDir && relative(state.launchDir, state.cwd);
    const outside = launch && (launch === '..' || launch.startsWith('..' + sep) || isAbsolute(launch));
    const beyond = launch && typeof pathLevels === 'number' && launch.split(sep).length >= pathLevels;
    const prefix = display.showLaunchDir && pathLevels !== 'full' && (outside || beyond)
      ? `${projectPath(state.launchDir, 1)} › ` : '';
    project = linkPath(state.cwd, style(prefix + path, 'project'), color && display.showLinks && !compact);
  }
  if (display.addedDirsLayout === 'inline') project = [project, ...addedDirs(frame)].filter(Boolean).join(' ');
  const branch = branchPart(frame, compact);
  if (!branch || !project) return [project || branch];
  return config.gitStatus.branchOverflow === 'wrap' ? [project, branch] : [`${project} ${branch}`];
}

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

function costPart(frame) {
  const { words, config, state, style, costTotals } = frame;
  const money = (value) => `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`;
  const { display } = config;
  const costs = [
    display.showCost && state.cost !== null ? `${words.cost} ${money(state.cost)}` : '',
    display.showDailyCost && costTotals?.day != null ? `${words.today} ${money(costTotals.day)}` : '',
    display.showWeeklyCost && costTotals?.week != null ? `${words.week} ${money(costTotals.week)}` : '',
  ].filter(Boolean);
  return costs.length ? style(costs.join(PIPE), 'label') : '';
}

function account(frame) {
  const { config: { display }, state } = frame;
  const plan = display.showAuth ? state.plan : '';
  let user = display.showAuthUser ? state.email : '';
  if (user && !display.authUserFullEmail) user = user.split('@')[0];
  if (user && display.authUserLength) user = truncate(user, display.authUserLength);
  return [plan, user].filter(Boolean).join(' · ');
}

function header(frame, compact) {
  const { state, config, activity, style } = frame;
  const { display } = config;
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

function activityEntries(frame, key) {
  const { state, config, activity, words, style } = frame;
  const { display } = config;
  const activeIcon = style('◐', 'warning');
  const doneIcon = style('✓', 'context');
  if (['tools', 'skills', 'mcp'].includes(key)) {
    if (!display[{ tools: 'showTools', skills: 'showSkills', mcp: 'showMcp' }[key]]) return [];
    const group = (entry) => (entry.kind ?? 'tools') === key;
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
      const elapsed = start != null && (running || end != null) ? duration((running ? state.now : end) - start, true) : '';
      const modelLabel = [model, display.showAgentEffort && effort ? effortText(effort, display.effortFormat) : ''].filter(Boolean).join(' ');
      return `${running ? activeIcon : doneIcon} ${style(name, 'git')}${modelLabel ? ` ${style(`[${modelLabel}]`, 'label')}` : ''}`
        + description + (elapsed ? style(` (${elapsed})`, 'label') : '');
    });
  }
  if (key === 'tasks' && display.showTasks) {
    return [[state.tasks > 0 ? `${words.tasks} ${state.tasks}` : '',
      state.artifacts > 0 ? `${words.artifacts} ${state.artifacts}` : ''].filter(Boolean).map((part) => style(part, 'label')).join(DIVIDER)];
  }
  return [];
}

function changedFiles(frame) {
  const { config, git, style, width, color } = frame;
  if (!config.gitStatus.showFileStats || !git?.fileStats || width < 60) return [];
  const { trackedFiles, modified, added, deleted, untracked } = git.fileStats;
  const fileStyle = { modified: ['~', 'warning'], added: ['+', 'context'], deleted: ['-', 'critical'] };
  const parts = trackedFiles.map(({ basename, fullPath, type, lineDiff }) => {
    const [prefix, shade] = fileStyle[type];
    const path = git.root ? resolve(git.root, fullPath) : '';
    const inside = path && !relative(git.root, path).split(sep).includes('..');
    const name = linkPath(path, style(labelText(basename), shade), inside && color && config.display.showLinks);
    const diff = [lineDiff?.added ? style(`+${lineDiff.added}`, 'context') : '',
      lineDiff?.deleted ? style(`-${lineDiff.deleted}`, 'critical') : ''].filter(Boolean);
    return style(prefix, shade) + name + (diff.length ? `(${diff.join(' ')})` : '');
  });
  const more = modified + added + deleted - trackedFiles.length;
  if (more > 0) parts.push(style(`+${more} more`, 'label'));
  if (untracked > 0) parts.push(style(`?${untracked}`, 'label'));
  return pack(parts, '  ', width);
}

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
      const counts = environment && display.showConfigCounts ? [
        ['instructions', 'AGENTS.md / GEMINI.md'], ['rules', words.rules], ['mcp', 'MCPs'], ['hooks', words.hooks],
      ] : [];
      if (counts.reduce((total, [item]) => total + environment[item], 0) < display.environmentThreshold) return [];
      return pack(counts.filter(([item]) => environment[item] > 0).map(([item, name]) => style(`${environment[item]} ${name}`, 'label')), DIVIDER, frame.width);
    }
    case 'cacheHitRate': {
      const { input, cache, cacheRead } = state.context ?? {};
      const total = (input ?? 0) + (cache ?? 0);
      return display.showCacheHitRate && cacheRead != null && total > 0
        ? [style(`${words.cacheHit} ${Math.round(100 * cacheRead / total)}%`, 'label')] : [];
    }
    case 'promptCache': {
      const cache = state.context?.cache;
      return display.showPromptCache && cache !== null && cache > 0 ? [style(`${words.cache} ${tokens(cache)} ${words.tokens}`, 'label')] : [];
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

function expanded(frame) {
  const { config, width } = frame;
  const rows = [];
  const groups = new Map();
  for (const group of config.display.mergeGroups) for (const element of group) {
    if (!groups.has(element)) groups.set(element, group);
  }
  const order = config.elementOrder;
  for (let index = 0; index < order.length;) {
    const key = order[index];
    const group = groups.get(key);
    let end = index + 1;
    while (end < order.length && group && group === groups.get(order[end])) end += 1;
    const entries = order.slice(index, end).map((element) => ({ element, lines: entriesFor(frame, element).filter(Boolean) }))
      .filter(({ lines }) => lines.length);
    index = end;
    const joined = entries.map(({ lines }) => lines.join(DIVIDER)).join(DIVIDER);
    if (entries.length > 1 && entries.every(({ lines }) => lines.length === 1) && visibleWidth(joined) <= width) {
      const split = entries.findIndex(({ element }) => config.display.rightAlign.includes(element));
      let line = joined;
      if (split > 0 && Number.isFinite(width)) {
        const left = entries.slice(0, split).map(({ lines }) => lines[0]).join(DIVIDER);
        const right = entries.slice(split).map(({ lines }) => lines[0]).join(DIVIDER);
        line = left + ' '.repeat(width - visibleWidth(left) - visibleWidth(right)) + right;
      }
      rows.push({ line, activity: entries.some(({ element }) => ACTIVITY.has(element)) });
    } else {
      for (const { element, lines } of entries) {
        const parts = entries.length > 1 ? entriesFor(frame, element, true) : lines;
        rows.push(...parts.map((line) => ({ line, activity: ACTIVITY.has(element) })));
      }
    }
  }
  rows.push(...changedFiles(frame).map((line) => ({ line, activity: false })));
  if (!order.includes('sessionTokens')) rows.push(...entriesFor(frame, 'sessionTokens').map((line) => ({ line, activity: false })));
  return rows;
}

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

export function render(state, config, { git, activity, memory, environment, costTotals, extra, color = true } = {}) {
  const width = config.forceMaxWidth && config.maxWidth ? config.maxWidth
    : Math.min(state.width ?? Infinity, config.maxWidth ?? Infinity);
  const barWidth = width >= 100 ? 10 : width >= 60 ? 6 : 4;
  const style = (text, key) => paint(text, config.colors[key], color);
  const frame = { state, config, git, activity, memory, environment, costTotals, extra, width, barWidth, color, style,
    words: messages(config.language) };
  const rows = (config.lineLayout === 'compact' ? compact(frame) : expanded(frame)).filter(({ line }) => line);
  const firstActivity = rows.findIndex(({ activity: active }) => active);
  if (config.showSeparators && firstActivity > 0) {
    const count = Math.min(width, Math.max(20, ...rows.slice(0, firstActivity).map(({ line }) => visibleWidth(line))));
    rows.splice(firstActivity, 0, { line: style('─'.repeat(count), 'label') });
  }
  return rows.map(({ line }) => (color ? '\x1b[0m' : '') + (Number.isFinite(width) ? truncate(line, width) : line)).join('\n');
}
