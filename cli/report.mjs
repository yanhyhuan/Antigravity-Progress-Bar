// Usage details shown by the #usage hook and by `node cli/usage.mjs`.
import { dataDir, load, loadAll, stats, dayKey, bucket } from './ledger.mjs';
import { conversationKey, compact, percentage, money, duration, countdown, cacheRate } from './metrics.mjs';
import { displayWidth, truncate, groupQuotas, quotaCode } from './render.mjs';
import { savedLanguage, TRIGGERS, toAscii, asciiGlyphs } from './common.mjs';

const DAY = 86400000;
const words = {
  en: { title: 'Usage details', current: 'Current conversation', recent: 'Most recent conversation',
    none: 'No usage recorded yet; statistics start once the status line sees a reply.',
    missing: 'This conversation has no recorded usage yet.', tokens: 'Tokens', total: 'total', cache: 'Cache', hit: 'hit',
    read: 'read', request: 'last request', speed: 'Speed', generating: 'generating', cost: 'Cost', context: 'Context',
    capacity: 'capacity', lastTurn: 'Last turn', turn: 'This turn', observed: 'cache and speed cover requests seen by the plugin',
    local: 'This device', localNote: 'counted by the plugin', today: 'Today', week: '7 days', month: '30 days',
    conversations: 'Conv.', daily: '14 days', models: 'Models · 7 days', quota: 'Quota', weekWindow: 'week', disabled: 'Unavailable',
    now: 'just now', minutes: n => `${n}m ago`, hours: n => `${n}h ago`, days: n => `${n}d ago`,
    footer: `${TRIGGERS.join(' · ')}  answered locally, no model call or quota` },
  'zh-CN': { title: '用量详情', current: '当前会话', recent: '最近会话',
    none: '暂无用量记录；状态栏看到第一次回复后开始统计。',
    missing: '当前会话尚无用量记录。', tokens: 'Token', total: '合计', cache: '缓存', hit: '命中',
    read: '读取', request: '本次请求', speed: '速率', generating: '生成', cost: '花费', context: '上下文',
    capacity: '容量', lastTurn: '上轮', turn: '本轮', observed: '缓存与速率只统计插件观察到的请求',
    local: '本机统计', localNote: '插件观察到的增量', today: '今天', week: '近 7 天', month: '近 30 天',
    conversations: '会话', daily: '近 14 天', models: '模型 · 近 7 天', quota: '额度', weekWindow: '周', disabled: '不可用',
    now: '刚刚', minutes: n => `${n} 分钟前`, hours: n => `${n} 小时前`, days: n => `${n} 天前`,
    footer: `${TRIGGERS.join(' · ')}  本地响应，不调用模型、不消耗额度` },
  'zh-TW': { title: '用量詳情', current: '目前對話', recent: '最近對話',
    none: '尚無用量紀錄；狀態列看到第一次回覆後開始統計。',
    missing: '目前對話尚無用量紀錄。', tokens: 'Token', total: '合計', cache: '快取', hit: '命中',
    read: '讀取', request: '本次請求', speed: '速率', generating: '生成', cost: '花費', context: '上下文',
    capacity: '容量', lastTurn: '上輪', turn: '本輪', observed: '快取與速率僅統計外掛觀察到的請求',
    local: '本機統計', localNote: '外掛觀察到的增量', today: '今天', week: '近 7 天', month: '近 30 天',
    conversations: '對話', daily: '近 14 天', models: '模型 · 近 7 天', quota: '配額', weekWindow: '週', disabled: '無法使用',
    now: '剛剛', minutes: n => `${n} 分鐘前`, hours: n => `${n} 小時前`, days: n => `${n} 天前`,
    footer: `${TRIGGERS.join(' · ')}  本機回應，不呼叫模型、不消耗配額` },
};

export function aggregate(records, now, days) {
  const from = dayKey(now - (days - 1) * DAY), to = dayKey(now);
  const total = { ...bucket(), conversations: 0, models: {} };
  for (const record of records) {
    let active = false;
    for (const [day, entry] of Object.entries(record.days || {})) {
      if (day < from || day > to) continue;
      active = true;
      for (const key of Object.keys(bucket())) total[key] += Number(entry[key]) || 0;
      for (const [model, value] of Object.entries(entry.models || {})) {
        total.models[model] = (total.models[model] || 0) + (Number(value.input) || 0) + (Number(value.output) || 0);
      }
    }
    if (active) total.conversations += 1;
  }
  return total;
}

