// Local usage ledger for the CLI status line.
// Only whitelisted numbers, model labels and state are stored, one file per
// conversation under a one-way key. No prompt text, IDs, paths or account data.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { generating, busy, cleanText } from './metrics.mjs';

export const SCHEMA = 1;
const MAX_GAP = 120000;   // a single sample interval counts as generation for at most 2 minutes
const LATE_MS = 15000;    // totals arriving shortly after idle still belong to the finished turn
const DAY_LIMIT = 120;
const MODEL_LIMIT = 8;
const KEY = /^[a-f0-9]{24}$/;

export function dataDir({ env = process.env, home = homedir() } = {}) {
  return env.AG_PULSE_CLI_DATA || join(home, '.gemini', 'antigravity-cli', 'antigrative-dashboard-data');
}
const folder = dir => join(dir, 'conversations');

export function dayKey(time) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// cacheBase = uncached input + cache read + cache write of requests whose cache data is complete.
export const bucket = () => ({ input: 0, output: 0, cacheRead: 0, cacheBase: 0, cost: 0, requests: 0 });

function empty(key, now) {
  return { schema: SCHEMA, key, model: null, modelId: null, firstSeen: now, lastSeen: now, baseline: null, last: null,
    totals: null, request: null, context: null, quotas: null, observed: bucket(), genMs: 0,
    days: {}, turn: null, lastTurn: null };
}

const delta = (current, previous) => current !== null && previous !== null && previous !== undefined && current >= previous
  ? current - previous : 0;

export function update(previous, metrics, key, now = Date.now()) {
  const record = previous && previous.schema === SCHEMA && previous.key === key ? structuredClone(previous) : empty(key, now);
  const last = record.last;
  const totals = metrics.totals || { input: null, output: null };
  const cost = metrics.cost?.usd ?? null;
  const usage = [metrics.inputTokens, metrics.outputTokens, metrics.cacheReadTokens, metrics.cacheCreationTokens];
  const usageKey = usage.map(value => value === null ? '' : value).join(',');
  const hasUsage = usage.some(value => value !== null && value > 0);

  // Totals already present the first time a conversation is seen (for example a
  // resumed conversation) are kept as a baseline and never attributed to a day.
  if (!last) record.baseline = { input: totals.input, output: totals.output, cost };
  const dIn = last ? delta(totals.input, last.input) : 0;
  const dOut = last ? delta(totals.output, last.output) : 0;
  const dCost = last ? delta(cost, last.cost) : 0;
  // A changed current_usage tuple marks a newly completed request.
  const request = last && hasUsage && usageKey !== last.usage
    ? { input: usage[0], output: usage[1], cacheRead: usage[2], cacheWrite: usage[3] } : null;
  const cacheComplete = request && request.input !== null && request.cacheRead !== null;
  const gen = last && generating(last.state) ? Math.max(0, Math.min(MAX_GAP, now - last.t)) : 0;
  const changed = dIn > 0 || dOut > 0 || dCost > 0 || request !== null;

  const add = target => {
    target.input += dIn; target.output += dOut; target.cost += dCost;
    if (request) {
      target.requests += 1;
      if (cacheComplete) {
        target.cacheRead += request.cacheRead;
        target.cacheBase += request.input + request.cacheRead + (request.cacheWrite || 0);
      }
    }
  };
  record.genMs += gen;
  if (changed) {
    add(record.observed);
    const day = record.days[dayKey(now)] ||= { ...bucket(), models: {} };
    add(day);
    const model = cleanText(metrics.model || record.model || 'unknown', 48);
    if (day.models[model] || Object.keys(day.models).length < MODEL_LIMIT) {
      const entry = day.models[model] ||= { input: 0, output: 0 };
      entry.input += dIn; entry.output += dOut;
    }
  }

  // Turns: busy after idle starts one, idle ends it.
  if (busy(metrics.state) && !record.turn) record.turn = { start: now, ...bucket(), genMs: 0 };
  if (record.turn) {
    if (changed) add(record.turn);
    record.turn.genMs += gen;
    if (metrics.state === 'idle') { record.lastTurn = { ...record.turn, end: now }; record.turn = null; }
  } else if (changed && record.lastTurn && now - record.lastTurn.end < LATE_MS) add(record.lastTurn);

  record.last = { t: now, state: metrics.state, input: totals.input, output: totals.output, cost, usage: usageKey };
  record.lastSeen = now;
  record.model = metrics.model || record.model;
  record.modelId = metrics.modelId || record.modelId || null;
  record.totals = { input: totals.input, output: totals.output, cost, estimated: metrics.cost?.estimated === true };
  if (usage.some(value => value !== null)) record.request = { input: usage[0], output: usage[1], cacheRead: usage[2], cacheWrite: usage[3] };
  record.context = { usedPercentage: metrics.context?.usedPercentage ?? null, capacity: metrics.context?.capacity ?? null };
  if (metrics.quotas?.length) record.quotas = { savedAt: now, items: metrics.quotas.map(quota => ({ id: quota.id, bucketId: quota.bucketId ?? null,
    disabled: quota.disabled === true, remaining: quota.remaining,
    resetTime: quota.resetTime ?? (quota.resetInSeconds !== null ? now + quota.resetInSeconds * 1000 : null) })) };
  const days = Object.keys(record.days).sort();
  for (const day of days.slice(0, Math.max(0, days.length - DAY_LIMIT))) delete record.days[day];

  // Idle samples without new numbers do not need a write.
  const dirty = !last || changed || gen > 0 || metrics.state !== last.state || !previous;
  return { record, dirty };
}

const rate = (read, base) => base > 0 ? read / base * 100 : null;
const speed = (output, ms) => ms >= 2000 && output > 0 ? output / (ms / 1000) : null;

export function summarize(entry, now = Date.now()) {
  if (!entry) return null;
  return { input: entry.input, output: entry.output, cost: entry.cost, requests: entry.requests,
    cacheRate: rate(entry.cacheRead, entry.cacheBase), tps: speed(entry.output, entry.genMs),
    elapsed: (entry.end ?? now) - entry.start, end: entry.end ?? null };
}

export function stats(record, now = Date.now()) {
  if (!record) return null;
  return {
    session: { cacheRate: rate(record.observed.cacheRead, record.observed.cacheBase), tps: speed(record.observed.output, record.genMs) },
    turn: summarize(record.turn, now), lastTurn: summarize(record.lastTurn, now),
  };
}

export function load(dir, key) {
  if (!KEY.test(key || '')) return null;
  try {
    const value = JSON.parse(readFileSync(join(folder(dir), key + '.json'), 'utf8'));
    return value && value.schema === SCHEMA && value.key === key ? value : null;
  } catch { return null; }
}

export function save(dir, record) {
  if (!KEY.test(record.key || '')) throw new Error('Invalid ledger key');
  mkdirSync(folder(dir), { recursive: true, mode: 0o700 });
  const file = join(folder(dir), record.key + '.json');
  const temporary = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
}

export function loadAll(dir, { since = 0, limit = 1000 } = {}) {
  let names = [];
  try { names = readdirSync(folder(dir)).filter(name => KEY.test(name.slice(0, -5)) && name.endsWith('.json')); } catch { return []; }
  const records = [];
  for (const name of names.slice(0, limit * 2)) {
    const record = load(dir, name.slice(0, -5));
    if (record && record.lastSeen >= since) records.push(record);
  }
  return records.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, limit);
}
