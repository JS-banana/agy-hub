// @ts-check
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { dataDir } from './local-data.js';
import { isRecord, objectOrEmpty } from './objects.js';
import { readObject, writeObject } from './runtime/json-file.js';
import { labelText } from './terminal.js';
import { nonnegative, timeValue, validConversation } from './state.js';

const MAX_TAIL_BYTES = 8 * 1024 * 1024;
const SAMPLE_BYTES = 4 * 1024;
const CURSOR_BYTES = 256 * 1024;
const MAX_CACHED_TOOLS = 1024;
const TOOL_NAME = /^[\w.:-]{1,128}$/;
const TOOLS = new Map(Object.entries({
  read_file: 'Read', view_file: 'Read', edit_file: 'Edit', replace_file_content: 'Edit',
  multi_replace_file_content: 'Edit', apply_patch: 'Edit', write_file: 'Write', write_to_file: 'Write',
  run_command: 'Bash', command_status: 'Bash', grep_search: 'Grep', find_by_name: 'Glob', list_dir: 'List',
}));
const PATH_TOOLS = new Set(['Read', 'Edit', 'Write']);

/** @typedef {import('./render/types.js').ToolCall} ToolCall */
/** @typedef {Pick<ToolCall, 'name' | 'kind'> & {count: number}} CompletedTool */
/** @typedef {{pending: (ToolCall | null)[], running: {call: ToolCall, observed: number | null}[],
 *  completed: Record<string, CompletedTool>, started: number | null, lastReply: number | null,
 *  replyTokens: number | null, model: string}} TranscriptState */
/** @typedef {{version: 2, dev: string, ino: string, stamp: string, offset: number, truncated: boolean,
 *  head: string, tail: string, state: TranscriptState}} Cursor */

/** @param {unknown} call @returns {ToolCall | null} */
export function toolCall(call) {
  if (!isRecord(call) || typeof call.name !== 'string' || !TOOL_NAME.test(call.name)) return null;
  const name = TOOLS.get(call.name) ?? call.name;
  if (/^mcp(?:__|:|\.)/i.test(call.name)) return { name, target: '', kind: 'mcp' };
  let target = '';
  if (PATH_TOOLS.has(name)) {
    const args = objectOrEmpty(call.args);
    let path = args.Path ?? args.AbsolutePath ?? args.TargetFile ?? args.path;
    if (typeof path === 'string' && path.startsWith('"')) {
      try { path = JSON.parse(path); } catch { path = ''; }
    }
    if (typeof path === 'string') {
      target = labelText(path.split(/[/\\]/).at(-1));
      const isSkill = args.IsSkillFile === true || args.IsSkillFile === 'true';
      if (name === 'Read' && isSkill && target === 'SKILL.md') {
        return { name: labelText(basename(dirname(path))), target: '', kind: 'skills' };
      }
    }
  }
  return { name, target };
}

/** @returns {TranscriptState} */
function emptyState() {
  return { pending: [], running: [], completed: {}, started: null, lastReply: null, replyTokens: null, model: '' };
}

/** AGY emits calls on PLANNER_RESPONSE and the corresponding GENERIC results in order.
 *  @param {TranscriptState} state @param {string} text
 */
function applyLines(state, text) {
  let next = 0;
  for (const line of text.split('\n')) {
    if (!line) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const createdAt = timeValue(event?.created_at);
    state.started ??= createdAt;
    if (event?.type === 'PLANNER_RESPONSE') {
      if (createdAt !== null) state.lastReply = createdAt;
      state.replyTokens = nonnegative(event.output_tokens);
      state.model = labelText(event.model?.display_name) || labelText(event.model?.id) || labelText(event.model) || state.model;
      state.pending = Array.isArray(event.tool_calls) ? event.tool_calls.map(toolCall) : [];
      state.running = [];
      next = 0;
    } else if (event?.type === 'GENERIC' && next < state.pending.length) {
      const call = state.pending[next++];
      if (!call) continue;
      if (event.status === 'DONE') {
        const { kind, name } = call;
        const key = `${kind ?? 'tools'}:${name}`;
        const prior = state.completed[key];
        if (prior) prior.count++;
        else state.completed[key] = kind ? { name, kind, count: 1 } : { name, count: 1 };
      } else if (event.status === 'RUNNING' || event.status === null) {
        state.running.push({ call, observed: event.status === 'RUNNING' ? createdAt : null });
      }
    } else if (event?.type) {
      // A result separated from its calls by another step has no explicit link.
      state.pending = [];
      state.running = [];
      next = 0;
    }
  }
  if (next) state.pending = state.pending.slice(next);
}

