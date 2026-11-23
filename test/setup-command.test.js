import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const posix = { skip: process.platform === 'win32' };
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));

function workspace(t) {
  const home = mkdtempSync(join(tmpdir(), 'agy-hub-guided-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const directory = join(home, '.gemini', 'antigravity-cli');
  mkdirSync(directory, { recursive: true });
  const config = join(directory, 'agy-hub.json');
  return {
    config, settings: join(directory, 'settings.json'),
    run: (...args) => spawnSync(process.execPath, [cli, ...args], {
      encoding: 'utf8', timeout: 5000, input: '',
      env: { ...process.env, HOME: home, AGY_HUB_CONFIG: config, AGY_HUB_DATA_DIR: join(home, 'data'), NO_COLOR: '1' },
    }),
  };
}

test('Agent setup uses the same validation and leaves unrelated options intact', (t) => {
  const { run, config, settings } = workspace(t);
  const original = { lineLayout: 'compact', gitStatus: { showAheadBehind: true } };
  writeFileSync(config, JSON.stringify(original));
  const patch = '{"display":{"showTools":true}}';
  const preview = run('setup', '--configure-only', '--dry-run', '--set', patch, '--json');
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(JSON.parse(preview.stdout).preview, /✓ Read/);
  assert.deepEqual(json(config), original);
  assert.equal(existsSync(settings), false);
  assert.match(run('preview', '--set', patch).stdout, /✓ Read/);
  assert.equal(run('preview', '--set', '{"display":{"showTools":"yes"}}').status, 1);
  assert.equal(run('setup', '--configure-only').status, 1);

  const apply = run('setup', '--configure-only', '--yes', '--set', patch, '--json');
  assert.equal(apply.status, 0, apply.stderr);
  assert.deepEqual(JSON.parse(apply.stdout), { configChanged: true, configureOnly: true, installation: null });
  assert.deepEqual(json(config), { ...original, display: { showTools: true } });
  assert.equal(existsSync(settings), false);
  assert.equal(run('config', 'undo').status, 0);
  assert.deepEqual(json(config), original);
});

test('Agent setup requires separate approval for an existing statusline', posix, (t) => {
  const { run, config, settings } = workspace(t);
  const original = { statusLine: { type: 'command', command: 'printf other-hud' }, theme: 'dark' };
  writeFileSync(settings, JSON.stringify(original));
  const plan = run('setup', '--dry-run', '--preset', 'activity', '--json');
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal(JSON.parse(plan.stdout).needsReplacement, true);
  const declined = run('setup', '--yes', '--preset', 'activity');
  assert.equal(declined.status, 1);
  assert.match(declined.stderr, /different statusline/i);
  assert.equal(existsSync(config), false);
  assert.deepEqual(json(settings), original);

  const approved = run('setup', '--yes', '--replace', '--preset', 'activity');
  assert.equal(approved.status, 0, approved.stderr);
  assert.equal(json(config).display.showTools, true);
  assert.equal(JSON.parse(run('doctor').stdout).statusline.state, 'active');
  assert.equal(run('uninstall').status, 0);
  assert.deepEqual(json(settings), original);
});

test('local Agent skill is installable and preserves a modified copy', posix, (t) => {
  const { run, settings } = workspace(t);
  const path = run('skill', 'path').stdout.trim();
  assert.equal(run('skill', 'install').status, 0);
  const installed = readFileSync(path, 'utf8');
  assert.match(installed, /name: agy-hub/);
  assert.equal(run('skill', 'install').status, 0);
  assert.equal(run('skill', 'uninstall').status, 0);
  assert.equal(existsSync(path), false);
  assert.equal(run('skill', 'install').status, 0);
  writeFileSync(path, 'my custom skill');
  assert.equal(run('skill', 'install').status, 1);
  assert.equal(run('skill', 'uninstall').status, 1);
  assert.equal(readFileSync(path, 'utf8'), 'my custom skill');
  assert.equal(existsSync(settings), false);
});
