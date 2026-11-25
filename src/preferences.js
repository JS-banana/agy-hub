// @ts-check
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { configPath, normalizeConfig, readConfig } from './config.js';
import { ansiColors, configRules, DEFAULT_CONFIG, inspectConfig, jsonSchema } from './config-schema.js';
import { MAX_CONFIG_BYTES, readTextFile } from './runtime/text-file.js';
import { isRecord } from './objects.js';
import { presetConfig } from './presets.js';

/** @typedef {Record<string, unknown>} ConfigPatch */
/** @typedef {{file: string, undoFile: string, release: () => void}} PreferencesLock */

const manualOnly = Object.entries(configRules).filter(([, rule]) => rule.manualOnly).map(([key]) => key);
/** @param {unknown} value */
const json = (value) => JSON.stringify(value, null, 2);
/** @param {string} text */
const hash = (text) => createHash('sha256').update(text).digest('hex');
const activityOptions = /** @type {const} */ ([
  ['tools', 'showTools'], ['agents', 'showAgents'], ['skills', 'showSkills'], ['mcp', 'showMcp'],
]);

/** @param {string} path */
const readText = (path) => readTextFile(path)?.text ?? null;
/** @param {string} path */
const readUndo = (path) => readTextFile(path, 256 * 1024)?.text ?? null;

/** @param {string} path */
function targetPath(path) {
  return lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() ? realpathSync(path) : path;
}

/** @param {string} [text] */
export function parseConfigPatch(text) {
  if (text === undefined) throw new Error('Expected a valid JSON object.');
  /** @type {unknown} */
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('Expected a valid JSON object.'); }
  if (!isRecord(value)) throw new Error('Expected a valid JSON object.');
  return value;
}

/** @param {ConfigPatch} base @param {ConfigPatch} patch @param {ConfigPatch} [defaults] @returns {ConfigPatch} */
export function mergeConfig(base, patch, defaults = DEFAULT_CONFIG) {
  const entries = Object.entries(patch).map(([key, value]) => {
    if (!Object.hasOwn(defaults, key) || !isRecord(defaults[key]) || !isRecord(value)) return [key, value];
    return [key, mergeConfig(isRecord(base[key]) ? base[key] : {}, value, defaults[key])];
  });
  return { ...base, ...Object.fromEntries(entries) };
}

/** @param {string} path */
function check(path) {
  let text;
  try { text = readText(targetPath(path)); } catch {
    return { valid: false, unknown: [], invalid: [], unsafe: [], error: 'unreadable' };
  }
  try {
    const raw = text === null ? {} : parseConfigPatch(text);
    return { ...inspectConfig(raw), exists: text !== null };
  } catch {
    return { valid: false, unknown: [], invalid: [], unsafe: [], exists: true, error: 'invalid-json' };
  }
}

/** @overload @param {string} path @param {true} createDirectory @returns {PreferencesLock} */
/** @overload @param {string} path @param {false} createDirectory @returns {PreferencesLock | null} */
/** @param {string} path @param {boolean} createDirectory */
function acquireLock(path, createDirectory) {
  const file = targetPath(path);
  if (createDirectory) mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  try { mkdirSync(lock, { mode: 0o700 }); } catch (error) {
    const { code } = /** @type {NodeJS.ErrnoException} */ (error);
    if (code === 'ENOENT' && !createDirectory) return null;
    if (code === 'EEXIST') throw new Error(`Configuration is locked at ${lock}.`);
    throw error;
  }
  return { file, undoFile: `${file}.undo.json`, release: () => rmdirSync(lock) };
}

/** @param {string} path @param {string | null} text */
function restoreText(path, text) {
  if (text === null) {
    unlinkSync(path);
    return;
  }
  const staged = join(dirname(path), `.agy-hud-${randomUUID()}.tmp`);
  try {
    writeFileSync(staged, text, { flag: 'wx', mode: 0o600 });
    renameSync(staged, path);
  } finally {
    if (lstatSync(staged, { throwIfNoEntry: false })) unlinkSync(staged);
  }
}

/** @param {ConfigPatch} base @param {ConfigPatch} patch */
function candidateConfig(base, patch, guided = false) {
  const restricted = manualOnly.filter((key) => {
    const [section, field] = key.split('.');
    return isRecord(patch[section]) && Object.hasOwn(patch[section], field);
  });
  if (restricted.length) throw new Error(`Edit these file paths directly in the configuration file: ${restricted.join(', ')}.`);
  const updated = mergeConfig(base, patch);
  const { valid, unknown, invalid, unsafe } = inspectConfig(updated);
  if (!valid) {
    const lists = /** @type {const} */ ([[unknown, 'Unknown keys'], [invalid, 'Invalid values'], [unsafe, 'Unsafe keys']]);
    const problems = lists
      .filter(([keys]) => keys.length).map(([keys, label]) => `${label}: ${keys.map((key) => JSON.stringify(key)).join(', ')}`);
    throw new Error(`${problems.join('. ')}.`);
  }
  if (guided && isRecord(patch.display) && !Object.hasOwn(patch, 'elementOrder')) {
    const display = patch.display;
    const config = normalizeConfig(updated);
    if (config.lineLayout === 'expanded') {
      const missing = activityOptions.filter(([row, option]) => display[option] === true && !config.elementOrder.includes(row));
      if (missing.length) updated.elementOrder = [...config.elementOrder, ...missing.map(([row]) => row)];
    }
  }
  const next = `${json(updated)}\n`;
  if (Buffer.byteLength(next) > MAX_CONFIG_BYTES) throw new Error(`Configuration file exceeds ${MAX_CONFIG_BYTES} bytes.`);
  return { updated, next };
}

