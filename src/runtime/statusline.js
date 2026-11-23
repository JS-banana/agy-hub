import { execFileSync } from 'node:child_process';
import { readActivity } from '../activity.js';
import { readConfig } from '../config.js';
import { gitStatus } from '../git.js';
import { hookActivity } from '../hooks.js';
import { configCounts, externalQuota, memoryUsage, recordCosts } from '../local-data.js';
import { render } from '../render.js';
import { recordPreview } from '../replay.js';
import { normalizeState } from '../state.js';
import { labelText } from '../terminal.js';
import { readInput } from './input.js';

function extraLabel(command) {
  if (!command || process.env.AGY_HUB_ALLOW_EXTRA_CMD !== '1' || process.platform === 'win32') return '';
  try {
    return labelText(execFileSync('/bin/sh', ['-c', command], {
      timeout: 300, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 4096, stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\n', 1)[0]);
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
  const git = config.gitStatus.enabled || config.jjStatus.enabled ? gitStatus(state.cwd, config.gitStatus, state.vcs, config.jjStatus) : null;
  const { display } = config;
  const transcript = display.showTools || display.showSkills || display.showMcp || display.showDuration
    || display.showSessionStartDate || display.showLastResponseAt || display.showSpeed || display.modelSource !== 'stdin'
    ? readActivity(state) : null;
  const activity = hookActivity(state, transcript, display);
  state.quota = externalQuota(state, display);
  const details = {
    git, activity, color: !process.env.NO_COLOR, extra: extraLabel(extraCommand),
    memory: display.showMemoryUsage ? memoryUsage() : null,
    environment: display.showConfigCounts ? configCounts(state) : null,
    costTotals: display.showDailyCost || display.showWeeklyCost ? recordCosts(state, display) : null,
  };
  if (display.recordPreview) recordPreview(state, details);
  return render(state, config, details);
}
