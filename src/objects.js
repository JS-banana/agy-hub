// @ts-check

/** @param {unknown} value
 *  @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value */
export function objectOrEmpty(value) {
  return isRecord(value) ? value : {};
}
