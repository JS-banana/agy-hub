import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { freemem, homedir, totalmem } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { recordCosts as summarizeCosts } from './cost.js';
import { isRecord } from './objects.js';
import { readObject, writeObject } from './runtime/json-file.js';

export { readObject, writeObject } from './runtime/json-file.js';

export const dataDir = () => process.env.AGY_HUB_DATA_DIR || join(homedir(), '.gemini', 'antigravity-cli', 'agy-hub-data');
const finite = (value) => Number.isFinite(value) && value >= 0;

const execFileAsync = promisify(execFile);
const vmStatOptions = { encoding: 'utf8', timeout: 120, maxBuffer: 16 * 1024 };

function summarizeMemory(raw = '') {
  const total = totalmem();
  if (!total) return null;
  let used = total - freemem();
  if (process.platform === 'linux') {
    const free = /^MemAvailable:\s+(\d+) kB/m.exec(raw);
    if (free) used = total - Number(free[1]) * 1024;
  } else if (process.platform === 'darwin') {
    const page = /page size of (\d+) bytes/i.exec(raw);
    const active = /^Pages active:\s+(\d+)/m.exec(raw);
    const wired = /^Pages wired down:\s+(\d+)/m.exec(raw);
    if (page && active && wired) used = Number(page[1]) * (Number(active[1]) + Number(wired[1]));
  }
  return { total, used: Math.max(0, Math.min(total, used)) };
}

export function memoryUsage() {
  try {
    if (process.platform === 'linux') return summarizeMemory(readFileSync('/proc/meminfo', 'utf8'));
    if (process.platform === 'darwin') return summarizeMemory(execFileSync('/usr/bin/vm_stat', vmStatOptions));
  } catch { /* Fall back to the operating system's free-memory counter. */ }
  return summarizeMemory();
}

export async function memoryUsageAsync() {
  try {
    if (process.platform === 'linux') return summarizeMemory(await readFile('/proc/meminfo', 'utf8'));
    if (process.platform === 'darwin') return summarizeMemory((await execFileAsync('/usr/bin/vm_stat', vmStatOptions)).stdout);
  } catch { /* Fall back to the operating system's free-memory counter. */ }
  return summarizeMemory();
}

const MARKERS = ['.git', '.jj', '.hg'];
const DEFINITIONS = ['AGENTS.md', 'GEMINI.md'];
const CUSTOMIZATION_DIRS = ['.agents', '.agent', '_agents', '_agent'];

function workspaceLevels(cwd) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd) || cwd.includes('\0')) return [];
  const levels = [];
  let dir = resolve(cwd);
  while (levels.length < 64) {
    levels.push(dir);
    if (MARKERS.some((marker) => existsSync(join(dir, marker)))) return levels;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return levels.slice(0, 1);
}

function files(path) {
  try { return readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isFile()); } catch { return []; }
}

export function configCounts(state, home = homedir()) {
  const workspace = [...new Set([state.cwd, ...state.addedDirs].flatMap(workspaceLevels))];
  const personal = join(home, '.gemini');
  const configurations = [...workspace.flatMap((dir) => CUSTOMIZATION_DIRS.map((name) => join(dir, name))), join(personal, 'config')];
  const instructions = [...workspace, personal, ...configurations].reduce((total, dir) =>
    total + files(dir).filter((entry) => DEFINITIONS.includes(entry.name)).length, 0);
  const counts = { instructions, rules: 0, mcp: 0, hooks: 0 };
  const servers = new Set();
  for (const dir of configurations) {
    counts.rules += files(join(dir, 'rules')).filter((entry) => entry.name.endsWith('.md')).length;
    const mcp = readObject(join(dir, 'mcp_config.json'))?.mcpServers;
    if (isRecord(mcp)) for (const name of Object.keys(mcp)) servers.add(name);
    const hooks = readObject(join(dir, 'hooks.json')) ?? {};
    counts.hooks += Object.values(hooks).filter((group) => isRecord(group) && group.enabled !== false)
      .flatMap((group) => Object.values(group)).filter(Array.isArray).reduce((total, entries) =>
        total + entries.reduce((count, entry) => count + (Array.isArray(entry?.hooks)
          ? entry.hooks.filter((handler) => typeof handler?.command === 'string').length
          : typeof entry?.command === 'string' ? 1 : 0), 0), 0);
  }
  return { ...counts, mcp: servers.size };
}

function snapshotWindow(window, time) {
  return { used: window.used, amount: window.amount, exhausted: window.exhausted, observedAt: time,
    resetAt: window.resetAt ?? (window.reset !== 0 ? time + window.reset : 0) };
}

function restoreWindow(window, now) {
  const used = finite(window.used) && window.used <= 100 ? window.used : null;
  const amount = finite(window.amount) ? window.amount : null;
  if (used === null && amount === null) return null;
  return {
    used, amount,
    exhausted: window.exhausted === true,
    expired: false,
    reset: window.resetAt ? window.resetAt - now : 0,
  };
}

export function externalQuota(state, display) {
  const { quota, now } = state;
  if (!quota.key) return quota;
  const filename = (path) => path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
  const keys = ['short', 'weekly'];
  const active = (window) => Boolean(window && !window.expired);
  const disabled = (key) => quota.disabled?.includes(key);
  const valid = (snapshot, key) => {
    const window = snapshot?.[key];
    const time = window?.observedAt ?? snapshot?.time;
    return snapshot?.version === 1 && snapshot.key === quota.key && !disabled(key)
      && isRecord(window) && finite(window.resetAt) && (window.resetAt === 0 || window.resetAt > now)
      && finite(time) && time <= now && now - time <= display.externalUsageFreshnessMs;
  };
  const saved = display.externalUsagePath ? readObject(filename(display.externalUsagePath)) : null;
  if (display.externalUsageWritePath && keys.some((key) => active(quota[key]))) {
    try {
      const path = filename(display.externalUsageWritePath);
      const before = readObject(path);
      const windows = Object.fromEntries(keys.map((key) => [key, active(quota[key]) ? snapshotWindow(quota[key], now)
        : valid(before, key) ? { ...before[key], observedAt: before[key].observedAt ?? before.time } : null]));
      if (before?.version !== 1 || before.key !== quota.key || !finite(before.time) || before.time > now || now - before.time >= 30_000 ||
        keys.some((key) => {
          const prior = before[key];
          const next = windows[key];
          return prior?.used !== next?.used || prior?.amount !== next?.amount || prior?.exhausted !== next?.exhausted
            || (next && !valid(before, key)) || (prior?.resetAt > now) !== (next?.resetAt > now);
        })) {
        writeObject(path, { version: 1, key: quota.key, time: now, scoped: quota.scoped === true, ...windows });
      }
    } catch {
      // Native quota remains available if writing a snapshot fails.
    }
  }
  const merged = { ...quota };
  for (const key of keys) {
    if (active(quota[key])) continue;
    if (valid(saved, key)) {
      merged[key] = restoreWindow(saved[key], now);
      if (merged[key] && saved.scoped === true) merged.scoped = true;
    } else if (quota[key]?.expired) merged[key] = null;
  }
  return merged;
}

export function recordCosts(state, display, directory = dataDir()) {
  return summarizeCosts(state, display, directory);
}
