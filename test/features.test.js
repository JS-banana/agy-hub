import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, renameSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readActivity, summarizeTranscript } from '../src/activity.js';
import { normalizeConfig } from '../src/config.js';
import { hookActivity, hookDefinitions, recordHook } from '../src/hooks.js';
import { configCounts, externalQuota, recordCosts } from '../src/local-data.js';
import { resolveCost } from '../src/pricing.js';
import { render } from '../src/render.js';
import { normalizeState } from '../src/state.js';
import { stripColor, visibleWidth } from '../src/terminal.js';

const NOW = new Date(2026, 10, 23, 12, 0, 0).getTime();
const conversationId = '12345678-abcd-ef01-2345-6789abcdef01';
const sample = {
  cwd: '/tmp/project', model: { display_name: 'Gemini Flash (High)', effort: 'high' },
  context_window: { used_percentage: 43, context_window_size: 200_000 },
  quota: { 'gemini-5h': { remaining_fraction: 0.75, reset_in_seconds: 5600 } },
  terminal_width: 100,
};
const view = (payload, config, details = {}) =>
  render(normalizeState(payload, NOW), normalizeConfig(config), { ...details, color: false });

function temp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'agy-hub-features-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('prefers a reported cost including zero and estimates absent amounts from cumulative tokens', () => {
  const display = { display: { showCost: true, modelOverride: 'Custom badge' } };
  const payload = {
    model: { id: 'gemini-3.8-flash-medium', display_name: 'Gemini 3.8 Flash (Medium)' },
    context_window: { total_input_tokens: 1_000_000, total_output_tokens: 1_000_000,
      current_usage: { input_tokens: 1, output_tokens: 1 } },
  };
  assert.match(view(payload, display), /Cost ≈\$4\.50/);
  assert.match(view({ ...payload, cost: { total_usd: 0 } }, display), /Cost \$0\.00/);
  assert.match(view({ ...payload, cost: { total_usd: 0.75 } }, display), /Cost \$0\.75/);
  assert.doesNotMatch(view(payload), /Cost/);
  assert.doesNotMatch(view({ ...payload, context_window: { current_usage: payload.context_window.current_usage } }, display), /Cost/);
  assert.doesNotMatch(view({ ...payload, context_window: { total_input_tokens: 123 } }, display), /Cost/);
  assert.doesNotMatch(view({ ...payload, context_window: { total_input_tokens: 0, total_output_tokens: 0 } }, display), /Cost/);
  assert.match(view({ ...payload, context_window: { total_input_tokens: 1, total_output_tokens: 0 } }, display), /Cost <\$0\.0001/);
});

test('resolves official model aliases and rate cutovers without a default price', () => {
  const window = { total_input_tokens: 1_000_000, total_output_tokens: 1_000_000 };
  const local = (model, now = NOW) => resolveCost(normalizeState({ model, context_window: window }, now));
  const newYear = Date.UTC(2027, 0, 1);
  const december = Date.UTC(2026, 11, 1);
  assert.equal(local({ id: 'models/gemini-3.8-flash-high' }, newYear - 1).usd, 4.50);
  assert.equal(local({ id: 'models/gemini-3.8-flash-high' }, newYear).usd, 9);
  assert.equal(local({ display_name: 'Gemini 4 Argon (Medium)' }, december - 1).usd, 12);
  assert.equal(local({ display_name: 'Gemini 4 Argon (Medium)' }, december).usd, 24);
  assert.equal(local({ id: 'gemini-3.1-pro-high' }).usd, 14);
  assert.equal(local({ id: 'claude-opus-5-5-max', display_name: 'Claude Sonnet 5.5 (Thinking)' }).usd, 24);
  assert.equal(local({ display_name: 'Claude Sonnet 5.5 (Thinking)' }).usd, 12);
  assert.equal(local({ id: 'claude-opus-4-6' }).usd, 30);
  assert.equal(local({ id: 'claude-opus-4-20250514' }).usd, 90);
  assert.equal(local({ id: 'claude-3-7-sonnet-20250219' }).usd, 18);
  for (const id of ['gemini-3.5-pro', 'gemini-3.8-flash-tts', 'gemini-pro-orchestrator-argon', 'future-model']) {
    assert.equal(local({ id }), null);
  }
});

