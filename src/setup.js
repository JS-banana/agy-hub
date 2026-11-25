// @ts-check
import { constants } from 'node:fs';
import { access, chmod, lstat, mkdir, mkdtemp, realpath, rename, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { isRecord } from './objects.js';
import { readTextFile } from './runtime/text-file.js';

/** @typedef {{ text: string, mode: number }} FileSnapshot */
/** @typedef {FileSnapshot & { value: Record<string, unknown> }} JsonFile */
/** @typedef {{commands: string[], createdSettings: boolean, previous?: unknown}} Backup */
/** @typedef {FileSnapshot & { value: Backup }} BackupFile */
/** @typedef {{executable?: string, script?: string, extraCommand?: string}} BindingOptions */

export const settingsPath = () => join(homedir(), '.gemini', 'antigravity-cli', 'settings.json');
const SETTINGS_BYTES = 1024 * 1024;
const entryPoint = fileURLToPath(new URL('./cli.js', import.meta.url));

function requirePosix() {
  if (process.platform === 'win32') throw new Error('AGY HUD setup requires macOS or Linux.');
}

/** @param {string} value */
function quoteShell(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** @param {BindingOptions} [options] */
export function cliCommand({ executable = process.execPath, script = entryPoint, extraCommand } = {}) {
  const base = `${quoteShell(executable)} ${quoteShell(script)}`;
  return extraCommand === undefined ? base : `${base} --extra-cmd ${quoteShell(extraCommand)}`;
}

/** @param {BindingOptions} [options] */
function createStatusLine(options) {
  return { type: 'command', command: cliCommand(options), enabled: true, stack_with_default: false, padding: 0 };
}

/** @param {BindingOptions} [options] */
export function printSettings(options) {
  requirePosix();
  return JSON.stringify({ statusLine: createStatusLine(options) });
}

/** @param {string} path @returns {JsonFile | null} */
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
  return { ...file, value };
}

/** @param {string} path @param {unknown} value */
function serialize(path, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(text) <= SETTINGS_BYTES) return text;
  throw new RangeError(`Writing ${path} would exceed ${SETTINGS_BYTES} bytes.`);
}

