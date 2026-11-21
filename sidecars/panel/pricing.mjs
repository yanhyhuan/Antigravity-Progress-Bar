// Model pricing and exchange rate service with single-file cache and 24h sync throttle.
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { platformPaths } from '../../compat/platform.mjs';

// Sync interval: 24 hours (rates and model prices are stable)
export const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const BUILTIN_EXCHANGE_RATE = 7.15;

// Lightweight core modern models fallback
export const BUILTIN_MODELS = {
  'google/gemini-4-carbon': { prompt: 0.000002, completion: 0.000012, cacheRead: 0.0000002, cacheWrite: 0.00000025 },
  'google/gemini-4-neon': { prompt: 0.00000125, completion: 0.000005, cacheRead: 0.000000125, cacheWrite: 0.0000001875 },
  'google/gemini-4-hydrogen': { prompt: 0.00000075, completion: 0.000003, cacheRead: 0.000000075, cacheWrite: 0.0000001 },
  'google/gemini-4-argon': { prompt: 0.000002, completion: 0.00001, cacheRead: 0.0000001, cacheWrite: 0.0000001875 },
  'google/gemini-3.8-flash': { prompt: 0.00000075, completion: 0.00000375, cacheRead: 0.000000075, cacheWrite: 0.0000000416666666666667 },
  'google/gemini-3.8-pro': { prompt: 0.00000125, completion: 0.000005, cacheRead: 0.0000003125, cacheWrite: 0.00000125 },
  'anthropic/claude-opus-5.5': { prompt: 0.000004, completion: 0.00002, cacheRead: 0.0000002, cacheWrite: 0.000005 },
  'anthropic/claude-opus-4.6': { prompt: 0.000005, completion: 0.000025, cacheRead: 0.0000005, cacheWrite: 0.00000625 },
  'anthropic/claude-sonnet-5.5': { prompt: 0.000002, completion: 0.00001, cacheRead: 0.0000001, cacheWrite: 0.0000025 },
  'anthropic/claude-sonnet-5': { prompt: 0.000003, completion: 0.000015, cacheRead: 0.0000003, cacheWrite: 0.00000375 },
  'anthropic/claude-sonnet-4.6': { prompt: 0.000003, completion: 0.000015, cacheRead: 0.0000003, cacheWrite: 0.00000375 },
  'anthropic/claude-haiku-5.5': { prompt: 0.0000001, completion: 0.0000005, cacheRead: 0.00000001, cacheWrite: 0.000000125 },
  'openai/gpt-5.4': { prompt: 0.0000025, completion: 0.00001, cacheRead: 0.000000625, cacheWrite: 0 },
  'openai/gpt-4o': { prompt: 0.0000025, completion: 0.00001, cacheRead: 0.00000125, cacheWrite: 0 }
};

