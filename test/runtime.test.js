import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../src/config.js';
import { recordHook } from '../src/hooks.js';
import { readInput } from '../src/runtime/input.js';

test('stdin uses a byte limit and decodes UTF-8 across chunks', async () => {
  const bytes = Buffer.from('{"model":"星"}');
  const split = bytes.indexOf(0xe6) + 1;
  assert.deepEqual(await readInput(Readable.from([bytes.subarray(0, split), bytes.subarray(split)]), bytes.length), { model: '星' });
  assert.equal(await readInput(Readable.from([bytes]), bytes.length - 1), null);
  assert.equal(await readInput(Readable.from(['[]'])), null);
});

test('config accepts regular symlinks and ignores oversized input and FIFOs without blocking', { skip: process.platform === 'win32' }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-read-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const regular = join(root, 'hud.json');
  const link = join(root, 'link.json');
  const pipe = join(root, 'pipe.json');
  writeFileSync(regular, '{"lineLayout":"compact"}');
  symlinkSync(regular, link);
  assert.equal(readConfig(link).lineLayout, 'compact');
  writeFileSync(regular, '{"lineLayout":"compact"}' + ' '.repeat(100_000));
  assert.equal(readConfig(link).lineLayout, 'expanded');
  execFileSync('mkfifo', [pipe]);
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const output = execFileSync(process.execPath, [cli], {
    input: '{"model":{"display_name":"Protected"},"context_window":{"used_percentage":3}}',
    env: { ...process.env, HOME: root, AGY_HUD_CONFIG: pipe, NO_COLOR: '1', AGY_HUD_DISABLE: '0' },
    encoding: 'utf8', timeout: 2000,
  });
  assert.match(output, /\[Protected\]\nContext/);
  const doctor = JSON.parse(execFileSync(process.execPath, [cli, 'doctor'], {
    env: { ...process.env, HOME: root, AGY_HUD_CONFIG: pipe }, encoding: 'utf8', timeout: 2000,
  }));
  assert.equal(doctor.configuration.error, 'unreadable');
});

test('preset preview is independent of an existing configuration', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-preset-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = join(root, 'config.json');
  writeFileSync(config, '{"lineLayout":"compact","display":{"showModel":false}}');
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const preview = execFileSync(process.execPath, [cli, 'preview', '--preset', 'default', '--plain'], {
    env: { ...process.env, AGY_HUD_CONFIG: config }, encoding: 'utf8',
  });
  assert.match(preview, /^\[Gemini [^\n]+\nContext /);
  const resolved = execFileSync(process.execPath, [cli, 'config', 'path'], {
    env: { ...process.env, HOME: root, AGY_HUD_CONFIG: '' }, encoding: 'utf8',
  }).trim();
  assert.equal(resolved, join(root, '.gemini', 'antigravity-cli', 'agy-hud.json'));
});

test('a partial replay file is a cache miss in diagnostics', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-replay-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = join(root, 'data');
  mkdirSync(data);
  writeFileSync(join(data, 'preview.json'), '{"state":{},"details":{}}');
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const output = execFileSync(process.execPath, [cli, 'report'], {
    env: { ...process.env, HOME: root, AGY_HUD_DATA_DIR: data, AGY_HUD_CONFIG: join(root, 'hud.json') }, encoding: 'utf8',
  });
  const report = JSON.parse(output);
  assert.equal(report.capturedFrame, null);
  assert.equal('paths' in report, false);
  assert.doesNotMatch(output, /agy-hud-replay-/);
});

