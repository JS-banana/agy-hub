import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { labelText } from './terminal.js';
import { nonnegative, timeValue, validConversation } from './state.js';

const MAX_TAIL_BYTES = 8 * 1024 * 1024;
const TOOLS = new Map(Object.entries({
  read_file: 'Read', view_file: 'Read', edit_file: 'Edit', replace_file_content: 'Edit',
  multi_replace_file_content: 'Edit', apply_patch: 'Edit', write_file: 'Write', write_to_file: 'Write',
  run_command: 'Bash', command_status: 'Bash', grep_search: 'Grep', find_by_name: 'Glob', list_dir: 'List',
}));
const PATH_TOOLS = new Set(['Read', 'Edit', 'Write']);

export function toolCall(call) {
  if (typeof call?.name !== 'string' || !/^[\w.:-]{1,128}$/.test(call.name)) return null;
  const name = TOOLS.get(call.name) ?? call.name;
  if (/^mcp(?:__|:|\.)/i.test(call.name)) return { name, target: '', kind: 'mcp' };
  let target = '';
  if (PATH_TOOLS.has(name)) {
    let path = call.args?.Path ?? call.args?.AbsolutePath ?? call.args?.TargetFile ?? call.args?.path;
    if (typeof path === 'string' && path.startsWith('"')) {
      try { path = JSON.parse(path); } catch { path = ''; }
    }
    if (typeof path === 'string') {
      target = labelText(path.split(/[/\\]/).at(-1));
      const isSkill = [true, 'true'].includes(call.args?.IsSkillFile);
      if (name === 'Read' && isSkill && target === 'SKILL.md') {
        return { name: labelText(basename(dirname(path))), target: '', kind: 'skills' };
      }
    }
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
  let started = null;
  let lastReply = null;
  let output = null;
  let model = '';
  for (const line of tail.split('\n')) {
    const event = parseStep(line);
    const createdAt = timeValue(event?.created_at);
    if (createdAt !== null && started === null) started = createdAt;
    if (event?.type === 'PLANNER_RESPONSE') {
      if (createdAt !== null) lastReply = createdAt;
      output = nonnegative(event.output_tokens);
      model = labelText(event.model?.display_name) || labelText(event.model?.id) || labelText(event.model) || model;
      last = Array.isArray(event.tool_calls) ? event.tool_calls.map((call) => ({ call: toolCall(call), status: null })) : [];
      resultIndex = 0;
    } else if (event?.type === 'GENERIC' && resultIndex < last.length) {
      const entry = last[resultIndex++];
      entry.status = event.status;
      entry.observed = createdAt;
      if (entry.call && entry.status === 'DONE') {
        const { kind, name } = entry.call;
        const key = `${kind ?? 'tools'}:${name}`;
        const prior = completed.get(key);
        if (prior) prior.count += 1;
        else completed.set(key, kind ? { kind, name, count: 1 } : { name, count: 1 });
      }
    } else if (event?.type) {
      // A result separated from its calls by another step has no explicit link.
      last = [];
    }
  }
  return {
    running: last.filter(({ call, status, observed }) => call && (
      (agentState === 'tool_use' && (status === null || status === 'RUNNING'))
      || (status === 'RUNNING' && observed != null && Date.now() - observed < 60_000)
    )).map(({ call }) => call),
    completed: [...completed.values()].sort((a, b) => b.count - a.count),
    ...(started !== null ? { started } : {}),
    ...(lastReply !== null ? { lastReply } : {}),
    ...(output !== null ? { replyTokens: output } : {}),
    ...(model ? { model } : {}),
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
  if (!validConversation(conversationId)) return null;
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