export function normalizeKey(str) {
  if (!str || typeof str !== 'string') return '';
  return str.toLowerCase().trim()
    .replace(/^https?:\/\/[^\/]+\//, '')
    .replace(/^[~@]/, '')
    .replace(/^(?:google|anthropic|openai)\//, '')
    .replace(/^orchestrator\s+(?=(?:gemini|claude|gpt|anthropic|google|openai|o[134])\b)/i, '')
    .replace(/\((?:xhigh|extra\s+high|max|high|medium|low|neon|orchestrator|thinking|(?:xhigh|extra\s+high|max|high|medium|low)\s+thinking)\)/gi, '')
    .trim()
    .replace(/-(?:n|thinking|preview|latest)$/, '')
    .replace(/:batch$/, '')
    .replace(/\s+/g, '-');
}

export function resolveModelPricing(modelName, catalog = BUILTIN_MODELS) {
  if (!modelName) return null;
  const raw = String(modelName).trim().toLowerCase();
  if (catalog[raw]) return catalog[raw];

  for (const prefix of ['google/', 'anthropic/', 'openai/']) {
    if (catalog[prefix + raw]) return catalog[prefix + raw];
  }

  const norm = normalizeKey(raw);
  if (!norm) return null;

  for (const [key, p] of Object.entries(catalog)) {
    if (normalizeKey(key) === norm) return p;
  }

  const dotNorm = norm.replace(/-(\d+)-(\d+)/g, '-$1.$2');
  const dashNorm = norm.replace(/\./g, '-');
  for (const [key, p] of Object.entries(catalog)) {
    const kNorm = normalizeKey(key);
    if (kNorm === dotNorm || kNorm === dashNorm) return p;
  }

  for (const [key, p] of Object.entries(catalog)) {
    const kNorm = normalizeKey(key);
    if (kNorm.startsWith(norm) || norm.startsWith(kNorm)) return p;
  }

  if (norm.includes('argon')) {
    const candidate = Object.entries(catalog).find(([k]) => normalizeKey(k).includes('argon'));
    if (candidate) return candidate[1];
  }
  if (norm.includes('carbon')) {
    const candidate = Object.entries(catalog).find(([k]) => normalizeKey(k).includes('carbon'));
    if (candidate) return candidate[1];
  }
  if (norm.includes('hydrogen')) {
    const candidate = Object.entries(catalog).find(([k]) => normalizeKey(k).includes('hydrogen'));
    if (candidate) return candidate[1];
  }
  if (norm.includes('neon')) {
    const candidate = Object.entries(catalog).find(([k]) => normalizeKey(k).includes('neon'));
    if (candidate) return candidate[1];
  }
  if (norm.includes('opus')) {
    const candidate = Object.entries(catalog).find(([k]) => normalizeKey(k).includes('opus'));
    if (candidate) return candidate[1];
  }
  if (norm.includes('sonnet')) {
    const candidate = Object.entries(catalog).find(([k]) => normalizeKey(k).includes('sonnet'));
    if (candidate) return candidate[1];
  }
  if (norm.includes('haiku')) {
    const candidate = Object.entries(catalog).find(([k]) => normalizeKey(k).includes('haiku'));
    if (candidate) return candidate[1];
  }
  if (norm.includes('flash')) {
    const candidate = Object.entries(catalog).find(([k]) => normalizeKey(k).includes('flash'));
    if (candidate) return candidate[1];
  }
  if (norm.startsWith('gemini-4')) {
    const candidate = Object.entries(catalog).find(([k]) => normalizeKey(k).startsWith('gemini-4'));
    if (candidate) return candidate[1];
  }
  if (norm.includes('orchestrator')) {
    const candidate = Object.entries(catalog).find(([k]) => normalizeKey(k).includes('neon'));
    if (candidate) return candidate[1];
  }

  return null;
}

export function computeCost(counts, pricing, { currency = 'zh-CN', exchangeRate = BUILTIN_EXCHANGE_RATE } = {}) {
  if (!counts || !pricing) return null;
  const uncached = Number(counts.uncached || 0);
  const read = Number(counts.cacheRead || 0);
  const write = Number(counts.cacheWrite || 0);
  const output = Number(counts.output || 0);

  const usd = (uncached * (pricing.prompt || 0)) +
              (read * (pricing.cacheRead || 0)) +
              (write * (pricing.cacheWrite || 0)) +
              (output * (pricing.completion || 0));

  const isZh = String(currency || '').startsWith('zh');
  const rate = Number(exchangeRate) > 0 ? Number(exchangeRate) : BUILTIN_EXCHANGE_RATE;
  const amount = isZh ? usd * rate : usd;
  const symbol = isZh ? '¥' : '$';

  return { usd, amount, symbol, currency, rate };
}

export function formatCostValue(amount, symbol = '¥') {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  if (amount === 0) return `${symbol}0.00`;
  if (amount > 0 && amount < 0.01) return `< ${symbol}0.01`;
  return `${symbol}${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export class PricingService {
  constructor(directory = platformPaths().data) {
    this.directory = directory;
    this.file = join(directory, 'pricing-cache.json');
    this.models = { ...BUILTIN_MODELS };
    this.exchangeRate = BUILTIN_EXCHANGE_RATE;
    this.lastSyncedAt = null;
    this.exchangeRateUpdatedAt = null;
    this.syncing = false;
    this.disposed = false;
    this.controller = null;
  }

  async init(activeModels = []) {
    await this.loadCache();
    if (!this.disposed) void this.fetchCloud(activeModels, false);
  }

  async loadCache() {
    try {
      const text = await readFile(this.file, 'utf8');
      const data = JSON.parse(text);
      if (data && typeof data === 'object') {
        if (Number(data.lastExchangeRate) > 0) {
          this.exchangeRate = Number(data.lastExchangeRate);
          this.exchangeRateUpdatedAt = data.exchangeRateUpdatedAt || null;
        }
        if (data.models && typeof data.models === 'object' && Object.keys(data.models).length > 0) {
          this.models = { ...BUILTIN_MODELS, ...data.models };
        }
        if (data.lastSyncedAt) this.lastSyncedAt = data.lastSyncedAt;
      }
    } catch {
      // Safe fallback to built-in defaults
    }
  }

  async saveCache() {
    if (this.disposed) return;
    const temp = this.file + '.' + randomUUID() + '.tmp';
    try {
      await mkdir(this.directory, { recursive: true });
      const payload = {
        lastExchangeRate: this.exchangeRate,
        exchangeRateUpdatedAt: this.exchangeRateUpdatedAt,
        lastSyncedAt: this.lastSyncedAt,
        models: this.models
      };
      await writeFile(temp, JSON.stringify(payload, null, 2), 'utf8');
      await rename(temp, this.file);
    } catch {
      await unlink(temp).catch(() => {});
    }
  }

  async fetchCloud(activeModels = [], force = false) {
    if (this.disposed || this.syncing) return;
    const now = Date.now();
    const lastSyncTime = this.lastSyncedAt ? Date.parse(this.lastSyncedAt) : 0;

    if (!force && lastSyncTime && Number.isFinite(lastSyncTime) && (now - lastSyncTime < SYNC_INTERVAL_MS)) {
      return;
    }

    this.syncing = true;
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 6000);
    timeout.unref?.();

    try {
      const erPromise = fetch('https://open.er-api.com/v6/latest/USD', {
        signal: controller.signal,
        headers: { 'User-Agent': 'AntigravityProgressBar/0.9.11' }
      }).then(r => r.ok ? r.json() : null).catch(() => null);

      const orPromise = fetch('https://openrouter.ai/api/v1/models', {
        signal: controller.signal,
        headers: { 'User-Agent': 'AntigravityProgressBar/0.9.11' }
      }).then(r => r.ok ? r.json() : null).catch(() => null);

      const [erData, orData] = await Promise.all([erPromise, orPromise]);
      if (this.disposed) return;

      let updated = false;

      if (erData?.result === 'success' && Number(erData.rates?.CNY) > 0) {
        this.exchangeRate = Number(erData.rates.CNY);
        this.exchangeRateUpdatedAt = new Date().toISOString();
        updated = true;
      }

      if (Array.isArray(orData?.data)) {
        const fullCloudCatalog = {};
        for (const m of orData.data) {
          if (!m?.id || !m.pricing) continue;
          const p = m.pricing;
          fullCloudCatalog[m.id] = {
            prompt: Number(p.prompt) || 0,
            completion: Number(p.completion) || 0,
            cacheRead: Number(p.input_cache_read) || 0,
            cacheWrite: Number(p.input_cache_write) || 0
          };
        }

        const targets = Array.isArray(activeModels) && activeModels.length > 0
          ? new Set(activeModels)
          : new Set(Object.keys(BUILTIN_MODELS));
        const extracted = {};

        for (const target of targets) {
          const matched = resolveModelPricing(target, fullCloudCatalog);
          if (matched) extracted[target] = matched;
        }

        if (Object.keys(extracted).length > 0) {
          this.models = { ...this.models, ...extracted };
          this.lastSyncedAt = new Date().toISOString();
          updated = true;
        }
      }

      if (updated) await this.saveCache();
    } catch {
      // Offline: retain cached/built-in pricing
    } finally {
      clearTimeout(timeout);
      if (this.controller === controller) this.controller = null;
      this.syncing = false;
    }
  }

  snapshot(activeModels = []) {
    const resultModels = {};
    const targets = Array.isArray(activeModels) && activeModels.length > 0
      ? activeModels
      : Object.keys(this.models);

    for (const m of targets) {
      const p = resolveModelPricing(m, this.models) || resolveModelPricing(m, BUILTIN_MODELS);
      if (p) resultModels[m] = p;
    }

    return {
      exchangeRate: this.exchangeRate,
      exchangeRateUpdatedAt: this.exchangeRateUpdatedAt,
      lastSyncedAt: this.lastSyncedAt,
      models: resultModels,
      syncing: this.syncing
    };
  }

  dispose() {
    this.disposed = true;
    this.controller?.abort();
    this.controller = null;
  }
}
