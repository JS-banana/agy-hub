// @ts-check
import { constants } from 'node:fs';
import { access, chmod, lstat, mkdir, mkdtemp, realpath, rename, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { isRecord } from './objects.js';
import { isQualifiedPath, trustedPathDirectories } from './runtime/command.js';
import { readTextFile } from './runtime/text-file.js';

/** @typedef {{ text: string, mode: number }} FileSnapshot */
/** @typedef {FileSnapshot & { value: Record<string, unknown> }} JsonFile */
/** @typedef {{commands: string[], createdSettings: boolean, previous?: unknown}} Backup */
/** @typedef {FileSnapshot & { value: Backup }} BackupFile */
/** @typedef {{executable?: string, script?: string, extraCommand?: string}} BindingOptions */

export const settingsPath = () => join(homedir(), '.gemini', 'antigravity-cli', 'settings.json');
const SETTINGS_BYTES = 1024 * 1024;
const entryPoint = fileURLToPath(new URL('./cli.js', import.meta.url));

const WIN_BOOTSTRAP_RE = /^set NoDefaultCurrentDirectoryInExePath=1&&set AGY_HUD_DIR=([^"\r\n;%]+)&&%SystemRoot%\\System32\\cmd\.exe \/d \/v:on \/c set PATH=!AGY_HUD_DIR!;!PATH!\^&\^&set AGY_HUD_DIR=\^&\^&([^\s"&|<>()^%!\r\n]+) -e const\{pathToFileURL:u\}=require\^\^\^\('node:url'\^\^\^\),a=JSON\.parse\^\^\^\(Buffer\.from\^\^\^\('([A-Za-z0-9_-]+)','base64url'\^\^\^\)\+''\^\^\^\);process\.argv\.splice\^\^\^\(1,0,\.\.\.a\^\^\^\);import\^\^\^\(u\^\^\^\(a\[0\]\^\^\^\)\.href\^\^\^\) --$/;

/** @param {string} value */
function quotePosix(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Build a quote-free cmd.exe command so Go's exec.Command("cmd", "/c", cmd)
 *  does not turn double quotes into literal \" tokens that cmd.exe rejects,
 *  and expand PATH with delayed expansion so entries like C:\R&D\bin cannot split commands.
 *  @param {{executable: string, script: string, extraCommand?: string}} options
 */
function windowsCliCommand({ executable, script, extraCommand }) {
  if (/[\r\n\0]/.test(executable) || /[\r\n\0]/.test(script) || (extraCommand !== undefined && /\0/.test(extraCommand))) {
    throw new Error('Command arguments on Windows cannot contain control characters.');
  }
  const exeDir = win32.dirname(executable);
  const exeName = win32.basename(executable);
  if (!isQualifiedPath(executable, 'win32') || !exeDir || !exeName || /[";%]/.test(exeDir) || /[\s"&|<>()^%!;]/.test(exeName)) {
    throw new Error('Unsupported Windows executable path for cmd.exe statusline invocation.');
  }
  const escapedDir = exeDir.replace(/([&|<>()^])/g, '^$1');
  const argv = !extraCommand ? [script] : [script, '--extra-cmd', extraCommand];
  const encoded = Buffer.from(JSON.stringify(argv)).toString('base64url');
  return `set NoDefaultCurrentDirectoryInExePath=1&&set AGY_HUD_DIR=${escapedDir}&&%SystemRoot%\\System32\\cmd.exe /d /v:on /c set PATH=!AGY_HUD_DIR!;!PATH!^&^&set AGY_HUD_DIR=^&^&${exeName} -e const{pathToFileURL:u}=require^^^('node:url'^^^),a=JSON.parse^^^(Buffer.from^^^('${encoded}','base64url'^^^)+''^^^);process.argv.splice^^^(1,0,...a^^^);import^^^(u^^^(a[0]^^^).href^^^) --`;
}

/** @param {BindingOptions & {platform?: NodeJS.Platform}} [options] */
export function cliCommand({ executable = process.execPath, script = entryPoint, extraCommand, platform = process.platform } = {}) {
  const normalizedExtra = extraCommand || undefined;
  if (platform === 'win32') return windowsCliCommand({ executable, script, extraCommand: normalizedExtra });
  const base = `${quotePosix(executable)} ${quotePosix(script)}`;
  return normalizedExtra === undefined ? base : `${base} --extra-cmd ${quotePosix(normalizedExtra)}`;
}

/** Build the command prefix recorded in the local /agy-hud skill (PowerShell on Windows, POSIX sh elsewhere).
 *  @param {{executable?: string, script?: string, platform?: NodeJS.Platform}} [options]
 */
export function skillCommand({ executable = process.execPath, script = entryPoint, platform = process.platform } = {}) {
  if (platform !== 'win32') return cliCommand({ executable, script, platform });
  if (/[\r\n\0]/.test(executable) || /[\r\n\0]/.test(script)) {
    throw new Error('Command arguments on Windows cannot contain control characters.');
  }
  const quotePs = (/** @type {string} */ value) => `'${value.replaceAll("'", "''")}'`;
  return `& { $a = '.' + (@(@($args) | ForEach-Object { ':' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$_)) }) -join ','); & ${quotePs(executable)} -e 'const{pathToFileURL:u}=require(\`node:url\`),s=process.argv[2].slice(1);process.argv.splice(1,2,process.argv[1],...(s?s.split(\`,\`).map(x=>Buffer.from(x.slice(1),\`base64\`)+\`\`):[]));import(u(process.argv[1]).href)' ${quotePs(script)} $a }`;
}

/** @param {BindingOptions & {platform?: NodeJS.Platform}} [options] */
function createStatusLine(options) {
  return { type: 'command', command: cliCommand(options), enabled: true, stack_with_default: false, padding: 0 };
}

/** @param {BindingOptions} [options] */
export function printSettings(options) {
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
  const baseCommand = createStatusLine({ executable: options?.executable, script: options?.script }).command;
  const parsed = bindingPaths(current?.command);
  const managed = savedBinding(current?.command, backup);
  const owned = parsed?.base === baseCommand ? parsed : managed;
  const effectiveExtra = options?.extraCommand !== undefined
    ? (options.extraCommand || undefined)
    : owned?.extraCommand;
  const desired = createStatusLine({ ...options, extraCommand: effectiveExtra });
  if (parsed?.base === baseCommand && current?.command === desired.command) {
    if (current?.enabled === false) return {
      text: serialize(path, { ...settings, statusLine: { ...current, enabled: true } }),
      message: `Enabled AGY HUD in ${path}. Restart agy to load it.`,
    };
    return { message: `AGY HUD is already configured in ${path}.` };
  }

  const custom = typeof current?.command === 'string' && !!current.command && !owned;
  const statusLine = owned
    ? { ...desired, ...current, command: desired.command, enabled: true }
    : desired;
  const saved = managed && backup
    ? { ...backup.value, commands: [...new Set([managed.base, baseCommand])] }
    : { commands: [baseCommand], createdSettings: !original, previous: owned && backup ? backup.value.previous : settings.statusLine };
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
export async function install({ settingsPath: file = settingsPath(), executable, script, extraCommand, replaceCustom = true, apply = (commit) => commit() } = {}) {
  return withSettingsLock(file, true, async (path, backupPath) => {
    const original = readJson(path);
    const backup = readBackup(backupPath);
    const plan = planInstall(path, backupPath, original, backup, { executable, script, extraCommand });
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

/** @param {string} command @param {NodeJS.Platform} [platform] */
function parseCommandWords(command, platform = process.platform) {
  if (platform === 'win32') {
    const match = WIN_BOOTSTRAP_RE.exec(command);
    if (!match) return [];
    const [, escapedDir, exeName, encoded] = match;
    const executable = win32.join(escapedDir.replace(/\^([&|<>()^])/g, '$1'), exeName);
    try {
      const argv = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      if (!Array.isArray(argv)) return [];
      if (argv.length === 1 && typeof argv[0] === 'string') return [executable, argv[0]];
      if (argv.length === 3 && argv[1] === '--extra-cmd' && typeof argv[0] === 'string' && typeof argv[2] === 'string' && argv[2]) {
        return [executable, argv[0], argv[2]];
      }
    } catch { /* Malformed encoded payload is treated as a custom statusline. */ }
    return [];
  }
  return [...command.matchAll(/'((?:[^']|'\\'')*)'/g)].map((match) => match[1].replaceAll("'\\''", "'"));
}

/** @param {unknown} command @param {NodeJS.Platform} [platform] */
export function bindingPaths(command, platform = process.platform) {
  // Accept the canonical invocation and its one optional argument.
  if (typeof command !== 'string') return null;
  const words = parseCommandWords(command, platform);
  const [executable, script, extraCommand] = words;
  if ((words.length !== 2 && words.length !== 3) || !isQualifiedPath(executable, platform) || !isQualifiedPath(script, platform)) return null;
  const base = createStatusLine({ executable, script, platform }).command;
  return createStatusLine({ executable, script, extraCommand, platform }).command === command ? { executable, script, base, extraCommand } : null;
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
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT?.split(';').filter(Boolean) ?? ['.EXE', '.CMD', '.BAT', '.COM'])
    : [''];
  const mode = process.platform === 'win32' ? constants.F_OK : constants.X_OK;
  const candidates = trustedPathDirectories(path);
  const matches = await Promise.all(candidates.flatMap((dir) => extensions.map((ext) => usableFile(join(dir, `${name}${ext}`), mode))));
  return matches.some(Boolean);
}

/** @param {{settingsPath?: string, extraCommand?: string}} [options] */
export async function diagnoseInstallation({ settingsPath: file = settingsPath(), extraCommand } = {}) {
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
    planInstall(target, backupPath, original, backup, { extraCommand });
  } catch (error) {
    if (error instanceof RangeError) return { state: 'too-large', enabled };
    throw error;
  }
  if (!configured) return { state: 'not-configured', enabled: false };
  if (!current && !savedBinding(statusLine?.command, backup)) return { state: 'custom', enabled };

  const executableMode = process.platform === 'win32' ? constants.F_OK : constants.X_OK;
  const [nodeAvailable, entryAvailable] = paths ? await Promise.all([
    usableFile(paths.executable, executableMode),
    usableFile(paths.script, constants.R_OK),
  ]) : [false, false];
  const state = !nodeAvailable || !entryAvailable ? 'broken' : !current ? 'stale' : enabled ? 'active' : 'disabled';
  return { state, enabled, managed: true, nodeAvailable, entryAvailable };
}
