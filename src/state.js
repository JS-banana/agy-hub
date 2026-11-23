import { labelText } from './terminal.js';

const nonnegative = (value) => Number.isFinite(value) && value >= 0 ? value : null;
const percentage = (value) => Math.round(Math.max(0, Math.min(100, value)));

function contextUsage(window) {
  if (!window || typeof window !== 'object') return null;
  const current = window.current_usage;
  const input = nonnegative(current?.input_tokens);
  const cacheRead = nonnegative(current?.cache_read_input_tokens);
  const cacheWrite = nonnegative(current?.cache_creation_input_tokens);
  const cache = cacheRead === null && cacheWrite === null ? null : (cacheRead ?? 0) + (cacheWrite ?? 0);
  const size = nonnegative(window.context_window_size);

  let used = nonnegative(window.used_percentage);
  const remaining = nonnegative(window.remaining_percentage);
  if (used === null && remaining !== null && remaining <= 100) used = 100 - remaining;
  if (used === null && size > 0 && input !== null) used = 100 * ((input + (cache ?? 0)) / size);
  return used === null ? null : { used: percentage(used), input, cache };
}

function quotaWindow(quota, key, now) {
  const bucket = quota?.[key];
  if (bucket?.disabled === true) return null;
  const remaining = nonnegative(bucket?.remaining_fraction);
  if (remaining === null || remaining > 1) return null;
  const resetAt = typeof bucket.reset_time === 'string' ? Date.parse(bucket.reset_time) : NaN;
  const resetIn = nonnegative(bucket.reset_in_seconds);
  const reset = Number.isFinite(resetAt) ? resetAt - now : (resetIn ?? 0) * 1000;
  return { used: percentage(100 * (1 - remaining)), exhausted: remaining === 0, reset };
}

function usageWindows(quota, identity, now) {
  const group = (key) => ({
    short: quotaWindow(quota, `${key}-5h`, now),
    weekly: quotaWindow(quota, `${key}-weekly`, now),
  });
  const gemini = group('gemini');
  const thirdParty = group('3p');
  const argon = /\bargon\b/i.test(identity) ? quotaWindow(quota, 'gemini-argon-wtu-weekly', now) : null;
  if (argon) return { weekly: argon };
  if (/\bgemini\b/i.test(identity)) return gemini;
  if (/\b(claude|opus|sonnet|haiku|gpt|openai|deepseek|grok|kimi|glm|qwen|minimax)\b/i.test(identity)) return thirdParty;
  const hasGemini = Boolean(gemini.short || gemini.weekly);
  const hasThirdParty = Boolean(thirdParty.short || thirdParty.weekly);
  if (hasGemini !== hasThirdParty) return hasGemini ? gemini : thirdParty;
  return {};
}

function subagents(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    const name = labelText(entry?.name) || labelText(entry?.role);
    if (!name || !['running', 'completed'].includes(entry.status)) return [];
    const model = labelText(entry.model?.display_name) || labelText(entry.model?.id) || labelText(entry.model);
    const role = labelText(entry.role);
    return [{ name, model, role: role === name ? '' : role, running: entry.status === 'running' }];
  });
}

export function normalizeState(payload, now = Date.now()) {
  const window = payload?.context_window;
  const model = labelText(payload?.model?.display_name) || labelText(payload?.model?.id);
  const identity = `${model} ${labelText(payload?.model?.id)}`;
  const terminalWidth = payload?.terminal_width;
  return {
    cwd: [payload?.workspace?.current_dir, payload?.cwd, payload?.workspace?.project_dir]
      .find((value) => typeof value === 'string' && value.length > 0),
    vcs: payload?.vcs?.type,
    model,
    effort: labelText(payload?.model?.effort),
    title: labelText(payload?.conversation_title),
    version: labelText(payload?.version),
    width: Number.isInteger(terminalWidth) && terminalWidth > 0 ? terminalWidth : null,
    context: contextUsage(window),
    quota: usageWindows(payload?.quota, identity, now),
    agents: subagents(payload?.subagents),
    conversationId: payload?.conversation_id ?? payload?.session_id,
    transcriptPath: payload?.transcript_path,
    agentState: payload?.agent_state,
    tasks: nonnegative(payload?.task_count),
    cost: nonnegative(payload?.cost?.total_usd),
    input: nonnegative(window?.total_input_tokens),
    output: nonnegative(window?.total_output_tokens),
  };
}
