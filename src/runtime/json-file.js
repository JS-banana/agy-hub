// @ts-check
import { randomUUID } from 'node:crypto';
import { constants, closeSync, fstatSync, openSync, readSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isRecord } from '../objects.js';

const MAX_OBJECT_BYTES = 128 * 1024;

/** Read a local object. Only a missing path is represented by null.
 *  @param {string} path
 *  @param {number} [maxBytes]
 */
export function readStoredObject(path, maxBytes = MAX_OBJECT_BYTES) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > maxBytes) throw new Error('Invalid local data file.');
    const buffer = Buffer.allocUnsafe(info.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length !== info.size) throw new Error('Local data file changed during read.');
    const value = /** @type {unknown} */ (JSON.parse(buffer.toString('utf8', 0, length)));
    if (!isRecord(value)) throw new Error('Expected a local JSON object.');
    return value;
  } finally {
    closeSync(fd);
  }
}

/** Best-effort local snapshots may recover from an unreadable file as a cache miss.
 *  @param {string} path
 *  @param {number} [maxBytes]
 */
export function readObject(path, maxBytes) {
  try { return readStoredObject(path, maxBytes); } catch { return null; }
}

/** @param {string} path @param {unknown} value @param {number} [maxBytes] */
export function writeObject(path, value, maxBytes = MAX_OBJECT_BYTES) {
  const contents = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(contents) > maxBytes) throw new Error('Local data exceeds its size limit.');
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const tmp = join(directory, `.agy-hub-${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, contents, { flag: 'wx', mode: 0o600 });
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}
