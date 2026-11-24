// Synthetic data for --preview, --preview-argon, the browser preview and tests. Never real usage.
export function previewPayload(overrides = {}) {
  return {
    model: { display_name: 'Gemini 3.5 Flash (High)' }, agent_state: 'working', terminal_width: 100,
    context_window: { total_input_tokens: 88244, total_output_tokens: 61074, used_percentage: 44.2, context_window_size: 1048576,
      current_usage: { input_tokens: 63382, output_tokens: 346, cache_read_input_tokens: 20857, cache_creation_input_tokens: 0 } },
    quota: { 'gemini-5h': { remaining_fraction: 0.72, reset_in_seconds: 8100 },
      'gemini-weekly': { remaining_fraction: 0.9378, reset_in_seconds: 560580 } },
    cost: { total_usd: 0.4213, estimated: false },
    ...overrides,
  };
}

export function previewArgonPayload(overrides = {}) {
  const base = previewPayload({
    version: '1.4.5',
    model: { id: 'gemini-4-argon-high', display_name: 'Gemini 4 Argon (High)' },
    agent_state: 'idle',
    quota: {
      'gemini-5h': { remaining_fraction: 0.72, reset_in_seconds: 8100 },
      'gemini-weekly': { remaining_fraction: 0.9378, reset_in_seconds: 560580 },
      'gemini-argon-wtu-weekly': { remaining_fraction: 0.4, reset_in_seconds: 345600 },
      '3p-5h': { remaining_fraction: 0.82, reset_in_seconds: 3600 },
      '3p-weekly': { remaining_fraction: 0.24, reset_in_seconds: 172800 },
    },
    ...overrides,
  });
  return base;
}

export const previewStats = () => ({ session: { cacheRate: 31.4, tps: 41.8 },
  turn: { input: 12340, output: 1180, cost: 0.03, requests: 3, cacheRate: 64.2, tps: 45.3, elapsed: 38000, end: null }, lastTurn: null });
