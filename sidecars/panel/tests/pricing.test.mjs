import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PricingService,
  resolveModelPricing,
  computeCost,
  formatCostValue,
  normalizeKey,
  BUILTIN_MODELS
} from '../pricing.mjs';

test('normalizeKey handles prefixes, suffixes, qualifiers, and punctuation consistently', () => {
  assert.equal(normalizeKey('google/gemini-3.8-flash-n'), 'gemini-3.8-flash');
  assert.equal(normalizeKey('anthropic/claude-opus-4-6-thinking'), 'claude-opus-4-6');
  assert.equal(normalizeKey('gemini-4-argon:batch'), 'gemini-4-argon');
  assert.equal(normalizeKey('~anthropic/claude-opus-latest'), 'claude-opus');
  assert.equal(normalizeKey('Claude 3.5 Sonnet'), 'claude-3.5-sonnet');
  assert.equal(normalizeKey('Gemini 4 Carbon (High)'), 'gemini-4-carbon');
  assert.equal(normalizeKey('Gemini 4 Neon (XHigh)'), 'gemini-4-neon');
  assert.equal(normalizeKey('Gemini 4 Hydrogen (Orchestrator)'), 'gemini-4-hydrogen');
  assert.equal(normalizeKey('Claude Opus 5.5 (Max)'), 'claude-opus-5.5');
  assert.equal(normalizeKey('Claude Sonnet 5.5 (Max Thinking)'), 'claude-sonnet-5.5');
  assert.equal(normalizeKey('Orchestrator Claude Opus 5.5 (Max)'), 'claude-opus-5.5');
});

test('resolveModelPricing matches diverse model IDs including Carbon and Neon families', () => {
  assert.equal(resolveModelPricing('Gemini 4 Carbon (High)', BUILTIN_MODELS)?.prompt, 0.000002);
  assert.equal(resolveModelPricing('Gemini 4 Neon (XHigh)', BUILTIN_MODELS)?.prompt, 0.00000125);
  assert.equal(resolveModelPricing('Gemini 4 Hydrogen (Orchestrator)', BUILTIN_MODELS)?.prompt, 0.00000075);
  assert.equal(resolveModelPricing('Claude Opus 5.5 (Max)', BUILTIN_MODELS)?.prompt, 0.000004);
  assert.equal(resolveModelPricing('Orchestrator Claude Opus 5.5 (Max)', BUILTIN_MODELS)?.prompt, 0.000004);
  assert.equal(resolveModelPricing('Orchestrator (Neon)', BUILTIN_MODELS)?.prompt, 0.00000125);
  assert.equal(resolveModelPricing('Orchestrator', BUILTIN_MODELS)?.prompt, 0.00000125);
  assert.equal(resolveModelPricing('gemini-3.8-flash-n', BUILTIN_MODELS)?.prompt, 0.00000075);
  assert.equal(resolveModelPricing('claude-opus-4-6-thinking', BUILTIN_MODELS)?.prompt, 0.000005);
  assert.equal(resolveModelPricing('claude-opus-4.6', BUILTIN_MODELS)?.prompt, 0.000005);
  assert.equal(resolveModelPricing('unknown-future-model-xyz', BUILTIN_MODELS), null);
});

test('computeCost computes formula accurately for USD and CNY across zh-CN / zh-TW / en', () => {
  const pricing = { prompt: 0.000001, cacheRead: 0.0000001, cacheWrite: 0, completion: 0.000005 };
  const counts = { uncached: 1000000, cacheRead: 2000000, cacheWrite: 0, output: 500000 };

  const en = computeCost(counts, pricing, { currency: 'en', exchangeRate: 7.2 });
  assert.equal(en.usd, 3.7);
  assert.equal(en.amount, 3.7);
  assert.equal(en.symbol, '$');

  const zh = computeCost(counts, pricing, { currency: 'zh-CN', exchangeRate: 7.2 });
  assert.equal(zh.usd, 3.7);
  assert.equal(Math.round(zh.amount * 100) / 100, 26.64);
  assert.equal(zh.symbol, '¥');

  const tw = computeCost(counts, pricing, { currency: 'zh-TW', exchangeRate: 7.2 });
  assert.equal(tw.symbol, '¥');
  assert.equal(Math.round(tw.amount * 100) / 100, 26.64);
});

test('formatCostValue handles zeros, tiny fractions and regular currency amounts', () => {
  assert.equal(formatCostValue(null), '—');
  assert.equal(formatCostValue(0, '¥'), '¥0.00');
  assert.equal(formatCostValue(0, '$'), '$0.00');
  assert.equal(formatCostValue(0.0005, '¥'), '< ¥0.01');
  assert.equal(formatCostValue(0.0005, '$'), '< $0.01');
  assert.equal(formatCostValue(12.345, '¥'), '¥12.35');
  assert.equal(formatCostValue(1234.5, '$'), '$1,234.50');
});

test('PricingService restores lastExchangeRate from cache when offline and disposes cleanly', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ag-pricing-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const cachePayload = {
    lastExchangeRate: 6.885,
    exchangeRateUpdatedAt: '2026-10-14T08:00:00.000Z',
    lastSyncedAt: '2026-10-14T08:00:00.000Z',
    models: {
      'custom/ultra-gemini-4': { prompt: 0.000003, completion: 0.000015, cacheRead: 0.00000015 }
    }
  };
  await writeFile(join(dir, 'pricing-cache.json'), JSON.stringify(cachePayload), 'utf8');

  const service = new PricingService(dir);
  await service.loadCache();

  assert.equal(service.exchangeRate, 6.885);
  assert.equal(service.models['custom/ultra-gemini-4'].prompt, 0.000003);

  const snapshot = service.snapshot();
  assert.equal(snapshot.exchangeRate, 6.885);
  assert.equal(snapshot.exchangeRateUpdatedAt, '2026-10-14T08:00:00.000Z');
  assert.ok(snapshot.models['custom/ultra-gemini-4']);
  service.dispose();
  assert.equal(service.disposed, true);
});
