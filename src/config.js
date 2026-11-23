import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const configPath = () => process.env.AGY_HUB_CONFIG ?? join(homedir(), '.gemini', 'antigravity-cli', 'agy-hub.json');

const colorDefaults = {
  model: 'cyan', project: 'yellow', git: 'magenta', gitBranch: 'cyan', label: 'dim',
  context: 'green', usage: 'brightBlue', warning: 'yellow', usageWarning: 'brightMagenta', critical: 'red',
};

export const ansiColors = new Map(Object.entries({
  dim: 2, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35,
  cyan: 36, white: 37, brightBlue: 94, brightMagenta: 95,
}));

const displayDefaults = {
  showModel: true, showProject: true, showContextBar: true, showUsage: true, usageBarEnabled: true,
  showResetLabel: true, showTokenBreakdown: true,
  showAgents: false, showTools: false, showSessionName: false, showEffortLevel: false,
  showCost: false, showSessionTokens: false, showAgyVersion: false, showTasks: false,
};

const gitDefaults = { enabled: true, showDirty: true, showAheadBehind: false };

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
  const warning = integer(display?.contextWarningThreshold, 70, 0, 100);
  return {
    lineLayout: raw?.lineLayout === 'compact' ? 'compact' : 'expanded',
    pathLevels: raw?.pathLevels === 'full' ? 'full' : integer(raw?.pathLevels, 1, 1, 20),
    maxWidth: integer(raw?.maxWidth, null, 1, 1000),
    showSeparators: raw?.showSeparators === true,
    gitStatus: booleans(gitDefaults, raw?.gitStatus),
    display: {
      ...booleans(displayDefaults, display),
      contextWarningThreshold: warning,
      contextCriticalThreshold: integer(display?.contextCriticalThreshold, Math.max(85, warning), warning, 100),
      sevenDayThreshold: integer(display?.sevenDayThreshold, 80, 0, 100),
      usageValue: display?.usageValue === 'remaining' ? 'remaining' : 'percent',
    },
    colors: Object.fromEntries(Object.entries(colorDefaults).map(([key, value]) => [
      key, validColor(raw?.colors?.[key]) ? raw.colors[key] : value,
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
