import { compact, percentage, countdown, money, duration } from './metrics.mjs';
import { toAscii } from './common.mjs';

// Some minimal Node builds lack full ICU; code points are a safe fallback.
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
export const clusters = text => segmenter ? [...segmenter.segment(text)].map(item => item.segment) : Array.from(text);
export function cellWidth(cluster) {
  if (/^\p{Mark}+$/u.test(cluster)) return 0;
  if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(cluster)) return 2;
  const code = cluster.codePointAt(0);
  return code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) || (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) || (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x20000 && code <= 0x3fffd)) ? 2 : 1;
}
export const displayWidth = text => clusters(text).reduce((sum, item) => sum + cellWidth(item), 0);
export function truncate(text, width) {
  if (displayWidth(text) <= width) return text;
  let result = '', used = 0;
  for (const item of clusters(text)) {
    const size = cellWidth(item);
    if (used + size > width - 1) break;
    result += item; used += size;
  }
  return result + (width > 0 ? '…' : '');
}

export const labels = {
  en: { context: 'Context', cache: 'Cache', cacheRead: 'Cache read', tokens: 'Tokens', capacity: 'Capacity',
    created: 'Cache write', input: 'Input', output: 'Output', left: 'left', quota: 'Quota', week: 'week',
    disabled: 'Unavailable', unknown: 'Unknown', idle: 'Ready', thinking: 'Thinking', working: 'Working', tool_use: 'Tool',
    initializing: 'Starting', turn: 'Turn', lastTurn: 'Last turn', hint: '#usage details', request: 'request', read: 'read' },
  'zh-CN': { context: '上下文', cache: '缓存', cacheRead: '缓存读取', tokens: 'Token', capacity: '容量',
    created: '缓存写入', input: '输入', output: '输出', left: '剩余', quota: '额度', week: '周',
    disabled: '不可用', unknown: '未知', idle: '就绪', thinking: '思考中', working: '生成中', tool_use: '工具',
    initializing: '启动中', turn: '本轮', lastTurn: '上轮', hint: '#usage 详情', request: '本次', read: '读取' },
  'zh-TW': { context: '上下文', cache: '快取', cacheRead: '快取讀取', tokens: 'Token', capacity: '容量',
    created: '快取寫入', input: '輸入', output: '輸出', left: '剩餘', quota: '配額', week: '週',
    disabled: '無法使用', unknown: '未知', idle: '就緒', thinking: '思考中', working: '生成中', tool_use: '工具',
    initializing: '啟動中', turn: '本輪', lastTurn: '上輪', hint: '#usage 詳情', request: '本次', read: '讀取' },
};

export const quotaGroups = week => ({
  'gemini-5h': ['gemini', 'Gemini', '5h', 36],
  'gemini-weekly': ['gemini', 'Gemini', week, 36],
  '3p-5h': ['3p', 'Claude/GPT', '5h', 35],
  '3p-weekly': ['3p', 'Claude/GPT', week, 35],
  'gemini-argon-wtu-weekly': ['gemini-argon', 'Argon', week, 36],
});

export function groupQuotas(quotas, model, week) {
  // Group only exact contract IDs; unknown future buckets keep their identity.
  const known = quotaGroups(week), groups = new Map();
  for (const quota of quotas) {
    const keyId = quota.bucketId !== undefined ? quota.bucketId : quota.id;
    const mapping = known[keyId];
    const [id, name, window, code] = mapping || [quota.id, quota.id, null, 36];
    const mapKey = (mapping ? 'family:' : 'bucket:') + id;
    if (!groups.has(mapKey)) groups.set(mapKey, { id, name, code, known: !!mapping, windows: [] });
    groups.get(mapKey).windows.push({ ...quota, window });
  }
  const identity = model || '';
  const argon = /(?:^|[^a-z])argon(?:$|[^a-z])/i.test(identity);
  // The payload, not a plan-name guess or the model label alone, determines
  // whether this account exposes a dedicated Argon pool. Never create one.
  const active = argon
    ? (groups.has('family:gemini-argon') ? 'gemini-argon' : groups.has('family:gemini') ? 'gemini' : null)
    : /gemini|hydrogen|carbon|neon/i.test(identity) ? 'gemini'
    : /claude|sonnet|opus|haiku|anthropic|gpt|openai|(?:^|[^a-z])o[134](?:$|[^a-z0-9])|^3p(?:$|[-_])/i.test(identity) ? '3p'
    : /orchestrator/i.test(identity) ? 'gemini' : null;
  for (const group of groups.values()) group.windows.sort((a, b) => (a.window === '5h' ? -1 : 1) - (b.window === '5h' ? -1 : 1));
  return [...groups.values()].sort((a, b) => (b.known && b.id === active ? 1 : 0) - (a.known && a.id === active ? 1 : 0) ||
    (b.known ? 1 : 0) - (a.known ? 1 : 0) || a.name.localeCompare(b.name));
}