test('stdin and preview replay show local cost and mode without writing the estimate to the ledger', (t) => {
  const directory = temp(t);
  const config = join(directory, 'config.json');
  writeFileSync(config, JSON.stringify({ gitStatus: { enabled: false }, display: {
    showCost: true, showDailyCost: true, showAgentModeOnly: true, recordPreview: true,
  } }));
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const run = (args, payload) => execFileSync(process.execPath, [cli, ...args], {
    input: payload && JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, AGY_HUB_CONFIG: config, AGY_HUB_DATA_DIR: directory, AGY_HUB_DISABLE: '0', NO_COLOR: '1' },
  });
  const payload = {
    conversation_id: conversationId, model: { id: 'claude-sonnet-5-5-high' },
    cost: null, context_window: { total_input_tokens: 400_000, total_output_tokens: 100_000 },
    quota: { '3p-weekly': { remaining_fraction: 0.62 } },
    agent_state: 'idle', agent_mode: 'plan', terminal_width: 100,
  };
  const frame = run([], payload);
  assert.match(frame, /Cost ≈\$1\.80/);
  assert.match(frame, /Plan mode/);
  assert.match(frame, /Usage Weekly .*38%/);
  assert.doesNotMatch(frame, /idle/);
  assert.equal(existsSync(join(directory, 'cost')), false);
  assert.equal(run(['preview', '--last', '--plain']), frame);
  const previewFile = join(directory, 'preview.json');
  const legacy = JSON.parse(readFileSync(previewFile, 'utf8'));
  assert.equal(legacy.version, 1);
  delete legacy.state.quota.weekly.expired;
  writeFileSync(previewFile, JSON.stringify(legacy));
  assert.equal(run(['preview', '--last', '--plain']), frame);
  assert.match(run([], { ...payload, cost: { total_usd: 0 } }), /Cost \$0\.00/);
  assert.equal(existsSync(join(directory, 'cost', `${conversationId}.json`)), true);
});

test('orders sections and header segments, aligns only fitting sections, and uses localized numbers', () => {
  const row = view(sample, {
    language: 'zh-TW',
    elementOrder: ['context', 'usage', 'project'],
    projectLineOrder: ['project', 'model'],
    display: { contextValue: 'both', rightAlign: ['usage'], showEffortLevel: true, effortFormat: 'symbol' },
    colors: { barFilled: '#', barEmpty: '-' },
  }).split('\n');
  assert.equal(visibleWidth(row[0]), 100);
  assert.match(row[0], /^上下文 ####------ 43% \(86k\/200k\).+用量 ###------- 25%/);
  assert.equal(row[1], 'project │ [Gemini Flash ◑]');
  assert.match(view({ ...sample, terminal_width: 39 }, {
    elementOrder: ['context', 'usage'], display: { rightAlign: ['usage'] },
  }), /^Context .+\nUsage {3}/);
  assert.match(view(sample, { maxWidth: 25, forceMaxWidth: true }), /\n/);
});

test('renders true balance-only quotas and pace indicators without inventing a percentage', () => {
  assert.match(view({ ...sample, quota: { 'gemini-weekly': { remaining_amount: 1234 } } }), /Usage Weekly 1,234 left/);
  assert.match(view({ ...sample, quota: { 'gemini-weekly': { remaining_amount: 0.004 } } }), /Usage Weekly 0\.004 left/);
  assert.match(view({ ...sample, quota: { 'gemini-weekly': { remaining_amount: 1e-8 } } }), /Usage Weekly 1E-8 left/);
  const escalating = { ...sample, quota: { 'gemini-5h': { remaining_fraction: 0.76, reset_in_seconds: 16_200 } } };
  assert.match(view(escalating, { display: { usagePace: true, usageThreshold: 70, timeFormat: 'elapsed' } }), /24% ▲ \(10% elapsed\)/);
  assert.match(view(sample, { display: { usageBarEnabled: false, usageValue: 'remaining', timeFormat: 'both' } }),
    /Usage 5h 75% \(resets in 1h 34m, at /);
});

test('uses amount and percentage snapshots only for the same model pool and while fresh', (t) => {
  const path = join(temp(t), 'quota.json');
  const config = normalizeConfig({ display: { externalUsagePath: path, externalUsageWritePath: path } }).display;
  const original = normalizeState(sample, NOW);
  assert.equal(externalQuota(original, config).short.used, 25);
  const missing = { ...sample, quota: {} };
  const matches = externalQuota(normalizeState(missing, NOW + 1000), config);
  assert.equal(matches.short.reset, original.quota.short.reset - 1000);
  assert.equal(externalQuota(normalizeState(missing, NOW + 600_000), config).short, null);
  assert.equal(externalQuota(normalizeState({ ...missing, model: { id: 'claude-opus' } }, NOW + 1000), config).short, null);
  const weekly = { 'gemini-weekly': { remaining_fraction: 0.125 } };
  externalQuota(normalizeState({ ...sample, quota: { ...sample.quota, ...weekly } }, NOW + 2000), config);
  assert.equal(externalQuota(normalizeState(sample, NOW + 2500), config).weekly.used, 88);
  const disabled = { ...sample, quota: { ...sample.quota, 'gemini-weekly': { disabled: true } } };
  assert.equal(externalQuota(normalizeState(disabled, NOW + 3000), config).weekly, null);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).weekly, null);
});

