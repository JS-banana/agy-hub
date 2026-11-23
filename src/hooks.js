import { readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolCall } from './activity.js';
import { dataDir, readObject, writeObject } from './local-data.js';
import { validConversation } from './state.js';

const EVENTS = ['SessionStart', 'PreInvocation', 'PostInvocation', 'PreToolUse', 'PostToolUse'];
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const cli = fileURLToPath(new URL('./cli.js', import.meta.url));
const key = (value) => Number.isSafeInteger(value) && value >= 0;

export function hookDefinitions() {
  const definitions = EVENTS.map((event) => {
    const handler = { type: 'command', command: `${quote(process.execPath)} ${quote(cli)} hook ${event}`, timeout: 2 };
    return [event, event.endsWith('ToolUse') ? [{ matcher: '*', hooks: [handler] }] : [handler]];
  });
  return { 'agy-hub': Object.fromEntries(definitions) };
}

export function recordHook(event, input, directory = dataDir(), now = Date.now()) {
  if (!EVENTS.includes(event) || !validConversation(input?.conversationId)) return;
  const root = join(directory, 'hooks', input.conversationId);
  try {
    if (event === 'SessionStart' || event === 'PreInvocation') {
      const paths = Array.isArray(input.workspacePaths) ? input.workspacePaths
        .filter((path) => typeof path === 'string' && isAbsolute(path) && !path.includes('\0')).slice(0, 6) : [];
      if (paths.length || event === 'SessionStart') {
        const metadata = readObject(join(root, 'workspace.json')) ?? {};
        writeObject(join(root, 'workspace.json'), {
          started: metadata.started ?? now, paths: paths.length ? paths : (metadata.paths ?? []),
        });
      }
    }
    if (event === 'PreInvocation' && key(input.invocationNum)) {
      writeObject(join(root, 'start.json'), { id: input.invocationNum, time: now });
    }
    if (event === 'PostInvocation' && key(input.invocationNum)) {
      const start = readObject(join(root, 'start.json'));
      if (start?.id === input.invocationNum && Number.isFinite(start.time) && now >= start.time) {
        writeObject(join(root, 'invocation.json'), { from: start.time, to: now });
      }
    }
    if (event.endsWith('ToolUse') && key(input.stepIdx)) {
      const call = toolCall(input.toolCall);
      if (!call) return;
      const phase = event === 'PreToolUse' ? 'pre' : 'post';
      writeObject(join(root, 'tools', `${input.stepIdx}.${phase}.json`), {
        call, ok: !input.error, time: now,
      });
    }
  } catch {
    // Metadata is optional and never changes whether agy runs a tool.
  }
}

function observeTools(root, now) {
  let entries;
  try { entries = readdirSync(root); } catch { return null; }
  const steps = new Map();
  for (const filename of entries) {
    const match = /^(\d+)\.(pre|post)\.json$/.exec(filename);
    if (!match) continue;
    const [, step, phase] = match;
    const current = steps.get(Number(step));
    if (!current || phase === 'post') steps.set(Number(step), { filename, phase });
  }
  const completed = new Map();
  const running = [];
  for (const { filename, phase } of [...steps.entries()].sort((a, b) => a[0] - b[0]).map(([, entry]) => entry)) {
    const data = readObject(join(root, filename));
    if (!data?.call?.name) continue;
    if (phase === 'pre' && Number.isFinite(data.time) && now - data.time < 300_000) running.push(data.call);
    if (phase === 'post' && data.ok === true) {
      const { name, kind } = data.call;
      const identity = `${kind ?? 'tools'}:${name}`;
      const prior = completed.get(identity);
      if (prior) prior.count += 1;
      else completed.set(identity, { name, kind, count: 1 });
    }
  }
  return { running, completed: [...completed.values()].sort((a, b) => b.count - a.count) };
}

export function hookActivity(state, activity, display, directory = dataDir()) {
  if (!validConversation(state.conversationId)) return activity;
  const root = join(directory, 'hooks', state.conversationId);
  const metadata = readObject(join(root, 'workspace.json'));
  if (!metadata) return activity;
  const snapshot = { ...activity, started: activity?.started ?? metadata.started };
  if (!state.addedDirs.length && Array.isArray(metadata.paths)) {
    const primary = new Set([state.cwd, state.launchDir].filter(Boolean).map((path) => resolve(path)));
    state.addedDirs = metadata.paths.filter((path) => typeof path === 'string' && isAbsolute(path) && !primary.has(resolve(path)));
  }
  if (display.showSpeed && activity?.replyTokens > 0 && activity.lastReply != null) {
    const interval = readObject(join(root, 'invocation.json'));
    if (interval && Number.isFinite(interval.from) && Number.isFinite(interval.to) &&
      interval.to - interval.from >= 500 && activity.lastReply >= interval.from && activity.lastReply <= interval.to + 2000) {
      snapshot.speed = 1000 * activity.replyTokens / (interval.to - interval.from);
    }
  }
  if (display.showTools || display.showSkills || display.showMcp) {
    const events = observeTools(join(root, 'tools'), state.now);
    if (events) {
      const combined = new Map((activity?.completed ?? []).map((item) => [`${item.kind ?? 'tools'}:${item.name}`, item]));
      for (const item of events.completed) {
        const name = `${item.kind ?? 'tools'}:${item.name}`;
        if ((combined.get(name)?.count ?? 0) < item.count) combined.set(name, item);
      }
      snapshot.completed = [...combined.values()].sort((a, b) => b.count - a.count);
      snapshot.running = events.running.length ? events.running : activity?.running;
    }
  }
  return snapshot;
}
