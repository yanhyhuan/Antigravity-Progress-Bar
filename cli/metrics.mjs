// The CLI contract is independent of desktop ModelUsageStats semantics.
import { createHash } from 'node:crypto';

const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const tokens = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export const states = ['idle', 'thinking', 'working', 'tool_use', 'initializing'];
// Exact IDs observed in the official quota map. Never infer a shared Gemini
// window from an arbitrary gemini-* suffix: Argon has a distinct weekly pool.
const knownQuotaIds = new Set(['gemini-5h', 'gemini-weekly', '3p-5h', '3p-weekly', 'gemini-argon-wtu-weekly']);
// States in which the model is producing tokens (tool execution is excluded).
export const generating = state => state === 'thinking' || state === 'working';
export const busy = state => state === 'thinking' || state === 'working' || state === 'tool_use';

export function cleanText(value, limit = 120) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, limit);
}

// One-way, truncated key: statistics can be grouped per conversation without
// storing the conversation ID itself.
export function conversationKey(id) {
  if (typeof id !== 'string' || !id || id.length > 200) return null;
  return createHash('sha256').update('antigrative-dashboard:' + id).digest('hex').slice(0, 24);
}

// Cache hit = cache read / (uncached input + cache read + cache write).
// Unknown cache read stays unknown; a zero denominator has no ratio.
export function cacheRate({ input, cacheRead, cacheWrite }) {
  if (cacheRead === null || input === null) return null;
  const total = input + cacheRead + (cacheWrite || 0);
  if (!Number.isSafeInteger(total)) return null;
  return total > 0 ? cacheRead / total * 100 : null;
}

export function normalize(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid status payload');
  const context = object(payload.context_window), usage = object(context.current_usage);
  const model = object(payload.model), cost = object(payload.cost);
  const used = number(context.used_percentage), remaining = number(context.remaining_percentage);
  const entries = Object.entries(object(payload.quota));
  // Keep official windows even when unknown buckets precede them. The output
  // remains bounded; unknown names retain their own sanitized identity.
  const selected = [...entries.filter(([key]) => knownQuotaIds.has(key)), ...entries.filter(([key]) => !knownQuotaIds.has(key))].slice(0, 16);
  const quotas = selected.map(([key, raw]) => {
    const value = object(raw), fraction = number(value.remaining_fraction);
    const reset = typeof value.reset_time === 'string' ? Date.parse(value.reset_time) : NaN;
    return {
      id: cleanText(key, 64), bucketId: knownQuotaIds.has(key) ? key : null, disabled: value.disabled === true,
      remaining: value.disabled !== true && fraction !== null && fraction <= 1 ? fraction * 100 : null,
      resetInSeconds: number(value.reset_in_seconds), resetTime: Number.isFinite(reset) ? reset : null,
    };
  }).filter(value => value.id);
  const current = {
    input: tokens(usage.input_tokens), output: tokens(usage.output_tokens),
    cacheRead: tokens(usage.cache_read_input_tokens), cacheWrite: tokens(usage.cache_creation_input_tokens),
  };
  return {
    model: cleanText(model.display_name || model.id) || null,
    modelId: cleanText(model.id) || null,
    state: states.includes(payload.agent_state) ? payload.agent_state : null,
    width: Number.isInteger(payload.terminal_width) && payload.terminal_width > 0 ? Math.min(500, payload.terminal_width) : 80,
    context: { usedPercentage: used ?? (remaining !== null && remaining <= 100 ? 100 - remaining : null),
      capacity: tokens(context.context_window_size) || null },
    // Conversation totals supplied by the CLI (cumulative, not context occupancy).
    totals: { input: tokens(context.total_input_tokens), output: tokens(context.total_output_tokens) },
    cacheReadTokens: current.cacheRead,
    cacheCreationTokens: current.cacheWrite,
    inputTokens: current.input, outputTokens: current.output,
    requestCacheRate: cacheRate(current),
    cost: { usd: number(cost.total_usd), estimated: cost.estimated === true },
    quotas,
  };
}

export function compact(value) {
  if (value === null || value === undefined) return '--';
  for (const [base, suffix, nextBase, nextSuffix] of [[1e12, 'T', 0, ''], [1e9, 'B', 1e12, 'T'], [1e6, 'M', 1e9, 'B'], [1e3, 'K', 1e6, 'M']]) {
    if (value >= base) {
      const rounded = Number((value / base).toFixed(1));
      return nextBase && rounded * base >= nextBase ? `1${nextSuffix}` : `${rounded}${suffix}`;
    }
  }
  return String(Math.round(value));
}

export function percentage(value, digits = 1) {
  return value === null || value === undefined ? '--' : `${Number(value.toFixed(digits))}%`;
}

export function money(value, estimated = false) {
  if (value === null || value === undefined) return '--';
  const text = value >= 100 ? value.toFixed(0) : value >= 1 ? value.toFixed(2) : value.toFixed(value >= 0.01 ? 2 : 3);
  return `${estimated ? '≈' : ''}$${text}`;
}

export function duration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '--';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(seconds / 3600)}h${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}m`;
}

export function countdown(quota, now = Date.now()) {
  // Absolute time prevents a replayed reset_in_seconds from looking fresh.
  const seconds = quota.resetTime !== null ? Math.max(0, (quota.resetTime - now) / 1000) : quota.resetInSeconds;
  if (seconds === null || seconds === undefined) return null;
  if (seconds < 60) return '<1m';
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h${Math.floor(seconds % 3600 / 60)}m`;
  return `${Math.floor(seconds / 86400)}d${Math.floor(seconds % 86400 / 3600)}h`;
}