export const quotaCode = remaining => remaining === null ? 39 : remaining >= 70 ? 32 : remaining >= 30 ? 33 : 31;
export const contextCode = used => used !== null && used >= 90 ? 31 : used !== null && used >= 60 ? 33 : 36;

// A segment lists display variants from widest to narrowest. Each variant has
// the priority of keeping it; the lowest-priority variant steps down first.
// `null` as a variant drops the segment.
const variant = (pri, ...parts) => ({ pri, parts: parts.flat() });

export function render(metrics, { language = 'en', width = metrics.width, color = true, details = false,
  lightBackground = false, now = Date.now(), stats = null, hint = true, ascii = false } = {}) {
  const l = labels[language] || labels.en;
  width = Math.max(1, Math.min(500, width));
  const part = (text, code = 39, bold = false, dim = false) => ({ text, code, bold, dim });
  const subtle = text => part(text, 39, false, true);
  const plain = parts => parts.map(item => item.text).join('');
  const fit = parts => {
    if (displayWidth(plain(parts)) <= width) return parts;
    const result = []; let left = width - 1;
    for (const item of parts) {
      let text = '';
      for (const cluster of clusters(item.text)) {
        const size = cellWidth(cluster);
        if (size > left) break;
        text += cluster; left -= size;
      }
      if (text) result.push({ ...item, text });
      if (text !== item.text) break;
    }
    return [...result, subtle('…')];
  };
  const paint = parts => fit(parts).map(item => color
    ? `\x1b[${item.bold ? '1;' : item.dim ? '2;' : ''}${item.code}m${item.text}\x1b[0m` : item.text).join('');
  const bar = (value, code, size) => {
    if (value === null) return [];
    const filled = Math.min(size, Math.max(0, Math.round(value / 100 * size)));
    return [part('█'.repeat(filled), code), subtle('░'.repeat(size - filled))];
  };
  const layout = segments => {
    const pick = segments.map(() => 0);
    const build = () => {
      const out = [];
      segments.forEach((segment, index) => {
        const chosen = segment.variants[pick[index]];
        if (!chosen || !chosen.parts.length) return;
        if (out.length) out.push(subtle(segment.lead ?? ' · '));
        out.push(...chosen.parts);
      });
      return out;
    };
    let row = build();
    while (displayWidth(plain(row)) > width) {
      let best = -1;
      segments.forEach((segment, index) => {
        if (pick[index] >= segment.variants.length - 1) return;
        if (best < 0 || segment.variants[pick[index]].pri < segments[best].variants[pick[best]].pri) best = index;
      });
      if (best < 0) break;
      pick[best]++; row = build();
    }
    return row;
  };
  const tokenParts = (input, output, bold = true) => [
    ...(input !== null ? [subtle('↑'), part(compact(input), 39, bold)] : []),
    ...(input !== null && output !== null ? [subtle(' ')] : []),
    ...(output !== null ? [subtle('↓'), part(compact(output), 39, bold)] : []),
  ];

  // Row 1: context, conversation tokens, cache, estimated speed, cost and state.
  const used = metrics.context.usedPercentage, level = contextCode(used);
  const alert = used !== null && used >= 90 ? [part(' !', 31, true)] : [];
  const value = digits => part(percentage(used, digits), used === null ? 39 : level, true);
  const main = [{ variants: [
    variant(35, part(`${l.context} `), value(1), ...alert, ...(used !== null ? [subtle(' '), ...bar(used, level, 8)] : [])),
    variant(76, part(`${l.context} `), value(1), ...alert),
    variant(999, value(0), ...alert)] }];
  const totals = metrics.totals || { input: null, output: null };
  if (totals.input !== null || totals.output !== null) main.push({ variants: [
    variant(50, part(`${l.tokens} `), ...tokenParts(totals.input, totals.output)),
    variant(68, ...tokenParts(totals.input, totals.output)), null] });
  const sessionRate = stats?.session?.cacheRate ?? null;
  const cacheRate = sessionRate ?? metrics.requestCacheRate ?? null;
  const read = metrics.cacheReadTokens;
  const cacheShort = language === 'zh-CN' ? '缓' : language === 'zh-TW' ? '快' : 'C';
  if (cacheRate !== null) main.push({ variants: [
    variant(40, part(`${l.cache} `), part(percentage(cacheRate), 35, true)),
    variant(86, part(`${l.cache} `), part(percentage(cacheRate, 0), 35, true)),
    variant(999, part(cacheShort, 39), part(percentage(cacheRate, 0), 35, true))] });
  else main.push({ variants: [
    variant(40, part(`${l.cacheRead} `), part(compact(read), read === null ? 39 : 35, true)),
    variant(86, part(`${l.cache} `), part(compact(read), read === null ? 39 : 35, true)), null] });
  const tps = stats?.turn?.tps ?? stats?.session?.tps ?? null;
  if (tps !== null) main.push({ variants: [variant(45, part(`≈${Math.round(tps)}`, 36, true), subtle(' t/s')), null] });
  if (metrics.cost?.usd) main.push({ variants: [variant(20, part(money(metrics.cost.usd, metrics.cost.estimated), 33)), null] });
  const stateCode = metrics.state === 'idle' ? 32 : metrics.state ? 33 : 39;
  main.push({ variants: [variant(38, part('● ', stateCode), part(l[metrics.state] || l.unknown, stateCode)),
    variant(60, part('●', stateCode)), null] });

  // Quota rows: one per family, 5h and weekly windows together.
  // A third returned known family (Argon) must not disappear behind the 2-row cap.
  const groups = groupQuotas(metrics.quotas, metrics.modelId || metrics.model, l.week);
  const hasArgon = groups.some(group => group.known && group.id === 'gemini-argon');
  const visible = groups.slice(0, hasArgon ? 3 : 2);
  const nameWidth = Math.max(0, ...visible.map(group => displayWidth(group.name)));
  const quotaRow = (group, extra) => {
    const label = name => group.id === '3p' && group.known
      ? [part('Claude', '38;2;218;119;86', true), subtle('/'), part('GPT', lightBackground ? 39 : '38;2;248;250;252', true)]
      : [part(name, group.code, true)];
    const pad = ' '.repeat(Math.max(0, nameWidth - displayWidth(group.name)));
    const short = group.id === '3p' && group.known ? 'C/G' : group.id === 'gemini' && group.known ? 'G'
      : group.id === 'gemini-argon' && group.known ? 'Ar' : group.name;
    const segments = [{ variants: [variant(30, ...label(group.name), subtle(`${pad} ${l.left}`)),
      variant(82, ...label(group.name)), variant(999, part(short, group.code, true))] }];
    group.windows.forEach((quota, index) => {
      const code = quota.disabled ? 39 : quotaCode(quota.remaining);
      const reset = quota.disabled ? null : countdown(quota, now);
      const head = [...(quota.window ? [part(`${quota.window} `)] : []),
        part(quota.disabled ? l.disabled : percentage(quota.remaining), code, true),
        ...(!quota.disabled && quota.remaining !== null && quota.remaining < 30 ? [part(' !', code, true)] : [])];
      const resetParts = reset !== null ? [subtle(`  ↻ ${reset}`)] : [];
      segments.push({ lead: index ? ' · ' : '  ', variants: [
        // Later windows (weekly) give way before the 5h window.
        variant(48 - index, ...head, ...(!quota.disabled && quota.remaining !== null ? [subtle(' '), ...bar(quota.remaining, code, 5)] : []), ...resetParts),
        variant(58 - index, ...head, ...resetParts), variant(999, ...head)] });
    });
    if (extra) segments.push({ lead: '  ', variants: [variant(25, subtle(extra)), null] });
    return segments;
  };

  const rows = [main];
  if (!groups.length) rows.push([{ variants: [variant(999, subtle(`${l.quota} --`))] }]);
  visible.forEach((group, index) => rows.push(quotaRow(group, index === visible.length - 1 && groups.length > visible.length ? `… +${groups.length - visible.length}` : null)));

  // Turn row: live while busy, last finished turn while idle.
  const turn = stats?.turn || (metrics.state !== 'thinking' && metrics.state !== 'working' && metrics.state !== 'tool_use' ? stats?.lastTurn : null);
  if (turn) {
    const live = turn === stats?.turn;
    const segments = [{ variants: [variant(999, subtle(live ? l.turn : l.lastTurn))] }];
    if (turn.input || turn.output) segments.push({ lead: '  ', variants: [variant(50, ...tokenParts(turn.input, turn.output, false)),
      variant(66, ...tokenParts(null, turn.output, false)), null] });
    if (turn.cacheRate !== null) segments.push({ variants: [variant(46, part(`${l.cache} `), part(percentage(turn.cacheRate, 0), 35)), null] });
    if (turn.tps !== null) segments.push({ variants: [variant(44, part(`≈${Math.round(turn.tps)}`, 36), subtle(' t/s')), null] });
    segments.push({ variants: [variant(42, subtle(duration(turn.elapsed))), null] });
    if (turn.cost) segments.push({ variants: [variant(20, part(money(turn.cost), 33)), null] });
    rows.push(segments);
  }
  if (hint) rows[rows.length - 1].push({ lead: '   ', variants: [variant(15, subtle(l.hint)), variant(16, subtle('#usage')), null] });

  const lines = rows.map(segments => paint(layout(segments)));
  if (details) {
    const more = `${metrics.model || 'Antigravity'} · ${l.capacity} ${compact(metrics.context.capacity)} · ${l.request} ${l.input} ${compact(metrics.inputTokens)} · ${l.output} ${compact(metrics.outputTokens)} · ${l.cacheRead} ${compact(metrics.cacheReadTokens)} · ${l.created} ${compact(metrics.cacheCreationTokens)}`;
    lines.push(paint([subtle(more)]));
  }
  const text = lines.join('\n');
  return ascii ? toAscii(text) : text;
}
