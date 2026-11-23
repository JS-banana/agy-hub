import { constants } from 'node:fs';
import { access, chmod, lstat, mkdir, mkdtemp, realpath, rename, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { isRecord } from './objects.js';
import { readTextFile } from './runtime/text-file.js';

export const settingsPath = () => join(homedir(), '.gemini', 'antigravity-cli', 'settings.json');
const SETTINGS_BYTES = 1024 * 1024;
const entryPoint = fileURLToPath(new URL('./cli.js', import.meta.url));

function requirePosix() {
  if (process.platform === 'win32') throw new Error('AGY Hub setup requires macOS or Linux.');
}

function quoteShell(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function createStatusLine({ executable = process.execPath, script = entryPoint } = {}) {
  return { type: 'command', command: `${quoteShell(executable)} ${quoteShell(script)}`, enabled: true, stack_with_default: false, padding: 0 };
}

export function printSettings(options) {
  requirePosix();
  return JSON.stringify({ statusLine: createStatusLine(options) });
}

function readJson(path) {
  const file = readTextFile(path, SETTINGS_BYTES);
  if (!file) return null;
  let value;
  try {
    value = JSON.parse(file.text);
  } catch {
    throw new Error(`Invalid JSON in ${path}.`);
  }
  if (!isRecord(value)) throw new Error(`Expected a JSON object in ${path}.`);
  return { value, content: file.text, mode: file.mode };
}

async function writeJson(path, value, original) {
  const temporaryDirectory = await mkdtemp(join(dirname(path), '.agy-hub-'));
  try {
    const staged = join(temporaryDirectory, 'data');
    await writeFile(staged, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await chmod(staged, original?.mode ?? 0o600);
    if (original !== undefined) await verifySettings(path, original);
    await rename(staged, path);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function withSettingsLock(settingsPath, createDirectory, operation) {
  requirePosix();
  const path = await realpath(settingsPath).catch(async (error) => {
    if (error.code !== 'ENOENT') throw error;
    const existing = await lstat(settingsPath).catch((statError) => {
      if (statError.code === 'ENOENT') return null;
      throw statError;
    });
    if (existing) throw error;
    return settingsPath;
  });

  if (createDirectory) await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lock = `${path}.agy-hub.lock`;
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'ENOENT' && !createDirectory) return 'AGY Hub has no saved installation.';
    if (error.code === 'EEXIST') {
      throw new Error(`AGY Hub setup is locked at ${lock}. If a previous setup was interrupted and no setup is running, remove the empty lock directory and retry.`);
    }
    throw error;
  }

  try {
    return await operation(path, `${path}.agy-hub-backup.json`);
  } finally {
    await rmdir(lock);
  }
}

function readBackup(path) {
  const backup = readJson(path)?.value;
  if (backup && (!Array.isArray(backup.commands) || !backup.commands.length ||
    backup.commands.some((command) => typeof command !== 'string') || typeof backup.createdSettings !== 'boolean')) {
    throw new Error(`Invalid AGY Hub backup in ${path}.`);
  }
  return backup;
}

async function verifySettings(path, original) {
  if (readJson(path)?.content !== original?.content) {
    throw new Error(`Antigravity settings changed during setup. Retry using the latest ${path}.`);
  }
}

export async function install({ settingsPath: file = settingsPath(), executable, script } = {}) {
  return withSettingsLock(file, true, async (path, backupPath) => {
    const statusLine = createStatusLine({ executable, script });
    const original = readJson(path);
    const settings = original?.value ?? {};
    const backup = readBackup(backupPath);
    const currentCommand = settings.statusLine?.command;
    if (currentCommand === statusLine.command) {
      if (settings.statusLine.enabled === false) {
        await writeJson(path, { ...settings, statusLine: { ...settings.statusLine, enabled: true } }, original);
        return `Enabled AGY Hub in ${path}. Restart agy to load it.`;
      }
      return `AGY Hub is already configured in ${path}.`;
    }

    const ownsCurrent = backup?.commands.includes(currentCommand);
    const saved = ownsCurrent
      ? { ...backup, commands: [currentCommand, statusLine.command] }
      : { commands: [statusLine.command], createdSettings: !original, previous: settings.statusLine };
    await writeJson(backupPath, saved);
    await writeJson(path, { ...settings, statusLine }, original);
    return `Installed AGY Hub in ${path}. Restart agy to load it.`;
  });
}

export async function uninstall({ settingsPath: file = settingsPath() } = {}) {
  return withSettingsLock(file, false, async (path, backupPath) => {
    const backup = readBackup(backupPath);
    if (!backup) return 'AGY Hub has no saved installation.';

    const original = readJson(path);
    const settings = original?.value ?? {};
    if (backup.commands.includes(settings.statusLine?.command)) {
      if (Object.hasOwn(backup, 'previous')) settings.statusLine = backup.previous;
      else delete settings.statusLine;
      if (backup.createdSettings && Object.keys(settings).length === 0) {
        await verifySettings(path, original);
        await unlink(path);
      } else {
        await writeJson(path, settings, original);
      }
    } else if (!isDeepStrictEqual(settings.statusLine, backup.previous)) {
      return `The status line command was changed after installation. The prior settings are saved in ${backupPath}.`;
    }

    await unlink(backupPath);
    return `Removed AGY Hub from ${path}. Restart agy to load the restored settings.`;
  });
}

function bindingPaths(command) {
  // Parse only the two canonical words emitted here. Never evaluate shell input.
  const words = [...command.matchAll(/'((?:[^']|'\\'')*)'/g)].map((match) => match[1].replaceAll("'\\''", "'"));
  if (words.length !== 2 || words.some((word) => !isAbsolute(word))) return null;
  const [executable, script] = words;
  return createStatusLine({ executable, script }).command === command ? { executable, script } : null;
}

async function usableFile(path, mode) {
  try {
    await access(path, mode);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function commandOnPath(name, path = process.env.PATH ?? '') {
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  const mode = process.platform === 'win32' ? constants.F_OK : constants.X_OK;
  const candidates = path.split(delimiter).filter(isAbsolute);
  const matches = await Promise.all(candidates.map((dir) => usableFile(join(dir, executable), mode)));
  return matches.some(Boolean);
}

export async function diagnoseInstallation({ settingsPath: file = settingsPath() } = {}) {
  if (process.platform === 'win32') return { state: 'unsupported', enabled: false };
  let statusLine;
  let target;
  try {
    target = await realpath(file).catch(() => file);
    statusLine = readJson(target)?.value.statusLine;
  } catch {
    return { state: 'unreadable', enabled: false };
  }
  if (!isRecord(statusLine) || typeof statusLine.command !== 'string' || !statusLine.command) {
    return { state: 'not-configured', enabled: false };
  }

  const enabled = statusLine.enabled !== false;
  const current = statusLine.command === createStatusLine().command;
  let backup;
  try { backup = readBackup(`${target}.agy-hub-backup.json`); } catch {
    return { state: 'invalid-backup', enabled, managed: current };
  }
  if (!current && !backup?.commands.includes(statusLine.command)) return { state: 'custom', enabled };

  const paths = bindingPaths(statusLine.command);
  const [nodeAvailable, entryAvailable] = paths ? await Promise.all([
    usableFile(paths.executable, constants.X_OK),
    usableFile(paths.script, constants.R_OK),
  ]) : [false, false];
  const state = !nodeAvailable || !entryAvailable ? 'broken' : !current ? 'stale' : enabled ? 'active' : 'disabled';
  return { state, enabled, managed: true, nodeAvailable, entryAvailable };
}
