import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { labelText } from './terminal.js';

const MAX_TAIL_BYTES = 256 * 1024;
const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const TOOLS = new Map(Object.entries({
  read_file: 'Read', view_file: 'Read', edit_file: 'Edit', replace_file_content: 'Edit',
  multi_replace_file_content: 'Edit', apply_patch: 'Edit', write_file: 'Write', write_to_file: 'Write',
  run_command: 'Bash', command_status: 'Bash', grep_search: 'Grep', find_by_name: 'Glob', list_dir: 'List',
}));
const PATH_TOOLS = new Set(['Read', 'Edit', 'Write']);

function toolCall(call) {
  if (typeof call?.name !== 'string' || !/^[\w.:-]{1,64}$/.test(call.name)) return null;
  const name = TOOLS.get(call.name) ?? call.name;
  let target = '';
  if (PATH_TOOLS.has(name)) {
    let path = call.args?.Path ?? call.args?.AbsolutePath ?? call.args?.TargetFile ?? call.args?.path;
    if (typeof path === 'string' && path.startsWith('"')) {
      try { path = JSON.parse(path); } catch { path = ''; }
    }
    if (typeof path === 'string') target = labelText(path.split(/[/\\]/).at(-1));
  }
  return { name, target };
}

function parseStep(line) {
  try { return JSON.parse(line); } catch { return null; }
}

/** AGY emits calls on PLANNER_RESPONSE and the corresponding GENERIC results in order. */
export function summarizeTranscript(tail, agentState) {
  let last = [];
  let resultIndex = 0;
  const completed = new Map();
  for (const line of tail.split('\n')) {
    const event = parseStep(line);
    if (event?.type === 'PLANNER_RESPONSE') {
      last = Array.isArray(event.tool_calls) ? event.tool_calls.map((call) => ({ call: toolCall(call), status: null })) : [];
      resultIndex = 0;
    } else if (event?.type === 'GENERIC' && resultIndex < last.length) {
      const entry = last[resultIndex++];
      entry.status = event.status;
      if (entry.call && entry.status === 'DONE') {
        const { name } = entry.call;
        completed.set(name, (completed.get(name) ?? 0) + 1);
      }
    } else if (event?.type) {
      // A result separated from its calls by another step has no explicit link.
      last = [];
    }
  }
  return {
    running: agentState === 'tool_use' ? last
      .filter(({ call, status }) => call && (status === null || status === 'RUNNING'))
      .map(({ call }) => call) : [],
    completed: [...completed].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}

function readTail(root, relative) {
  let fd;
  try {
    const expected = join(realpathSync(root), relative);
    if (realpathSync(expected) !== expected) return null;
    fd = openSync(expected, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const info = fstatSync(fd);
    if (!info.isFile()) return null;
    const start = Math.max(0, info.size - MAX_TAIL_BYTES);
    const buffer = Buffer.alloc(Math.min(info.size, MAX_TAIL_BYTES));
    const length = readSync(fd, buffer, 0, buffer.length, start);
    const tail = buffer.toString('utf8', 0, length);
    return start > 0 ? (tail.includes('\n') ? tail.slice(tail.indexOf('\n') + 1) : '') : tail;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function readActivity({ conversationId, transcriptPath, agentState }, home = homedir()) {
  if (typeof conversationId !== 'string' || !UUID.test(conversationId)) return null;
  const relative = join(conversationId, '.system_generated', 'logs', 'transcript.jsonl');
  const appRoot = join(home, '.gemini', 'antigravity', 'brain');
  const cliRoot = join(home, '.gemini', 'antigravity-cli', 'brain');
  const roots = transcriptPath === join(appRoot, relative) ? [appRoot, cliRoot] : [cliRoot];
  for (const root of roots) {
    const tail = readTail(root, relative);
    if (tail !== null) return summarizeTranscript(tail, agentState);
  }
  return null;
}
