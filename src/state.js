// @ts-check
import { objectOrEmpty } from './objects.js';
import { labelText } from './terminal.js';

/** @param {unknown} value */
export const nonnegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
/** @param {number} value */
export const percentage = (value) => Math.round(Math.max(0, Math.min(100, value)));
/** @param {unknown} value */
export const timeValue = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
/** @param {unknown} id */
export const validConversation = (id) => typeof id === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id);

/** @param {Record<string, unknown>} window */
function contextUsage(window) {
  const current = objectOrEmpty(window.current_usage);
  const input = nonnegative(current.input_tokens);
  const cacheRead = nonnegative(current.cache_read_input_tokens);
  const cacheWrite = nonnegative(current.cache_creation_input_tokens);
  const cache = cacheRead === null && cacheWrite === null ? null : (cacheRead ?? 0) + (cacheWrite ?? 0);
  const size = nonnegative(window.context_window_size) || null;

  let used = nonnegative(window.used_percentage);
  const remaining = nonnegative(window.remaining_percentage);
  if (used === null && remaining !== null && remaining <= 100) used = 100 - remaining;
  const fallbackTokens = input === null ? null : input + (cache ?? 0);
  if (used === null && size !== null && fallbackTokens !== null) used = 100 * fallbackTokens / size;
  const tokens = size !== null && used !== null ? Math.round(size * Math.min(used, 100) / 100) : fallbackTokens;
  return used === null && tokens === null ? null : {
    used: used === null ? null : percentage(used), input, cache, cacheRead, size, tokens,
  };
}

/** @typedef {{used: number | null, amount: number | null, exhausted: boolean, reset: number, resetAt?: number}} QuotaWindow */
/** @typedef {{short?: QuotaWindow | null, weekly?: QuotaWindow | null, scoped?: boolean, key?: 'argon' | 'gemini' | '3p', disabled?: string[]}} UsageWindows */

/** @param {Record<string, unknown>} quota
 *  @param {string} key
 *  @param {number} now
 *  @returns {QuotaWindow | null}
 */
function quotaWindow(quota, key, now) {
  const bucket = objectOrEmpty(quota[key]);
  if (bucket.disabled === true) return null;
  const fraction = nonnegative(bucket.remaining_fraction);
  const remaining = fraction !== null && fraction <= 1 ? fraction : null;
  const amount = nonnegative(bucket.remaining_amount);
  if (remaining === null && amount === null) return null;
  const resetIn = nonnegative(bucket.reset_in_seconds);
  const resetAt = timeValue(bucket.reset_time) ?? (resetIn === null ? null : now + resetIn * 1000);
  return {
    used: remaining === null ? null : percentage(100 * (1 - remaining)), amount,
    exhausted: (remaining ?? amount) === 0, reset: resetAt === null ? 0 : resetAt - now,
    ...(resetAt === null ? {} : { resetAt }),
  };
}

/** @param {Record<string, unknown>} quota
 *  @param {string} identity
 *  @param {number} now
 *  @returns {UsageWindows}
 */
function usageWindows(quota, identity, now) {
  /** @param {string} key */
  const disabled = (key) => objectOrEmpty(quota[key]).disabled === true;
  /** @param {string} key */
  const group = (key) => ({
    short: quotaWindow(quota, `${key}-5h`, now),
    weekly: quotaWindow(quota, `${key}-weekly`, now),
    disabled: [disabled(`${key}-5h`) ? 'short' : '', disabled(`${key}-weekly`) ? 'weekly' : ''].filter(Boolean),
  });
  const gemini = group('gemini');
  const thirdParty = group('3p');
  const argon = /\bargon\b/i.test(identity) ? quotaWindow(quota, 'gemini-argon-wtu-weekly', now) : null;
  if (argon) return { weekly: argon, scoped: true, key: 'argon' };
  if (/\bargon\b/i.test(identity) && !gemini.short && !gemini.weekly) {
    return { key: 'argon', disabled: disabled('gemini-argon-wtu-weekly') ? ['weekly'] : [] };
  }
  if (/\bgemini\b/i.test(identity)) return { ...gemini, key: 'gemini' };
  if (/\b(claude|opus|sonnet|haiku|gpt|openai|deepseek|grok|kimi|glm|qwen|minimax)\b/i.test(identity)) return { ...thirdParty, key: '3p' };
  const hasGemini = Boolean(gemini.short || gemini.weekly);
  const hasThirdParty = Boolean(thirdParty.short || thirdParty.weekly);
  if (hasGemini !== hasThirdParty) return hasGemini ? { ...gemini, key: 'gemini' } : { ...thirdParty, key: '3p' };
  return {};
}

/** @param {unknown} entries */
function subagents(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((value) => {
    const entry = objectOrEmpty(value);
    const name = labelText(entry.name) || labelText(entry.role);
    if (!name || (entry.status !== 'running' && entry.status !== 'completed')) return [];
    const source = objectOrEmpty(entry.model);
    const model = labelText(source.display_name) || labelText(source.id) || labelText(entry.model);
    const role = labelText(entry.role);
    return [{
      name, model, role: role === name ? '' : role, running: entry.status === 'running',
      effort: labelText(entry.effort ?? source.effort),
      start: timeValue(entry.started_at), end: timeValue(entry.completed_at),
    }];
  });
}

/** @param {unknown} value */
const textValue = (value) => typeof value === 'string' && value.length > 0 ? value : undefined;

/** @param {unknown} input
 *  @param {number} [now]
 */
export function normalizeState(input, now = Date.now()) {
  const payload = objectOrEmpty(input);
  const workspace = objectOrEmpty(payload.workspace);
  const window = objectOrEmpty(payload.context_window);
  const modelSource = objectOrEmpty(payload.model);
  const model = labelText(modelSource.display_name) || labelText(modelSource.id);
  const identity = `${model} ${labelText(modelSource.id)}`;
  const terminalWidth = nonnegative(payload.terminal_width);
  /** @type {unknown[]} */
  const dirs = Array.isArray(workspace.added_dirs) ? workspace.added_dirs : [];
  return {
    cwd: textValue(workspace.current_dir) ?? textValue(payload.cwd) ?? textValue(workspace.project_dir),
    launchDir: textValue(payload.cwd) ?? textValue(workspace.project_dir),
    addedDirs: dirs.filter((path) => typeof path === 'string').slice(0, 5),
    vcs: textValue(objectOrEmpty(payload.vcs).type),
    model,
    now,
    effort: labelText(modelSource.effort),
    title: labelText(payload.conversation_title),
    version: labelText(payload.version),
    width: terminalWidth !== null && Number.isInteger(terminalWidth) && terminalWidth > 0 ? terminalWidth : null,
    context: contextUsage(window),
    quota: usageWindows(objectOrEmpty(payload.quota), identity, now),
    agents: subagents(payload.subagents),
    conversationId: textValue(payload.conversation_id) ?? textValue(payload.session_id),
    transcriptPath: textValue(payload.transcript_path),
    agentState: labelText(payload.agent_state),
    agent: labelText(objectOrEmpty(payload.agent).name),
    plan: labelText(payload.plan_tier),
    email: labelText(payload.email),
    sandbox: objectOrEmpty(payload.sandbox).enabled === true,
    cycleMode: labelText(payload.cycle_mode),
    artifacts: nonnegative(payload.artifact_count),
    tasks: nonnegative(payload.task_count),
    cost: nonnegative(objectOrEmpty(payload.cost).total_usd),
    input: nonnegative(window.total_input_tokens),
    output: nonnegative(window.total_output_tokens),
  };
}

/** @typedef {ReturnType<typeof normalizeState>} HudState */
