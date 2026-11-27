// @ts-check
import { spawn } from 'node:child_process';

/** Read bounded UTF-8 stdout from an optional status line probe.
 *  @param {string} command @param {string[]} args
 *  @param {{cwd?: string, env?: NodeJS.ProcessEnv, timeout: number, maxBuffer: number, windowsVerbatimArguments?: boolean}} options
 *  @returns {Promise<{status: number | null, stdout: string}>}
 */
export async function readCommand(command, args, { cwd, env, timeout, maxBuffer, windowsVerbatimArguments }) {
  try {
    const child = spawn(command, args, {
      cwd, env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, windowsVerbatimArguments,
    });
    return await new Promise((resolve) => {
      /** @type {Buffer[]} */
      const chunks = [];
      let bytes = 0;
      let stopped = false;
      function stop() {
        stopped = true;
        // A descendant can keep stdout open after the command exits.
        child.stdout.destroy();
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
        clearTimeout(timer);
        resolve({ status: null, stdout: '' });
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        const status = stopped ? null : code;
        resolve({ status, stdout: status === null ? '' : Buffer.concat(chunks).toString('utf8') });
      });
    });
  } catch {
    return { status: null, stdout: '' };
  }
}