/** @param {string} path @param {string} text @param {FileSnapshot | null} original @param {number} [mode] */
async function replaceText(path, text, original, mode = original?.mode ?? 0o600) {
  const temporaryDirectory = await mkdtemp(join(dirname(path), '.agy-hud-'));
  try {
    const staged = join(temporaryDirectory, 'data');
    await writeFile(staged, text, { mode: 0o600 });
    await chmod(staged, mode);
    verifyUnchanged(path, original?.text);
    await rename(staged, path);
  } finally {
    // A cleanup failure after rename must not roll back a committed binding.
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

/** @param {string} path */
function resolveSettings(path) {
  return realpath(path).catch(async (error) => {
    if (error.code !== 'ENOENT') throw error;
    const existing = await lstat(path).catch((statError) => {
      if (statError.code === 'ENOENT') return null;
      throw statError;
    });
    if (existing) throw error;
    return path;
  });
}

/** @param {string} file @param {boolean} createDirectory @param {(path: string, backupPath: string) => Promise<string>} operation */
async function withSettingsLock(file, createDirectory, operation) {
  requirePosix();
  const path = await resolveSettings(file);
  if (createDirectory) await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lock = `${path}.agy-hud.lock`;
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    const { code } = /** @type {NodeJS.ErrnoException} */ (error);
    if (code === 'ENOENT' && !createDirectory) return 'AGY HUD has no saved installation.';
    if (code === 'EEXIST') {
      throw new Error(`AGY HUD setup is locked at ${lock}. If a previous setup was interrupted and no setup is running, remove the empty lock directory and retry.`);
    }
    throw error;
  }

  try {
    return await operation(path, `${path}.agy-hud-backup.json`);
  } finally {
    await rmdir(lock);
  }
}

/** @param {string} path @returns {BackupFile | null} */
function readBackup(path) {
  const file = readJson(path);
  if (!file) return null;
  const { commands, createdSettings } = file.value;
  if (!Array.isArray(commands) || !commands.length || commands.some((command) => !bindingPaths(command))
    || typeof createdSettings !== 'boolean') {
    throw new Error(`Invalid AGY HUD backup in ${path}.`);
  }
  return { ...file, value: { ...file.value, commands, createdSettings } };
}

/** @param {string} path @param {string | undefined} text */
function verifyUnchanged(path, text) {
  if (readTextFile(path, SETTINGS_BYTES)?.text !== text) {
    throw new Error(`Antigravity settings changed during setup. Retry using the latest ${path}.`);
  }
}

/** @param {unknown} command @param {BackupFile | null} backup */
function savedBinding(command, backup) {
  const parsed = bindingPaths(command);
  return parsed && backup?.value.commands.some((saved) => bindingPaths(saved)?.base === parsed.base) ? parsed : null;
}

/** @param {string} path @param {string} backupPath @param {JsonFile | null} original
 * @param {BackupFile | null} backup @param {BindingOptions} [options]
 */
function planInstall(path, backupPath, original, backup, options) {
  const settings = original?.value ?? {};
  const current = isRecord(settings.statusLine) ? settings.statusLine : null;
  const desired = createStatusLine(options);
  const parsed = bindingPaths(current?.command);
  if (parsed?.base === desired.command) {
    if (current?.enabled === false) return {
      text: serialize(path, { ...settings, statusLine: { ...current, enabled: true } }),
      message: `Enabled AGY HUD in ${path}. Restart agy to load it.`,
    };
    return { message: `AGY HUD is already configured in ${path}.` };
  }

  const managed = savedBinding(current?.command, backup);
  const custom = typeof current?.command === 'string' && !!current.command && !managed;
  const statusLine = managed
    ? { ...desired, ...current, command: createStatusLine({ ...options, extraCommand: managed.extraCommand }).command, enabled: true }
    : desired;
  const saved = managed && backup
    ? { ...backup.value, commands: [managed.base, desired.command] }
    : { commands: [desired.command], createdSettings: !original, previous: settings.statusLine };
  return {
    custom,
    text: serialize(path, { ...settings, statusLine }),
    backup: serialize(backupPath, saved),
    message: `Installed AGY HUD in ${path}. Restart agy to load it.`,
  };
}

/** @param {string} path @param {string} text @param {BackupFile | null} original */
async function restoreBackup(path, text, original) {
  const current = readTextFile(path, SETTINGS_BYTES);
  if (current?.text !== text) throw new Error(`Backup changed during setup: ${path}.`);
  if (original) await replaceText(path, original.text, current, original.mode);
  else await unlink(path);
}

/** @param {BindingOptions & {settingsPath?: string, replaceCustom?: boolean,
 *   apply?: (commit: () => Promise<string>) => Promise<string>}} [options]
 */
export async function install({ settingsPath: file = settingsPath(), executable, script, replaceCustom = true, apply = (commit) => commit() } = {}) {
  return withSettingsLock(file, true, async (path, backupPath) => {
    const original = readJson(path);
    const backup = readBackup(backupPath);
    const plan = planInstall(path, backupPath, original, backup, { executable, script });
    if (plan.custom && !replaceCustom) {
      throw new Error('A different statusline is configured. Confirm the replacement or run setup --configure-only to keep it.');
    }
    return apply(async () => {
      if (!plan.text) return plan.message;
      if (plan.backup) {
        verifyUnchanged(path, original?.text);
        await replaceText(backupPath, plan.backup, backup);
      }
      try {
        await replaceText(path, plan.text, original);
      } catch (error) {
        if (plan.backup) await restoreBackup(backupPath, plan.backup, backup);
        throw error;
      }
      return plan.message;
    });
  });
}

export async function uninstall({ settingsPath: file = settingsPath() } = {}) {
  return withSettingsLock(file, false, async (path, backupPath) => {
    const backup = readBackup(backupPath);
    if (!backup) return 'AGY HUD has no saved installation.';

    const original = readJson(path);
    const settings = original?.value ?? {};
    const current = isRecord(settings.statusLine) ? settings.statusLine : null;
    if (savedBinding(current?.command, backup)) {
      if (Object.hasOwn(backup.value, 'previous')) settings.statusLine = backup.value.previous;
      else delete settings.statusLine;
      if (backup.value.createdSettings && Object.keys(settings).length === 0) {
        verifyUnchanged(path, original?.text);
        await unlink(path);
      } else {
        await replaceText(path, serialize(path, settings), original);
      }
    } else if (!isDeepStrictEqual(settings.statusLine, backup.value.previous)) {
      return `The status line command was changed after installation. The prior settings are saved in ${backupPath}.`;
    }

    await unlink(backupPath);
    return `Removed AGY HUD from ${path}. Restart agy to load the restored settings.`;
  });
}

/** @param {unknown} command */
function bindingPaths(command) {
  // Accept the canonical invocation and its one optional quoted argument.
  if (typeof command !== 'string') return null;
  const words = [...command.matchAll(/'((?:[^']|'\\'')*)'/g)].map((match) => match[1].replaceAll("'\\''", "'"));
  const [executable, script, extraCommand] = words;
  if ((words.length !== 2 && words.length !== 3) || !isAbsolute(executable) || !isAbsolute(script)) return null;
  const base = createStatusLine({ executable, script }).command;
  return createStatusLine({ executable, script, extraCommand }).command === command ? { executable, script, base, extraCommand } : null;
}

