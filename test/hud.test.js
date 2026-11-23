import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readActivity, summarizeTranscript } from '../src/activity.js';
import { normalizeConfig } from '../src/config.js';
import { gitStatus } from '../src/git.js';
import { render } from '../src/render.js';
import { normalizeState } from '../src/state.js';
import { stripColor, visibleWidth } from '../src/terminal.js';

const payload = {
  workspace: { current_dir: '/tmp/my-project' },
  model: { id: 'gemini-flash', display_name: 'Gemini Flash' },
  terminal_width: 110,
  context_window: { used_percentage: 45 },
  quota: {
    'gemini-5h': { remaining_fraction: 0.75, reset_in_seconds: 5400 },
    'gemini-weekly': { remaining_fraction: 0.62 },
    '3p-5h': { remaining_fraction: 0.15 },
  },
};
const git = { branch: 'main', dirty: true };

test('renders the upstream two-line HUD style with native agy values', () => {
  const actual = render(normalizeState(payload), normalizeConfig(), { git });
  assert.equal(stripColor(actual), [
    '[Gemini Flash] │ my-project git:(main*)',
    'Context █████░░░░░ 45% │ Usage ███░░░░░░░ 25% (resets in 1h 30m)',
  ].join('\n'));
  assert.match(actual, /\x1b\[36m\[Gemini Flash\]/);
  assert.match(actual, /\x1b\[32m█████\x1b\[2m░/);
  assert.match(actual, /\x1b\[94m███\x1b\[2m░/);
});

test('splits narrow bars and keeps compact layout on one line when it fits', () => {
  const narrow = render(normalizeState({ ...payload, terminal_width: 40 }), normalizeConfig(), { git, color: false });
  assert.equal(narrow, '[Gemini Flash] │ my-project git:(main*)\nContext ██░░ 45%\nUsage   █░░░ 25% (resets in 1h 30m)');
  const compact = render(normalizeState(payload), normalizeConfig({ lineLayout: 'compact' }), { git, color: false });
  assert.equal(compact, '[Gemini Flash] █████░░░░░ 45% | my-project git:(main*) | Usage ███░░░░░░░ 25% (1h 30m / 5h)');
});

test('displays only the current model quota and respects disabled and dedicated buckets', () => {
  const quota = { ...payload.quota, 'gemini-argon-wtu-weekly': { remaining_fraction: 0.15 } };
  const thirdParty = normalizeState({ ...payload, quota, model: { display_name: 'Claude Opus' } });
  assert.equal(thirdParty.quota.short.used, 85);
  assert.equal(thirdParty.quota.weekly, null);
  const argon = normalizeState({ ...payload, quota, model: { display_name: 'Gemini Argon' } });
  assert.equal(argon.quota.short, undefined);
  assert.equal(argon.quota.weekly.used, 85);
  assert.match(render(argon, normalizeConfig(), { color: false }), /Usage Weekly █████████░ 85%/);
  const disabled = normalizeState({ ...payload, quota: { 'gemini-5h': { remaining_fraction: 0, disabled: true }, '3p-5h': quota['3p-5h'] } });
  assert.equal(disabled.quota.short, null);
  assert.doesNotMatch(render(disabled, normalizeConfig(), { color: false }), /Usage/);
});

test('honors weekly thresholds and absolute reset times without hiding quota exhaustion', () => {
  const now = Date.parse('2026-11-23T12:00:00Z');
  const quota = { ...payload.quota, 'gemini-weekly': { remaining_fraction: 0, reset_time: '2026-11-24T14:00:00Z', reset_in_seconds: 5 } };
  const state = normalizeState({ ...payload, quota }, now);
  assert.match(render(state, normalizeConfig(), { color: false }), /Usage ⚠ Limit reached \(resets in 1d 2h\)/);
  quota['gemini-weekly'] = { remaining_fraction: 0.19 };
  assert.match(render(normalizeState({ ...payload, quota }), normalizeConfig(), { color: false }), /Weekly ████████░░ 81%/);
});

test('respects explicit context zero and never uses cumulative input as the context window', () => {
  assert.equal(normalizeState({ context_window: { used_percentage: 0, total_input_tokens: 20_000 } }).context.used, 0);
  assert.equal(normalizeState({ context_window: { context_window_size: 1000, total_input_tokens: 9000 } }).context, null);
  const current_usage = { input_tokens: 450, cache_read_input_tokens: 30, cache_creation_input_tokens: 20 };
  const state = normalizeState({ context_window: { context_window_size: 1000, current_usage } });
  assert.deepEqual(state.context, { used: 50, input: 450, cache: 50, cacheRead: 30, size: 1000, tokens: 500 });
});

test('truncates by terminal cells and keeps untrusted labels out of ANSI controls', () => {
  const state = normalizeState({
    ...payload, model: { display_name: '\x1b[31m界界👩🏻‍💻界界界界\u202e\nInjected' }, terminal_width: 14,
  });
  const actual = render(state, normalizeConfig(), { git });
  assert.doesNotMatch(actual, /\x1b\[31m|\u202e|Injected/);
  assert.match(stripColor(actual), /👩🏻‍💻/);
  for (const line of actual.split('\n')) assert.ok(visibleWidth(line) <= 14);
});

const events = [
  { type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'read_file', args: { Path: '"/tmp/main.js"' } }, { name: 'grep_search' }] },
  { type: 'GENERIC', status: 'DONE' },
  { type: 'GENERIC', status: 'ERROR' },
  { type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'edit_file', args: { Path: '"/tmp/main.js"' } }] },
  { type: 'GENERIC', status: 'RUNNING' },
].map((event) => JSON.stringify(event)).join('\n');

test('pairs parallel calls and results, and reads only a conversation transcript in the brain directory', (t) => {
  const expected = { running: [{ name: 'Edit', target: 'main.js' }], completed: [{ name: 'Read', count: 1 }] };
  assert.deepEqual(summarizeTranscript(events, 'tool_use'), expected);
  assert.deepEqual(summarizeTranscript(events, 'idle').running, []);
  const home = mkdtempSync(join(tmpdir(), 'agy-hub-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const id = '12345678-abcd-ef01-2345-6789abcdef01';
  const suffix = join('brain', id, '.system_generated', 'logs', 'transcript.jsonl');
  const transcriptPath = join(home, '.gemini', 'antigravity', suffix);
  const actualPath = join(home, '.gemini', 'antigravity-cli', suffix);
  mkdirSync(dirname(actualPath), { recursive: true });
  writeFileSync(actualPath, events);
  assert.deepEqual(readActivity({ conversationId: id, transcriptPath, agentState: 'tool_use' }, home), expected);
  assert.equal(readActivity({ conversationId: '../../other', transcriptPath: actualPath }, home), null);
});

test('handles Git before the first commit and displays dirty state in the command entry point', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'agy-hub-git-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '-b', 'hud-test', cwd]);
  assert.deepEqual(gitStatus(cwd, { showAheadBehind: true, showDirty: true }), { branch: 'hud-test', dirty: false, ahead: 0, behind: 0 });
  writeFileSync(join(cwd, 'untracked'), 'test');
  const entry = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const output = execFileSync(process.execPath, [entry], {
    env: { ...process.env, AGY_HUB_CONFIG: join(cwd, 'absent.json'), NO_COLOR: '1' },
    input: JSON.stringify({ ...payload, workspace: { current_dir: cwd } }), encoding: 'utf8',
  });
  assert.match(output, /git:\(hud-test\*\)/);
  assert.doesNotMatch(output, /\x1b/);
});
