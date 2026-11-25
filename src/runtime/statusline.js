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
import { readObject } from './json-file.js';

/** @param {string} [command] */
async function extraLabel(command) {
  if (!command || process.env.AGY_HUD_ALLOW_EXTRA_CMD !== '1' || process.platform === 'win32') return '';
  const { status, stdout } = await readCommand('/bin/sh', ['-c', command], { timeout: 300, maxBuffer: 4096 });
  return status === 0 ? labelText(stdout.split('\n', 1)[0]) : '';
}

/** agy omits model.effort for the Orchestrator; its planner name in settings carries the level, e.g. "Gemini 4 Neon (High)".
 *  @param {string} model
 */
function orchestratorEffort(model) {
  if (!/^orchestrator\b/i.test(model)) return '';
  const planner = objectOrEmpty(objectOrEmpty(readObject(settingsPath())).orchestrator).planner;
  return typeof planner === 'string' ? labelText(/\(([^()]+)\)\s*$/.exec(planner)?.[1] ?? '').toLowerCase() : '';
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
  if (display.showEffortLevel && !state.effort) state.effort = orchestratorEffort(state.model);
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
  state.quota = externalQuota(state, display);
  const details = {
    git, activity, memory, environment, extra, color: !process.env.NO_COLOR,
    costTotals: display.showDailyCost || display.showWeeklyCost ? recordCosts(state, display) : null,
  };
  if (display.recordPreview) recordPreview(state, details);
  return render(state, config, details);
}
