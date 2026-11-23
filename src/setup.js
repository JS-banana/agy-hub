import { chmod, lstat, mkdir, mkdtemp, open, realpath, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const defaultSettingsPath = () => join(homedir(), '.gemini', 'antigravity-cli', 'settings.json');
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

async function readJson(path) {
  const file = await open(path, 'r').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!file) return null;

  try {
    const content = await file.readFile('utf8');
    let value;
    try {
      value = JSON.parse(content);
    } catch {
      throw new Error(`Invalid JSON in ${path}.`);
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Expected a JSON object in ${path}.`);
    }
    return { value, content, mode: (await file.stat()).mode & 0o777 };
  } finally {
    await file.close();
  }
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
    if (error.code === 'EEXIST') throw new Error(`AGY Hub setup is locked at ${lock}.`);
    throw error;
  }

  try {
    return await operation(path, `${path}.agy-hub-backup.json`);
  } finally {
    await rmdir(lock);
  }
}

async function readBackup(path) {
  const backup = (await readJson(path))?.value;
  if (backup && (!Array.isArray(backup.commands) || !backup.commands.length ||
    backup.commands.some((command) => typeof command !== 'string') || typeof backup.createdSettings !== 'boolean')) {
    throw new Error(`Invalid AGY Hub backup in ${path}.`);
  }
  return backup;
}

async function verifySettings(path, original) {
  if ((await readJson(path))?.content !== original?.content) {
    throw new Error(`Antigravity settings changed during setup. Retry using the latest ${path}.`);
  }
}

export async function install({ settingsPath = defaultSettingsPath() } = {}) {
  return withSettingsLock(settingsPath, true, async (path, backupPath) => {
    const statusLine = createStatusLine();
    const original = await readJson(path);
    const settings = original?.value ?? {};
    const backup = await readBackup(backupPath);
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

export async function uninstall({ settingsPath = defaultSettingsPath() } = {}) {
  return withSettingsLock(settingsPath, false, async (path, backupPath) => {
    const backup = await readBackup(backupPath);
    if (!backup) return 'AGY Hub has no saved installation.';

    const original = await readJson(path);
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
