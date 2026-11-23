import { bar, labelText, pack, paint, visibleWidth } from './terminal.js';

const SEPARATOR = ' │ ';
const PIPE = ' | ';

function tokens(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}k`;
  return String(value);
}

function resetDuration(ms) {
  if (ms <= 0) return '';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = hours < 24 ? minutes % 60 : hours % 24;
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

function projectPath(cwd, levels) {
  const safe = labelText(cwd);
  if (!safe || levels === 'full') return safe;
  return safe.split(/[/\\]/).filter(Boolean).slice(-levels).join('/') || safe;
}

function projectPart(frame) {
  const { state, config, git, style } = frame;
  const path = projectPath(state.cwd, config.pathLevels);
  const project = config.display.showProject && path ? style(path, 'project') : '';
  const branchName = labelText(git?.branch);
  if (!config.gitStatus.enabled || !branchName) return project;
  const stars = config.gitStatus.showDirty && git.dirty ? '*' : '';
  const branch = [branchName + stars];
  if (config.gitStatus.showAheadBehind && git.ahead) branch.push(`↑${git.ahead}`);
  if (config.gitStatus.showAheadBehind && git.behind) branch.push(`↓${git.behind}`);
  const status = style('git:(', 'git') + style(branch.join(' '), 'gitBranch') + style(')', 'git');
  return [project, status].filter(Boolean).join(' ');
}

function contextPart(frame, compact) {
  const { state, config, style, color, barWidth } = frame;
  if (!state.context) return '';
  const { used, input, cache } = state.context;
  const { display } = config;
  const shade = used >= display.contextCriticalThreshold ? 'critical' : used >= display.contextWarningThreshold ? 'warning' : 'context';
  const details = [];
  if (display.showTokenBreakdown && used >= display.contextCriticalThreshold) {
    if (input !== null) details.push(`in: ${tokens(input)}`);
    if (cache !== null) details.push(`cache: ${tokens(cache)}`);
  }
  const parts = [
    compact ? '' : style('Context', 'label'),
    display.showContextBar ? bar(used, barWidth, config.colors[shade], color) : '',
    style(`${used}%`, shade),
    details.length ? style(`(${details.join(', ')})`, 'label') : '',
  ];
  return parts.filter(Boolean).join(' ');
}

function usageParts(frame, compact, align = false) {
  const { state, config, style, color, barWidth } = frame;
  const { display } = config;
  const { short, weekly } = state.quota;
  if (!display.showUsage || (!short && !weekly)) return [];

  const resetText = (window) => {
    const duration = resetDuration(window.reset);
    return duration && (display.showResetLabel ? `resets in ${duration}` : duration);
  };
  const label = style(align ? 'Usage  ' : 'Usage', 'label');
  const exhausted = [short, weekly].find((window) => window?.exhausted);
  if (exhausted) {
    const reset = resetText(exhausted);
    const warning = style(`⚠ Limit reached${reset ? ` (${reset})` : ''}`, 'critical');
    return [compact ? warning : `${label} ${warning}`];
  }

  const format = (window, isWeekly) => {
    const shade = window.used >= 90 ? 'critical' : window.used >= 75 ? 'usageWarning' : 'usage';
    const value = display.usageValue === 'remaining' ? 100 - window.used : window.used;
    const duration = resetDuration(window.reset);
    const reset = compact && display.usageBarEnabled && duration ? `${duration} / ${isWeekly ? '7d' : '5h'}` : resetText(window);
    return [
      isWeekly ? style(align && short ? 'Weekly ' : 'Weekly', 'label') : display.usageBarEnabled ? '' : style('5h', 'label'),
      display.usageBarEnabled ? bar(window.used, barWidth, config.colors[shade], color) : '',
      style(`${value}%`, shade),
      reset ? `(${reset})` : '',
    ].filter(Boolean).join(' ');
  };
  if (!short) return [compact ? format(weekly, true) : `${label} ${format(weekly, true)}`];
  const parts = [`${label} ${format(short, false)}`];
  if (weekly && weekly.used >= display.sevenDayThreshold) parts.push(format(weekly, true));
  return parts;
}

function activityParts(frame, activity, width) {
  const { state, config, style } = frame;
  const { display } = config;
  const rows = [];
  if (display.showTools) {
    const activeIcon = style('◐', 'warning');
    const running = activity?.running?.slice(-2).map(({ name, target }) =>
      `${activeIcon} ${style(name, 'model')}${target ? style(`: ${target}`, 'label') : ''}`) ?? [];
    if (running.length === 0 && state.agentState === 'tool_use') running.push(`${activeIcon} ${style('Tool use', 'model')}`);
    const completed = activity?.completed?.slice(0, 4).map(({ name, count }) =>
      `${style('✓', 'context')} ${style(name, 'model')} ${style(`×${count}`, 'label')}`) ?? [];
    rows.push(...pack([...running, ...completed], PIPE, width));
  }
  if (display.showAgents) {
    const ordered = [...state.agents.filter(({ running }) => running), ...state.agents.filter(({ running }) => !running).reverse()];
    for (const { name, model, role, running } of ordered.slice(0, 3)) {
      const marker = running ? style('◐', 'warning') : style('✓', 'context');
      const agent = `${marker} ${style(name, 'git')}${model ? ` ${style(`[${model}]`, 'label')}` : ''}${role ? style(`: ${role}`, 'label') : ''}`;
      rows.push(...pack([agent], PIPE, width));
    }
  }
  if (display.showTasks && state.tasks > 0) rows.push(...pack([style(`Background tasks ${state.tasks}`, 'label')], PIPE, width));
  return rows;
}

export function render(state, config, { git, activity, color = true } = {}) {
  const { display } = config;
  const width = Math.min(state.width ?? Infinity, config.maxWidth ?? Infinity);
  const barWidth = width >= 100 ? 10 : width >= 60 ? 6 : 4;
  const style = (text, key) => paint(text, config.colors[key], color);
  const frame = { state, config, git, color, style, barWidth };
  const compact = config.lineLayout === 'compact';
  const effort = display.showEffortLevel && state.effort && !state.model.toLowerCase().endsWith(`(${state.effort.toLowerCase()})`)
    ? ` ${state.effort}` : '';
  const model = display.showModel ? style(`[${state.model || 'Antigravity'}${effort}]`, 'model') : '';
  const project = projectPart(frame);
  const title = display.showSessionName && state.title ? style(state.title, 'label') : '';
  const version = display.showAgyVersion && state.version ? style(`agy v${state.version}`, 'label') : '';
  const cost = display.showCost && state.cost !== null ? style(`Cost $${state.cost.toFixed(2)}`, 'label') : '';
  const totals = display.showSessionTokens && state.input !== null && state.output !== null
    ? style(`Tokens ${tokens(state.input + state.output)} (in: ${tokens(state.input)}, out: ${tokens(state.output)})`, 'label') : '';
  const context = contextPart(frame, compact);
  const usage = usageParts(frame, compact);
  const lines = compact
    ? pack([[model, context].filter(Boolean).join(' '), project, title, version, ...usage, totals, cost], PIPE, width)
    : pack([model, project, title, version, cost], SEPARATOR, width);

  if (!compact) {
    const combined = [context, usage.join(PIPE)].filter(Boolean).join(SEPARATOR);
    if (combined) {
      if (visibleWidth(combined) <= width) lines.push(combined);
      else lines.push(...pack([context], SEPARATOR, width), ...pack(usageParts(frame, false, Boolean(context)), PIPE, width));
    }
    lines.push(...pack([totals], SEPARATOR, width));
  }

  const activities = activityParts(frame, activity, width);
  if (config.showSeparators && activities.length && lines.length) {
    const count = Math.min(width, Math.max(20, ...lines.map(visibleWidth)));
    lines.push(style('─'.repeat(count), 'label'));
  }
  const rows = [...lines, ...activities];
  return (color ? rows.map((row) => `\x1b[0m${row}`) : rows).join('\n');
}