/** @param {TranscriptState} state @param {string | undefined} agentState @param {number} now @param {boolean} [truncated] */
function summary(state, agentState, now, truncated = false) {
  const running = state.running.filter(({ observed }) => agentState === 'tool_use'
    || (observed !== null && now - observed < 60_000)).map(({ call }) => call);
  if (agentState === 'tool_use') {
    for (const call of state.pending) if (call) running.push(call);
  }
  return {
    running, completed: Object.values(state.completed).sort((a, b) => b.count - a.count),
    ...(!truncated && state.started !== null ? { started: state.started } : {}),
    ...(state.lastReply !== null ? { lastReply: state.lastReply } : {}),
    ...(state.replyTokens !== null ? { replyTokens: state.replyTokens } : {}),
    ...(state.model ? { model: state.model } : {}),
  };
}

/** @param {string} tail @param {string} [agentState] @param {number} [now] */
export function summarizeTranscript(tail, agentState, now = Date.now()) {
  const state = emptyState();
  applyLines(state, tail);
  return summary(state, agentState, now);
}

/** @param {unknown} value */
const validTime = (value) => value === null || Number.isSafeInteger(value);
/** @param {unknown} value */
const validLabel = (value) => typeof value === 'string' && labelText(value) === value;
/** @param {Record<string, unknown>} tool */
const validName = (tool) => tool.kind === 'skills' ? validLabel(tool.name)
  : (tool.kind === undefined || tool.kind === 'mcp') && typeof tool.name === 'string' && TOOL_NAME.test(tool.name);
/** @param {unknown} call */
const validCall = (call) => isRecord(call) && validName(call) && validLabel(call.target)
  && Object.keys(call).length === (call.kind ? 3 : 2);

/** @param {Buffer} buffer */
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
/** @param {unknown} value */
const validDigest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** @param {unknown} cache @param {import('node:fs').BigIntStats} info @returns {cache is Cursor} */
function validCache(cache, info) {
  if (!isRecord(cache) || cache.version !== 2 || cache.dev !== String(info.dev) || cache.ino !== String(info.ino)
    || typeof cache.offset !== 'number' || !Number.isSafeInteger(cache.offset) || cache.offset < 0
    || typeof cache.truncated !== 'boolean' || typeof cache.stamp !== 'string'
    || !validDigest(cache.head) || !validDigest(cache.tail)
    || !isRecord(cache.state)) return false;
  const state = cache.state;
  if (Object.keys(state).length !== Object.keys(emptyState()).length
    || !validTime(state.started) || !validTime(state.lastReply) || !validLabel(state.model)
    || (state.replyTokens !== null && nonnegative(state.replyTokens) === null)
    || !Array.isArray(state.pending) || !Array.isArray(state.running) || !isRecord(state.completed)
    || state.pending.length + state.running.length > MAX_CACHED_TOOLS) return false;
  const completed = Object.entries(state.completed);
  return completed.length <= MAX_CACHED_TOOLS && completed.every(([key, tool]) =>
    isRecord(tool) && validName(tool) && key === `${tool.kind ?? 'tools'}:${tool.name}`
    && typeof tool.count === 'number' && Number.isSafeInteger(tool.count) && tool.count > 0
    && Object.keys(tool).length === (tool.kind ? 3 : 2))
    && state.pending.every((call) => call === null || validCall(call))
    && state.running.every((entry) => isRecord(entry) && Object.keys(entry).length === 2
      && validCall(entry.call) && validTime(entry.observed));
}

/** @param {number} fd @param {bigint} start @param {number} length */
function readRange(fd, start, length) {
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const count = readSync(fd, buffer, offset, length - offset, start + BigInt(offset));
    if (!count) throw new Error('Transcript changed during read.');
    offset += count;
  }
  return buffer;
}

/** @param {number} fd @param {import('node:fs').BigIntStats} info @param {string} cursorPath
 *  @param {string | undefined} agentState @param {number} now
 */
