// @ts-check
// AGY HUD was named AGY Hub through v0.5.0. Keep honoring the settings and state saved under the old name.
import { existsSync } from 'node:fs';

/** @param {string} name */
export const env = (name) => process.env[`AGY_HUD_${name}`] ?? process.env[`AGY_HUB_${name}`];

/** Return `path` unless only its `agy-hub` counterpart exists. @param {string} path */
export function withLegacy(path) {
  const legacy = path.replace(/agy-hud(?=[^/]*$)/, 'agy-hub');
  return !existsSync(path) && existsSync(legacy) ? legacy : path;
}
