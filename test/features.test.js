import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { summarizeTranscript } from '../src/activity.js';
import { normalizeConfig } from '../src/config.js';
import { hookActivity, hookDefinitions, recordHook } from '../src/hooks.js';
import { configCounts, externalQuota, recordCosts } from '../src/local-data.js';
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