/** @param {string} path @param {number} mode */
async function usableFile(path, mode) {
  try {
    await access(path, mode);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** @param {string} name */
export async function commandOnPath(name, path = process.env.PATH ?? '') {
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  const mode = process.platform === 'win32' ? constants.F_OK : constants.X_OK;
  const candidates = path.split(delimiter).filter(isAbsolute);
  const matches = await Promise.all(candidates.map((dir) => usableFile(join(dir, executable), mode)));
  return matches.some(Boolean);
}

export async function diagnoseInstallation({ settingsPath: file = settingsPath() } = {}) {
  if (process.platform === 'win32') return { state: 'unsupported', enabled: false };
  let original;
  let target;
  try {
    target = await resolveSettings(file);
    original = readJson(target);
  } catch {
    return { state: 'unreadable', enabled: false };
  }
  const statusLine = isRecord(original?.value.statusLine) ? original.value.statusLine : null;
  const configured = typeof statusLine?.command === 'string' && !!statusLine.command;
  const enabled = configured && statusLine?.enabled !== false;
  const paths = bindingPaths(statusLine?.command);
  const current = paths?.base === createStatusLine().command;
  const backupPath = `${target}.agy-hud-backup.json`;
  let backup;
  try { backup = readBackup(backupPath); } catch {
    return { state: 'invalid-backup', enabled, managed: current };
  }
  try {
    planInstall(target, backupPath, original, backup);
  } catch (error) {
    if (error instanceof RangeError) return { state: 'too-large', enabled };
    throw error;
  }
  if (!configured) return { state: 'not-configured', enabled: false };
  if (!current && !savedBinding(statusLine?.command, backup)) return { state: 'custom', enabled };

  const [nodeAvailable, entryAvailable] = paths ? await Promise.all([
    usableFile(paths.executable, constants.X_OK),
    usableFile(paths.script, constants.R_OK),
  ]) : [false, false];
  const state = !nodeAvailable || !entryAvailable ? 'broken' : !current ? 'stale' : enabled ? 'active' : 'disabled';
  return { state, enabled, managed: true, nodeAvailable, entryAvailable };
}