test('preserves a fresh snapshot from another session when the native short window expires', (t) => {
  const path = join(temp(t), 'quota.json');
  const display = normalizeConfig({ display: { externalUsagePath: path, externalUsageWritePath: path } }).display;
  const observe = (quota, now) => externalQuota(normalizeState({ ...sample, quota }, now), display);
  const saved = () => JSON.parse(readFileSync(path, 'utf8'));
  const expired = { 'gemini-5h': { remaining_fraction: 0, reset_time: new Date(NOW).toISOString() } };
  assert.equal(observe(expired, NOW).short, null);
  assert.equal(existsSync(path), false);

  observe({ ...sample.quota, 'gemini-weekly': { remaining_fraction: 0.75 } }, NOW);
  const original = saved();
  const later = NOW + 31_000;
  const restored = observe(expired, later).short;
  assert.equal(restored.used, 25);
  assert.equal(restored.expired, false);
  assert.equal(restored.reset, original.short.resetAt - later);
  assert.deepEqual(saved(), original);

  const merged = observe({ ...expired, 'gemini-weekly': { remaining_fraction: 0.5 } }, later);
  assert.deepEqual(merged.short, restored);
  assert.equal(merged.weekly.used, 50);
  const updated = saved();
  assert.deepEqual(updated.short, original.short);
  assert.equal(updated.weekly.used, 50);
  assert.equal(updated.weekly.observedAt, later);
});

test('discards snapshots observed before a known native reset while preserving the other window', (t) => {
  const path = join(temp(t), 'quota.json');
  const display = normalizeConfig({ display: { externalUsagePath: path, externalUsageWritePath: path } }).display;
  const observe = (quota, now) => externalQuota(normalizeState({ ...sample, quota }, now), display);
  const deadline = NOW + 1000;
  const expired = { 'gemini-5h': { remaining_fraction: 0, reset_time: new Date(deadline).toISOString() } };
  observe({ 'gemini-5h': { remaining_fraction: 0 }, 'gemini-weekly': { remaining_fraction: 0.62 } }, NOW);
  const after = observe(expired, deadline);
  assert.equal(after.short, null);
  assert.equal(after.weekly.used, 38);
  assert.equal(observe({}, deadline + 1).short, null);
  observe({ 'gemini-5h': { remaining_fraction: 0.75 } }, deadline + 2);
  assert.equal(observe(expired, deadline + 3).short.used, 25);
  const nextReset = new Date(deadline + 4).toISOString();
  const merged = observe({ 'gemini-5h': { remaining_fraction: 0, reset_time: nextReset },
    'gemini-weekly': { remaining_fraction: 0.5 } }, deadline + 5);
  assert.equal(merged.short, null);
  assert.equal(merged.weekly.used, 50);
  assert.equal(observe({}, deadline + 6).short, null);
});