function readTranscript(fd, info, cursorPath, agentState, now) {
  const saved = readObject(cursorPath, CURSOR_BYTES);
  let cursor = validCache(saved, info) && info.size >= saved.offset
    && info.size - BigInt(saved.offset) <= MAX_TAIL_BYTES ? saved : null;
  const stamp = [info.size, info.mtimeNs, info.ctimeNs].join(':');
  if (cursor?.stamp === stamp) {
    const remaining = Number(info.size - BigInt(cursor.offset));
    if (remaining) applyLines(cursor.state, readRange(fd, BigInt(cursor.offset), remaining).toString('utf8'));
    return summary(cursor.state, agentState, now, cursor.truncated);
  }
  // A changed stat stamp at the same size is a rewrite rather than an append.
  if (cursor && info.size === BigInt(cursor.offset)) cursor = null;

  // Verify fixed head and tail boundary digests (at most 8 KiB total) so
  // growing logs stay O(delta) and keep full history without rebasing.
  let headSample = Buffer.alloc(0);
  let tailSample = Buffer.alloc(0);
  if (cursor && cursor.offset > 0) {
    const headLen = Math.min(cursor.offset, SAMPLE_BYTES);
    headSample = readRange(fd, 0n, headLen);
    if (sha256(headSample) !== cursor.head) {
      cursor = null;
    } else {
      const sampleStart = Math.max(0, cursor.offset - SAMPLE_BYTES);
      tailSample = sampleStart === 0 && cursor.offset <= SAMPLE_BYTES
        ? headSample
        : readRange(fd, BigInt(sampleStart), cursor.offset - sampleStart);
      if (sha256(tailSample) !== cursor.tail) cursor = null;
    }
  }

  const tailStart = info.size > MAX_TAIL_BYTES ? info.size - BigInt(MAX_TAIL_BYTES) : 0n;
  const start = cursor ? BigInt(cursor.offset) : tailStart;
  const truncated = cursor ? cursor.truncated : start > 0n;
  const state = cursor?.state ?? emptyState();
  const buffer = readRange(fd, start, Number(info.size - start));
  const end = buffer.lastIndexOf(0x0a) + 1;
  // A tail starting inside a line can only resume at its first newline.
  const begin = !cursor && truncated ? buffer.indexOf(0x0a) + 1 : 0;
  if (!cursor && truncated && !begin) return summary(state, agentState, now, truncated);
  if (end > begin) applyLines(state, buffer.toString('utf8', begin, end));
  const offset = Number(start + BigInt(end));
  if (Number.isSafeInteger(offset)
    && state.pending.length + state.running.length <= MAX_CACHED_TOOLS && Object.keys(state.completed).length <= MAX_CACHED_TOOLS) {
    try {
      const committed = buffer.subarray(0, end);
      let head;
      if (cursor) {
        head = cursor.offset >= SAMPLE_BYTES ? cursor.head
          : sha256(Buffer.concat([headSample, committed]).subarray(0, SAMPLE_BYTES));
      } else if (start === 0n) {
        head = sha256(committed.subarray(0, SAMPLE_BYTES));
      } else {
        head = sha256(readRange(fd, 0n, Math.min(offset, SAMPLE_BYTES)));
      }
      let tail;
      if (end >= SAMPLE_BYTES) {
        tail = sha256(committed.subarray(end - SAMPLE_BYTES, end));
      } else if (cursor) {
        tail = sha256(Buffer.concat([tailSample, committed]).subarray(-SAMPLE_BYTES));
      } else if (start === 0n) {
        tail = sha256(committed);
      } else {
        const tailPos = Math.max(0, offset - SAMPLE_BYTES);
        tail = sha256(readRange(fd, BigInt(tailPos), offset - tailPos));
      }
      writeObject(cursorPath, { version: 2, dev: String(info.dev), ino: String(info.ino), stamp,
        offset, truncated, head, tail, state }, CURSOR_BYTES);
    } catch { /* Activity is available even if the cursor cannot be saved. */ }
  }
  if (end < buffer.length) {
    applyLines(state, buffer.toString('utf8', end));
  }
  return summary(state, agentState, now, truncated);
}

/** @param {{conversationId?: string, transcriptPath?: string, agentState?: string, now?: number}} state
 *  @param {string} [home] @param {string} [directory]
 */
export function readActivity(state, home = homedir(),
  directory = home === homedir() ? dataDir() : join(home, '.gemini', 'antigravity-cli', 'agy-hud-data')) {
  const { conversationId, transcriptPath, agentState } = state;
  if (!conversationId || !validConversation(conversationId)) return null;
  const now = state.now ?? Date.now();
  const relative = join(conversationId, '.system_generated', 'logs', 'transcript.jsonl');
  const cursorPath = join(directory, 'transcript', `${conversationId}.json`);
  const appRoot = join(home, '.gemini', 'antigravity', 'brain');
  const cliRoot = join(home, '.gemini', 'antigravity-cli', 'brain');
  const roots = transcriptPath === join(appRoot, relative) ? [appRoot, cliRoot] : [cliRoot];
  for (const root of roots) {
    let fd;
    try {
      const expected = join(realpathSync(root), relative);
      if (realpathSync(expected) !== expected) continue;
      fd = openSync(expected, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
      const info = fstatSync(fd, { bigint: true });
      if (info.isFile()) return readTranscript(fd, info, cursorPath, agentState, now);
    } catch { /* The transcript may be missing or changing. Try the next supported root. */ }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  return null;
}
