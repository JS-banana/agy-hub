import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs, { appendFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
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

test('selects the first usable mode from cycle_mode, mode, and agent_mode', () => {
  assert.equal(normalizeState({ cycle_mode: 'auto', mode: 'plan', agent_mode: 'default' }).cycleMode, 'auto');
  assert.equal(normalizeState({ cycle_mode: '  ', mode: '\x1b[31mplan\x1b[0m', agent_mode: 'auto' }).cycleMode, 'plan');
  assert.equal(normalizeState({ cycle_mode: null, mode: false, agent_mode: 'accept-edits' }).cycleMode, 'accept-edits');
  assert.equal(normalizeState({ cycle_mode: {}, vim: { mode: 'INSERT' } }).cycleMode, '');
});

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

test('uses the label color for short and weekly quota countdowns', () => {
  const state = normalizeState({
    ...payload, terminal_width: 160,
    quota: {
      ...payload.quota,
      'gemini-weekly': { remaining_fraction: 0.62, reset_in_seconds: 583_200 },
    },
  });
  const display = { sevenDayThreshold: 0 };
  const expanded = normalizeConfig({ display });
  const actual = render(state, expanded);
  assert.match(actual, /\x1b\[2m\(resets in 1h 30m\)\x1b\[0m/);
  assert.match(actual, /\x1b\[2m\(resets in 6d 18h\)\x1b\[0m/);
  assert.equal(stripColor(actual), render(state, expanded, { color: false }));

  const compact = normalizeConfig({ lineLayout: 'compact', display, colors: { label: '#708090' } });
  const custom = render(state, compact);
  assert.match(custom, /\x1b\[38;2;112;128;144m\(1h 30m \/ 5h\)\x1b\[0m/);
  assert.match(custom, /\x1b\[38;2;112;128;144m\(6d 18h \/ 7d\)\x1b\[0m/);
});

test('splits narrow bars and keeps compact layout on one line when it fits', () => {
  const narrow = render(normalizeState({ ...payload, terminal_width: 40 }), normalizeConfig(), { git, color: false });
  assert.equal(narrow, '[Gemini Flash] │ my-project git:(main*)\nContext ██░░ 45%\nUsage   █░░░ 25% (resets in 1h 30m)');
  const compact = render(normalizeState(payload), normalizeConfig({ lineLayout: 'compact' }), { git, color: false });
  assert.equal(compact, '[Gemini Flash] █████░░░░░ 45% | my-project git:(main*) | Usage ███░░░░░░░ 25% (1h 30m / 5h)');
});

test('bounds alignment even when a payload reports an implausibly wide terminal', () => {
  const state = normalizeState({ ...payload, terminal_width: 1e20 });
  const config = normalizeConfig({ display: { rightAlign: ['usage'] } });
  const lines = render(state, config, { git, color: false }).split('\n');
  assert.equal(visibleWidth(lines[1]), 1000);
  assert.match(lines[1], /Usage .*25%/);
});

test('renders execution mode on its own without changing the full agent status', () => {
  const state = normalizeState({ ...payload, cycle_mode: 'auto', agent_state: 'idle',
    agent: { name: 'reviewer' }, sandbox: { enabled: true } });
  const hud = (settings) => render(state, normalizeConfig(settings), { color: false });
  assert.match(hud({ display: { showAgentState: true } }), /reviewer · idle · auto · Sandbox/);
  const modeOnly = hud({ display: { showAgentModeOnly: true } });
  assert.match(modeOnly, /Auto mode/);
  assert.doesNotMatch(modeOnly, /reviewer|idle|Sandbox/);
  const both = hud({ display: { showAgentState: true, showAgentModeOnly: true } });
  assert.equal(both, modeOnly);
  assert.doesNotMatch(hud({}), /Auto mode|reviewer/);

  const compact = normalizeConfig({ lineLayout: 'compact', language: 'zh-Hant', display: { showAgentModeOnly: true } });
  const plan = normalizeState({ ...payload, cycle_mode: 'plan' });
  assert.match(render(plan, compact, { color: false }), /規劃模式/);
  const missing = normalizeState({ ...payload, agent_state: 'idle' });
  assert.doesNotMatch(render(missing, compact, { color: false }), /模式|idle/);
  const unknown = normalizeState({ ...payload, cycle_mode: 'custom-review' });
  assert.match(render(unknown, compact, { color: false }), /custom-review/);
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

test('matches orchestrator, Gemini codename, and underscore-delimited model IDs to the right quota pool', () => {
  const dualQuota = {
    'gemini-5h': { remaining_fraction: 0.75, reset_in_seconds: 5400 },
    'gemini-weekly': { remaining_fraction: 0.62, reset_in_seconds: 583_200 },
    '3p-5h': { remaining_fraction: 0.15, reset_in_seconds: 3600 },
    '3p-weekly': { remaining_fraction: 0.50, reset_in_seconds: 500_000 },
  };
  for (const displayName of ['Orchestrator (Neon)', 'Orchestrator (Hydrogen)', 'Orchestrator (Carbon)']) {
    const state = normalizeState({ ...payload, quota: dualQuota, model: { display_name: displayName } });
    assert.equal(state.quota.key, 'gemini');
    assert.equal(state.quota.short.used, 25);
    assert.equal(state.quota.weekly.used, 38);
    const rendered = render(state, normalizeConfig({ display: { sevenDayThreshold: 0 } }), { color: false });
    assert.match(rendered, /Usage .*25%/);
    assert.match(rendered, /Weekly .*38%/);
  }

  const underscoreGemini = normalizeState({ ...payload, quota: dualQuota, model: { id: 'MODEL_ORCHESTRATOR_NEON' } });
  assert.equal(underscoreGemini.quota.key, 'gemini');
  assert.equal(underscoreGemini.quota.short.used, 25);

  const underscoreThirdParty = normalizeState({ ...payload, quota: dualQuota, model: { id: 'MODEL_CLAUDE_OPUS_4_6' } });
  assert.equal(underscoreThirdParty.quota.key, '3p');
  assert.equal(underscoreThirdParty.quota.short.used, 85);

  const underscoreArgon = normalizeState({
    ...payload,
    quota: { ...dualQuota, 'gemini-argon-wtu-weekly': { remaining_fraction: 0.15 } },
    model: { id: 'MODEL_ORCHESTRATOR_ARGON' },
  });
  assert.equal(underscoreArgon.quota.key, 'argon');
  assert.equal(underscoreArgon.quota.scoped, true);
  assert.equal(underscoreArgon.quota.weekly.used, 85);

  const argonScoped = normalizeState({
    ...payload,
    quota: { ...dualQuota, 'gemini-argon-wtu-weekly': { remaining_fraction: 0.15 } },
    model: { display_name: 'Orchestrator (Argon)' },
  });
  assert.equal(argonScoped.quota.key, 'argon');
  assert.equal(argonScoped.quota.scoped, true);
  assert.equal(argonScoped.quota.weekly.used, 85);

  const argonFallback = normalizeState({ ...payload, quota: dualQuota, model: { display_name: 'Orchestrator (Argon)' } });
  assert.equal(argonFallback.quota.key, 'gemini');
  assert.equal(argonFallback.quota.short.used, 25);

  const argonDisabled = normalizeState({
    ...payload,
    quota: { 'gemini-argon-wtu-weekly': { remaining_fraction: 0, disabled: true }, '3p-5h': dualQuota['3p-5h'] },
    model: { display_name: 'Orchestrator (Argon)' },
  });
  assert.equal(argonDisabled.quota.key, 'argon');
  assert.deepEqual(argonDisabled.quota.disabled, ['weekly']);
  assert.equal(argonDisabled.quota.short, undefined);

  const thirdPartyOrch = normalizeState({ ...payload, quota: dualQuota, model: { display_name: 'Orchestrator (Opus)' } });
  assert.equal(thirdPartyOrch.quota.key, '3p');
  assert.equal(thirdPartyOrch.quota.short.used, 85);

  const thirdPartyWithCodename = normalizeState({
    ...payload,
    quota: dualQuota,
    model: { display_name: 'Claude Opus (Neon)', id: 'claude-opus-4-6' },
  });
  assert.equal(thirdPartyWithCodename.quota.key, '3p');
  assert.equal(thirdPartyWithCodename.quota.short.used, 85);

  const thirdPartyWithArgon = normalizeState({
    ...payload,
    quota: { ...dualQuota, 'gemini-argon-wtu-weekly': { remaining_fraction: 0.15 } },
    model: { display_name: 'Claude Opus', id: 'MODEL_CLAUDE_OPUS_ARGON' },
  });
  assert.equal(thirdPartyWithArgon.quota.key, '3p');
  assert.equal(thirdPartyWithArgon.quota.short.used, 85);

  const disabledOrch = normalizeState({
    ...payload,
    quota: { 'gemini-5h': { remaining_fraction: 0, disabled: true }, '3p-5h': dualQuota['3p-5h'] },
    model: { display_name: 'Orchestrator (Neon)' },
  });
  assert.equal(disabledOrch.quota.key, 'gemini');
  assert.equal(disabledOrch.quota.short, null);
  assert.doesNotMatch(render(disabledOrch, normalizeConfig(), { color: false }), /Usage/);

  for (const displayName of ['neondb-custom', 'jargon-v1']) {
    const unknown = normalizeState({ ...payload, quota: dualQuota, model: { display_name: displayName } });
    assert.deepEqual(unknown.quota, {});
  }
});

test('honors weekly thresholds and absolute reset times without hiding quota exhaustion', () => {
  const now = Date.parse('2026-11-23T12:00:00Z');
  const quota = { ...payload.quota, 'gemini-weekly': { remaining_fraction: 0, reset_time: '2026-11-24T14:00:00Z', reset_in_seconds: 5 } };
  const state = normalizeState({ ...payload, quota }, now);
  assert.match(render(state, normalizeConfig(), { color: false }), /Usage ⚠ Limit reached \(resets in 1d 2h\)/);
  quota['gemini-weekly'] = { remaining_fraction: 0.19 };
  assert.match(render(normalizeState({ ...payload, quota }), normalizeConfig(), { color: false }), /Weekly ████████░░ 81%/);
});

test('distinguishes expired quota windows from unused windows and unknown reset times', () => {
  const now = Date.parse('2026-11-23T12:00:00Z');
  for (const [bucket, expired] of [
    [{ remaining_fraction: 1, reset_in_seconds: 0 }, false],
    [{ remaining_fraction: 0.62 }, false],
    [{ remaining_amount: 12, reset_in_seconds: 0 }, false],
    [{ remaining_fraction: 0.5, reset_in_seconds: 0 }, true],
    [{ remaining_fraction: 0.999, reset_in_seconds: 0 }, true],
    [{ remaining_amount: 0, reset_in_seconds: 0 }, true],
    [{ remaining_fraction: 1, reset_time: new Date(now).toISOString(), reset_in_seconds: 60 }, true],
    [{ remaining_fraction: 0, reset_time: new Date(now + 1000).toISOString(), reset_in_seconds: 0 }, false],
  ]) {
    const state = normalizeState({ ...payload, quota: { 'gemini-5h': bucket } }, now);
    assert.equal(state.quota.short.expired, expired, JSON.stringify(bucket));
  }
});

test('renders only active quota windows in expanded and compact layouts', () => {
  const now = Date.parse('2026-11-23T12:00:00Z');
  const past = new Date(now - 1000).toISOString();
  const weekly = { remaining_fraction: 0.62, reset_in_seconds: 86_400 };
  for (const [lineLayout, weeklyFrame] of [
    ['expanded', '[Gemini Flash]\nUsage Weekly ████░░░░░░ 38% (resets in 1d)'],
    ['compact', '[Gemini Flash] | Weekly ████░░░░░░ 38% (1d / 7d)'],
  ]) {
    const hud = (short, week, usageThreshold = 0) => {
      const state = normalizeState({ model: payload.model, quota: { 'gemini-5h': short, 'gemini-weekly': week } }, now);
      return render(state, normalizeConfig({ lineLayout, display: { usageThreshold } }), { color: false });
    };
    for (const remaining_fraction of [0.01, 0]) {
      const short = { remaining_fraction, reset_time: past };
      assert.equal(hud(short, weekly), weeklyFrame);
      assert.equal(hud(short, weekly, 40), '[Gemini Flash]');
      assert.equal(hud(short, { ...weekly, reset_time: past }), '[Gemini Flash]');
    }
  }
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

function transcriptFixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'agy-hub-transcript-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const conversationId = '12345678-abcd-ef01-2345-6789abcdef01';
  const cli = join(home, '.gemini', 'antigravity-cli');
  const file = join(cli, 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl');
  mkdirSync(dirname(file), { recursive: true });
  return { file, cursor: join(cli, 'agy-hub-data', 'transcript', `${conversationId}.json`),
    read: (now, agentState = 'idle') => readActivity({ conversationId, now, agentState }, home) };
}

test('reuses complete transcript bytes and expires running tools on cache hits', (t) => {
  const { file, cursor, read } = transcriptFixture(t);
  const now = Date.UTC(2026, 10, 24);
  const planner = { type: 'PLANNER_RESPONSE', created_at: new Date(now).toISOString(), model: '模型',
    tool_calls: [{ name: 'read_file' }, { name: 'grep_search' }, { name: 'grep_search' }] };
  const base = [planner, { type: 'GENERIC', status: 'RUNNING', created_at: planner.created_at }]
    .map((event) => JSON.stringify(event) + '\n').join('');
  writeFileSync(file, base);

  // Count only reads from the already-open transcript, excluding the cursor JSON.
  const { ino } = statSync(file, { bigint: true });
  const readSync = fs.readSync;
  const ranges = [];
  const spy = t.mock.method(fs, 'readSync', (fd, buffer, offset, length, position) => {
    const bytes = readSync(fd, buffer, offset, length, position);
    if (fs.fstatSync(fd, { bigint: true }).ino === ino) ranges.push([Number(position), bytes]);
    return bytes;
  });
  syncBuiltinESMExports();
  t.after(() => { spy.mock.restore(); syncBuiltinESMExports(); });

  const start = Buffer.byteLength(base);
  assert.deepEqual(read(now), summarizeTranscript(base, 'idle', now));
  assert.deepEqual(ranges.splice(0), [[0, start]]);
  assert.equal(read(now + 59_999).running[0].name, 'Read');
  assert.deepEqual(read(now + 60_000).running, []);
  assert.deepEqual(read(now + 60_000, 'tool_use').running.map(({ name }) => name), ['Read', 'Grep', 'Grep']);
  assert.deepEqual(ranges, []);

  const done = JSON.stringify({ type: 'GENERIC', status: 'DONE' });
  const suffix = done + '\n' + done;
  appendFileSync(file, suffix);
  const frame = read(now);
  assert.deepEqual(frame, summarizeTranscript(base + suffix, 'idle', now));
  assert.deepEqual(frame.completed, [{ name: 'Grep', count: 2 }]);
  assert.deepEqual(ranges.splice(0), [[0, start + Buffer.byteLength(suffix)]]);
  const committed = start + Buffer.byteLength(done + '\n');
  const saved = readFileSync(cursor, 'utf8');
  assert.equal(JSON.parse(saved).offset, committed);
  assert.deepEqual(read(now), frame);
  assert.equal(readFileSync(cursor, 'utf8'), saved);
  assert.deepEqual(ranges.splice(0), [[committed, Buffer.byteLength(done)]]);
  appendFileSync(file, '\n');
  assert.deepEqual(read(now), frame);
  assert.deepEqual(ranges.splice(0), [[0, committed + Buffer.byteLength(done + '\n')]]);
  assert.equal(JSON.parse(readFileSync(cursor, 'utf8')).offset, statSync(file).size);
  assert.deepEqual(read(now), frame);
  assert.deepEqual(ranges, []);
});

test('rebuilds the cursor after truncation, replacement or invalid cache data', (t) => {
  const { file, cursor, read } = transcriptFixture(t);
  const line = (model) => JSON.stringify({ type: 'PLANNER_RESPONSE', model }) + '\n';
  writeFileSync(file, line('Original model'));
  assert.equal(read().model, 'Original model');
  writeFileSync(file, line('New'));
  assert.equal(read().model, 'New');
  // Keep the inode and rewrite to the same size, then past the saved offset.
  const padding = JSON.stringify({ type: 'USER_INPUT', text: 'x'.repeat(8192) }) + '\n';
  for (const model of ['One', 'Two', 'Three']) {
    writeFileSync(file, padding + line(model) + padding);
    assert.equal(read().model, model);
  }
  writeFileSync(file + '.new', line('Two'));
  renameSync(file + '.new', file);
  assert.equal(read().model, 'Two');
  const saved = JSON.parse(readFileSync(cursor, 'utf8'));
  for (const corrupt of ['{', JSON.stringify({ ...saved, version: 1 }), JSON.stringify({ ...saved, offset: -1 }),
    JSON.stringify({ ...saved, state: { ...saved.state, completed: { 'tools:Read': { name: 'Read', count: -2 } } } }),
    JSON.stringify({ ...saved, state: { ...saved.state, pending: Array(1025).fill(null) } }),
    ' '.repeat(256 * 1024) + '{}']) {
    writeFileSync(cursor, corrupt);
    assert.deepEqual(read(), summarizeTranscript(line('Two'), 'idle'));
    assert.deepEqual(JSON.parse(readFileSync(cursor, 'utf8')), saved);
  }
  // An unwritable cursor must still yield the transcript for this frame.
  rmSync(cursor);
  mkdirSync(cursor);
  assert.equal(read().model, 'Two');
});

test('bounds transcript verification as a growing log moves beyond the cached range', (t) => {
  const { file, cursor, read } = transcriptFixture(t);
  const block = JSON.stringify({ type: 'USER_INPUT', text: 'x'.repeat(4 * 1024 * 1024) }) + '\n';
  const planner = (model) => JSON.stringify({ type: 'PLANNER_RESPONSE', model }) + '\n';
  writeFileSync(file, planner('First') + block);
  assert.equal(read().model, 'First');
  for (let i = 0; i < 2; i++) {
    appendFileSync(file, block);
    assert.equal(read().model, 'First');
  }
  appendFileSync(file, block + planner('Latest'));
  assert.equal(read().model, 'Latest');
  const saved = JSON.parse(readFileSync(cursor, 'utf8'));
  assert.equal(saved.start, statSync(file).size - 8 * 1024 * 1024);
  appendFileSync(file, '{}\n');
  assert.equal(read().model, 'Latest');
});

test('resumes after an oversized partial line and a split UTF-8 append', (t) => {
  const { file, cursor, read } = transcriptFixture(t);
  const initial = JSON.stringify({ type: 'PLANNER_RESPONSE', model: 'Earlier' }) + '\n';
  writeFileSync(file, initial);
  assert.equal(read().model, 'Earlier');
  appendFileSync(file, ' '.repeat(8 * 1024 * 1024) + initial.trimEnd());
  assert.deepEqual(read(), { running: [], completed: [] });

  const offset = statSync(file).size + 1;
  const line = Buffer.from(JSON.stringify({ type: 'PLANNER_RESPONSE', model: '星', created_at: '2026-11-24T00:00:00Z' }) + '\n');
  const split = line.indexOf('星') + 1;
  appendFileSync(file, Buffer.concat([Buffer.from('\n'), line.subarray(0, split)]));
  assert.deepEqual(read(), { running: [], completed: [] });
  assert.equal(JSON.parse(readFileSync(cursor, 'utf8')).offset, offset);
  appendFileSync(file, line.subarray(split));
  const expected = { running: [], completed: [], model: '星', lastReply: Date.UTC(2026, 10, 24) };
  assert.deepEqual(read(), expected);
  assert.deepEqual(read(), expected);
});

test('handles Git before the first commit and displays dirty state in the command entry point', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'agy-hub-git-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '-b', 'hud-test', cwd]);
  assert.deepEqual(gitStatus(cwd, { showAheadBehind: true, showDirty: true }), { branch: 'hud-test', dirty: false, ahead: 0, behind: 0 });
  writeFileSync(join(cwd, 'untracked'), 'test');
  const entry = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const output = execFileSync(process.execPath, [entry], {
    env: { ...process.env, AGY_HUB_CONFIG: join(cwd, 'absent.json'), AGY_HUB_DISABLE: '0', NO_COLOR: '1' },
    input: JSON.stringify({ ...payload, workspace: { current_dir: cwd } }), encoding: 'utf8',
  });
  assert.match(output, /git:\(hud-test\*\)/);
  assert.doesNotMatch(output, /\x1b/);
});
