// @ts-check
import { isRecord } from '../objects.js';

const MAX_INPUT_BYTES = 1024 * 1024;

/** Read one AGY payload. Measure the byte limit before decoding multi-byte UTF-8.
 *  @param {import('node:stream').Readable} [input]
 *  @param {number} [limit]
 */
export async function readInput(input = process.stdin, limit = MAX_INPUT_BYTES) {
  /** @type {Buffer[]} */
  const chunks = [];
  let length = 0;
  try {
    for await (const part of input) {
      const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part);
      length += bytes.length;
      if (length > limit) return null;
      chunks.push(bytes);
    }
    const value = /** @type {unknown} */ (JSON.parse(Buffer.concat(chunks, length).toString('utf8')));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}