export function daily(records, now, days = 14) {
  return Array.from({ length: days }, (_, index) => {
    const key = dayKey(now - (days - 1 - index) * DAY);
    return records.reduce((sum, record) => sum + (Number(record.days?.[key]?.input) || 0) + (Number(record.days?.[key]?.output) || 0), 0);
  });
}

export function sparkline(values, ascii = false) {
  // ASCII ticks keep '.' for an empty day so it cannot be mistaken for a low bar.
  const max = Math.max(0, ...values), ticks = ascii ? ':-=+*#%@' : '▁▂▃▄▅▆▇█', zero = ascii ? '.' : '·';
  return values.map(value => value <= 0 || max <= 0 ? zero : ticks[Math.min(7, Math.floor(value / max * 7.999))]).join('');
}

export function buildReport({ records, current = null, isCurrent = false, now = Date.now() }) {
  const summary = current ? stats(current, now) : null;
  const quotaSource = current?.quotas ? current : records.find(record => record.quotas);
  return {
    now, isCurrent, hasData: records.length > 0 || !!current,
    conversation: current && {
      model: current.model, totals: current.totals, context: current.context, genMs: current.genMs,
      observed: current.observed, requestRate: current.request ? cacheRate(current.request) : null,
      session: summary.session, turn: summary.turn, lastTurn: summary.lastTurn,
      partial: !!(current.baseline && ((current.baseline.input || 0) > 0 || (current.baseline.output || 0) > 0)),
    },
    ranges: { today: aggregate(records, now, 1), week: aggregate(records, now, 7), month: aggregate(records, now, 30) },
    daily: daily(records, now, 14),
    quotas: quotaSource?.quotas || null, quotaModel: quotaSource?.modelId || quotaSource?.model || null,
  };
}

