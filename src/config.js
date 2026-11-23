import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { stripVTControlCharacters } from 'node:util';
import { join } from 'node:path';

export const configPath = () => process.env.AGY_HUB_CONFIG ?? join(homedir(), '.gemini', 'antigravity-cli', 'agy-hub.json');

const colorDefaults = {
  model: 'cyan', project: 'yellow', git: 'magenta', gitBranch: 'cyan', label: 'dim',
  context: 'green', usage: 'brightBlue', warning: 'yellow', usageWarning: 'brightMagenta', critical: 'red',
  custom: 208, barFilled: '█', barEmpty: '░',
};

export const ansiColors = new Map(Object.entries({
  dim: 2, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35,
  cyan: 36, white: 37, brightBlue: 94, brightMagenta: 95,
}));

const displayDefaults = {
  showModel: true, showProject: true, showContextBar: true, showUsage: true, usageBarEnabled: true,
  showResetLabel: true, showTokenBreakdown: true,
  showAgents: false, showTools: false, showSessionName: false, showEffortLevel: false,
  showCost: false, showDailyCost: false, showWeeklyCost: false, showSessionTokens: false, showAgyVersion: false,
  showTasks: false, showAuth: false, showAuthUser: false, authUserFullEmail: false,
  showLaunchDir: false, showAddedDirs: true, showProvider: false, showAgentEffort: false,
  showSkills: false, showMcp: false, showAgentState: false,
  showDuration: false, showSpeed: false, showSessionStartDate: false, showLastResponseAt: false,
  showMemoryUsage: false, showPromptCache: false, showCacheHitRate: false, showConfigCounts: false,
  showModelScopedUsage: true, usagePace: false, usageCompact: false, showClockSeconds: false,
  showLinks: false, recordPreview: false,
};

const gitDefaults = { enabled: true, showDirty: true, showAheadBehind: false, showFileStats: false, showWorktree: false };
const jjDefaults = { enabled: false, showDirty: true, showConflicts: true };

const elements = ['project', 'addedDirs', 'context', 'usage', 'promptCache', 'cacheHitRate', 'memory', 'environment',
  'tools', 'skills', 'mcp', 'agents', 'sessionTime', 'tasks', 'sessionTokens', 'cost'];
const defaultOrder = elements.slice(0, -2);
const firstLine = ['model', 'project', 'agent', 'sessionName', 'version', 'extra', 'duration', 'cost', 'speed', 'auth'];
const uniqueChoices = (value, options, fallback = []) => Array.isArray(value)
  ? [...new Set(value.filter((entry) => options.includes(entry)))] : fallback;
const choice = (value, options, fallback = options[0]) => options.includes(value) ? value : fallback;
const shortText = (value) => typeof value === 'string'
  ? stripVTControlCharacters(value).replace(/[\p{Cc}\p{Bidi_Control}\u2028\u2029]/gu, '').trim().slice(0, 250) : '';

function booleans(defaults, overrides) {
  return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [
    key, typeof overrides?.[key] === 'boolean' ? overrides[key] : value,
  ]));
}

function integer(value, fallback, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function validColor(value) {
  return ansiColors.has(value) || integer(value, null, 0, 255) !== null
    || (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value));
}

