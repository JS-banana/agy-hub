// @ts-check
import { closeSync, lstatSync, mkdirSync, openSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { WEEK } from './metrics.js';
import { isRecord } from './objects.js';
import { readStoredObject, writeObject } from './runtime/json-file.js';
import { validConversation } from './state.js';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const GROUPS = ['argon', 'gemini', '3p'];
const THREE_WEEKS = 3 * WEEK;
const ARCHIVE_EVENTS = 512;
// Older releases could write more than their general JSON reader could reopen.
const LEDGER_BYTES = 8 * 1024 * 1024;
const ARCHIVE_BYTES = 128 * 1024;

/** @typedef {import('./state.js').HudState} HudState */
/** @typedef {import('./config-schema.js').HudConfig['display']} Display */
/** @typedef {{time: number, value: number, group: string}} CostEvent */
/** @typedef {{id: number, latest: number}} CostArchive */
/** @typedef {{total: number, events: CostEvent[], archives: CostArchive[], nextArchive: number}} CostLedger */

/** @param {unknown} value @returns {value is number} */
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
/** @param {unknown} value @returns {value is number} */
const archiveId = (value) => finite(value) && Number.isSafeInteger(value);

/** @param {unknown} value @returns {CostEvent[]} */
function costEvents(value) {
  if (!Array.isArray(value)) throw new Error('Invalid cost entries.');
  /** @type {unknown[]} */
  const events = value;
  return events.map((event) => {
    if (!isRecord(event) || !finite(event.time) || !finite(event.value)) throw new Error('Invalid cost entry.');
    const group = typeof event.group === 'string' && GROUPS.includes(event.group) ? event.group : '';
    return { time: event.time, value: event.value, group };
  });
}

/** @param {string} file @returns {CostLedger | null} */
function readLedger(file) {
  const data = readStoredObject(file, LEDGER_BYTES);
  if (!data) return null;
  if (!finite(data.total)) throw new Error('Invalid cumulative cost.');
  const events = costEvents(data.events);
  if (data.archives === undefined && data.nextArchive === undefined) {
    return { total: data.total, events, archives: [], nextArchive: 0 };
  }
  if (!Array.isArray(data.archives) || !archiveId(data.nextArchive)) throw new Error('Invalid cost archives.');
  /** @type {CostArchive[]} */
  const archives = [];
  let previous = -1;
  for (const entry of data.archives) {
    if (!isRecord(entry) || !archiveId(entry.id) || entry.id <= previous || entry.id >= data.nextArchive || !finite(entry.latest)) {
      throw new Error('Invalid cost archive reference.');
    }
    archives.push({ id: entry.id, latest: entry.latest });
    previous = entry.id;
  }
  return { total: data.total, events, archives, nextArchive: data.nextArchive };
}

/** @param {HudState} state @param {Display['weeklyCostPeriod']} period @param {number} day */
function weeklyStart(state, period, day) {
  if (period === 'quota') {
    const { weekly } = state.quota;
    return weekly && !weekly.expired && weekly.reset > 0 && weekly.reset <= WEEK
      ? state.now + weekly.reset - WEEK : null;
  }
  const start = new Date(day);
  start.setDate(start.getDate() - (start.getDay() - DAYS.indexOf(period) + 7) % 7);
  return start.getTime();
}

/** @param {string} root @param {number} id */
const archivePath = (root, id) => join(root, `${id}.json`);

/** @param {string} file @param {string} archiveRoot @param {HudState} state @param {number} cost */
function updateCost(file, archiveRoot, { now, quota }, cost) {
  const lock = file + '.lock';
  let fd;
  try {
    const prior = readLedger(file);
    if (prior && cost <= prior.total) return;
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    fd = openSync(lock, 'wx', 0o600);
    const current = readLedger(file);
    if (current && cost <= current.total) return;

    const cutoff = now - THREE_WEEKS;
    const events = current?.events.filter((event) => event.time > cutoff) ?? [];
    // A resumed conversation may have incurred its entire first observed cost.
    if (current) events.push({ time: now, value: cost - current.total, group: quota.key ?? '' });
    const archives = current?.archives.filter(({ latest }) => latest > cutoff) ?? [];
    let nextArchive = current?.nextArchive ?? 0;
    let start = 0;
    while (start + ARCHIVE_EVENTS < events.length) {
      if (!archiveId(nextArchive + 1)) throw new Error('Cost archive number is out of range.');
      const batch = events.slice(start, start + ARCHIVE_EVENTS);
      const latest = Math.max(...batch.map((event) => event.time));
      // Publishing the ledger below makes this immutable batch visible. If it
      // fails, the same unpublished number can be reused at the next callback.
      writeObject(archivePath(archiveRoot, nextArchive), { events: batch }, ARCHIVE_BYTES);
      archives.push({ id: nextArchive++, latest });
      start += ARCHIVE_EVENTS;
    }
    writeObject(file, { total: cost, events: events.slice(start), archives, nextArchive }, LEDGER_BYTES);
    for (const entry of current?.archives ?? []) {
      if (entry.latest <= cutoff) {
        try { unlinkSync(archivePath(archiveRoot, entry.id)); } catch { /* Already pruned or unavailable. */ }
      }
    }
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EEXIST') {
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

/** @param {string} root */
function conversations(root) {
  try {
    return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile() &&
      entry.name.endsWith('.json') && validConversation(entry.name.slice(0, -5)));
  } catch { return []; }
}

/** @param {HudState} state @param {Display} display @param {string} directory */
export function recordCosts(state, display, directory) {
  const root = join(directory, 'cost');
  const { now, conversationId, cost } = state;
  const archiveRoot = join(root, 'archives');
  if (conversationId && validConversation(conversationId) && finite(cost)) {
    updateCost(join(root, `${conversationId}.json`), join(archiveRoot, conversationId), state, cost);
  }
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const dayStart = today.getTime();
  const weekStart = weeklyStart(state, display.weeklyCostPeriod, dayStart);
  const earliest = Math.min(dayStart, weekStart ?? dayStart);
  let day = 0;
  let week = weekStart === null ? null : 0;
  /** @param {CostEvent[]} events */
  function count(events) {
    for (const event of events) {
      if (event.time > now) continue;
      if (event.time >= dayStart) day += event.value;
      if (week !== null && weekStart !== null && event.time >= weekStart &&
        (display.weeklyCostPeriod !== 'quota' || event.group === state.quota.key)) week += event.value;
    }
  }
  for (const entry of conversations(root)) {
    let ledger;
    try { ledger = readLedger(join(root, entry.name)); } catch { continue; }
    if (!ledger) continue;
    // Oldest events first keeps floating-point accumulation stable after rotation.
    for (const archive of ledger.archives) {
      if (archive.latest < earliest) continue;
      try {
        const batch = readStoredObject(archivePath(join(archiveRoot, entry.name.slice(0, -5)), archive.id), ARCHIVE_BYTES);
        if (batch) count(costEvents(batch.events));
      } catch { /* An unreadable archive does not hide the rest of the history. */ }
    }
    count(ledger.events);
  }
  return { day, week };
}
