// @ts-check
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readActivity } from '../activity.js';
import { readConfig } from '../config.js';
import { gitStatusAsync } from '../git.js';
import { hookActivity } from '../hooks.js';
import { configCounts, externalQuota, memoryUsageAsync, recordCosts } from '../local-data.js';
import { render } from '../render.js';
import { recordPreview } from '../replay.js';
import { normalizeState } from '../state.js';
import { labelText } from '../terminal.js';
import { readInput } from './input.js';

const execFileAsync = promisify(execFile);

/** @param {string} [command] */
async function extraLabel(command) {
  if (!command || process.env.AGY_HUB_ALLOW_EXTRA_CMD !== '1' || process.platform === 'win32') return '';
  try {
    const probe = execFileAsync('/bin/sh', ['-c', command], {
      timeout: 300, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 4096,
    });
    probe.child.stdin?.end();
    return labelText((await probe).stdout.split('\n', 1)[0]);
  } catch {
    return '';
  }
}

/** Read one callback, gather enabled probes, and hand the data to the pure renderer.
 *  @param {string} [extraCommand]
 */
export async function statusline(extraCommand) {
  if (process.env.AGY_HUB_DISABLE === '1') return '';
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
  state.quota = externalQuota(state, display);
  const details = {
    git, activity, memory, environment, extra, color: !process.env.NO_COLOR,
    costTotals: display.showDailyCost || display.showWeeklyCost ? recordCosts(state, display) : null,
  };
  if (display.recordPreview) recordPreview(state, details);
  return render(state, config, details);
}