test('a timed-out extra command leaves memory and hook workspace counts in the frame', { skip: process.platform === 'win32' }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-probes-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'project');
  const shared = join(root, 'shared');
  const data = join(root, 'data');
  const config = join(root, 'config.json');
  const conversationId = '12345678-abcd-ef01-2345-6789abcdef01';
  mkdirSync(cwd);
  mkdirSync(shared);
  writeFileSync(join(shared, 'AGENTS.md'), 'Shared instructions');
  writeFileSync(config, JSON.stringify({ gitStatus: { enabled: false }, display: { showConfigCounts: true, showMemoryUsage: true } }));
  recordHook('SessionStart', { conversationId, workspacePaths: [cwd, shared] }, data);
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const run = (command, allow = '1') => execFileSync(process.execPath, [cli, '--extra-cmd', command], {
    env: { ...process.env, HOME: root, AGY_HUD_CONFIG: config, AGY_HUD_DATA_DIR: data,
      AGY_HUD_ALLOW_EXTRA_CMD: allow, NO_COLOR: '1', AGY_HUD_DISABLE: '0' },
    input: JSON.stringify({ cwd, model: { display_name: 'Probes' }, conversation_id: conversationId }),
    encoding: 'utf8', timeout: 2500,
  });
  const command = 'printf "extra-label\\nsecond line\\n"';
  const labeled = run(command);
  assert.match(labeled, /extra-label/);
  assert.doesNotMatch(labeled, /second line/);
  assert.match(run('head -c 5000 /dev/zero >&2; ' + command), /extra-label/);
  assert.doesNotMatch(run(command + '; head -c 5000 /dev/zero'), /extra-label/);
  assert.doesNotMatch(run(command, '0'), /extra-label/);
  const frame = run(command + ' && exec sleep 5');
  assert.doesNotMatch(frame, /extra-label/);
  assert.match(frame, /\[Probes\]/);
  assert.match(frame, /Approx RAM/);
  assert.match(frame, /1 AGENTS\.md \/ GEMINI\.md/);
});

test('the Orchestrator badge takes its reasoning effort from the configured planner', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-orchestrator-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const settings = join(root, '.gemini', 'antigravity-cli');
  const settingsFile = join(settings, 'settings.json');
  mkdirSync(settings, { recursive: true });
  writeFileSync(settingsFile, JSON.stringify({ orchestrator: { planner: 'Gemini 4 Neon (High)' } }));
  const config = join(root, 'hud.json');
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  /** @param {object} model @param {Record<string, unknown>} [display] @param {Record<string, unknown>} [extraPayload] */
  const run = (model, display = { showEffortLevel: true }, extraPayload = {}) => {
    writeFileSync(config, JSON.stringify({ gitStatus: { enabled: false }, display }));
    return execFileSync(process.execPath, [cli], {
      env: { ...process.env, HOME: root, AGY_HUD_CONFIG: config, AGY_HUD_DATA_DIR: join(root, 'data'), NO_COLOR: '1', AGY_HUD_DISABLE: '0' },
      input: JSON.stringify({ cwd: root, model, ...extraPayload }), encoding: 'utf8', timeout: 2500,
    });
  };
  const orchestrator = { id: 'Orchestrator (Neon)', display_name: 'Orchestrator (Neon)' };
  assert.match(run(orchestrator), /\[Orchestrator \(Neon\) ◑ high\]/);
  assert.match(run(orchestrator, { showEffortLevel: false }), /\[Orchestrator \(Neon\)\]/);
  assert.match(run({ display_name: 'Gemini 4 Neon (Low)', effort: 'low' }), /\[Gemini 4 Neon ○ low\]/);

  writeFileSync(settingsFile, JSON.stringify({ orchestrator: { planner: 'Gemini 4 Neon (Extra High)' } }));
  assert.match(run(orchestrator), /\[Orchestrator \(Neon\) ◕ xhigh\]/);

  for (const planner of ['Gemini 4 Neon (Preview)', 'Claude Opus 4 (Thinking)']) {
    writeFileSync(settingsFile, JSON.stringify({ orchestrator: { planner } }));
    assert.match(run(orchestrator), /\[Orchestrator \(Neon\)\]/);
  }

  for (const raw of ['{}', '{invalid json']) {
    writeFileSync(settingsFile, raw);
    assert.match(run(orchestrator), /\[Orchestrator \(Neon\)\]/);
  }

  if (process.platform !== 'win32') {
    const linkedTarget = join(root, 'dotfiles-settings.json');
    writeFileSync(linkedTarget, JSON.stringify({ orchestrator: { planner: 'Gemini 4 Neon (High)' } }));
    rmSync(settingsFile);
    symlinkSync(linkedTarget, settingsFile);
    assert.match(run(orchestrator), /\[Orchestrator \(Neon\) ◑ high\]/);
  }

  const conversationId = '12345678-abcd-ef01-2345-6789abcdef01';
  const transcriptDir = join(settings, 'brain', conversationId, '.system_generated', 'logs');
  mkdirSync(transcriptDir, { recursive: true });
  writeFileSync(join(transcriptDir, 'transcript.jsonl'), `${JSON.stringify({ type: 'PLANNER_RESPONSE', model: 'Gemini 4 Hydrogen' })}\n`);
  assert.match(run(orchestrator, { showEffortLevel: true, modelSource: 'transcript' }, { conversation_id: conversationId }), /\[Gemini 4 Hydrogen\]/);
});
