// @ts-check
import { isDeepStrictEqual, stripVTControlCharacters } from 'node:util';
import { ansiColors, MAX_TERMINAL_WIDTH, visibleWidth } from './terminal.js';

export { ansiColors } from './terminal.js';

/** @typedef {Record<string, unknown>} JsonSchema */
/**
 * @template T
 * @typedef {{
 *   defaultValue: T,
 *   description: string,
 *   schema: JsonSchema,
 *   normalize: (value: unknown) => T | undefined,
 *   accepts?: (value: unknown) => boolean,
 *   manualOnly?: boolean
 * }} Rule
 */
/** @typedef {{ [key: string]: Rule<unknown> | Shape }} Shape */
/** @template S @typedef {{ [K in keyof S]: S[K] extends Rule<infer V> ? V : Values<S[K]> }} Values */
/** @typedef {{ description: string, defaultValue: unknown, schema: JsonSchema, manualOnly: boolean }} RuleMetadata */
/** @typedef {{ valid: boolean, unknown: string[], invalid: string[], unsafe: string[] }} ConfigInspection */

const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const languages = /** @type {const} */ (['en', 'zh-Hans', 'zh-Hant', 'zh', 'zh-TW']);
const elements = /** @type {const} */ ([
  'project', 'addedDirs', 'context', 'usage', 'promptCache', 'cacheHitRate', 'memory', 'environment',
  'tools', 'skills', 'mcp', 'agents', 'sessionTime', 'tasks', 'sessionTokens', 'cost',
]);
const firstLine = /** @type {const} */ (['model', 'project', 'agent', 'sessionName', 'version', 'extra', 'duration', 'cost', 'speed', 'auth']);
const contextWarning = 70;
const contextCritical = 85;
const terminalTextLimit = 250;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @template T
 * @param {T} defaultValue
 * @param {string} description
 * @param {JsonSchema} schema
 * @param {(value: unknown) => T | undefined} normalize
 * @param {{ accepts?: (value: unknown) => boolean, manualOnly?: boolean }=} options
 * @returns {Rule<T>}
 */
function rule(defaultValue, description, schema, normalize, options) {
  return { defaultValue, description, schema, normalize, ...options };
}

/** @param {boolean} fallback @param {string} description */
function flag(fallback, description) {
  return rule(fallback, description, { type: 'boolean' }, (value) => typeof value === 'boolean' ? value : undefined);
}

