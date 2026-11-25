// @ts-check
import { homedir } from 'node:os';
import { join } from 'node:path';
import { normalizeConfig } from './config-schema.js';
import { env, withLegacy } from './legacy-name.js';
import { readTextFile } from './runtime/text-file.js';

export { ansiColors, normalizeConfig } from './config-schema.js';

export const configPath = () => env('CONFIG') ?? withLegacy(join(homedir(), '.gemini', 'antigravity-cli', 'agy-hud.json'));

/** @param {string} [file] */
export function readConfig(file = configPath()) {
  try {
    const source = readTextFile(file);
    if (source) return normalizeConfig(JSON.parse(source.text));
  } catch {
    // The status line stays available when user config is invalid or unreadable.
  }
  return normalizeConfig();
}
