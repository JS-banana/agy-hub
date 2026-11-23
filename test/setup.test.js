import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { applySetupPreferences, preferences } from '../src/preferences.js';
import { diagnoseInstallation, install, printSettings, uninstall } from '../src/setup.js';

const posix = { skip: process.platform === 'win32' };
const readSettings = async (path) => JSON.parse(await readFile(path, 'utf8'));
const backup = (path) => `${path}.agy-hub-backup.json`;

async function temporaryDirectory(context) {
  const directory = await mkdtemp(join(tmpdir(), 'agy-hub-setup-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('session settings quote paths for the shell used by agy', posix, async (context) => {
  const directory = await temporaryDirectory(context);
  const executable = join(directory, "Node's executable");
  const script = join(directory, "status 'line' $(date).cjs");
  await symlink(process.execPath, executable);
  await writeFile(script, 'console.log("ready")');

  const { statusLine } = JSON.parse(printSettings({ executable, script }));
  assert.equal(statusLine.type, 'command');
  assert.equal(execFileSync('/bin/sh', ['-c', statusLine.command], { encoding: 'utf8' }), 'ready\n');
});

test('install and uninstall preserve a previous status line and other settings', posix, async (context) => {
  const settingsPath = join(await temporaryDirectory(context), 'settings.json');
  const original = { statusLine: { type: 'command', command: 'old-hud', padding: 1 }, telemetry: false };
  await writeFile(settingsPath, JSON.stringify(original));
  await chmod(settingsPath, 0o640);

  await install({ settingsPath });
  const installed = await readSettings(settingsPath);
  assert.deepEqual(installed, { ...original, ...JSON.parse(printSettings()) });
  assert.equal((await stat(settingsPath)).mode & 0o777, 0o640);
  assert.equal((await stat(backup(settingsPath))).mode & 0o777, 0o600);
  const journal = await readFile(backup(settingsPath), 'utf8');
  assert.match(await install({ settingsPath }), /already configured/);
  assert.equal(await readFile(backup(settingsPath), 'utf8'), journal);

  await writeFile(settingsPath, JSON.stringify({ ...installed, statusLine: { ...installed.statusLine, enabled: false }, telemetry: true }));
  assert.match(await install({ settingsPath }), /Enabled AGY Hub/);
  assert.equal((await readSettings(settingsPath)).statusLine.enabled, true);
  assert.equal(await readFile(backup(settingsPath), 'utf8'), journal);
  await uninstall({ settingsPath });
  assert.deepEqual(await readSettings(settingsPath), { ...original, telemetry: true });
  await assert.rejects(stat(backup(settingsPath)), { code: 'ENOENT' });
  assert.match(await uninstall({ settingsPath }), /no saved installation/);
});

test('uninstall removes a settings file created solely for AGY Hub', posix, async (context) => {
  const settingsPath = join(await temporaryDirectory(context), 'nested', 'settings.json');
  assert.match(await uninstall({ settingsPath }), /no saved installation/);
  await install({ settingsPath });
  assert.deepEqual(await readSettings(settingsPath), JSON.parse(printSettings()));

  await uninstall({ settingsPath });
  await assert.rejects(stat(settingsPath), { code: 'ENOENT' });
  await assert.rejects(stat(backup(settingsPath)), { code: 'ENOENT' });
});

test('replacement of the status line outside setup preserves the new command', posix, async (context) => {
  const settingsPath = join(await temporaryDirectory(context), 'settings.json');
  await install({ settingsPath });
  const replacement = { statusLine: { command: 'later-hud' } };
  await writeFile(settingsPath, JSON.stringify(replacement));

  assert.match(await uninstall({ settingsPath }), /changed after installation/);
  assert.deepEqual(await readSettings(settingsPath), replacement);
  assert.ok(await stat(backup(settingsPath)));

  await install({ settingsPath });
  await uninstall({ settingsPath });
  assert.deepEqual(await readSettings(settingsPath), replacement);
});

test('concurrent installs retain one copy of the original status line', posix, async (context) => {
  const settingsPath = join(await temporaryDirectory(context), 'settings.json');
  const original = { statusLine: { command: 'old-hud' } };
  await writeFile(settingsPath, JSON.stringify(original));

  const attempts = await Promise.allSettled([install({ settingsPath }), install({ settingsPath })]);
  assert.ok(attempts.some(({ status }) => status === 'fulfilled'));
  for (const attempt of attempts) {
    if (attempt.status === 'rejected') assert.match(attempt.reason.message, /setup is locked/);
  }
  assert.deepEqual(await readSettings(settingsPath), JSON.parse(printSettings()));

  await uninstall({ settingsPath });
  assert.deepEqual(await readSettings(settingsPath), original);
});

test('install preserves settings symlinks and refuses malformed settings', posix, async (context) => {
  const directory = await temporaryDirectory(context);
  const target = join(directory, 'dotfiles.json');
  const settingsPath = join(directory, 'settings.json');
  await symlink(target, settingsPath);
  await assert.rejects(install({ settingsPath }), { code: 'ENOENT' });
  assert.ok((await lstat(settingsPath)).isSymbolicLink());

  await writeFile(target, 'broken JSON');
  await assert.rejects(install({ settingsPath }), /Invalid JSON/);
  assert.equal(await readFile(target, 'utf8'), 'broken JSON');
  await assert.rejects(stat(backup(target)), { code: 'ENOENT' });

  await writeFile(target, '{}');
  await install({ settingsPath });
  assert.ok((await lstat(settingsPath)).isSymbolicLink());
  assert.deepEqual(await readSettings(target), JSON.parse(printSettings()));
  await uninstall({ settingsPath });
  assert.deepEqual(await readSettings(target), {});
});

test('diagnostics distinguish a custom command, a moved installation, disabled and active settings', posix, async (context) => {
  const directory = await temporaryDirectory(context);
  const settingsPath = join(directory, 'settings.json');
  const script = join(directory, "old user's hud.js");
  await writeFile(script, 'console.log("ready")');
  await writeFile(settingsPath, '{"statusLine":{"type":"command","command":"other-hud"}}');
  assert.equal((await diagnoseInstallation({ settingsPath })).state, 'custom');
  await install({ settingsPath, script });
  assert.equal((await diagnoseInstallation({ settingsPath })).state, 'stale');
  await unlink(script);
  const broken = await diagnoseInstallation({ settingsPath });
  assert.equal(broken.state, 'broken');
  assert.equal(broken.nodeAvailable, true);
  assert.equal(broken.entryAvailable, false);
  await install({ settingsPath });
  const active = await readSettings(settingsPath);
  assert.equal((await diagnoseInstallation({ settingsPath })).state, 'active');
  await writeFile(settingsPath, JSON.stringify({ statusLine: { ...active.statusLine, enabled: false } }));
  assert.equal((await diagnoseInstallation({ settingsPath })).state, 'disabled');
});

test('refuses changes that exceed the settings or backup limit before writing either file', posix, async (context) => {
  const settingsPath = join(await temporaryDirectory(context), 'settings.json');
  const limit = 1024 * 1024;
  const originalSettings = JSON.stringify({ unrelated: 'a'.repeat(limit - 40) });
  const originalStatusline = JSON.stringify({ statusLine: { command: 'b'.repeat(limit - 50) } });
  for (const [input, output] of [[originalSettings, settingsPath], [originalStatusline, backup(settingsPath)]]) {
    await writeFile(settingsPath, input);
    assert.equal((await diagnoseInstallation({ settingsPath })).state, 'too-large');
    await assert.rejects(install({ settingsPath }), (error) => {
      assert.match(error.message, /would exceed/);
      assert.ok(error.message.includes(`/${basename(output)} would exceed`));
      return true;
    });
    assert.equal(await readFile(settingsPath, 'utf8'), input);
    await assert.rejects(stat(backup(settingsPath)), { code: 'ENOENT' });
  }
});

test('recovers a legacy installation that already crossed the write limit', posix, async (context) => {
  const settingsPath = join(await temporaryDirectory(context), 'settings.json');
  const original = JSON.stringify({ unrelated: 'x'.repeat(1024 * 1024 - 17) });
  const current = JSON.parse(printSettings());
  const oldSettings = JSON.stringify({ ...JSON.parse(original), ...current }, null, 2);
  assert.ok(Buffer.byteLength(oldSettings) > 1024 * 1024);
  await writeFile(settingsPath, oldSettings);
  await writeFile(backup(settingsPath), JSON.stringify({ commands: [current.statusLine.command], createdSettings: false }));
  await uninstall({ settingsPath });
  assert.equal(await readFile(settingsPath, 'utf8'), `${original}\n`);
  await assert.rejects(stat(backup(settingsPath)), { code: 'ENOENT' });
});

test('rebinds an extended command and restores the original statusline', posix, async (context) => {
  const directory = await temporaryDirectory(context);
  const settingsPath = join(directory, 'settings.json');
  const script = join(directory, "old version's cli.js");
  const original = { statusLine: { type: 'command', command: 'old-hud' } };
  const extraCommand = `printf "%s" "today's project"`;
  await writeFile(script, '');
  await writeFile(settingsPath, JSON.stringify(original));
  await install({ settingsPath, script });
  const { statusLine } = JSON.parse(printSettings({ script, extraCommand }));
  await writeFile(settingsPath, JSON.stringify({ statusLine: { ...statusLine, padding: 1 } }));
  assert.equal((await diagnoseInstallation({ settingsPath })).state, 'stale');
  await install({ settingsPath, replaceCustom: false });
  const rebound = await readSettings(settingsPath);
  assert.deepEqual(rebound, { statusLine: { ...JSON.parse(printSettings({ extraCommand })).statusLine, padding: 1 } });
  assert.equal((await diagnoseInstallation({ settingsPath })).state, 'active');

  const custom = { statusLine: { command: rebound.statusLine.command + '; true' } };
  await writeFile(settingsPath, JSON.stringify(custom));
  assert.equal((await diagnoseInstallation({ settingsPath })).state, 'custom');
  await assert.rejects(install({ settingsPath, replaceCustom: false }), /different statusline/);
  await writeFile(settingsPath, JSON.stringify(rebound));
  await uninstall({ settingsPath });
  assert.deepEqual(await readSettings(settingsPath), original);
});

test('restores HUD preferences and their prior undo record if settings change before commit', posix, async (context) => {
  const directory = await temporaryDirectory(context);
  const settingsPath = join(directory, 'settings.json');
  const configPath = join(directory, 'hud.json');
  preferences('set', '{"display":{"showTools":true}}', { path: configPath });
  const prior = await readFile(configPath, 'utf8');
  const priorUndo = await readFile(`${configPath}.undo.json`, 'utf8');
  const external = '{"theme":"light"}';
  await assert.rejects(install({
    settingsPath,
    apply: async (commit) => (await applySetupPreferences({ lineLayout: 'compact' }, async () => {
      assert.equal((await readSettings(configPath)).lineLayout, 'compact');
      await writeFile(settingsPath, external);
      return commit();
    }, configPath)).installation,
  }), /settings changed during setup/);
  assert.equal(await readFile(settingsPath, 'utf8'), external);
  assert.equal(await readFile(configPath, 'utf8'), prior);
  assert.equal(await readFile(`${configPath}.undo.json`, 'utf8'), priorUndo);
  await assert.rejects(stat(backup(settingsPath)), { code: 'ENOENT' });
});