/** @param {unknown} value @param {number} min @param {number} max @returns {value is number} */
function inRange(value, min, max) {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** @template {number | null} D @param {D} fallback @param {number} min @param {number} max @param {string} description @returns {Rule<number | D>} */
function integer(fallback, min, max, description) {
  const schema = { type: fallback === null ? ['integer', 'null'] : 'integer', minimum: min, maximum: max };
  return rule(fallback, description, schema, (value) => inRange(value, min, max) ? value : value === null && fallback === null ? fallback : undefined);
}

/** @template {string} T @param {T} fallback @param {readonly T[]} options @param {string} description */
function choice(fallback, options, description) {
  return rule(fallback, description, { type: 'string', enum: options }, (value) => options.find((entry) => entry === value));
}

/** @template {string} T @param {readonly T[]} options @param {readonly unknown[]} values @returns {T[]} */
function knownEntries(options, values) {
  const allowed = new Set(options);
  return /** @type {T[]} */ ([...new Set(values.filter((entry) => allowed.has(/** @type {T} */ (entry))))]);
}

/** @template {string} T @param {T[]} fallback @param {readonly T[]} options @param {string} description */
function order(fallback, options, description) {
  return rule(fallback, description, { type: 'array', items: { type: 'string', enum: options }, uniqueItems: true },
    (value) => Array.isArray(value) ? knownEntries(options, value) : undefined);
}

/** @param {string} value */
function cleanText(value) {
  const visible = stripVTControlCharacters(value).replace(/[\p{Cc}\p{Bidi_Control}\u2028\u2029]/gu, '').trim();
  return [...visible].slice(0, terminalTextLimit).join('');
}

/** @param {string} description */
function terminalText(description) {
  return rule('', description, { type: 'string', maxLength: terminalTextLimit },
    (value) => typeof value === 'string' ? cleanText(value) : undefined,
    { accepts: (value) => typeof value === 'string' && value.trim() === cleanText(value) });
}

/** @param {string} description @param {string} fallback */
function barGlyph(description, fallback) {
  /** @param {unknown} value */
  const normalize = (value) => {
    if (typeof value !== 'string') return undefined;
    const glyph = cleanText(value);
    return visibleWidth(glyph) === 1 ? glyph : undefined;
  };
  return rule(fallback, description, { type: 'string', minLength: 1, maxLength: terminalTextLimit },
    normalize, { accepts: (value) => typeof value === 'string' && normalize(value) === value.trim() });
}

/** @param {string} description @param {string} example */
function pathText(description, example) {
  return rule('', description, { type: 'string', examples: [example] }, (value) => typeof value === 'string' ? value.trim() : undefined,
    { accepts: (value) => typeof value === 'string', manualOnly: true });
}

/** @param {string | number} fallback @param {string} description */
function color(fallback, description) {
  const hex = '^#[0-9a-fA-F]{6}$';
  const schema = { anyOf: [
    { type: 'string', enum: [...ansiColors.keys()] },
    { type: 'integer', minimum: 0, maximum: 255 },
    { type: 'string', pattern: hex },
  ], examples: ['cyan', 39, '#1ea7fd'] };
  const hexColor = new RegExp(hex);
  return rule(fallback, description, schema, (value) =>
    inRange(value, 0, 255) || (typeof value === 'string' && (ansiColors.has(value) || hexColor.test(value))) ? value : undefined);
}

const shape = {
  language: rule(/** @type {'en' | 'zh-Hans' | 'zh-Hant'} */ ('en'), 'Language used for HUD labels.',
    { type: 'string', enum: languages }, (value) => {
      if (value === 'zh' || value === 'zh-Hans') return 'zh-Hans';
      if (value === 'zh-TW' || value === 'zh-Hant') return 'zh-Hant';
      return value === 'en' ? 'en' : undefined;
    }, { accepts: (value) => languages.some((entry) => entry === value) }),
  lineLayout: choice('expanded', ['expanded', 'compact'], 'Use separate rows or fit metrics and the project on one line.'),
  pathLevels: rule(/** @type {number | 'full'} */ (1), 'Number of trailing project-directory components to show, or the full path.',
    { anyOf: [{ type: 'integer', minimum: 1, maximum: 20 }, { const: 'full' }], examples: [2, 'full'] },
    (value) => value === 'full' || inRange(value, 1, 20) ? value : undefined),
  maxWidth: integer(null, 1, MAX_TERMINAL_WIDTH, 'Maximum HUD width in terminal columns. Null uses the width reported by agy.'),
  showSeparators: flag(false, 'Insert a divider before activity rows.'),
  forceMaxWidth: flag(false, 'Use maxWidth as a fixed width even when agy reports a smaller width.'),
  elementOrder: order(elements.slice(0, -2), elements, 'Row order in expanded mode. Omit entries to hide or leave them in their default placement.'),
  projectLineOrder: order([], firstLine, 'Order of segments on the project line. Unlisted segments keep their relative order.'),
  gitStatus: {
    enabled: flag(true, 'Show Git information in recognized repositories.'),
    showDirty: flag(true, 'Mark the branch with an asterisk when the working tree has local changes.'),
    showAheadBehind: flag(false, 'Show the number of commits ahead of and behind the tracking branch.'),
    showFileStats: flag(false, 'Show changed files or file counts and line totals, depending on the layout.'),
    showWorktree: flag(false, 'Show the name of a linked Git worktree.'),
    branchOverflow: choice('truncate', ['truncate', 'wrap'], 'Choose how a Git branch fits when the project row is narrow.'),
    pushWarningThreshold: integer(0, 0, 10_000, 'Ahead count at which to use the warning color. Zero disables the threshold.'),
    pushCriticalThreshold: integer(0, 0, 10_000, 'Ahead count at which to use the critical color. Zero disables the threshold.'),
  },
  jjStatus: {
    enabled: flag(false, 'Show Jujutsu status in a jj workspace when the jj executable is available.'),
    showDirty: flag(true, 'Mark recorded changes in the working-copy commit.'),
    showConflicts: flag(true, 'Show when the Jujutsu working-copy commit contains conflicts.'),
  },
  display: {
    showModel: flag(true, 'Show the selected model badge.'),
    showProject: flag(true, 'Show the current project or workspace directory.'),
    showContextBar: flag(true, 'Show a progress bar for context use.'),
    showUsage: flag(true, 'Show model-group quota when agy supplies it.'),
    usageBarEnabled: flag(true, 'Show quota windows as progress bars.'),
    showResetLabel: flag(true, 'Include the reset label before the quota reset time.'),
    showTokenBreakdown: flag(true, 'Show the current input and cache breakdown above the critical context threshold.'),
    showAgents: flag(false, 'Show running and completed subagents.'),
    showTools: flag(false, 'Show current tool activity and completed tool counts.'),
    showSessionName: flag(false, 'Show the conversation title if agy supplies it.'),
    showEffortLevel: flag(false, 'Include reasoning effort in the model badge when available.'),
    showCost: flag(false, 'Show the cost reported by agy or a local standard API price estimate when it is missing.'),
    showDailyCost: flag(false, 'Track and show estimated cost increases since local midnight.'),
    showWeeklyCost: flag(false, 'Track and show estimated cost increases in the configured week.'),
    showSessionTokens: flag(false, 'Show cumulative input and output tokens for the current conversation.'),
    showAgyVersion: flag(false, 'Show the Antigravity CLI version.'),
    showTasks: flag(false, 'Show the number of background tasks and artifacts reported by agy.'),
    showAuth: flag(false, 'Show the account plan reported by agy.'),
    showAuthUser: flag(false, 'Show the account name from the email address reported by agy.'),
    authUserFullEmail: flag(false, 'Use the full email address when showAuthUser is enabled.'),
    showLaunchDir: flag(false, 'Prefix the project path with the launch directory if the shortened path omits it.'),
    showAddedDirs: flag(true, 'Show additional workspace directories when reported by agy or its hooks.'),
    showProvider: flag(false, 'Include the configured provider name on the model badge.'),
    showAgentEffort: flag(false, 'Show the reasoning effort of subagents when agy supplies it.'),
    showSkills: flag(false, 'Show recognized skill activity.'),
    showMcp: flag(false, 'Show recognized MCP tool activity.'),
    showAgentState: flag(false, 'Show agy agent state, operating mode, and sandbox indicator when available.'),
    showAgentModeOnly: flag(false, 'Show only the execution mode when available. Overrides showAgentState.'),
    agentStateFormat: choice('text', ['text', 'icon'], 'Show the agent state as text, or as an icon that names the state only while busy.'),
    showDuration: flag(false, 'Show elapsed conversation time.'),
    showSpeed: flag(false, 'Estimate response tokens per second from recorded hook timing.'),
    showSessionStartDate: flag(false, 'Show the session start time when known.'),
    showLastResponseAt: flag(false, 'Show the timestamp of the last model response when known.'),
    showMemoryUsage: flag(false, 'Show approximate system memory use.'),
    showPromptCache: flag(false, 'Show the current prompt cache token count when available.'),
    showCacheHitRate: flag(false, 'Show the current prompt cache read proportion when agy reports the counts.'),
    showConfigCounts: flag(false, 'Show counts of project and personal instructions, rules, MCP servers, and hooks.'),
    showModelScopedUsage: flag(true, 'Show a dedicated model quota when available.'),
    usagePace: flag(false, 'Highlight quotas projected to run out ahead of the reset.'),
    usageCompact: flag(false, 'Use compact text for quota windows.'),
    showClockSeconds: flag(false, 'Include seconds in wall-clock displays.'),
    showLinks: flag(false, 'Render terminal hyperlinks for supported paths.'),
    recordPreview: flag(false, 'Save a sanitized render frame locally for preview and diagnostics.'),
    mergeGroups: rule(/** @type {(typeof elements[number])[][]} */ ([['context', 'usage']]),
      'Adjacent rows that may share a line in expanded mode. An empty list keeps rows separate.',
      { type: 'array', items: { type: 'array', items: { type: 'string', enum: elements }, uniqueItems: true, minItems: 2 } },
      (value) => Array.isArray(value) ? value.map((group) => Array.isArray(group) ? knownEntries(elements, group) : []).filter((group) => group.length >= 2) : undefined),
    rightAlign: order([], elements, 'Elements that start a right-aligned group in a merged row.'),
    contextWarningThreshold: integer(contextWarning, 0, 100, 'Context use percentage at which to use the warning color.'),
    contextCriticalThreshold: integer(contextCritical, 0, 100, 'Context use percentage at which to use the critical color. Must be at least the warning threshold.'),
    sevenDayThreshold: integer(80, 0, 100, 'Usage percentage at which to show a secondary weekly quota.'),
    usageThreshold: integer(0, 0, 100, 'Minimum percentage of usage before quotas are shown.'),
    environmentThreshold: integer(0, 0, 10_000, 'Minimum combined configuration count before it is shown.'),
    contextValue: choice('percent', ['percent', 'tokens', 'remaining', 'both'], 'Format the context readout as used percentage, tokens, remaining percentage, or both used percentage and tokens.'),
    usageValue: choice('percent', ['percent', 'remaining'], 'Show used or remaining quota percentage.'),
    autoCompactWindow: integer(null, 1, 100_000_000, 'Use a custom context capacity for display. Null uses the reported capacity.'),
    timeFormat: choice('relative', ['relative', 'absolute', 'both', 'elapsed', 'elapsedAndAbsolute'], 'Format of the quota reset or elapsed window time.'),
    hourCycle: choice('auto', ['auto', 'h11', 'h12', 'h23', 'h24'], 'Hour cycle for wall-clock times. Auto follows the locale.'),
    addedDirsLayout: choice('inline', ['inline', 'line'], 'Include additional directories next to the project or on a separate row.'),
    authUserLength: integer(8, 0, 320, 'Maximum display width of the account name. Zero keeps the full name.'),
    toolNameMaxLength: integer(0, 0, 128, 'Maximum width of a tool name. Zero keeps the full name.'),
    toolsMaxVisible: integer(4, 1, 20, 'Maximum number of different completed tools to display.'),
    skillsMaxVisible: integer(4, 1, 20, 'Maximum number of different completed skills to display.'),
    modelFormat: choice('full', ['full', 'compact', 'short'], 'Choose the full model name or a shortened form.'),
    modelSource: choice('stdin', ['stdin', 'auto', 'transcript'], 'Prefer the agy payload, auto fallback to the transcript, or prefer the transcript model.'),
    effortFormat: choice('full', ['full', 'symbol', 'text'], 'Format reasoning effort as a symbol, text, or both.'),
    weeklyCostPeriod: choice('quota', ['quota', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      'Start the cost week at the quota window or at local midnight on the chosen weekday.'),
    modelOverride: terminalText('Replace the displayed model name with custom text.'),
    providerName: terminalText('Text to show when showProvider is enabled.'),
    customLine: terminalText('Display custom text on the project line.'),
    customLinePosition: choice('last', ['last', 'first'], 'Place custom text last or first on the project line.'),
    externalUsagePath: pathText('Read missing quota windows from a matching, sufficiently recent local snapshot.', '~/agy-quota.json'),
    externalUsageWritePath: pathText('Write quota snapshots to this local path for other statusline processes.', '~/agy-quota.json'),
    externalUsageFreshnessMs: integer(300_000, 1000, 86_400_000, 'Maximum age of a quota snapshot in milliseconds.'),
  },
  colors: {
    model: color('cyan', 'Model badge color.'),
    project: color('yellow', 'Project path color.'),
    git: color('magenta', 'Git and Jujutsu status label color.'),
    gitBranch: color('cyan', 'Branch or bookmark color.'),
    label: color('dim', 'Metric label and secondary text color.'),
    context: color('green', 'Normal context usage color.'),
    usage: color('brightBlue', 'Normal quota usage color.'),
    warning: color('yellow', 'Context and other warning color.'),
    usageWarning: color('brightMagenta', 'Quota warning color.'),
    critical: color('red', 'Critical metric color.'),
    custom: color(208, 'Custom project-line text color.'),
    agent: color('dim', 'Agent state and execution mode color.'),
    barFilled: barGlyph('Single-cell symbol for the filled part of progress bars.', '█'),
    barEmpty: barGlyph('Single-cell symbol for the unfilled part of progress bars.', '░'),
  },
};

/** @typedef {Values<typeof shape>} HudConfig */

/** @param {Shape | Rule<unknown>} entry @returns {entry is Rule<unknown>} */
function isRule(entry) {
  return typeof entry.normalize === 'function';
}

/** @param {Shape} group @param {unknown} raw @returns {Record<string, unknown>} */
function resolveGroup(group, raw) {
  const object = isObject(raw) ? raw : {};
  return Object.fromEntries(Object.entries(group).map(([key, entry]) => {
    const value = Object.hasOwn(object, key) ? object[key] : undefined;
    if (!isRule(entry)) return [key, resolveGroup(entry, value)];
    const normalized = entry.normalize(value);
    return [key, normalized === undefined ? structuredClone(entry.defaultValue) : normalized];
  }));
}

/** @param {unknown} [raw] @returns {HudConfig} */
export function normalizeConfig(raw) {
  const config = /** @type {HudConfig} */ (resolveGroup(shape, raw));
  if (config.display.contextCriticalThreshold < config.display.contextWarningThreshold) {
    config.display.contextCriticalThreshold = Math.max(contextCritical, config.display.contextWarningThreshold);
  }
  return config;
}

export const DEFAULT_CONFIG = normalizeConfig();

/** @param {unknown} raw @returns {ConfigInspection} */
export function inspectConfig(raw) {
  /** @type {ConfigInspection} */
  const result = { valid: true, unknown: [], invalid: [], unsafe: [] };
  /** @param {Record<string, unknown>} object @param {Shape} group @param {string} prefix */
  function visit(object, group, prefix) {
    for (const [key, value] of Object.entries(object)) {
      const name = prefix + key;
      if (forbidden.has(key)) result.unsafe.push(name);
      else if (prefix === '' && key === '$schema') {
        if (typeof value !== 'string') result.invalid.push(name);
      } else if (!Object.hasOwn(group, key)) result.unknown.push(name);
      else {
        const entry = group[key];
        if (isRule(entry)) {
          const accepted = entry.accepts?.(value) ?? isDeepStrictEqual(value, entry.normalize(value));
          if (!accepted || (value === undefined && !entry.accepts)) result.invalid.push(name);
        } else if (isObject(value)) visit(value, entry, name + '.');
        else result.invalid.push(name);
      }
    }
  }

  if (isObject(raw)) {
    visit(raw, shape, '');
    const display = isObject(raw.display) ? raw.display : {};
    const warning = shape.display.contextWarningThreshold.normalize(display.contextWarningThreshold) ?? contextWarning;
    const critical = shape.display.contextCriticalThreshold.normalize(display.contextCriticalThreshold);
    if (critical !== undefined && critical < warning) result.invalid.push('display.contextCriticalThreshold');
  } else result.invalid.push('$');
  result.valid = result.unknown.length + result.invalid.length + result.unsafe.length === 0;
  return result;
}

/** @param {Shape} group @param {string} [prefix] @returns {Record<string, RuleMetadata>} */
function collectRules(group, prefix = '') {
  return Object.fromEntries(Object.entries(group).flatMap(([key, entry]) => {
    const path = prefix + key;
    if (isRule(entry)) {
      return [[path, {
        description: entry.description, defaultValue: structuredClone(entry.defaultValue),
        schema: structuredClone(entry.schema), manualOnly: entry.manualOnly === true,
      }]];
    }
    return Object.entries(collectRules(entry, path + '.'));
  }));
}

export const configRules = collectRules(shape);

/** @param {Shape} group @returns {JsonSchema} */
function schemaGroup(group) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(Object.entries(group).map(([key, entry]) => [key, isRule(entry) ? {
      ...structuredClone(entry.schema),
      description: entry.description + (entry.manualOnly ? ' Set this path directly in your configuration file.' : ''),
      default: structuredClone(entry.defaultValue),
    } : schemaGroup(entry)])),
  };
}

/** @returns {JsonSchema} */
export function jsonSchema() {
  const root = schemaGroup(shape);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'AGY HUD configuration',
    ...root,
    properties: {
      $schema: { type: 'string', description: 'JSON Schema URL used by configuration editors.' },
      .../** @type {JsonSchema} */ (root.properties),
    },
  };
}
