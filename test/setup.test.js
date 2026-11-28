import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, sep } from 'node:path';
import { test } from 'node:test';
import { applySetupPreferences, preferences } from '../src/preferences.js';
import { bindingPaths, cliCommand, diagnoseInstallation, install, printSettings, skillCommand, uninstall } from '../src/setup.js';

const isWindows = process.platform === 'win32';
const readSettings = async (path) => JSON.parse(await readFile(path, 'utf8'));
const backup = (path) => `${path}.agy-hud-backup.json`;

function runAgyShell(command, options = {}) {
  if (isWindows) {
    // Match agy's Go statusline_runner.go: exec.Command("cmd", "/c", command)
    // which escapes double quotes via EscapeArg, AND verify Node shell:true too.
    const goResult = spawnSync(process.env.ComSpec || 'cmd.exe', ['/c', command], { encoding: 'utf8', ...options });
    if (goResult.error) throw goResult.error;
    assert.equal(goResult.status, 0, goResult.stderr);
    const shellResult = spawnSync(command, { shell: true, encoding: 'utf8', ...options });
    assert.equal(shellResult.status, 0, shellResult.stderr);
    assert.equal(shellResult.stdout, goResult.stdout);
    return goResult.stdout;
  }
  return execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8', ...options });
}

async function temporaryDirectory(context) {
  const directory = await mkdtemp(join(tmpdir(), 'agy-hud-setup-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('session settings quote paths for the shell used by agy and ignore binaries in cwd', async (context) => {
  const directory = await temporaryDirectory(context);
  const binDir = join(directory, "Program Files (x86) & Node's Dir");
  const evilCwd = join(directory, 'untrusted-cwd');
  await mkdir(binDir);
  await mkdir(evilCwd);
  const executable = isWindows ? join(binDir, 'node.exe') : join(binDir, "Node's executable");
  const script = join(directory, isWindows ? "status 'line' $(date) & %TEMP%.cjs" : "status 'line' $(date).cjs");
  if (isWindows) {
    await copyFile(process.execPath, executable);
    await copyFile(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe'), join(evilCwd, 'node.exe'));
  } else {
    await symlink(process.execPath, executable);
  }
  await writeFile(script, 'console.log([process.env.PATH?.includes("R&D") ? "ready-rd" : "ready", ...process.argv.slice(2)].join(":"))');

  const { statusLine } = JSON.parse(printSettings({ executable, script }));
  assert.equal(statusLine.type, 'command');
  if (isWindows) assert.doesNotMatch(statusLine.command, /"/, 'Windows command must be quote-free for Go cmd /c');
  const pathWithAmpersand = [isWindows ? 'C:\\R&D\\bin' : '/tmp/R&D/bin', process.env.PATH].filter(Boolean).join(delimiter);
  const env = { ...process.env, PATH: pathWithAmpersand };
  assert.equal(runAgyShell(statusLine.command, { cwd: evilCwd, env }).replace(/\r\n$/, '\n'), 'ready-rd\n');
  assert.equal(runAgyShell(`${cliCommand({ executable, script })} hook SessionStart`, { cwd: evilCwd, env }).replace(/\r\n$/, '\n'), 'ready-rd:hook:SessionStart\n');
});

test('Windows cliCommand and bindingPaths round-trip extraCommand without expanding %PATH%', () => {
  const executable = 'C:\\Program Files (x86) & Node\\nodejs\\node.exe';
  const script = "C:\\Users\\satna\\user's hud\\src\\cli.js";
  const extraCommand = 'echo "hi" & %PATH%';
  const cmd = cliCommand({ executable, script, extraCommand, platform: 'win32' });
  assert.doesNotMatch(cmd, /"|%PATH%/);
  assert.match(cmd, /^set NoDefaultCurrentDirectoryInExePath=1&&set AGY_HUD_DIR=/);
  const parsed = bindingPaths(cmd, 'win32');
  assert.deepEqual(parsed, {
    executable,
    script,
    base: cliCommand({ executable, script, platform: 'win32' }),
    extraCommand,
  });
  assert.equal(bindingPaths(`${cmd} --extra-cmd hostname`, 'win32'), null);
  assert.match(skillCommand({ executable, script, platform: 'win32' }), /^& \{ /);
  assert.throws(() => cliCommand({ executable: 'C:\\bad\npath\\node.exe', script: 'C:\\cli.js', platform: 'win32' }), /control characters/);
  assert.throws(() => cliCommand({ executable: 'C:\\dir\\node copy.exe', script: 'C:\\cli.js', platform: 'win32' }), /Unsupported Windows executable/);
  assert.throws(() => cliCommand({ executable: '\\nodejs\\node.exe', script: 'C:\\cli.js', platform: 'win32' }), /Unsupported Windows executable/);
});

test('install and uninstall preserve a previous status line and other settings', async (context) => {
  const settingsPath = join(await temporaryDirectory(context), 'settings.json');
  const original = { statusLine: { type: 'command', command: 'old-hud', padding: 1 }, telemetry: false };
  await writeFile(settingsPath, JSON.stringify(original));
  if (!isWindows) await chmod(settingsPath, 0o640);

  await install({ settingsPath });
  const installed = await readSettings(settingsPath);
  assert.deepEqual(installed, { ...original, ...JSON.parse(printSettings()) });
  if (!isWindows) {
    assert.equal((await stat(settingsPath)).mode & 0o777, 0o640);
    assert.equal((await stat(backup(settingsPath))).mode & 0o777, 0o600);
  }
  const journal = await readFile(backup(settingsPath), 'utf8');
  assert.match(await install({ settingsPath }), /already configured/);
  assert.equal(await readFile(backup(settingsPath), 'utf8'), journal);

  await writeFile(settingsPath, JSON.stringify({ ...installed, statusLine: { ...installed.statusLine, enabled: false }, telemetry: true }));
  assert.match(await install({ settingsPath }), /Enabled AGY HUD/);
  assert.equal((await readSettings(settingsPath)).statusLine.enabled, true);
  assert.equal(await readFile(backup(settingsPath), 'utf8'), journal);
  await uninstall({ settingsPath });
  assert.deepEqual(await readSettings(settingsPath), { ...original, telemetry: true });
  await assert.rejects(stat(backup(settingsPath)), { code: 'ENOENT' });
  assert.match(await uninstall({ settingsPath }), /no saved installation/);
});

test('uninstall removes a settings file created solely for AGY HUD', async (context) => {
  const settingsPath = join(await temporaryDirectory(context), 'nested', 'settings.json');
  assert.match(await uninstall({ settingsPath }), /no saved installation/);
  await install({ settingsPath });
  assert.deepEqual(await readSettings(settingsPath), JSON.parse(printSettings()));

  await uninstall({ settingsPath });
  await assert.rejects(stat(settingsPath), { code: 'ENOENT' });
  await assert.rejects(stat(backup(settingsPath)), { code: 'ENOENT' });
});

test('replacement of the status line outside setup preserves the new command', async (context) => {
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

test('concurrent installs retain one copy of the original status line', async (context) => {
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

test('install preserves settings symlinks and refuses malformed settings', async (context) => {
  const directory = await temporaryDirectory(context);
  const target = join(directory, 'dotfiles.json');
  const settingsPath = join(directory, 'settings.json');
  let linked = false;
  try {
    await symlink(target, settingsPath);
    linked = true;
  } catch (error) {
    if (!isWindows || error.code !== 'EPERM') throw error;
  }
  if (linked) {
    await assert.rejects(install({ settingsPath }), { code: 'ENOENT' });
    assert.ok((await lstat(settingsPath)).isSymbolicLink());
  }

  const file = linked ? target : settingsPath;
  await writeFile(file, 'broken JSON');
  await assert.rejects(install({ settingsPath }), /Invalid JSON/);
  assert.equal(await readFile(file, 'utf8'), 'broken JSON');
  await assert.rejects(stat(backup(file)), { code: 'ENOENT' });

  await writeFile(file, '{}');
  await install({ settingsPath });
  if (linked) assert.ok((await lstat(settingsPath)).isSymbolicLink());
  assert.deepEqual(await readSettings(file), JSON.parse(printSettings()));
  await uninstall({ settingsPath });
  assert.deepEqual(await readSettings(file), {});
});

test('diagnostics distinguish a custom command, a moved installation, disabled and active settings', async (context) => {
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

test('refuses changes that exceed the settings or backup limit before writing either file', async (context) => {
  const settingsPath = join(await temporaryDirectory(context), 'settings.json');
  const limit = 1024 * 1024;
  const originalSettings = JSON.stringify({ unrelated: 'a'.repeat(limit - 40) });
  const originalStatusline = JSON.stringify({ statusLine: { command: 'b'.repeat(limit - 50) } });
  for (const [input, output] of [[originalSettings, settingsPath], [originalStatusline, backup(settingsPath)]]) {
    await writeFile(settingsPath, input);
    assert.equal((await diagnoseInstallation({ settingsPath })).state, 'too-large');
    await assert.rejects(install({ settingsPath }), (error) => {
      assert.match(error.message, /would exceed/);
      assert.ok(error.message.includes(`${sep}${basename(output)} would exceed`));
      return true;
    });
    assert.equal(await readFile(settingsPath, 'utf8'), input);
    await assert.rejects(stat(backup(settingsPath)), { code: 'ENOENT' });
  }
});

test('rebinds an extended command and restores the original statusline', async (context) => {
  const directory = await temporaryDirectory(context);
  const settingsPath = join(directory, 'settings.json');
  const script = join(directory, "old version's %TEMP% cli.js");
  const original = { statusLine: { type: 'command', command: 'old-hud' } };
  const extraCommand = `printf "%s" "today's %PATH% project\\"`;
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

test('restores HUD preferences and their prior undo record if settings change before commit', async (context) => {
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