test('replaces an elapsed snapshot with a fresh unused window whose only reset hint is zero', (t) => {
  const path = join(temp(t), 'quota.json');
  const display = normalizeConfig({ display: { externalUsagePath: path, externalUsageWritePath: path } }).display;
  const quota = (reset) => ({ 'gemini-5h': { remaining_fraction: 1, reset_in_seconds: reset } });
  externalQuota(normalizeState({ ...sample, quota: quota(1) }, NOW), display);
  externalQuota(normalizeState({ ...sample, quota: quota(0) }, NOW + 1000), display);
  const restored = externalQuota(normalizeState({ ...sample, quota: {} }, NOW + 2000), display).short;
  assert.equal(restored.used, 0);
  assert.equal(restored.expired, false);
  assert.equal(restored.reset, 0);
});

test('never restores a quota snapshot past its known reset even when the snapshot is still fresh', (t) => {
  const path = join(temp(t), 'quota.json');
  const display = normalizeConfig({ display: { externalUsagePath: path, externalUsageWritePath: path } }).display;
  const weekly = { 'gemini-weekly': { remaining_fraction: 0.5 } };
  const native = { ...sample, quota: { ...weekly, 'gemini-5h': { remaining_fraction: 0, reset_in_seconds: 1 } } };
  const missing = { ...sample, quota: {} };
  externalQuota(normalizeState(native, NOW), display);
  assert.equal(externalQuota(normalizeState(missing, NOW + 500), display).short.exhausted, true);
  const afterReset = externalQuota(normalizeState(missing, NOW + 1000), display);
  assert.equal(afterReset.short, null);
  assert.equal(afterReset.weekly.reset, 0);

  // A new window can start with unchanged data, still requiring a fresh snapshot.
  externalQuota(normalizeState(native, NOW + 1000), display);
  const renewed = externalQuota(normalizeState(missing, NOW + 1500), display);
  assert.equal(renewed.short.reset, 500);

  externalQuota(normalizeState({ ...sample, quota: weekly }, NOW + 2000), display);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).short, null);
  const alreadyReset = { ...sample, quota: { 'gemini-5h': { remaining_fraction: 0, reset_in_seconds: 0 } } };
  externalQuota(normalizeState(alreadyReset, NOW + 2500), display);
  assert.equal(externalQuota(normalizeState(missing, NOW + 2501), display).short, null);
});

test('records cumulative estimated cost changes once and separates quota weeks by model group', (t) => {
  const directory = temp(t);
  const settings = normalizeConfig().display;
  const quota = { ...sample.quota, 'gemini-weekly': { remaining_fraction: 0.55, reset_in_seconds: 200_000 } };
  const state = normalizeState({ ...sample, quota, conversation_id: conversationId, cost: { total_usd: 0.25 } }, NOW);
  assert.deepEqual(recordCosts(state, settings, directory), { day: 0, week: 0 });
  assert.deepEqual(recordCosts(state, settings, directory), { day: 0, week: 0 });
  assert.deepEqual(recordCosts({ ...state, cost: 0.375, now: NOW + 1000 }, settings, directory), { day: 0.125, week: 0.125 });
  const thirdParty = { ...state, now: NOW + 2000, cost: 0.5, quota: { key: '3p', weekly: state.quota.weekly } };
  assert.deepEqual(recordCosts(thirdParty, settings, directory), { day: 0.25, week: 0.125 });
  const ended = normalizeState({ ...sample, quota: { 'gemini-weekly': { remaining_fraction: 0.55, reset_in_seconds: 0 } } }, NOW + 3000);
  assert.deepEqual(recordCosts(ended, settings, directory), { day: 0.25, week: null });
});

