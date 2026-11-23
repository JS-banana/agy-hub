import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { constants, closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, writeFileSync,
  mkdirSync, renameSync, unlinkSync, readdirSync } from 'node:fs';
import { freemem, homedir, totalmem } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { validConversation } from './state.js';
import { WEEK } from './metrics.js';

export const dataDir = () => process.env.AGY_HUB_DATA_DIR || join(homedir(), '.gemini', 'antigravity-cli', 'agy-hub-data');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => Number.isFinite(value) && value >= 0;

export function readObject(path, maxBytes = 128 * 1024) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > maxBytes) return null;
    const value = JSON.parse(readFileSync(fd, 'utf8'));
    return isObject(value) ? value : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function writeObject(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = join(dirname(path), `.agy-hub-${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(tmp, path);
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

export function memoryUsage() {
  const total = totalmem();
  if (!total) return null;
  let used = total - freemem();
  try {
    if (process.platform === 'linux') {
      const raw = readFileSync('/proc/meminfo', 'utf8');
      const free = /^MemAvailable:\s+(\d+) kB/m.exec(raw);
      if (free) used = total - Number(free[1]) * 1024;
    } else if (process.platform === 'darwin') {
      const raw = execFileSync('/usr/bin/vm_stat', { encoding: 'utf8', timeout: 120, maxBuffer: 16 * 1024 });
      const page = /page size of (\d+) bytes/i.exec(raw);
      const active = /^Pages active:\s+(\d+)/m.exec(raw);
      const wired = /^Pages wired down:\s+(\d+)/m.exec(raw);
      if (page && active && wired) used = Number(page[1]) * (Number(active[1]) + Number(wired[1]));
    }
  } catch {
    // Fall back to the operating system's free-memory counter.
  }
  return { total, used: Math.max(0, Math.min(total, used)) };
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
    if (isObject(mcp)) for (const name of Object.keys(mcp)) servers.add(name);
    const hooks = readObject(join(dir, 'hooks.json')) ?? {};
    counts.hooks += Object.values(hooks).filter((group) => isObject(group) && group.enabled !== false)
      .flatMap((group) => Object.values(group)).filter(Array.isArray).reduce((total, entries) =>
        total + entries.reduce((count, entry) => count + (Array.isArray(entry?.hooks)
          ? entry.hooks.filter((handler) => typeof handler?.command === 'string').length
          : typeof entry?.command === 'string' ? 1 : 0), 0), 0);
  }
  return { ...counts, mcp: servers.size };
}

function snapshotWindow(window, time) {
  if (!window) return null;
  return { used: window.used, amount: window.amount, exhausted: window.exhausted, observedAt: time,
    resetAt: window.reset > 0 ? time + window.reset : 0 };
}

function restoreWindow(window, now) {
  if (!isObject(window) || !finite(window.resetAt)) return null;
  const used = finite(window.used) && window.used <= 100 ? window.used : null;
  const amount = finite(window.amount) ? window.amount : null;
  if (used === null && amount === null) return null;
  return {
    used, amount,
    exhausted: window.exhausted === true,
    reset: window.resetAt ? window.resetAt - now : 0,
  };
}

export function externalQuota(state, display) {
  const { quota, now } = state;
  if (!quota.key) return quota;
  const filename = (path) => path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
  const keys = ['short', 'weekly'];
  const disabled = (key) => quota.disabled?.includes(key);
  const valid = (snapshot, key) => {
    const time = snapshot?.[key]?.observedAt ?? snapshot?.time;
    return snapshot?.version === 1 && snapshot.key === quota.key && !disabled(key)
      && finite(time) && time <= now && now - time <= display.externalUsageFreshnessMs;
  };
  const saved = display.externalUsagePath ? readObject(filename(display.externalUsagePath)) : null;
  if ((quota.short || quota.weekly) && display.externalUsageWritePath) {
    try {
      const path = filename(display.externalUsageWritePath);
      const before = readObject(path);
      const windows = Object.fromEntries(keys.map((key) => [key, quota[key] ? snapshotWindow(quota[key], now)
        : valid(before, key) && before[key] ? { ...before[key], observedAt: before[key].observedAt ?? before.time } : null]));
      if (before?.key !== quota.key || !finite(before.time) || now - before.time >= 30_000 ||
        keys.some((key) => before[key]?.used !== windows[key]?.used || before[key]?.amount !== windows[key]?.amount)) {
        writeObject(path, { version: 1, key: quota.key, time: now, scoped: quota.scoped === true, ...windows });
      }
    } catch {
      // Native quota remains available if writing a snapshot fails.
    }
  }
  const merged = { ...quota };
  for (const key of keys) {
    if (quota[key] || !valid(saved, key)) continue;
    const window = restoreWindow(saved[key], now);
    if (window) {
      merged[key] = window;
      if (saved.scoped === true) merged.scoped = true;
    }
  }
  return merged;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const THREE_WEEKS = 3 * WEEK;

function weeklyStart(state, period, day) {
  if (period === 'quota') {
    const reset = state.quota.weekly?.reset;
    return reset > 0 && reset <= WEEK ? state.now + reset - WEEK : null;
  }
  const start = new Date(day);
  start.setDate(start.getDate() - (start.getDay() - DAYS.indexOf(period) + 7) % 7);
  return start.getTime();
}

function updateCost(file, state) {
  const { now, cost, quota } = state;
  const prior = readObject(file);
  if (finite(prior?.total) && cost <= prior.total) return;
  const lock = file + '.lock';
  let fd;
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    fd = openSync(lock, 'wx', 0o600);
    const current = readObject(file);
    const total = finite(current?.total) ? current.total : 0;
    if (current && cost <= total) return;
    const events = Array.isArray(current?.events) ? current.events.filter((event) => event?.time > now - THREE_WEEKS) : [];
    // A resumed conversation may already have incurred its entire first observed cost.
    if (current && cost > total) events.push({ time: now, value: cost - total, group: quota.key ?? '' });
    writeObject(file, { total: Math.max(total, cost), events });
  } catch (error) {
    if (error.code === 'EEXIST') {
      try {
        if (Date.now() - lstatSync(lock).mtimeMs > 15_000) unlinkSync(lock);
      } catch { /* Another callback may have released it. */ }
    }
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
      try { unlinkSync(lock); } catch { /* The next callback can recover. */ }
    }
  }
}

export function recordCosts(state, display, directory = dataDir()) {
  const root = join(directory, 'cost');
  const { now, conversationId, cost } = state;
  if (validConversation(conversationId) && finite(cost)) {
    updateCost(join(root, `${conversationId}.json`), state);
  }
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const dayStart = today.getTime();
  const weekStart = weeklyStart(state, display.weeklyCostPeriod, dayStart);
  let day = 0;
  let week = weekStart === null ? null : 0;
  for (const entry of files(root)) {
    if (!entry.name.endsWith('.json') || !validConversation(entry.name.slice(0, -5))) continue;
    const ledger = readObject(join(root, entry.name));
    if (!Array.isArray(ledger?.events)) continue;
    for (const event of ledger.events) {
      if (!finite(event?.time) || event.time > now || !finite(event?.value)) continue;
      if (event.time >= dayStart) day += event.value;
      if (week !== null && event.time >= weekStart &&
        (display.weeklyCostPeriod !== 'quota' || event.group === state.quota.key)) week += event.value;
    }
  }
  return { day, week };
}
