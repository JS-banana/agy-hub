// @ts-check
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

export const MAX_CONFIG_BYTES = 64 * 1024;

/** Read a bounded, regular user configuration file. Follow intentional symlinks
 *  and reject FIFOs/devices without waiting for them to produce bytes.
 *  @param {string} path
 *  @param {number} [limit]
 */
export function readTextFile(path, limit = MAX_CONFIG_BYTES) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) throw new Error('Expected a regular configuration file.');
    if (info.size > limit) throw new Error(`Configuration file exceeds ${limit} bytes.`);
    const buffer = Buffer.allocUnsafe(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size > limit) throw new Error(`Configuration file exceeds ${limit} bytes.`);
    return { text: buffer.toString('utf8', 0, size), mode: info.mode & 0o777 };
  } finally {
    closeSync(fd);
  }
}