test('migrates a large legacy cost ledger without losing exact times or counting unpublished batches', (t) => {
  const directory = temp(t);
  const costRoot = join(directory, 'cost');
  const file = join(costRoot, `${conversationId}.json`);
  mkdirSync(costRoot);
  const events = Array.from({ length: 2000 }, (_, index) => ({
    time: NOW - index * 1000, value: 0.125, group: index % 2 ? '3p' : 'gemini',
  }));
  writeFileSync(file, JSON.stringify({ total: 250, events }, null, 2));
  assert.ok(statSync(file).size > 128 * 1024);
  const settings = normalizeConfig().display;
  const quota = { 'gemini-weekly': { remaining_fraction: 0.5, reset_in_seconds: 604_794 } };
  const state = normalizeState({ ...sample, quota, conversation_id: conversationId, cost: { total_usd: 250.25 } }, NOW + 1000);
  assert.deepEqual(recordCosts(state, settings, directory), { day: 250.25, week: 0.625 });
  assert.deepEqual(recordCosts(state, settings, directory), { day: 250.25, week: 0.625 });

  const ledger = JSON.parse(readFileSync(file, 'utf8'));
  const archiveRoot = join(costRoot, 'archives', conversationId);
  assert.ok(ledger.archives.length > 0 && ledger.events.length < events.length);
  for (const archive of ledger.archives) {
    assert.ok(statSync(join(archiveRoot, `${archive.id}.json`)).size < 128 * 1024);
  }
  // An interrupted write can leave a new batch on disk without publishing it.
  writeFileSync(join(archiveRoot, `${ledger.nextArchive}.json`), JSON.stringify({ events: [{ time: NOW, value: 1024 }] }));
  assert.deepEqual(recordCosts({ ...state, cost: null }, settings, directory), { day: 250.25, week: 0.625 });

  const muchLater = { ...state, now: state.now + 22 * 86_400_000, cost: 250.5 };
  assert.deepEqual(recordCosts(muchLater, settings, directory), { day: 0.25, week: 0.25 });
  assert.equal(existsSync(join(archiveRoot, `${ledger.archives[0].id}.json`)), false);
});

test('retains an unreadable cost ledger without resetting its cumulative baseline', (t) => {
  const directory = temp(t);
  const root = join(directory, 'cost');
  const file = join(root, `${conversationId}.json`);
  mkdirSync(root);
  const unreadable = '{"total":';
  writeFileSync(file, unreadable);
  const state = normalizeState({ ...sample, conversation_id: conversationId, cost: { total_usd: 1 } }, NOW);
  assert.deepEqual(recordCosts(state, normalizeConfig().display, directory), { day: 0, week: null });
  assert.equal(readFileSync(file, 'utf8'), unreadable);
});

test('preserves the cost baseline while a stale write lock is recovered', (t) => {
  const directory = temp(t);
  const lock = join(directory, 'cost', `${conversationId}.json.lock`);
  const settings = normalizeConfig().display;
  const state = normalizeState({ ...sample, conversation_id: conversationId, cost: { total_usd: 1 } }, NOW);
  assert.deepEqual(recordCosts(state, settings, directory), { day: 0, week: null });
  writeFileSync(lock, '');
  const old = new Date(Date.now() - 30_000);
  utimesSync(lock, old, old);
  const next = { ...state, cost: 1.25 };
  assert.deepEqual(recordCosts(next, settings, directory), { day: 0, week: null });
  assert.equal(existsSync(lock), false);
  assert.deepEqual(recordCosts(next, settings, directory), { day: 0.25, week: null });
});

