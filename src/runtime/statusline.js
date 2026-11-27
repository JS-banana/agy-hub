// @ts-check
import { readActivity } from '../activity.js';
import { readConfig } from '../config.js';
import { gitStatusAsync } from '../git.js';
import { hookActivity } from '../hooks.js';
import { configCounts, externalQuota, memoryUsageAsync, recordCosts } from '../local-data.js';
import { objectOrEmpty } from '../objects.js';
import { render } from '../render.js';
import { recordPreview } from '../replay.js';
import { settingsPath } from '../setup.js';
import { normalizeState } from '../state.js';
import { labelText } from '../terminal.js';
import { readCommand } from './command.js';
import { readInput } from './input.js';
import { readTextFile } from './text-file.js';

const SETTINGS_BYTES = 1024 * 1024;
const PLANNER_EFFORT = new Map(Object.entries({
  low: 'low', medium: 'medium', high: 'high',
  xhigh: 'xhigh', 'extra high': 'xhigh', extra: 'xhigh', max: 'max',
}));

/** @param {string} [command] */
async function extraLabel(command) {
  if (!command || process.env.AGY_HUD_ALLOW_EXTRA_CMD !== '1') return '';
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
  const args = isWindows ? ['/d', '/s', '/c', `"${command}"`] : ['-c', command];
  const { status, stdout } = await readCommand(shell, args, {
    timeout: isWindows ? 1000 : 300, maxBuffer: 4096, windowsVerbatimArguments: isWindows,
  });
  return status === 0 ? labelText(stdout.split(/\r?\n/, 1)[0]) : '';
}

/** agy omits model.effort for the Orchestrator; its planner name in settings carries the level, e.g. "Gemini 4 Neon (High)".
 *  @param {string} model
 */
function orchestratorEffort(model) {
  if (!/^orchestrator\b/i.test(model)) return '';
  try {
    const file = readTextFile(settingsPath(), SETTINGS_BYTES);
    if (!file) return '';
    const parsed = /** @type {unknown} */ (JSON.parse(file.text));
    const planner = objectOrEmpty(objectOrEmpty(parsed).orchestrator).planner;
    if (typeof planner !== 'string') return '';
    const raw = labelText(/\(([^()]+)\)\s*$/.exec(planner)?.[1] ?? '').toLowerCase().replace(/\s+/g, ' ');
    return PLANNER_EFFORT.get(raw) ?? '';
  } catch {
    return '';
  }
}

/** Read one callback, gather enabled probes, and hand the data to the pure renderer.
 *  @param {string} [extraCommand]
 */
export async function statusline(extraCommand) {
  if (process.env.AGY_HUD_DISABLE === '1') return '';
  const payload = await readInput();
  if (!payload) return '';
  const config = readConfig();
  const state = normalizeState(payload);
  const { display } = config;
  const vcsPromise = config.gitStatus.enabled || config.jjStatus.enabled
    ? gitStatusAsync(state.cwd, config.gitStatus, state.vcs, config.jjStatus) : null;
  const memoryPromise = display.showMemoryUsage ? memoryUsageAsync() : null;
  const extraPromise = extraLabel(extraCommand);
  const activityPromise = Promise.resolve().then(() => {
    const transcript = display.showTools || display.showSkills || display.showMcp || display.showDuration
      || display.showSessionStartDate || display.showLastResponseAt || display.showSpeed || display.modelSource !== 'stdin'
      ? readActivity(state) : null;
    return hookActivity(state, transcript, display);
  });
  // Session hooks can add workspaces that contribute to the environment counts.
  const environmentPromise = display.showConfigCounts ? activityPromise.then(() => configCounts(state)) : null;
  const [git, activity, memory, environment, extra] = await Promise.all([
    vcsPromise, activityPromise, memoryPromise, environmentPromise, extraPromise,
  ]);
  if (display.showEffortLevel && !state.effort && !(display.modelSource === 'transcript' && activity?.model)) {
    state.effort = orchestratorEffort(state.model);
  }
  state.quota = externalQuota(state, display);
  const details = {
    git, activity, memory, environment, extra, color: !process.env.NO_COLOR,
    costTotals: display.showDailyCost || display.showWeeklyCost ? recordCosts(state, display) : null,
  };
  if (display.recordPreview) recordPreview(state, details);
  return render(state, config, details);
}
