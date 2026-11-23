// @ts-check
import { render } from './render.js';
import { normalizeState } from './state.js';

/** @param {import('./config-schema.js').HudConfig} config
 *  @param {{width?:number,color?:boolean}} [options]
 */
export function samplePreview(config, { width = 110, color = true } = {}) {
  const state = normalizeState({
    cwd: '/workspace/my-project', model: { display_name: 'Gemini 3.8 Flash', effort: 'high' },
    workspace: { current_dir: '/workspace/my-project' },
    conversation_title: 'Review authentication', version: '1.5.14',
    context_window: { used_percentage: 45, context_window_size: 200_000, total_input_tokens: 59_000, total_output_tokens: 3200 },
    terminal_width: width,
    quota: { 'gemini-5h': { remaining_fraction: 0.75, reset_in_seconds: 5400 } },
    subagents: [{ name: 'explore', model: 'Gemini Flash', status: 'running', role: 'Finding auth code' }],
  });
  return render(state, config, {
    color, git: {
      branch: 'main', dirty: true, ahead: 2, behind: 0,
      fileStats: { modified: 1, added: 0, deleted: 0, untracked: 1,
        trackedFiles: [{ basename: 'auth.ts', fullPath: 'src/auth.ts', type: 'modified', lineDiff: { added: 12, deleted: 3 } }] },
      lineDiff: { added: 12, deleted: 3 },
    },
    activity: {
      running: [{ name: 'Edit', target: 'auth.ts' }],
      completed: [{ name: 'Read', count: 3 }, { name: 'Grep', count: 2 }],
      started: state.now - 145_000, lastReply: state.now - 10_000,
    },
  });
}