test('combines the documented AGY hook lifecycle with transcript data and excludes secrets', (t) => {
  const directory = temp(t);
  const definitions = hookDefinitions()['agy-hub'];
  assert.match(definitions.PostToolUse[0].hooks[0].command, / hook PostToolUse$/);
  assert.match(definitions.SessionStart[0].command, / hook SessionStart$/);
  const input = { conversationId, workspacePaths: ['/tmp/project', '/tmp/shared'], lastUserInput: 'secret prompt' };
  recordHook('SessionStart', input, directory, NOW);
  recordHook('PreInvocation', { ...input, invocationNum: 0 }, directory, NOW);
  recordHook('PostInvocation', { ...input, invocationNum: 0 }, directory, NOW + 2000);
  recordHook('PreToolUse', { ...input, stepIdx: 2, toolCall: { name: 'run_command', args: { CommandLine: 'secret command' } } }, directory, NOW + 2100);
  recordHook('PostToolUse', { ...input, stepIdx: 1, toolCall: { name: 'view_file',
    args: { AbsolutePath: '/workspace/.agents/skills/search/SKILL.md', IsSkillFile: true } } }, directory, NOW + 2100);
  const state = normalizeState({ ...sample, conversation_id: conversationId }, NOW + 2500);
  const activity = hookActivity(state, { lastReply: NOW + 1700, replyTokens: 40 }, { showSkills: true, showSpeed: true }, directory);
  assert.equal(activity.speed, 20);
  assert.deepEqual(state.addedDirs, ['/tmp/shared']);
  assert.deepEqual(activity.running, [{ name: 'Bash', target: '' }]);
  assert.deepEqual(activity.completed, [{ name: 'search', kind: 'skills', count: 1 }]);
  const toolFile = join(directory, 'hooks', conversationId, 'tools', '2.pre.json');
  assert.doesNotMatch(readFileSync(toolFile, 'utf8'), /secret/);
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const invoke = (event) => JSON.parse(execFileSync(process.execPath, [cli, 'hook', event], {
    input: JSON.stringify({ conversationId, stepIdx: 3, toolCall: { name: 'read_file' } }),
    env: { ...process.env, AGY_HUB_DATA_DIR: directory }, encoding: 'utf8',
  }));
  assert.deepEqual(invoke('PreToolUse'), { decision: 'allow' });
  assert.deepEqual(invoke('PostToolUse'), {});
});

test('reuses hook tool counts while stable, expires running tools, and invalidates on atomic changes', (t) => {
  const directory = temp(t);
  const root = join(directory, 'hooks', conversationId);
  const tools = join(root, 'tools');
  const cache = join(root, 'tool-activity.json');
  const state = normalizeState({ ...sample, conversation_id: conversationId }, NOW);
  const readAt = (now) => hookActivity({ ...state, now }, null, { showTools: true }, directory);
  const record = (event, stepIdx, name) => recordHook(event, { conversationId, stepIdx, toolCall: { name } }, directory, NOW);
  recordHook('SessionStart', { conversationId }, directory, NOW);
  record('PreToolUse', 1, 'read_file');
  assert.equal(readAt(NOW).running[0].name, 'Read');

  const firstCache = statSync(cache).ino;
  const elapsed = NOW + 300_000;
  assert.equal(readAt(elapsed).running, undefined);
  assert.equal(statSync(cache).ino, firstCache);
  record('PostToolUse', 1, 'read_file');
  assert.deepEqual(readAt(elapsed).completed.map(({ name }) => name), ['Read']);
  record('PostToolUse', 2, 'edit_file');
  assert.deepEqual(readAt(elapsed).completed.map(({ name }) => name), ['Read', 'Edit']);
  renameSync(join(tools, '2.post.json'), join(tools, '1.post.json'));
  assert.deepEqual(readAt(elapsed).completed.map(({ name }) => name), ['Edit']);
  rmSync(join(tools, '1.post.json'));
  assert.deepEqual(readAt(elapsed).completed, []);

  record('PostToolUse', 3, 'read_file');
  assert.deepEqual(readAt(elapsed).completed.map(({ name }) => name), ['Read']);
  const saved = JSON.parse(readFileSync(cache, 'utf8'));
  writeFileSync(cache, JSON.stringify({ ...saved, completed: [{ name: 'invalid', count: -1 }] }));
  assert.deepEqual(readAt(elapsed).completed.map(({ name }) => name), ['Read']);

  const lastCache = readFileSync(cache, 'utf8');
  writeFileSync(join(tools, '4.post.json'), '{');
  assert.deepEqual(readAt(elapsed).completed.map(({ name }) => name), ['Read']);
  assert.equal(readFileSync(cache, 'utf8'), lastCache);
  record('PostToolUse', 4, 'write_file');
  assert.deepEqual(readAt(elapsed).completed.map(({ name }) => name), ['Read', 'Write']);
});