export function normalizeConfig(raw) {
  const display = raw?.display;
  const git = raw?.gitStatus;
  const warning = integer(display?.contextWarningThreshold, 70, 0, 100);
  const language = choice(raw?.language, ['en', 'zh-Hans', 'zh-Hant', 'zh', 'zh-TW']);
  const order = uniqueChoices(raw?.elementOrder, elements, defaultOrder);
  const mergeGroups = Array.isArray(display?.mergeGroups) ? display.mergeGroups
    .map((group) => uniqueChoices(group, elements)).filter((group) => group.length > 1) : [['context', 'usage']];
  return {
    language: ({ zh: 'zh-Hans', 'zh-TW': 'zh-Hant' })[language] ?? language,
    lineLayout: raw?.lineLayout === 'compact' ? 'compact' : 'expanded',
    pathLevels: raw?.pathLevels === 'full' ? 'full' : integer(raw?.pathLevels, 1, 1, 20),
    maxWidth: integer(raw?.maxWidth, null, 1, 1000),
    showSeparators: raw?.showSeparators === true,
    forceMaxWidth: raw?.forceMaxWidth === true,
    elementOrder: order,
    projectLineOrder: uniqueChoices(raw?.projectLineOrder, firstLine),
    gitStatus: {
      ...booleans(gitDefaults, git),
      branchOverflow: choice(git?.branchOverflow, ['truncate', 'wrap']),
      pushWarningThreshold: integer(git?.pushWarningThreshold, 0, 0, 10_000),
      pushCriticalThreshold: integer(git?.pushCriticalThreshold, 0, 0, 10_000),
    },
    jjStatus: booleans(jjDefaults, raw?.jjStatus),
    display: {
      ...booleans(displayDefaults, display),
      mergeGroups,
      rightAlign: uniqueChoices(display?.rightAlign, elements),
      contextWarningThreshold: warning,
      contextCriticalThreshold: integer(display?.contextCriticalThreshold, Math.max(85, warning), warning, 100),
      sevenDayThreshold: integer(display?.sevenDayThreshold, 80, 0, 100),
      usageThreshold: integer(display?.usageThreshold, 0, 0, 100),
      environmentThreshold: integer(display?.environmentThreshold, 0, 0, 10_000),
      contextValue: choice(display?.contextValue, ['percent', 'tokens', 'remaining', 'both']),
      usageValue: choice(display?.usageValue, ['percent', 'remaining']),
      autoCompactWindow: integer(display?.autoCompactWindow, null, 1, 100_000_000),
      timeFormat: choice(display?.timeFormat, ['relative', 'absolute', 'both', 'elapsed', 'elapsedAndAbsolute']),
      hourCycle: choice(display?.hourCycle, ['auto', 'h11', 'h12', 'h23', 'h24']),
      addedDirsLayout: choice(display?.addedDirsLayout, ['inline', 'line']),
      authUserLength: integer(display?.authUserLength, 8, 0, 320),
      toolNameMaxLength: integer(display?.toolNameMaxLength, 0, 0, 128),
      toolsMaxVisible: integer(display?.toolsMaxVisible, 4, 1, 20),
      skillsMaxVisible: integer(display?.skillsMaxVisible, 4, 1, 20),
      modelFormat: choice(display?.modelFormat, ['full', 'compact', 'short']),
      modelSource: choice(display?.modelSource, ['stdin', 'auto', 'transcript']),
      effortFormat: choice(display?.effortFormat, ['full', 'symbol', 'text']),
      weeklyCostPeriod: choice(display?.weeklyCostPeriod, ['quota', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
      modelOverride: shortText(display?.modelOverride),
      providerName: shortText(display?.providerName),
      customLine: shortText(display?.customLine),
      customLinePosition: choice(display?.customLinePosition, ['last', 'first']),
      externalUsagePath: typeof display?.externalUsagePath === 'string' ? display.externalUsagePath.trim() : '',
      externalUsageWritePath: typeof display?.externalUsageWritePath === 'string' ? display.externalUsageWritePath.trim() : '',
      externalUsageFreshnessMs: integer(display?.externalUsageFreshnessMs, 300_000, 1000, 86_400_000),
    },
    colors: Object.fromEntries(Object.entries(colorDefaults).map(([key, value]) => [
      key, ['barFilled', 'barEmpty'].includes(key) ? shortText(raw?.colors?.[key]) || value
        : validColor(raw?.colors?.[key]) ? raw.colors[key] : value,
    ])),
  };
}

export function readConfig(file = configPath()) {
  try {
    return normalizeConfig(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return normalizeConfig();
  }
}
