import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { configPath, readConfig } from './config.js';
import { ansiColors, configRules, DEFAULT_CONFIG, inspectConfig, jsonSchema } from './config-schema.js';
import { writeObject } from './local-data.js';
import { MAX_CONFIG_BYTES, readTextFile } from './runtime/text-file.js';
import { isRecord } from './objects.js';
import { presetConfig } from './presets.js';

const manualOnly = Object.entries(configRules).filter(([, rule]) => rule.manualOnly).map(([key]) => key);
const json = (value) => JSON.stringify(value, null, 2);
const hash = (text) => createHash('sha256').update(text).digest('hex');

const readText = (path) => readTextFile(path)?.text ?? null;
const readUndo = (path) => readTextFile(path, 256 * 1024)?.text ?? null;

function targetPath(path) {
  return lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() ? realpathSync(path) : path;
}

function parseObject(text) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('Expected a valid JSON object.'); }
  if (!isRecord(value)) throw new Error('Expected a valid JSON object.');
  return value;
}

function mergeConfig(base, patch, defaults = DEFAULT_CONFIG) {
  const entries = Object.entries(patch).map(([key, value]) => {
    if (!Object.hasOwn(defaults, key) || !isRecord(defaults[key]) || !isRecord(value)) return [key, value];
    return [key, mergeConfig(isRecord(base[key]) ? base[key] : {}, value, defaults[key])];
  });
  return { ...base, ...Object.fromEntries(entries) };
}

function check(path) {
  let text;
  try { text = readText(targetPath(path)); } catch {
    return { valid: false, unknown: [], invalid: [], unsafe: [], error: 'unreadable' };
  }
  try {
    const raw = text === null ? {} : parseObject(text);
    return { ...inspectConfig(raw), exists: text !== null };
  } catch {
    return { valid: false, unknown: [], invalid: [], unsafe: [], exists: true, error: 'invalid-json' };
  }
}

function withLock(path, createDirectory, operation) {
  const file = targetPath(path);
  if (createDirectory) mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  try { mkdirSync(lock, { mode: 0o700 }); } catch (error) {
    if (error.code === 'ENOENT' && !createDirectory) return { undone: false };
    if (error.code === 'EEXIST') throw new Error(`Configuration is locked at ${lock}.`);
    throw error;
  }
  try { return operation(file, `${file}.undo.json`); } finally { rmdirSync(lock); }
}

function restoreText(path, text) {
  if (text === null) {
    unlinkSync(path);
    return;
  }
  const staged = join(dirname(path), `.agy-hub-${randomUUID()}.tmp`);
  try {
    writeFileSync(staged, text, { flag: 'wx', mode: 0o600 });
    renameSync(staged, path);
  } finally {
    if (lstatSync(staged, { throwIfNoEntry: false })) unlinkSync(staged);
  }
}

function set(path, patch, createOnly = false) {
  const restricted = manualOnly.filter((key) => {
    const [section, field] = key.split('.');
    return isRecord(patch[section]) && Object.hasOwn(patch[section], field);
  });
  if (restricted.length) throw new Error(`Edit these file paths directly in the configuration file: ${restricted.join(', ')}.`);

  return withLock(path, true, (file, undoFile) => {
    const before = readText(file);
    if (createOnly && before !== null) return { created: false, path };
    const base = before === null ? {} : parseObject(before);
    const updated = mergeConfig(base, patch);
    const { valid, unknown, invalid, unsafe } = inspectConfig(updated);
    if (!valid) {
      const problems = [[unknown, 'Unknown keys'], [invalid, 'Invalid values'], [unsafe, 'Unsafe keys']]
        .filter(([keys]) => keys.length).map(([keys, label]) => `${label}: ${keys.map((key) => JSON.stringify(key)).join(', ')}`);
      throw new Error(`${problems.join('. ')}.`);
    }
    if (!createOnly && isDeepStrictEqual(updated, base)) return { updated: false };
    const next = `${json(updated)}\n`;
    if (Buffer.byteLength(next) > MAX_CONFIG_BYTES) throw new Error(`Configuration file exceeds ${MAX_CONFIG_BYTES} bytes.`);

    const oldUndo = readUndo(undoFile);
    writeObject(undoFile, { before, after: hash(next) });
    try {
      if (readText(file) !== before) throw new Error('Configuration changed while saving. Run config set again.');
      writeObject(file, updated);
    } catch (error) {
      restoreText(undoFile, oldUndo);
      throw error;
    }
    return createOnly ? { created: true, path } : { updated: true };
  });
}

function undo(path) {
  return withLock(path, false, (file, undoFile) => {
    const saved = readUndo(undoFile);
    if (saved === null) return { undone: false };
    const { before, after } = parseObject(saved);
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
  });
}

export function preferences(action, argument, { path = configPath() } = {}) {
  switch (action) {
    case 'show': return json(readConfig(path));
    case 'schema': return json({ defaults: DEFAULT_CONFIG, colorNames: [...ansiColors.keys()], manualOnly });
    case 'json-schema': return json(jsonSchema());
    case 'check': return json(check(path));
    case 'path': return path;
    case 'init': return json(set(path, presetConfig(argument), true));
    case 'set': return json(set(path, parseObject(argument)));
    case 'undo': return json(undo(path));
    default: throw new Error('Expected config show, schema, check, set or undo.');
  }
}