test('uses hook session start instead of the first event in a truncated transcript', (t) => {
  const home = temp(t);
  const root = join(home, 'data');
  const file = join(home, '.gemini', 'antigravity-cli', 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl');
  mkdirSync(dirname(file), { recursive: true });
  const started = NOW - 7_200_000;
  const lastReply = NOW - 30_000;
  const initial = { type: 'USER_INPUT', created_at: new Date(started).toISOString() };
  const recent = { type: 'PLANNER_RESPONSE', created_at: new Date(lastReply).toISOString() };
  const state = normalizeState({ ...sample, conversation_id: conversationId }, NOW);
  const config = normalizeConfig({ display: { showDuration: true, showSessionStartDate: true } });
  writeFileSync(file, [initial, recent].map((event) => JSON.stringify(event)).join('\n'));
  assert.equal(readActivity(state, home).started, started);

  writeFileSync(file, [{ ...initial, text: 'x'.repeat(8 * 1024 * 1024) }, recent]
    .map((event) => JSON.stringify(event)).join('\n'));
  const tail = readActivity(state, home);
  assert.equal(tail.started, undefined);
  assert.equal(tail.lastReply, lastReply);
  assert.doesNotMatch(render(state, config, { activity: tail, color: false }), /Started|⏱/);
  recordHook('SessionStart', { conversationId }, root, started);
  const activity = hookActivity(state, tail, config.display, root);
  assert.equal(activity.started, started);
  assert.match(render(state, config, { activity, color: false }), /⏱️  2h/);
});

test('renders tool and subagent stages with known transcript timings and no invented agent duration', () => {
  const transcript = [
    { type: 'USER_INPUT', created_at: new Date(NOW - 5000).toISOString() },
    { type: 'PLANNER_RESPONSE', created_at: new Date(NOW - 2500).toISOString(), model: 'Gemini 3.8 Flash',
      output_tokens: 17, tool_calls: [{ name: 'mcp__sample__search' }] },
    { type: 'GENERIC', status: 'DONE' },
  ].map((event) => JSON.stringify(event)).join('\n');
  const activity = summarizeTranscript(transcript, 'idle');
  const payload = { ...sample, subagents: [{ name: 'research', status: 'running', model: 'Flash' }] };
  const config = { display: { showTools: true, showMcp: true, showAgents: true, modelSource: 'transcript' } };
  const running = view(payload, config, { activity });
  assert.match(running, /\[Gemini 3.8 Flash\]/);
  assert.match(running, /✓ mcp__sample__search ×1\n◐ research \[Flash\]$/);
  payload.subagents[0].status = 'completed';
  assert.match(view(payload, config, { activity }), /✓ research \[Flash\]$/);
});

test('counts local customizations up to the repository root and truncates linked rows safely', (t) => {
  const home = temp(t);
  const project = join(home, 'parent-project');
  const cwd = join(project, 'work');
  const fixture = [
    join(project, '.git', 'HEAD'), join(project, 'AGENTS.md'), join(project, '.agents', 'rules', 'rule.md'),
    join(project, '.agents', 'mcp_config.json'),
    join(cwd, '.agents', 'hooks.json'), join(home, '.gemini', 'GEMINI.md'),
  ];
  for (const path of fixture) mkdirSync(dirname(path), { recursive: true });
  for (const path of fixture) writeFileSync(path, path.endsWith('mcp_config.json') ? '{"mcpServers":{"local":{}}}' :
    path.endsWith('hooks.json') ? '{"listener":{"PostToolUse":[{"hooks":[{"command":"true"}]}]}}' : 'fixture');
  const state = normalizeState({ ...sample, cwd, terminal_width: 14, workspace: { current_dir: cwd } }, NOW);
  assert.deepEqual(configCounts(state, home), { instructions: 2, rules: 1, mcp: 1, hooks: 1 });
  writeFileSync(join(cwd, '.agents', 'hooks.json'), JSON.stringify(hookDefinitions()));
  assert.equal(configCounts(state, home).hooks, 5);
  const config = normalizeConfig({ pathLevels: 'full', display: { showLinks: true } });
  const projectLine = render(state, config).split('\n')[1];
  assert.match(projectLine, /\x1b\]8;;file:/);
  assert.match(projectLine, /\x1b\]8;;\x1b\\/);
  assert.ok(visibleWidth(stripColor(projectLine)) <= 14);
});
