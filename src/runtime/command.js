// @ts-check
import { spawn } from 'node:child_process';
import { join, posix, win32 } from 'node:path';

/** Check whether a path has an explicit POSIX root or a Windows drive / UNC share root.
 *  @param {unknown} pathValue @param {NodeJS.Platform} [platform]
 *  @returns {pathValue is string}
 */
export function isQualifiedPath(pathValue, platform = process.platform) {
  if (typeof pathValue !== 'string' || /[\r\n\0]/.test(pathValue)) return false;
  if (platform !== 'win32') return posix.isAbsolute(pathValue);
  if (pathValue.includes('"')) return false;
  const { root } = win32.parse(win32.normalize(pathValue));
  return /^(?:[A-Za-z]:\\|\\\\[^\\/?*:"<>|]+\\[^\\/?*:"<>|]+)/.test(root);
}

/** Split PATH into normalized directories with an explicit root, stripping Windows quotes
 *  and ignoring relative or drive-relative entries such as `\tools` or `C:tools`.
 *  @param {string} [pathValue] @param {NodeJS.Platform} [platform]
 *  @returns {string[]}
 */
export function trustedPathDirectories(pathValue = process.env.PATH ?? '', platform = process.platform) {
  if (platform !== 'win32') return pathValue.split(':').filter((entry) => isQualifiedPath(entry, platform));
  /** @type {string[]} */
  const entries = [];
  let current = '';
  let quoted = false;
  for (const ch of pathValue) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ';' && !quoted) { entries.push(current); current = ''; }
    else current += ch;
  }
  entries.push(current);
  /** @type {string[]} */
  const directories = [];
  for (const raw of entries) {
    const trimmed = raw.trim();
    if (!trimmed || !isQualifiedPath(trimmed, 'win32')) continue;
    directories.push(win32.normalize(trimmed));
  }
  return directories;
}

/** Read bounded UTF-8 stdout from an optional status line probe.
 *  @param {string} command @param {string[]} args
 *  @param {{cwd?: string, env?: NodeJS.ProcessEnv, timeout: number, maxBuffer: number, windowsVerbatimArguments?: boolean}} options
 *  @returns {Promise<{status: number | null, stdout: string}>}
 */
export async function readCommand(command, args, { cwd, env, timeout, maxBuffer, windowsVerbatimArguments }) {
  try {
    const isWindows = process.platform === 'win32';
    const child = spawn(command, args, {
      cwd, env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
      windowsVerbatimArguments, detached: !isWindows,
    });
    return await new Promise((resolve) => {
      /** @type {Buffer[]} */
      const chunks = [];
      let bytes = 0;
      let stopped = false;
      let childDone = false;
      let killerDone = true;
      /** @type {number | null} */
      let exitCode = null;
      function finish() {
        if (!childDone || !killerDone) return;
        clearTimeout(timer);
        const status = stopped ? null : exitCode;
        resolve({ status, stdout: status === null ? '' : Buffer.concat(chunks).toString('utf8') });
      }
      function stop() {
        if (stopped) return;
        stopped = true;
        clearTimeout(timer);
        // A descendant can keep stdout open after the command exits.
        child.stdout.destroy();
        if (isWindows && child.pid) {
          killerDone = false;
          const taskkill = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
          try {
            const killer = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
              stdio: 'ignore', windowsHide: true,
            });
            killer.once('error', () => {
              child.kill('SIGKILL');
              killerDone = true;
              finish();
            });
            killer.once('close', (code) => {
              if (code !== 0) child.kill('SIGKILL');
              killerDone = true;
              finish();
            });
            return;
          } catch {
            killerDone = true;
          }
        } else if (!isWindows && child.pid) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Process group already exited. */ }
        }
        child.kill('SIGKILL');
      }
      const timer = setTimeout(stop, timeout);
      timer.unref?.();
      child.stdout.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes <= maxBuffer) chunks.push(chunk);
        else stop();
      });
      child.once('error', () => {
        childDone = true;
        finish();
      });
      child.once('close', (code) => {
        exitCode = code;
        childDone = true;
        finish();
      });
    });
  } catch {
    return { status: null, stdout: '' };
  }
}