/** @param {ConfigPatch} patch @param {{path?: string, base?: ConfigPatch, guided?: boolean}} [options] */
export function previewPreferences(patch, { path = configPath(), base, guided = false } = {}) {
  const current = base ?? currentConfig(path);
  const { updated } = candidateConfig(current, patch, guided);
  return { config: normalizeConfig(updated), changed: !isDeepStrictEqual(updated, current) };
}

export function preferencesLocked(path = configPath()) {
  return Boolean(lstatSync(`${targetPath(path)}.lock`, { throwIfNoEntry: false }));
}

/** @param {string} path */
function currentConfig(path) {
  const before = readText(targetPath(path));
  return before === null ? {} : parseConfigPatch(before);
}

/** @param {PreferencesLock} lock @param {ConfigPatch} patch */
function savePatch({ file, undoFile }, patch, createOnly = false, guided = false) {
  const before = readText(file);
  if (createOnly && before !== null) return null;
  const base = before === null ? {} : parseConfigPatch(before);
  const { updated, next } = candidateConfig(base, patch, guided);
  if (!createOnly && isDeepStrictEqual(updated, base)) return null;

  const oldUndo = readUndo(undoFile);
  const nextUndo = `${json({ before, after: hash(next) })}\n`;
  if (readUndo(undoFile) !== oldUndo) throw new Error('Undo record changed while saving. Run config set again.');
  restoreText(undoFile, nextUndo);
  function restoreUndo() {
    if (readUndo(undoFile) !== nextUndo) throw new Error('The undo record was changed outside AGY HUD.');
    restoreText(undoFile, oldUndo);
  }

  try {
    if (readText(file) !== before) throw new Error('Configuration changed while saving. Run config set again.');
    restoreText(file, next);
  } catch (error) {
    restoreUndo();
    throw error;
  }

  return () => {
    if (readText(file) !== next) throw new Error('Configuration changed after saving. The undo record was kept.');
    restoreText(file, before);
    restoreUndo();
  };
}

/** @param {string} path @param {ConfigPatch} patch */
function set(path, patch, createOnly = false) {
  const lock = acquireLock(path, true);
  try {
    const updated = Boolean(savePatch(lock, patch, createOnly));
    return createOnly ? { created: updated, path } : { updated };
  } finally { lock.release(); }
}

/** Keep the preferences lock while the settings installer commits the binding.
 * @template T
 * @param {ConfigPatch} patch
 * @param {() => Promise<T>} commit
 */
export async function applySetupPreferences(patch, commit, path = configPath()) {
  if (!Object.keys(patch).length) return { changed: false, installation: await commit() };
  const lock = acquireLock(path, true);
  try {
    const rollback = savePatch(lock, patch, false, true);
    try {
      return { changed: Boolean(rollback), installation: await commit() };
    } catch (error) {
      if (rollback) {
        try { rollback(); } catch (restoreError) {
          const message = error instanceof Error ? error.message : String(error);
          const restoreMessage = restoreError instanceof Error ? restoreError.message : String(restoreError);
          throw new Error(`Setup failed: ${message} Configuration rollback failed: ${restoreMessage}`, { cause: error });
        }
      }
      throw error;
    }
  } finally { lock.release(); }
}

/** @param {string} path */
function undo(path) {
  const lock = acquireLock(path, false);
  if (!lock) return { undone: false };
  const { file, undoFile } = lock;
  try {
    const saved = readUndo(undoFile);
    if (saved === null) return { undone: false };
    const { before, after } = parseConfigPatch(saved);
    if ((before !== null && typeof before !== 'string') || typeof after !== 'string' || !/^[\da-f]{64}$/.test(after)) {
      throw new Error('Invalid configuration undo record.');
    }
    const current = readText(file);
    if (current !== before) {
      if (current === null || hash(current) !== after) throw new Error('Configuration has changed since the last config set. The undo record was kept.');
      restoreText(file, before);
    }
    unlinkSync(undoFile);
    return { undone: true };
  } finally { lock.release(); }
}

/** @param {string} action @param {string} [argument] */
export function preferences(action, argument, { path = configPath() } = {}) {
  switch (action) {
    case 'show': return json(readConfig(path));
    case 'schema': return json({ defaults: DEFAULT_CONFIG, colorNames: [...ansiColors.keys()], manualOnly });
    case 'json-schema': return json(jsonSchema());
    case 'check': return json(check(path));
    case 'path': return path;
    case 'init': return json(set(path, presetConfig(argument), true));
    case 'set': return json(set(path, parseConfigPatch(argument)));
    case 'undo': return json(undo(path));
    default: throw new Error('Expected config show, schema, check, set or undo.');
  }
}
