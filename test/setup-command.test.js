import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));

function workspace(t) {
  const home = mkdtempSync(join(tmpdir(), 'agy-hud-guided-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const directory = join(home, '.gemini', 'antigravity-cli');
  mkdirSync(directory, { recursive: true });
  const config = join(directory, 'agy-hud.json');
  return {
    config, settings: join(directory, 'settings.json'),
    run: (...args) => spawnSync(process.execPath, [cli, ...args], {
      encoding: 'utf8', timeout: 5000, input: '',
      env: { ...process.env, HOME: home, USERPROFILE: home, AGY_HUD_CONFIG: config, AGY_HUD_DATA_DIR: join(home, 'data'), NO_COLOR: '1' },
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

test('validates setup prompt language separately from HUD labels', (t) => {
  const { run, config } = workspace(t);
  const original = { language: 'zh-Hans' };
  writeFileSync(config, JSON.stringify(original));

  const preview = run('setup', '--configure-only', '--dry-run', '--json', '--prompt-language', 'zh-Hant');
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(JSON.parse(preview.stdout).preview, /上下文.*重置剩余/);
  assert.deepEqual(json(config), original);

  const invalid = run('setup', '--configure-only', '--yes', '--prompt-language', 'zh');
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /--prompt-language must be en, zh-Hans, or zh-Hant/);
  assert.deepEqual(json(config), original);
});

test('Agent setup requires separate approval for an existing statusline', (t) => {
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

test('setup plans detect locked HUD preferences and invalid backups before enabling the binding', (t) => {
  const { run, config, settings } = workspace(t);
  const backup = `${settings}.agy-hud-backup.json`;
  const original = { statusLine: { command: 'previous-hud' } };
  writeFileSync(settings, JSON.stringify(original));
  mkdirSync(`${config}.lock`);
  const args = ['--preset', 'compact', '--replace'];
  const plan = JSON.parse(run('setup', '--dry-run', '--json', ...args).stdout);
  assert.equal(plan.blocked, true);
  assert.equal(plan.configLocked, true);
  const failed = run('setup', '--yes', ...args);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /configuration is locked/i);
  assert.deepEqual(json(settings), original);
  assert.equal(existsSync(backup), false);
  assert.equal(existsSync(config), false);

  rmSync(`${config}.lock`, { recursive: true });
  writeFileSync(settings, '{}');
  writeFileSync(backup, '{}');
  const invalid = JSON.parse(run('setup', '--dry-run', '--json').stdout);
  assert.equal(invalid.blocked, true);
  assert.equal(invalid.statusline, 'invalid-backup');
  assert.equal(run('setup', '--yes').status, 1);
  assert.deepEqual(json(backup), {});
});

test('guided configuration inserts requested activity and honors an explicit order', (t) => {
  const { config, run } = workspace(t);
  const elementOrder = ['project', 'context', 'usage'];
  writeFileSync(config, JSON.stringify({ elementOrder, display: { showAgents: true } }));
  const options = ['--configure-only', '--set', '{"display":{"showTools":true}}'];
  const preview = JSON.parse(run('setup', '--dry-run', '--json', ...options).stdout);
  assert.match(preview.preview, /✓ Read/);
  assert.doesNotMatch(preview.preview, /◐ explore/);
  assert.equal(run('setup', '--yes', ...options).status, 0);
  assert.deepEqual(json(config).elementOrder, [...elementOrder, 'tools']);
  const explicit = JSON.stringify({ elementOrder, display: { showTools: true } });
  assert.equal(run('setup', '--configure-only', '--yes', '--set', explicit).status, 0);
  assert.deepEqual(json(config).elementOrder, elementOrder);

  const noGit = '{"gitStatus":{"enabled":false,"showFileStats":true}}';
  const frame = JSON.parse(run('setup', '--configure-only', '--dry-run', '--json', '--set', noGit).stdout).preview;
  assert.doesNotMatch(frame, /git:\(|auth\.ts|\?1/);
});

test('local Agent skill is installable and preserves a modified copy', (t) => {
  const { run, settings } = workspace(t);
  const path = run('skill', 'path').stdout.trim();
  assert.equal(run('skill', 'install').status, 0);
  const installed = readFileSync(path, 'utf8');
  assert.match(installed, /name: agy-hud/);
  assert.match(installed, /## Installed command/);
  assert.equal(run('skill', 'install').status, 0);
  assert.equal(run('skill', 'uninstall').status, 0);
  assert.equal(existsSync(path), false);
  assert.equal(existsSync(dirname(path)), false);
  const bundled = new URL('../skills/agy-hud/SKILL.md', import.meta.url);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, readFileSync(bundled));
  assert.match(run('skill', 'install').stdout, /Updated/);
  assert.equal(readFileSync(path, 'utf8'), installed);
  const previous = '---\nname: agy-hud\ndescription: Old instructions\n---\n';
  const digest = createHash('sha256').update(previous).digest('hex');
  const previousInstall = `${previous}\n<!-- AGY HUD installed SHA-256: ${digest} -->\n`;
  writeFileSync(path, previousInstall);
  const upgraded = run('skill', 'install');
  assert.equal(upgraded.status, 0, upgraded.stderr);
  assert.match(upgraded.stdout, /Updated/);
  assert.equal(readFileSync(path, 'utf8'), installed);
  const modified = previousInstall.replace('Old instructions', 'my custom skill');
  writeFileSync(path, modified);
  assert.equal(run('skill', 'install').status, 1);
  assert.equal(run('skill', 'uninstall').status, 1);
  assert.equal(readFileSync(path, 'utf8'), modified);
  assert.equal(existsSync(settings), false);
});