export function renderReport(report, { language = 'en', color = false, ascii = false } = {}) {
  const w = words[language] || words.en;
  const c = (text, code = 39, bold = false) => color ? `\x1b[${bold ? '1;' : ''}${code}m${text}\x1b[0m` : text;
  const dim = text => color ? `\x1b[2m${text}\x1b[0m` : text;
  const pad = (text, width) => text + ' '.repeat(Math.max(0, width - displayWidth(text.replace(/\x1b\[[\d;]*m/g, ''))));
  const row = (label, value) => `  ${pad(label, 9)}${value}`;
  const ago = time => {
    const minutes = Math.floor((report.now - time) / 60000);
    return minutes < 1 ? w.now : minutes < 60 ? w.minutes(minutes) : minutes < 1440 ? w.hours(Math.floor(minutes / 60)) : w.days(Math.floor(minutes / 1440));
  };
  const turnText = turn => [
    `↑${compact(turn.input)} ↓${compact(turn.output)}`,
    turn.cacheRate !== null ? `${w.cache} ${percentage(turn.cacheRate, 0)}` : null,
    turn.tps !== null ? `≈${Math.round(turn.tps)} tok/s` : null,
    duration(turn.elapsed), turn.cost ? money(turn.cost) : null,
  ].filter(Boolean).join(' · ');
  const lines = [c(`Antigravity Progress Bar · ${w.title}`, 36, true), dim('─'.repeat(44))];

  const conversation = report.conversation;
  if (!report.hasData) lines.push(w.none);
  else if (!conversation) lines.push(w.missing);
  else {
    lines.push(c(`${report.isCurrent ? w.current : w.recent}`, 39, true) + dim(` · ${truncate(conversation.model || '--', 32)}`));
    const totals = conversation.totals || {};
    const sum = totals.input !== null && totals.input !== undefined && totals.output !== null && totals.output !== undefined ? totals.input + totals.output : null;
    lines.push(row(w.tokens, `↑${c(compact(totals.input ?? null), 39, true)} · ↓${c(compact(totals.output ?? null), 39, true)}${sum !== null ? dim(` · ${w.total} ${compact(sum)}`) : ''}`));
    const observed = conversation.observed;
    const hit = conversation.session.cacheRate;
    lines.push(row(w.cache, [
      hit !== null ? `${w.hit} ${c(percentage(hit), 35, true)}${dim(` (${w.read} ${compact(observed.cacheRead)} / ${compact(observed.cacheBase)})`)}` : `${w.hit} --`,
      conversation.requestRate !== null ? dim(`${w.request} ${percentage(conversation.requestRate)}`) : null,
    ].filter(Boolean).join(' · ')));
    const tps = conversation.session.tps;
    lines.push(row(w.speed, `${tps !== null ? c(`≈${Math.round(tps)} tok/s`, 36, true) : '--'}${conversation.genMs ? dim(` · ${w.generating} ${duration(conversation.genMs)}`) : ''}`));
    if (totals.cost) lines.push(row(w.cost, c(money(totals.cost, totals.estimated), 33)));
    const context = conversation.context || {};
    if (context.usedPercentage !== null && context.usedPercentage !== undefined) {
      lines.push(row(w.context, `${percentage(context.usedPercentage)}${context.capacity ? dim(` · ${w.capacity} ${compact(context.capacity)}`) : ''}`));
    }
    const turn = conversation.turn || conversation.lastTurn;
    if (turn) lines.push(row(conversation.turn ? w.turn : w.lastTurn, turnText(turn)));
    if (conversation.partial) lines.push(dim(`  * ${w.observed}`));
  }

  if (report.hasData) {
    lines.push('', c(w.local, 39, true) + dim(` · ${w.localNote}`));
    lines.push(dim(`  ${pad('', 9)}${pad(w.tokens, 9)}${pad(w.cache, 8)}${pad(w.cost, 9)}${w.conversations}`));
    for (const [key, label] of [['today', w.today], ['week', w.week], ['month', w.month]]) {
      const range = report.ranges[key];
      const hit = range.cacheBase > 0 ? range.cacheRead / range.cacheBase * 100 : null;
      lines.push(`  ${pad(label, 9)}${pad(c(compact(range.input + range.output), 39, true), 9)}${pad(c(percentage(hit, 0), 35), 8)}${pad(range.cost ? money(range.cost) : '--', 9)}${range.conversations}`);
    }
    lines.push(`  ${pad(w.daily, 9)}${c(sparkline(report.daily, ascii), 36)}`);
    const models = Object.entries(report.ranges.week.models).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const all = models.reduce((sum, [, value]) => sum + value, 0);
    if (models.length && all > 0) {
      lines.push('', c(w.models, 39, true));
      for (const [model, value] of models) {
        const share = value / all * 100, filled = Math.round(share / 10);
        lines.push(`  ${pad(truncate(model, 26), 27)}${pad(compact(value), 7)}${c('█'.repeat(filled), 36)}${dim('░'.repeat(10 - filled))} ${percentage(share, 0)}`);
      }
    }
  }

  if (report.quotas?.items?.length) {
    lines.push('', c(w.quota, 39, true) + dim(` · ${ago(report.quotas.savedAt)}`));
    for (const group of groupQuotas(report.quotas.items.map(item => ({ ...item, resetInSeconds: null })), report.quotaModel, w.weekWindow).slice(0, 4)) {
      const windows = group.windows.map(quota => {
        const reset = quota.disabled ? null : countdown(quota, report.now);
        const code = quota.disabled ? 39 : quotaCode(quota.remaining);
        const value = quota.disabled ? w.disabled : percentage(quota.remaining);
        return `${quota.window ? quota.window + ' ' : ''}${c(value, code, true)}${!quota.disabled && quota.remaining !== null && quota.remaining < 30 ? c(' !', code, true) : ''}${reset ? dim(` ↻${reset}`) : ''}`;
      });
      lines.push(`  ${pad(c(group.name, group.code, true), 12)}${windows.join(dim(' · '))}`);
    }
  }
  lines.push('', dim(w.footer));
  const text = lines.join('\n');
  return ascii ? toAscii(text) : text;
}

export async function usageText({ conversationId = null, language = null, color = false, now = Date.now(), dir = dataDir(), ascii = asciiGlyphs() } = {}) {
  const records = loadAll(dir, { since: now - 31 * DAY });
  const key = conversationKey(conversationId);
  const current = key ? load(dir, key) : records[0] || null;
  const report = buildReport({ records, current, isCurrent: !!key, now });
  return renderReport(report, { language: language || await savedLanguage() || 'en', color, ascii });
}
