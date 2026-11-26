// End-to-end headless Microsoft Edge CDP verification for font sync, all-local
// usage scope switching, and quota-window token references across renderers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { accessSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CdpConnection } from '../../../compat/runtime-ui.mjs';
import { panelAppSource, panelPageSource } from '../panel-source.mjs';
import { trajectoryMetrics } from '../metrics.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);
const read = p => readFile(join(ROOT, p), 'utf8');
const extract = s => s.slice(s.indexOf('module.exports = ') + 17).trim().replace(/;$/, '');

function findEdge() {
  const candidates = [
    process.env.AG_EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  for (const file of candidates) {
    try { accessSync(file); return file; } catch {}
  }
  return null;
}

const EDGE_EXE = findEdge();

async function launchBrowser(userDataDir, initialUrl) {
  const child = spawn(EDGE_EXE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`, initialUrl,
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  child.unref();
  let cdp = null;
  try {
    const port = await new Promise((resolve, reject) => {
      let errText = '';
      const cleanupStderr = () => {
        child.stderr?.removeAllListeners('data');
        try { child.stderr?.destroy(); } catch {}
      };
      const timer = setTimeout(() => { cleanupStderr(); reject(new Error('Browser start timeout: ' + errText)); }, 30000);
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => {
        errText += chunk;
        const m = errText.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
        if (m) { clearTimeout(timer); cleanupStderr(); resolve(Number(m[1])); }
      });
      child.once('exit', code => { clearTimeout(timer); cleanupStderr(); reject(new Error('Browser exited ' + code)); });
    });
    let target;
    for (let i = 0; i < 150; i++) {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/json/list`);
        const targets = await resp.json();
        target = targets.find(t => t.type === 'page' && t.url.startsWith('http://127.0.0.1'));
        if (target) break;
      } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    if (!target) throw new Error('Failed to discover Edge page target');
    cdp = new CdpConnection(target.webSocketDebuggerUrl, { timeout: 30000 });
    await cdp.open();
    await cdp.command('Runtime.enable');
    await cdp.command('Page.enable');
    return { child, cdp };
  } catch (err) {
    try { cdp?.close(); } catch {}
    killBrowser(child);
    throw err;
  }
}

function killBrowser(child) {
  if (!child) return;
  try { child.stderr?.destroy(); } catch {}
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true, timeout: 15000 });
  } else {
    try { child.kill('SIGKILL'); } catch {}
  }
  try { child.kill(); } catch {}
}

test('font sync, scope switching and quota window reference render end-to-end in real Chromium', { skip: !EDGE_EXE }, async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ag-edge-ui-'));
  let child = null, cdp = null, server = null;
  try {

  const [i18nSrc, themeSrc, pricingSrc, usageSrc, updateSrc, widgetSrc, surfaceSrc, stylesCss, formatMjs] = await Promise.all([
    read('compat/i18n.cjs'), read('compat/theme.cjs'), read('compat/pricing.cjs'), read('compat/usage-ui.cjs'),
    read('compat/update-ui.cjs'), read('compat/inline-widget.cjs'), read('ide/surface.cjs'),
    read('sidecars/panel/styles.css'), read('sidecars/panel/format.mjs'),
  ]);
  const themeLib = require('../../../compat/theme.cjs')();
  const id = '11111111-1111-1111-1111-111111111111';
  let prefs = { language: 'zh-CN', languageGuideDismissed: true, usageGuideDismissed: true, usageScope: 'local', revision: 1 };
  let panelTheme = { fontFamily: "'Fira Code'", mode: 'dark', dark: { background: '#1e1e1e' } };
  let signedIn = true, slowFullPoll = false, stressModels = false, billionSpeed = false, usageOnlyCalls = 0, integrationState = null;
  const reset5h = new Date(Date.now() + 3 * 3600000).toISOString();
  const resetWk = new Date(Date.now() + 5 * 86400000).toISOString();
  const stressModelList = [
    'gemini-4-hydrogen-orchestrator', 'orchestrator-carbon', 'gemini-pro-orchestrator', 'gemini-4-hydrogen-xhigh',
    'gemini-4-carbon-high', 'gemini-4-carbon-medium', 'gemini-4-argon-high',
    'gemini-4-argon-medium', 'gemini-pro-orchestrator-argon', 'gemini-3.8-flash-high', 'gemini-3.8-flash-medium',
    'claude-opus-5.5-medium', 'claude-opus-5-5-high', 'claude-sonnet-5-5-high', 'claude-sonnet-5-5-medium',
    'gemini-flash', 'orchestrator-argon', 'gemini-pro-orchestrator-neon',
    'gemini-3.8-flash', 'gemini-3.8-flash-tiered', 'gpt-5.4-high', 'claude-sonnet-4.6',
    'Claude Sonnet 4.6 (Thinking)', 'Gemini 4 Neon (High)', 'Gemini 4 Neon (XHigh)',
    'Orchestrator (Neon)', 'GPT-OSS 120B (Medium)', 'claude-opus-4.5', 'gemini-3.5-pro',
    'gemini-3.5-flash', 'gpt-5.4-mini', 'o3-pro', 'claude-haiku-4.5', 'gemini-2.5-pro',
    'deepseek-r1', 'qwen-3-coder', 'llama-4-maverick',
  ];
  const usageData = (overrideScope = null) => {
    const scope = overrideScope === 'account' || overrideScope === 'local' ? overrideScope : prefs.usageScope;
    const isLocal = scope !== 'account';
    if (!isLocal && !signedIn) {
      return { accountKey: null, scope: 'account', accountAvailable: false, accountsCount: 2, timeZone: 'Asia/Shanghai', today: '2026-11-16', days: [], models: [], todayTokens: 0, weekTokens: 0, monthTokens: 0, totalTokens: 0, unknownRequests: 0, partialRequests: 0, unreadableFiles: 0, requests: 0, syncing: false, quotaWindows: {} };
    }
    const mult = isLocal ? 3 : 1;
    if (stressModels) {
      const days = [];
      let totalTokens = 0, totalReqs = 0;
      for (let d = 12; d <= 16; d++) {
        const models = {};
        stressModelList.forEach((m, idx) => {
          const base = (stressModelList.length - idx) * 180000 * (d === 16 ? 2 : 1) * mult;
          models[m] = { uncached: Math.round(base * 0.12), cacheRead: Math.round(base * 0.85), cacheWrite: 0, output: Math.round(base * 0.03), total: base, requests: 2 };
          totalTokens += base;
          totalReqs += 2;
        });
        days.push({ date: `2026-11-${String(d).padStart(2, '0')}`, models });
      }
      return {
        accountKey: isLocal ? 'all-local' : 'acct-hash-1',
        scope: isLocal ? 'local' : 'account',
        accountAvailable: signedIn,
        accountsCount: 2,
        timeZone: 'Asia/Shanghai',
        today: '2026-11-16',
        models: stressModelList,
        days,
        todayTokens: Math.round(totalTokens * 0.35), weekTokens: totalTokens, monthTokens: totalTokens, totalTokens,
        requests: totalReqs, firstDate: '2026-11-12', syncing: false, unknownRequests: 0, partialRequests: 0, unreadableFiles: 0,
        quotaWindows: {
          'gemini:5h': { observedTokens: 81100000, estimatedFullTokens: 644200000, requests: 40, usedFraction: 0.126 },
          'gemini:weekly': { observedTokens: 129900000, estimatedFullTokens: 216200000, requests: 120, usedFraction: 0.601 },
        },
      };
    }
    return {
      accountKey: isLocal ? 'all-local' : 'acct-hash-1',
      scope: isLocal ? 'local' : 'account',
      accountAvailable: signedIn,
      accountsCount: 2,
      timeZone: 'Asia/Shanghai',
      today: '2026-11-16',
      models: ['Gemini 4 Hydrogen'],
      days: [{ date: '2026-11-16', models: { 'Gemini 4 Hydrogen': { uncached: 1000 * mult, cacheRead: 9000 * mult, cacheWrite: 0, output: 1000 * mult, total: 11000 * mult, requests: 10 * mult } } }],
      todayTokens: 11000 * mult, weekTokens: 11000 * mult, monthTokens: 11000 * mult, totalTokens: 11000 * mult,
      requests: 10 * mult, firstDate: '2026-11-16', syncing: false, unknownRequests: 0, partialRequests: 0, unreadableFiles: 0,
      quotaWindows: {
        'gemini:5h': { observedTokens: 81100000, estimatedFullTokens: 644200000, requests: 40, usedFraction: 0.126 },
        'gemini:weekly': { observedTokens: 129900000, estimatedFullTokens: 216200000, requests: 120, usedFraction: 0.601 },
      },
    };
  };
  let staleError = null;
  let transientOffline = false;
  const metricsPayload = (overrideScope = null) => (transientOffline ? {
    connection: 'offline',
    error: '等待 Antigrative Dashboard 重新连接',
    speed: null,
    groups: [],
    transient: true,
  } : {
    connection: staleError ? 'stale' : 'live',
    ...(staleError ? { error: staleError } : {}),
    theme: panelTheme,
    preferences: prefs,
    serverTime: new Date().toISOString(),
    quotaUpdatedAt: new Date().toISOString(),
    groups: [{ id: 'gemini', name: 'Gemini', windows: { '5h': { available: true, remaining: 0.874, resetAt: reset5h }, weekly: { available: true, remaining: 0.399, resetAt: resetWk } } }],
    usage: usageData(overrideScope),
    ...(integrationState ? { integration: integrationState } : {}),
    speed: {
      ...trajectoryMetrics({ trajectory: { cascadeId: id, steps: [{ type: 'USER_INPUT' }], generatorMetadata: [{ chatModel: { modelDisplayName: 'Gemini 4 Hydrogen (XHigh)', chatStartMetadata: { contextWindowMetadata: { estimatedTokensUsed: 100000, maxContextTokens: 512000 } }, usage: billionSpeed ? { messageId: 'm2', inputTokens: '80000000', cacheReadTokens: '1150000000', outputTokens: '4567890', responseOutputTokens: '4000000', apiProvider: 'API_PROVIDER_GOOGLE_GEMINI' } : { messageId: 'm1', inputTokens: '5384106', cacheReadTokens: '55937971', outputTokens: '473719', responseOutputTokens: '400000', apiProvider: 'API_PROVIDER_GOOGLE_GEMINI' }, streamingDuration: '2s' } }] } }),
      transcriptStats: { version: 1, status: 'ready', complete: true, userTokens: 100, assistantTokens: 200, toolTokens: 50, systemTokens: 10, totalTokens: 360, matchedSteps: 1, compactionMarkers: 2, imageSteps: 0 },
    },
  });
  const inlineHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:40px;background:#17181a;color:#ddd;font:13px "Segoe UI",sans-serif}
    .composer{width:820px;margin:0 auto;padding:12px;border-radius:16px;background:#252629}
    .editor{height:40px}.actions{display:flex;align-items:center;justify-content:space-between;gap:6px}.left,.right{display:flex;align-items:center;gap:6px}
    button{background:transparent;border:0;color:inherit;height:28px;font:inherit}
  </style></head><body><div class="composer"><div class="editor" contenteditable="true" role="combobox"></div><div class="actions"><div class="left"><button aria-label="Add">＋</button><button data-testid="model-selector-trigger">Gemini 4 Hydrogen</button></div><div class="right"><button aria-label="Send">➜</button></div></div></div><script>
    history.replaceState({}, '', '/c/${id}');
    window.agPulseHost = {
      getMetrics: async (input = {}) => {
        const p = new URLSearchParams();
        if (input.force) p.set('force', '1');
        if (input.usageOnly) p.set('usageOnly', '1');
        if (input.usageScope) p.set('usageScope', input.usageScope);
        return (await fetch('/api/metrics?' + p)).json();
      },
      getPreferences: async () => (await fetch('/api/preferences')).json(),
      setPreferences: async input => (await fetch('/api/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).json(),
      updatePlugin: async () => ({ state: 'current', currentVersion: '0.9.16', latestVersion: '0.9.16' }),
      report: () => {},
    };
    window.__agPulseTestSurface = (${extract(surfaceSrc)})();
    window.__agPulseI18nFactory = (${extract(i18nSrc)});
    window.__agPulseThemeFactory = (${extract(themeSrc)});
    window.__agPulsePricingFactory = (${extract(pricingSrc)});
    window.__agPulseUsageFactory = (${extract(usageSrc)});
    window.__agPulseUpdateFactory = (${extract(updateSrc)});
    (${extract(widgetSrc)})();
  </script></body></html>`;

  server = createServer(async (req, res) => {
    const reqUrl = new URL(req.url, 'http://127.0.0.1');
    const path = reqUrl.pathname;
    if (path === '/inline-fixture') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(inlineHtml); return; }
    if (path === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(panelPageSource()); return; }
    if (path === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); res.end(panelAppSource()); return; }
    if (path === '/styles.css') { res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' }); res.end(stylesCss); return; }
    if (path === '/theme.css') { res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' }); res.end(themeLib.css(':root')); return; }
    if (path === '/format.mjs') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); res.end(formatMjs); return; }
    if (path === '/preload.js') { res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); res.end(''); return; }
    if (path === '/api/metrics') {
      const isUsageOnly = reqUrl.searchParams.get('usageOnly') === '1';
      if (isUsageOnly) usageOnlyCalls++;
      else if (slowFullPoll && reqUrl.searchParams.get('force') === '1') await new Promise(r => setTimeout(r, 5000));
      const scopeParam = reqUrl.searchParams.get('usageScope');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(metricsPayload(scopeParam))); return;
    }
    if (path === '/api/preferences') {
      if (req.method === 'POST') { let b = ''; for await (const c of req) b += c; prefs = { ...prefs, ...JSON.parse(b), revision: prefs.revision + 1 }; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(prefs)); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  ({ child, cdp } = await launchBrowser(userDataDir, `${baseUrl}/inline-fixture`));

  const evalJs = async expr => {
    const res = await cdp.command('Runtime.evaluate', { expression: `(${expr})()`, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error('Page error: ' + JSON.stringify(res.exceptionDetails));
    return res.result?.value;
  };
  const waitUntil = async (expr, label, timeout = 20000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evalJs(expr)) return;
      await new Promise(r => setTimeout(r, 80));
    }
    throw new Error('Timed out waiting for: ' + label);
  };

  await waitUntil(`() => {
    const bar = document.getElementById('ag-pulse-status-bar');
    return bar?.dataset.layout === 'ready' && bar.shadowRoot?.getElementById('tps')?.textContent !== '—';
  }`, 'inline widget hydrated');

  // 1. Font sync across inline widget, usage dialog, and update dialog
  await evalJs(`() => { document.documentElement.style.setProperty('--ui-font-family', '"Georgia"'); }`);
  await waitUntil(`() => getComputedStyle(document.getElementById('ag-pulse-status-bar').shadowRoot.querySelector('.bar')).fontFamily.includes('Georgia')`, 'inline widget font synced to Georgia');

  // Quota window token rows in inline context card + plural toks units
  const quotaText = await evalJs(`() => {
    const sr = document.getElementById('ag-pulse-status-bar').shadowRoot;
    sr.querySelector('[data-card="context"]').click();
    return {
      density: document.getElementById('ag-pulse-status-bar').dataset.density,
      contextTokens: sr.getElementById('context-tokens').textContent,
      fiveHidden: sr.getElementById('five-usage').hidden,
      fiveVal: sr.getElementById('five-usage-value').textContent,
      weekVal: sr.getElementById('week-usage-value').textContent,
    };
  }`);
  assert.equal(quotaText.density, 'full');
  assert.ok(quotaText.contextTokens.endsWith('toks'), 'contextTokens should use plural toks: ' + quotaText.contextTokens);
  assert.equal(quotaText.fiveHidden, false);
  assert.equal(quotaText.fiveVal, '81.1M toks (约 644.2M 满额)');
  assert.equal(quotaText.weekVal, '129.9M toks (约 216.2M 满额)');
  assert.equal(await evalJs(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('context-compaction-pill').textContent`), '🗜 2 次');

  // Cache card compact breakdown with exact title tooltips + zero horizontal ellipsis
  const cacheCard = await evalJs(`() => {
    const sr = document.getElementById('ag-pulse-status-bar').shadowRoot;
    sr.querySelector('[data-card="cache"]').click();
    const host = document.createElement('div');
    const card = sr.getElementById('cache-card');
    window.__agPulseTestSurface.setMarkup(host, card.querySelector('.heading').outerHTML + card.querySelector('.cache-stats').outerHTML);
    const cells = ['cache-read', 'cache-miss', 'cache-output'].map(id => {
      const dd = sr.getElementById(id).closest('dd');
      return {
        id,
        val: sr.getElementById(id).textContent,
        unit: sr.getElementById(id + '-unit').textContent,
        title: sr.getElementById(id + '-cell').getAttribute('title'),
        noClip: dd.scrollWidth <= dd.clientWidth,
      };
    });
    return {
      stripTotal: sr.getElementById('cache-total').textContent,
      coverage: sr.getElementById('cache-coverage').textContent,
      coverageUnit: sr.getElementById('cache-coverage-unit').textContent,
      usageUnits: [...sr.querySelectorAll('.usage-unit')].map(n => n.textContent),
      ideMarkupOk: host.querySelector('#cache-read-cell') !== null,
      cells,
    };
  }`);
  assert.equal(cacheCard.stripTotal, '61.8M tok', 'compact bottom strip keeps tok');
  assert.equal(cacheCard.coverage, '61,795,796');
  assert.equal(cacheCard.coverageUnit, 'toks');
  assert.deepEqual(cacheCard.usageUnits, ['toks', 'toks']);
  assert.equal(cacheCard.ideMarkupOk, true, 'ide/surface setMarkup should accept updated cache-card markup');
  assert.deepEqual(cacheCard.cells.map(c => [c.val, c.unit, c.title, c.noClip]), [
    ['55.9M', ' toks', '缓存读取: 55,937,971 toks', true],
    ['5.38M', ' toks', '未缓存输入: 5,384,106 toks', true],
    ['473.7K', ' toks', '输出: 473,719 toks', true],
  ]);

  // Verify >= 1e9 (>= 1 billion) switches cache total + read breakdown to compact B notation with exact tooltip
  billionSpeed = true;
  await evalJs(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('cache-card').dispatchEvent(new Event('pointerenter'))`);
  await evalJs(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.querySelector('[data-card="context"]').click()`);
  await evalJs(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.querySelector('.refresh').click()`);
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('cache-total').textContent === '1.2B tok'`, 'billion counter compact B on strip');
  const billionInline = await evalJs(`() => {
    const sr = document.getElementById('ag-pulse-status-bar').shadowRoot;
    sr.querySelector('[data-card="cache"]').click();
    return {
      stripTotal: sr.getElementById('cache-total').textContent,
      coverage: sr.getElementById('cache-coverage').textContent,
      coverageUnit: sr.getElementById('cache-coverage-unit').textContent,
      coverageTitle: sr.getElementById('cache-hero-total').getAttribute('title'),
      cacheRead: sr.getElementById('cache-read').textContent,
      cacheReadTitle: sr.getElementById('cache-read-cell').getAttribute('title'),
    };
  }`);
  assert.equal(billionInline.stripTotal, '1.2B tok');
  assert.equal(billionInline.coverage, '1.23B');
  assert.equal(billionInline.coverageUnit, 'toks');
  assert.equal(billionInline.coverageTitle, '1,234,567,890 toks');
  assert.equal(billionInline.cacheRead, '1.15B');
  assert.equal(billionInline.cacheReadTitle, '缓存读取: 1,150,000,000 toks');
  billionSpeed = false;
  await evalJs(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.querySelector('.refresh').click()`);
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('cache-total').textContent === '61.8M tok'`, 'restore sub-billion fixture');

  // Update dialog inherits --pulse-font
  const updateFont = await evalJs(`() => {
    const sr = document.getElementById('ag-pulse-status-bar').shadowRoot;
    sr.getElementById('check-update').click();
    return getComputedStyle(sr.getElementById('plugin-update-dialog')).fontFamily;
  }`);
  assert.ok(updateFont.includes('Georgia'), 'update dialog should inherit host font: ' + updateFont);
  await evalJs(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('update-close').click()`);

  // Usage dashboard modal inherits --pulse-font and supports scope toggle
  await evalJs(`() => {
    const sr = document.getElementById('ag-pulse-status-bar').shadowRoot;
    sr.querySelector('[data-card="cache"]').click();
    sr.getElementById('open-usage').click();
  }`);
  await waitUntil(`() => {
    const sr = document.getElementById('ag-pulse-status-bar').shadowRoot;
    return sr.getElementById('usage-dashboard')?.open === true;
  }`, 'usage dashboard opened');

  const localState = await evalJs(`() => {
    const ud = document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard');
    const vs = ud.firstElementChild.shadowRoot;
    return {
      font: getComputedStyle(vs.querySelector('.page')).fontFamily,
      subtitle: vs.getElementById('subtitle').textContent,
      total: vs.querySelector('#totals .value').textContent,
      localPressed: vs.querySelector('[data-usage-scope="local"]').getAttribute('aria-pressed'),
      actionWidths: [...vs.querySelectorAll('.actions button')].map(b => Math.round(b.getBoundingClientRect().width)),
    };
  }`);
  assert.ok(localState.font.includes('Georgia'), 'usage modal inherits Georgia: ' + localState.font);
  assert.ok(localState.subtitle.includes('全部流经统计'));
  assert.equal(localState.total, '33KToken');
  assert.equal(localState.localPressed, 'true');
  assert.deepEqual(localState.actionWidths, [32, 32, 32]);

  // Toggle to Current account: optimistic thumb/pressed flip < 50ms, usageOnly < 250ms even if slowFullPoll=true
  slowFullPoll = true;
  const switchStart = Date.now();
  const immediate = await evalJs(`() => {
    const vs = document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot;
    const t0 = performance.now();
    vs.querySelector('[data-usage-scope="account"]').click();
    return {
      inPageMs: performance.now() - t0,
      activeAttr: vs.getElementById('scope-controls').dataset.activeScope,
      pressed: vs.querySelector('[data-usage-scope="account"]').getAttribute('aria-pressed'),
      subtitle: vs.getElementById('subtitle').textContent,
    };
  }`);
  assert.ok(immediate.inPageMs < 150, 'click + optimistic UI state should resolve immediately');
  assert.equal(immediate.activeAttr, 'account');
  assert.equal(immediate.pressed, 'true');
  assert.ok(immediate.subtitle.includes('当前账号'));
  await waitUntil(`() => {
    const vs = document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot;
    return vs.querySelector('#totals .value')?.textContent === '11KToken';
  }`, 'usage modal switched to account scope via fast usageOnly path', 3500);
  assert.ok(Date.now() - switchStart < 4000, 'usageOnly path must not wait for 5000ms force poll');
  assert.ok(usageOnlyCalls >= 1);
  assert.equal(prefs.usageScope, 'account');

  // Toggle back to All local: scopeCache swaps totals immediately (< 50ms)
  const cachedBack = await evalJs(`() => {
    const vs = document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot;
    vs.querySelector('[data-usage-scope="local"]').click();
    return {
      activeAttr: vs.getElementById('scope-controls').dataset.activeScope,
      total: vs.querySelector('#totals .value').textContent,
      subtitle: vs.getElementById('subtitle').textContent,
    };
  }`);
  assert.equal(cachedBack.activeAttr, 'local');
  assert.equal(cachedBack.total, '33KToken');
  assert.ok(cachedBack.subtitle.includes('全部流经统计'));

  // Switch back to account to test signed-out state
  slowFullPoll = false;
  await evalJs(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot.querySelector('[data-usage-scope="account"]').click()`);
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot.querySelector('#totals .value')?.textContent === '11KToken'`, 're-settled to account');

  // Signed-out account scope shows empty prompt rather than crashing; toggling back restores data
  signedIn = false;
  await waitUntil(`() => {
    const vs = document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot;
    return vs.getElementById('usage-waiting').hidden === false;
  }`, 'signed-out waiting notice shown');
  await evalJs(`() => {
    const vs = document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot;
    vs.querySelector('[data-usage-scope="local"]').click();
  }`);
  await waitUntil(`() => {
    const vs = document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot;
    return vs.getElementById('usage-waiting').hidden === true && vs.querySelector('#totals .value')?.textContent === '33KToken';
  }`, 'local scope recovers while signed out');
  await evalJs(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot.getElementById('close').click()`);

  // Verify IDE setMarkup allowlist & compact sticky-header Usage Details layout with 18 merged models at 1280x800
  signedIn = true;
  stressModels = true;
  await cdp.command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await evalJs(`() => {
    const sr = document.getElementById('ag-pulse-status-bar').shadowRoot;
    sr.querySelector('[data-card="cache"]').click();
    sr.getElementById('open-usage').click();
  }`);
  await waitUntil(`() => {
    const ud = document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard');
    return ud?.open === true && ud.firstElementChild.shadowRoot.getElementById('usage-waiting').hidden === true;
  }`, 'reopened usage dashboard for 18-model layout verification');
  await evalJs(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot.getElementById('refresh').click()`);
  await waitUntil(`() => {
    const vs = document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot;
    return vs.querySelector('#totals .value')?.textContent !== '33KToken';
  }`, '18-model totals loaded', 20000);

  // Also prove ide/surface setMarkup accepts the exact static template in compat/usage-ui.cjs
  const pageTemplateMatch = usageSrc.match(/setMarkup\(page,`([^`]*)`\)/);
  assert.ok(pageTemplateMatch, 'should locate static page template in usage-ui.cjs');
  const ideSetMarkupOk = await evalJs(`() => {
    const host = document.createElement('div');
    window.__agPulseTestSurface.setMarkup(host, ${JSON.stringify(pageTemplateMatch[1])});
    return host.querySelector('#details') !== null && host.querySelector('#page-body') !== null && host.querySelector('.page-head') !== null;
  }`);
  assert.equal(ideSetMarkupOk, true, 'ide/surface setMarkup should accept updated usage-ui markup');

  const overviewBox = await evalJs(`() => {
    const ud = document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard');
    const r = ud.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  }`);

  const expectedMergedStressCount = 21;
  await evalJs(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot.getElementById('details-tab').click()`);
  await waitUntil(`() => {
    const vs = document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot;
    return vs.getElementById('details').hidden === false && vs.querySelectorAll('#legend button[data-model]').length === ${expectedMergedStressCount} && vs.querySelectorAll('#table-body tr').length === ${expectedMergedStressCount};
  }`, 'details tab with merged thinking-tier model rows visible');

  // Verify thinking tiers merge across legend/chart/table without merging distinct variants/roles,
  // and hovering a multi-tier table row shows the lightweight tier breakdown tooltip.
  const tierMergeCheck = await evalJs(`() => {
    const vs = document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot;
    const legendLabels = [...vs.querySelectorAll('#legend button .legend-name')].map(n => n.textContent.trim());
    const flashRow = vs.querySelector('#table-body tr[data-model="gemini 3.8 flash"]');
    const sonnetRow = vs.querySelector('#table-body tr[data-model="claude sonnet 4.6"]');
    const gptRow = vs.querySelector('#table-body tr[data-model="gpt 5.4"]');
    const hydrogenRow = vs.querySelector('#table-body tr[data-model="gemini 4 hydrogen"]');
    const deepseekRow = vs.querySelector('#table-body tr[data-model="deepseek r1"]');
    const tableHeaders = [...vs.querySelectorAll('#table-head th')].map(n => n.firstElementChild?.textContent?.trim() || n.textContent.trim());
    flashRow.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, clientX: 260 }));
    const tip = vs.getElementById('tip');
    const flashTip = {
      hidden: tip.hidden,
      title: tip.querySelector('.tip-title')?.textContent || '',
      tiers: [...tip.querySelectorAll('.tip-model')].map(n => n.textContent.trim()),
    };
    flashRow.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    const hiddenAfterLeave = tip.hidden;
    sonnetRow.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, clientX: 260 }));
    const sonnetTip = {
      hidden: tip.hidden,
      title: tip.querySelector('.tip-title')?.textContent || '',
      tiers: [...tip.querySelectorAll('.tip-model')].map(n => n.textContent.trim()),
    };
    sonnetRow.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    gptRow.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, clientX: 260 }));
    const singleTierTipHidden = tip.hidden;
    gptRow.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    hydrogenRow.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, clientX: 260 }));
    const hydrogenTip = {
      hidden: tip.hidden,
      title: tip.querySelector('.tip-title')?.textContent || '',
      tiers: [...tip.querySelectorAll('.tip-model')].map(n => n.textContent.trim()),
    };
    hydrogenRow.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    return {
      legendLabels,
      tableHeaders,
      totalMetrics: [...vs.querySelectorAll('#totals .metric')].map(m => ({ label: m.querySelector('label')?.textContent?.trim(), value: m.querySelector('.value')?.textContent?.trim() })),
      flashTotal: flashRow?.children[1]?.textContent || '',
      flashCost: flashRow?.querySelector('.col-cost')?.textContent || '',
      deepseekCost: deepseekRow?.querySelector('.col-cost')?.textContent || '',
      flashTip,
      sonnetTip,
      hydrogenTip,
      hiddenAfterLeave,
      singleTierTipHidden,
    };
  }`);
  assert.deepEqual(tierMergeCheck.tableHeaders, ['模型', '总 Token', '未缓存输入', '缓存读取', '缓存写入', '输出', '成本']);
  assert.equal(tierMergeCheck.totalMetrics.length, 5, 'Overview strip should render 5 KPI cards including est. weekly quota USD');
  assert.ok(/^≈\$[\d,.]+K?USD$/.test(tierMergeCheck.totalMetrics[4].value), 'Predicted weekly quota card should show ≈ USD from quotaWindows: ' + JSON.stringify(tierMergeCheck.totalMetrics[4]));
  assert.ok(/^¥[\d,]+\.\d{2}$/.test(tierMergeCheck.flashCost), 'Priced model should show CNY estimate in zh-CN: ' + tierMergeCheck.flashCost);
  assert.equal(tierMergeCheck.deepseekCost, '—', 'Unpriced model should show em-dash');
  assert.ok(tierMergeCheck.legendLabels.includes('Gemini 4 Carbon'), 'Carbon high+medium+orchestrator+gemini-pro-orchestrator should merge into Gemini 4 Carbon');
  assert.ok(tierMergeCheck.legendLabels.includes('Gemini 4 Neon'), 'Neon (High)+(XHigh)+Orchestrator (Neon)+gemini-pro-orchestrator-neon should merge into Gemini 4 Neon');
  assert.ok(tierMergeCheck.legendLabels.includes('Gemini 4 Hydrogen'), 'Hydrogen xhigh+orchestrator should merge into Gemini 4 Hydrogen');
  assert.ok(tierMergeCheck.legendLabels.includes('Gemini 4 Argon'), 'Argon high+medium+orchestrator+gemini-pro-orchestrator-argon should merge into Gemini 4 Argon');
  assert.ok(tierMergeCheck.legendLabels.includes('Claude Opus 5.5') && tierMergeCheck.legendLabels.includes('Claude Sonnet 5.5'), '2.35.0 claude-opus-5-5-* and claude-sonnet-5-5-* slugs should merge into Claude Opus 5.5 and Claude Sonnet 5.5');
  assert.equal(tierMergeCheck.legendLabels.some(l => /orchestrator|gemini pro$/i.test(l)), false, 'Orchestrator variants including gemini-pro-orchestrator* should merge into their corresponding Gemini 4 models');
  assert.equal(tierMergeCheck.hydrogenTip.hidden, false, 'Merged Hydrogen + Orchestrator row should show mode/tier breakdown tooltip');
  assert.ok(tierMergeCheck.hydrogenTip.title.includes('Gemini 4 Hydrogen'), 'Tooltip should display full model name: ' + tierMergeCheck.hydrogenTip.title);
  assert.ok(tierMergeCheck.hydrogenTip.tiers.some(t => t.startsWith('Orchestrator')) && tierMergeCheck.hydrogenTip.tiers.some(t => t.startsWith('XHigh')), 'Hydrogen tooltip should include Orchestrator and XHigh: ' + JSON.stringify(tierMergeCheck.hydrogenTip.tiers));
  assert.ok(tierMergeCheck.legendLabels.includes('GPT-OSS 120B'), 'Hyphenated uppercase model base must be preserved');
  assert.ok(tierMergeCheck.legendLabels.includes('GPT 5.4') && tierMergeCheck.legendLabels.includes('GPT 5.4 Mini'), 'Mini variant must stay distinct from GPT 5.4');
  assert.equal(tierMergeCheck.flashTip.hidden, false, 'Multi-tier row hover should show tier breakdown tooltip');
  assert.ok(tierMergeCheck.flashTip.title.includes('Gemini 3.8 Flash') && tierMergeCheck.flashTip.title.includes('档位分布'), 'Tooltip should show model name and tier heading: ' + tierMergeCheck.flashTip.title);
  assert.equal(tierMergeCheck.flashTip.tiers.length, 4, 'Gemini 3.8 Flash should list all 4 constituent tiers (High, Medium, Default, Tiered)');
  assert.ok(tierMergeCheck.flashTip.tiers.some(t => t.startsWith('High')) && tierMergeCheck.flashTip.tiers.some(t => t.startsWith('Medium')) && tierMergeCheck.flashTip.tiers.some(t => t.startsWith('默认')) && tierMergeCheck.flashTip.tiers.some(t => t.startsWith('Tiered')), 'Unexpected tier rows: ' + JSON.stringify(tierMergeCheck.flashTip.tiers));
  assert.equal(tierMergeCheck.sonnetTip.hidden, false, 'Mixed slug + parenthesized tier should merge into Claude Sonnet 4.6 with 2 tiers');
  assert.equal(tierMergeCheck.sonnetTip.tiers.length, 2, 'Claude Sonnet 4.6 should show Default + Thinking tiers');
  assert.equal(tierMergeCheck.hiddenAfterLeave, true, 'Leaving multi-tier row should hide tooltip');
  assert.equal(tierMergeCheck.singleTierTipHidden, true, 'Single-tier row hover should keep tooltip hidden');

  const detailsMetrics = await evalJs(`() => {
    const ud = document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard');
    const vs = ud.firstElementChild.shadowRoot;
    const dr = ud.getBoundingClientRect();
    const head = vs.querySelector('.page-head').getBoundingClientRect();
    const body = vs.getElementById('page-body');
    const br = body.getBoundingClientRect();
    const chart = vs.querySelector('#details .chart').getBoundingClientRect();
    const rows = [...vs.querySelectorAll('#table-body tr')];
    const visibleRows = rows.filter(r => r.getBoundingClientRect().bottom <= br.bottom + 1).length;
    const legendDot = vs.querySelector('#legend .dot').getBoundingClientRect();
    const tableDot = vs.querySelector('#table-body .dot').getBoundingClientRect();
    const stacks = [...vs.querySelectorAll('#details .stack')].filter(s => s.querySelector('.bar-segment'));
    const maxStackH = Math.max(0, ...stacks.map(s => s.getBoundingClientRect().height));
    const maxStackDiff = Math.max(0, ...stacks.map(s => {
      const h = s.getBoundingClientRect().height;
      const sum = [...s.children].reduce((acc, b) => acc + parseFloat(b.style.height), 0);
      return Math.abs(h - sum);
    }));
    const pinBefore = {
      localeTop: vs.getElementById('locale').getBoundingClientRect().top,
      refreshTop: vs.getElementById('refresh').getBoundingClientRect().top,
      closeTop: vs.getElementById('close').getBoundingClientRect().top,
      tabTop: vs.getElementById('details-tab').getBoundingClientRect().top,
      scopeTop: vs.getElementById('scope-controls').getBoundingClientRect().top,
    };
    return {
      frame: { x: Math.round(dr.x), y: Math.round(dr.y), width: Math.round(dr.width), height: Math.round(dr.height) },
      chartFrame: { x: Math.round(chart.x), width: Math.round(chart.width) },
      headBottom: head.bottom,
      bodyTop: br.top,
      bodyScrollTop: body.scrollTop,
      bodyScrollHeight: body.scrollHeight,
      bodyClientHeight: body.clientHeight,
      chartVisible: vs.querySelector('#details .chart').getBoundingClientRect().bottom <= br.bottom + 1,
      chartWrapNoVScroll: vs.querySelector('#details .chart-wrap').scrollHeight <= vs.querySelector('#details .chart-wrap').clientHeight + 1,
      headVisible: vs.querySelector('#table-head').getBoundingClientRect().bottom <= br.bottom + 1,
      visibleRows,
      hasStackedBars: vs.querySelectorAll('#details .bar-segment').length > 0,
      legendDot: [Math.round(legendDot.width), Math.round(legendDot.height)],
      tableDot: [Math.round(tableDot.width), Math.round(tableDot.height)],
      maxStackH,
      maxStackDiff,
      pinBefore,
    };
  }`);
  assert.deepEqual(detailsMetrics.frame, overviewBox, 'overview and details share identical outer frame');
  assert.ok(detailsMetrics.bodyTop >= detailsMetrics.headBottom - 1, 'scrollable page-body starts below pinned header (scrollbar avoids corner)');
  assert.equal(detailsMetrics.chartVisible, true, 'bar chart should fit cleanly above the fold');
  assert.equal(detailsMetrics.chartWrapNoVScroll, true, 'chart-wrap must not introduce vertical scrollbar/clipping');
  assert.equal(detailsMetrics.headVisible, true, 'table header should fit cleanly above the fold');
  assert.ok(detailsMetrics.visibleRows >= 5, `at least 5 table rows should be visible above the fold at 1280x800, got ${detailsMetrics.visibleRows}`);
  assert.equal(detailsMetrics.hasStackedBars, true, 'colored stacked bar segments must be preserved');
  assert.deepEqual(detailsMetrics.legendDot, [7, 7]);
  assert.deepEqual(detailsMetrics.tableDot, [7, 7]);
  assert.ok(detailsMetrics.maxStackH <= 150.5 && detailsMetrics.maxStackH > 10, 'stack height respects 150px plot height: ' + detailsMetrics.maxStackH);
  assert.ok(detailsMetrics.maxStackDiff < 0.25, 'stack height matches bar segments: ' + detailsMetrics.maxStackDiff);

  // Scroll to bottom and verify top-right controls, tabs, scope toggle, and sticky table header stay pinned
  const scrolled = await evalJs(`() => {
    const ud = document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard');
    const vs = ud.firstElementChild.shadowRoot;
    const body = vs.getElementById('page-body');
    body.scrollTop = body.scrollHeight;
    const br = body.getBoundingClientRect();
    const thRect = vs.querySelector('#table-head th').getBoundingClientRect();
    return {
      scrollTop: body.scrollTop,
      pinAfter: {
        localeTop: vs.getElementById('locale').getBoundingClientRect().top,
        refreshTop: vs.getElementById('refresh').getBoundingClientRect().top,
        closeTop: vs.getElementById('close').getBoundingClientRect().top,
        tabTop: vs.getElementById('details-tab').getBoundingClientRect().top,
        scopeTop: vs.getElementById('scope-controls').getBoundingClientRect().top,
      },
      thStickyTop: thRect.top,
      bodyTop: br.top,
    };
  }`);
  assert.ok(scrolled.scrollTop > 50, 'page-body should scroll when 18 models are displayed');
  assert.deepEqual(scrolled.pinAfter, detailsMetrics.pinBefore, 'pinned top-right controls, tabs, and scope toggle must never move when scrolling');
  assert.ok(scrolled.thStickyTop >= scrolled.bodyTop - 1 && scrolled.thStickyTop <= scrolled.bodyTop + 2, `sticky thead th should stick to top of page-body (${scrolled.thStickyTop} vs ${scrolled.bodyTop})`);

  // Empty month navigation must preserve chart horizontal frame (scrollbar-gutter: stable)
  await evalJs(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot.getElementById('previous').click()`);
  const emptyChartFrame = await evalJs(`() => {
    const vs = document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot;
    const chart = vs.querySelector('#details .chart').getBoundingClientRect();
    return {
      rows: vs.querySelectorAll('#table-body tr').length,
      chartFrame: { x: Math.round(chart.x), width: Math.round(chart.width) },
    };
  }`);
  assert.equal(emptyChartFrame.rows, 0);
  assert.deepEqual(emptyChartFrame.chartFrame, detailsMetrics.chartFrame, 'chart frame must not shift when scrollbar toggles between empty and full months');

  await evalJs(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot.getElementById('close').click()`);
  stressModels = false;
  await cdp.command('Emulation.clearDeviceMetricsOverride');

  // Zero idle DOM mutations over 1s
  await new Promise(r => setTimeout(r, 300));
  await evalJs(`() => {
    window.__pulseMutations = 0;
    const sr = document.getElementById('ag-pulse-status-bar').shadowRoot;
    window.__pulseObs = new MutationObserver(list => { window.__pulseMutations += list.length; });
    window.__pulseObs.observe(sr, { attributes: true, childList: true, subtree: true, characterData: true });
  }`);
  await new Promise(r => setTimeout(r, 900));
  const idleMutations = await evalJs(`() => { window.__pulseObs.disconnect(); return window.__pulseMutations; }`);
  assert.equal(idleMutations, 0, 'steady-state widget polling should trigger zero idle DOM mutations');

  // Verify density recovery after font / width change & Traditional Chinese quota reference
  await evalJs(`() => { document.querySelector('.composer').style.width = '240px'; }`);
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar')?.dataset.density === 'icons'`, 'narrow container drops to icons density');
  await evalJs(`() => {
    document.documentElement.style.setProperty('--ui-font-family', '"Segoe UI"');
    document.querySelector('.composer').style.width = '820px';
  }`);
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar')?.dataset.density === 'full'`, 'widening recovers full density after font change');

  await evalJs(`() => {
    const sr = document.getElementById('ag-pulse-status-bar').shadowRoot;
    sr.querySelector('[data-card="context"]').click();
    sr.getElementById('card-language-zh-tw').click();
  }`);
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('week-usage-value').textContent === '129.9M toks (約 216.2M 滿額)'`, 'zh-TW quota window label');
  await evalJs(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('card-language-zh').click()`);
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('week-usage-value').textContent === '129.9M toks (约 216.2M 满额)'`, 'restore zh-CN');

  // Verify stale/discovery errors render sanitized and once in #quota-error (never duplicated in five-note/week-note)
  staleError = 'Command failed: powershell.exe -NoProfile -NonInteractive -Command Get-CimInstance Win32_Process';
  await waitUntil(`() => {
    const sr = document.getElementById('ag-pulse-status-bar').shadowRoot;
    return !sr.getElementById('quota-error').hidden && sr.getElementById('quota-error').textContent === '统计面板暂时无法连接';
  }`, 'sanitized raw command error shown once in #quota-error');
  const errorLayout = await evalJs(`() => {
    const sr = document.getElementById('ag-pulse-status-bar').shadowRoot;
    return {
      quotaError: sr.getElementById('quota-error').textContent,
      fiveNoteHidden: sr.getElementById('five-note').hidden,
      fiveNoteText: sr.getElementById('five-note').textContent,
      weekNoteHidden: sr.getElementById('week-note').hidden,
      weekNoteText: sr.getElementById('week-note').textContent,
    };
  }`);
  assert.deepEqual(errorLayout, {
    quotaError: '统计面板暂时无法连接',
    fiveNoteHidden: true,
    fiveNoteText: '',
    weekNoteHidden: true,
    weekNoteText: '',
  });
  staleError = '读取 Antigravity 进程信息超时';
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('quota-error').textContent === '读取 Antigravity 进程信息超时'`, 'discovery timeout message rendered in #quota-error');
  staleError = null;
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('quota-error').hidden`, 'quota-error hides once recovered');

  // Transient bridge timeout/offline response must keep the widget visible and preserve live metrics as stale
  transientOffline = true;
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('dot').classList.contains('stale')`, 'transient offline switches dot to stale');
  const duringTransient = await evalJs(`() => {
    const bar = document.getElementById('ag-pulse-status-bar');
    const sr = bar.shadowRoot;
    return {
      visibility: getComputedStyle(bar).visibility,
      inlineVisibility: bar.style.visibility,
      layout: bar.dataset.layout,
      density: bar.dataset.density,
      tps: sr.getElementById('tps').textContent,
      cacheTotal: sr.getElementById('cache-total').textContent,
      contextPct: sr.getElementById('context-percent').textContent,
      quotaErrorHidden: sr.getElementById('quota-error').hidden,
      quotaErrorText: sr.getElementById('quota-error').textContent,
    };
  }`);
  assert.equal(duringTransient.visibility, 'visible', 'transient timeout must never hide the status bar');
  assert.equal(duringTransient.inlineVisibility, '');
  assert.equal(duringTransient.layout, 'ready');
  assert.equal(duringTransient.density, 'full', 'transient timeout must not collapse hydrated bar to icons-only');
  assert.notEqual(duringTransient.tps, '—');
  assert.notEqual(duringTransient.cacheTotal, '— tok');
  assert.notEqual(duringTransient.contextPct, '—');
  assert.equal(duringTransient.quotaErrorHidden, true, 'transient reconnect must not display reconnecting warning in quota card');
  assert.equal(duringTransient.quotaErrorText, '');
  transientOffline = false;
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('dot').classList.contains('live')`, 'dot recovers to live after transient offline');

  // Unhydrated cold-start transient timeout must show connecting/loading state instead of contextUnknown/noQuota
  const navigateAndWait = async url => {
    let loaded;
    const done = new Promise(resolve => { loaded = resolve; });
    const prev = cdp.onEvent;
    cdp.onEvent = msg => { prev?.(msg); if (msg.method === 'Page.loadEventFired') loaded(); };
    try {
      await cdp.command('Page.navigate', { url });
      await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('Page load timeout: ' + url)), 15000))]);
    } finally {
      cdp.onEvent = prev;
    }
  };
  transientOffline = true;
  await navigateAndWait(`${baseUrl}/inline-fixture?cold=1`);
  await waitUntil(`() => {
    const bar = document.getElementById('ag-pulse-status-bar');
    const sr = bar?.shadowRoot;
    return bar?.dataset.layout === 'ready' && sr?.getElementById('dot')?.classList.contains('offline') && sr.getElementById('context-summary')?.textContent === '连接 Antigravity…';
  }`, 'cold-start transient timeout renders connecting state');
  const coldTransient = await evalJs(`() => {
    const sr = document.getElementById('ag-pulse-status-bar').shadowRoot;
    sr.querySelector('[data-card="context"]').click();
    return {
      contextSummary: sr.getElementById('context-summary').textContent,
      fiveNoteHidden: sr.getElementById('five-note').hidden,
      fiveNoteText: sr.getElementById('five-note').textContent,
      weekNoteHidden: sr.getElementById('week-note').hidden,
      weekNoteText: sr.getElementById('week-note').textContent,
      quotaErrorHidden: sr.getElementById('quota-error').hidden,
      quotaErrorText: sr.getElementById('quota-error').textContent,
    };
  }`);
  assert.deepEqual(coldTransient, {
    contextSummary: '连接 Antigravity…',
    fiveNoteHidden: false,
    fiveNoteText: '读取额度…',
    weekNoteHidden: true,
    weekNoteText: '',
    quotaErrorHidden: true,
    quotaErrorText: '',
  });
  transientOffline = false;
  await evalJs(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.querySelector('.refresh').click()`);
  await waitUntil(`() => {
    const sr = document.getElementById('ag-pulse-status-bar').shadowRoot;
    return sr.getElementById('dot').classList.contains('live') && sr.getElementById('context-percent').textContent !== '—' && sr.getElementById('five-note').hidden;
  }`, 'cold-start widget hydrates cleanly once sidecar responds');

  // 2. Navigate to Sidecar Panel and verify Fira Code font sync + compact quota height + toks cache card
  signedIn = true;
  await navigateAndWait(`${baseUrl}/`);
  await waitUntil(`() => document.getElementById('strip-tps')?.textContent && document.getElementById('strip-tps').textContent !== '—'`, 'panel hydrated');
  await evalJs(`() => {
    document.querySelector('.widget').style.height = '580px';
    document.getElementById('context-tab').click();
  }`);
  const panelCheck = await evalJs(`() => {
    const card = document.getElementById('context-card');
    const contextRes = {
      rootFont: getComputedStyle(document.documentElement).fontFamily,
      fiveHidden: document.getElementById('five-usage').hidden,
      fiveVal: document.getElementById('five-usage-value').textContent,
      weekVal: document.getElementById('week-usage-value').textContent,
      fits: card.scrollHeight <= card.clientHeight + 1,
      scrollH: card.scrollHeight,
      clientH: card.clientHeight,
    };
    document.getElementById('cache-tab').click();
    return {
      ...contextRes,
      stripCacheTotal: document.getElementById('strip-cache-total').textContent,
      cacheCoverage: document.getElementById('cache-coverage').textContent,
      cacheCoverageUnit: document.getElementById('cache-coverage-unit').textContent,
      cacheRead: document.getElementById('cache-read').textContent,
      cacheReadUnit: document.getElementById('cache-read-unit').textContent,
      cacheReadTitle: document.getElementById('cache-read-cell').getAttribute('title'),
    };
  }`);
  assert.ok(panelCheck.rootFont.includes('Fira Code'), 'panel font should adopt theme.fontFamily: ' + panelCheck.rootFont);
  assert.equal(panelCheck.fiveHidden, false);
  assert.equal(panelCheck.fiveVal, '81.1M toks (约 644.2M 满额)');
  assert.equal(panelCheck.weekVal, '129.9M toks (约 216.2M 满额)');
  assert.equal(panelCheck.fits, true, `context-card should fit cleanly inside 580px frame: ${panelCheck.scrollH} vs ${panelCheck.clientH}`);
  assert.equal(await evalJs(`() => document.getElementById('context-compaction-pill').textContent`), '🗜 2 次');
  assert.equal(panelCheck.stripCacheTotal, '61.8M tok', 'panel top strip retains tok');
  assert.equal(panelCheck.cacheCoverage, '61,795,796');
  assert.equal(panelCheck.cacheCoverageUnit, 'toks');
  assert.equal(panelCheck.cacheRead, '55.9M');
  assert.equal(panelCheck.cacheReadUnit, ' toks');
  assert.equal(panelCheck.cacheReadTitle, '缓存读取: 55,937,971 toks');

  // Verify >= 1e9 parity on sidecar panel as well
  billionSpeed = true;
  await evalJs(`() => document.getElementById('refresh-button').click()`);
  await waitUntil(`() => document.getElementById('strip-cache-total').textContent === '1.2B tok'`, 'panel updated to billion counter');
  const panelBillion = await evalJs(`() => ({
    strip: document.getElementById('strip-cache-total').textContent,
    coverage: document.getElementById('cache-coverage').textContent,
    coverageUnit: document.getElementById('cache-coverage-unit').textContent,
    coverageTitle: document.getElementById('cache-coverage').parentElement.getAttribute('title'),
    cacheRead: document.getElementById('cache-read').textContent,
    cacheReadTitle: document.getElementById('cache-read-cell').getAttribute('title'),
  })`);
  assert.deepEqual(panelBillion, {
    strip: '1.2B tok',
    coverage: '1.23B',
    coverageUnit: 'toks',
    coverageTitle: '1,234,567,890 toks',
    cacheRead: '1.15B',
    cacheReadTitle: '缓存读取: 1,150,000,000 toks',
  });

  // Verify #integration-note localization for debug-port-disabled and mounted cleanup
  integrationState = { state: 'reconnecting', reason: 'debug-port-disabled', hostVersion: '2.33.0', launchConfigured: true };
  await evalJs(`() => document.getElementById('refresh-button').click()`);
  await waitUntil(`() => document.getElementById('integration-note').textContent.includes('已自动配置启动入口')`, 'zh-CN debugPortReady note');

  await evalJs(`() => {
    document.getElementById('language-toggle').click();
    document.querySelector('[data-language-menu] [data-language="en"]').click();
  }`);
  await waitUntil(`() => document.getElementById('integration-note').textContent.includes('launch shortcut configured')`, 'en debugPortReady note');

  await evalJs(`() => {
    document.getElementById('language-toggle').click();
    document.querySelector('[data-language-menu] [data-language="zh-TW"]').click();
  }`);
  await waitUntil(`() => document.getElementById('integration-note').textContent.includes('已自動設定啟動捷徑')`, 'zh-TW debugPortReady note');

  integrationState = { state: 'reconnecting', reason: 'debug-port-disabled', hostVersion: '2.33.0', launchConfigured: false };
  await evalJs(`() => document.getElementById('refresh-button').click()`);
  await waitUntil(`() => document.getElementById('integration-note').textContent.includes('python3 manage.py launch')`, 'zh-TW debugPortManual note');

  integrationState = { state: 'reconnecting' };
  await evalJs(`() => document.getElementById('refresh-button').click()`);
  await waitUntil(`() => document.getElementById('integration-note').textContent.includes('內嵌狀態列正在自動重新連線')`, 'zh-TW generic reconnecting note');

  integrationState = { state: 'unavailable', reason: 'remote-hub' };
  await evalJs(`() => document.getElementById('refresh-button').click()`);
  await waitUntil(`() => document.getElementById('integration-note').textContent.includes('遠端 SSH/WSL 環境')`, 'zh-TW remote-hub note');

  integrationState = { state: 'mounted' };
  await evalJs(`() => document.getElementById('refresh-button').click()`);
  await waitUntil(`() => document.getElementById('integration-note').textContent === ''`, 'mounted clears integration-note');

  // 3. 3D Nailoong mascot anti-flicker regression suite:
  //    - zero self-triggered document MutationObserver churn during live animation
  //    - React model-selector re-render stability (button[aria-label^="Select model"] without data-testid + 2.35.0 running aria-label suffix)
  //    - hasCollision precision (ignores Radix/Base-UI tooltips, off-screen 2.35.0 aria-hidden modal drawer & non-overlapping non-modal dialogs; hides cleanly on overlapping listbox/select-popup with spatial + temporal hysteresis)
  //    - viewport top-threshold hysteresis (no chatter across 91..98px boundary jitter)
  //    - unready/evicted atlas frame retention (never clears canvas to blank while source is incomplete)
  integrationState = null;
  billionSpeed = false;
  transientOffline = false;
  await cdp.command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
  await navigateAndWait(`${baseUrl}/inline-fixture?nailong=1`);
  await waitUntil(`() => {
    const bar = document.getElementById('ag-pulse-status-bar');
    return location.pathname.startsWith('/c/') && bar?.dataset.layout === 'ready' && bar.shadowRoot?.getElementById('tps')?.textContent !== '—';
  }`, 'nailong inline-fixture document committed and hydrated');
  await evalJs(`() => {
    window.__nextFrame = () => new Promise(resolve => {
      let done = false;
      const fin = () => { if (!done) { done = true; resolve(); } };
      requestAnimationFrame(fin);
      setTimeout(fin, 40);
    });
    document.body.style.padding = '0 40px 40px';
    document.querySelector('.composer').style.marginTop = '160px';
    window.dispatchEvent(new Event('resize'));
  }`);
  await new Promise(r => setTimeout(r, 80));
  await waitUntil(`() => {
    const bar = document.getElementById('ag-pulse-status-bar');
    const host = document.querySelector('[data-ag-pulse-neon-mascot]');
    const st = host?.__agPulseNailongDebug?.state;
    const cv = host?.shadowRoot?.querySelector('.rig-canvas');
    if (!bar || bar.dataset.motion || !st?.shown || !st.stageShown || st.stageHidden || st.paintCount < 1 || !cv) return false;
    const data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let opaque = 0;
    for (let i = 3; i < data.length; i += 16) if (data[i] > 16) opaque++;
    return opaque > 200;
  }`, '3D Nailoong mascot mounted and painted initial atlas frame');
  await new Promise(r => setTimeout(r, 320));
  await waitUntil(`() => !document.getElementById('ag-pulse-status-bar')?.dataset.motion`, 'bar density motion settled before idle check');

  // 3a. Zero self-triggered document.documentElement mutations & zero show/hide toggles over 360ms live animation
  const idleNailong = await evalJs(`async () => {
    const host = document.querySelector('[data-ag-pulse-neon-mascot]');
    const dbg = host.__agPulseNailongDebug;
    const startToggles = dbg.state.showToggleCount;
    let docMutations = 0;
    const obs = new MutationObserver(records => { docMutations += records.length; });
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    await new Promise(r => setTimeout(r, 360));
    obs.disconnect();
    return { docMutations, toggleDelta: dbg.state.showToggleCount - startToggles, shown: dbg.state.shown };
  }`);
  assert.deepEqual(idleNailong, { docMutations: 0, toggleDelta: 0, shown: true }, 'Nailoong idle animation must not mutate document DOM or toggle shown');

  // 3b. React model-selector re-render stability without [data-testid="model-selector-trigger"]
  const modelRerender = await evalJs(`async () => {
    const host = document.querySelector('[data-ag-pulse-neon-mascot]');
    const dbg = host.__agPulseNailongDebug;
    const startToggles = dbg.state.showToggleCount;
    const left = document.querySelector('.composer .left');
    for (let i = 0; i < 5; i++) {
      const oldBtn = left.querySelector('[data-testid="model-selector-trigger"], button[aria-label^="Select model"]');
      const nextBtn = document.createElement('button');
      nextBtn.setAttribute('role', 'combobox');
      nextBtn.setAttribute('aria-haspopup', 'listbox');
      nextBtn.setAttribute('aria-label', 'Select model, current: Gemini 4 Neon #' + i + (i % 2 ? ', Model cannot be changed while the agent is running' : ''));
      nextBtn.textContent = 'Gemini 4 Neon';
      oldBtn.replaceWith(nextBtn);
      await Promise.resolve();
      await window.__nextFrame();
    }
    return {
      shown: dbg.state.shown,
      stageShown: dbg.state.stageShown,
      toggleDelta: dbg.state.showToggleCount - startToggles,
    };
  }`);
  assert.deepEqual(modelRerender, { shown: true, stageShown: true, toggleDelta: 0 }, 'Replacing Select model button across React re-renders must never bounce Nailoong');

  // 3c. Non-overlapping non-modal [role="dialog"], closed 2.35.0 off-screen drawer [aria-modal="true"][aria-hidden="true"], & Radix/Base-UI [role="tooltip"] must not hide Nailoong
  const nonBlockingPopups = await evalJs(`async () => {
    const host = document.querySelector('[data-ag-pulse-neon-mascot]');
    const dbg = host.__agPulseNailongDebug;
    const actorRect = host.shadowRoot.querySelector('.actor').getBoundingClientRect();
    const startToggles = dbg.state.showToggleCount;
    const sideDialog = document.createElement('div');
    sideDialog.id = 'non-modal-side-dialog';
    sideDialog.setAttribute('role', 'dialog');
    sideDialog.style.cssText = 'position:fixed;left:8px;top:24px;width:260px;height:200px;background:#222;';
    const closedDrawer = document.createElement('div');
    closedDrawer.id = 'closed-235-drawer';
    closedDrawer.setAttribute('role', 'dialog');
    closedDrawer.setAttribute('aria-modal', 'true');
    closedDrawer.setAttribute('aria-hidden', 'true');
    closedDrawer.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:800px;transform:translateX(-100%);pointer-events:none;';
    const radixTip = document.createElement('div');
    radixTip.id = 'radix-hover-tip';
    radixTip.setAttribute('data-radix-popper-content-wrapper', '');
    radixTip.style.cssText = \`position:fixed;left:\${Math.round(actorRect.left)}px;top:\${Math.round(actorRect.top + 16)}px;width:120px;height:32px;\`;
    radixTip.innerHTML = '<div role="tooltip">Toolbar tooltip</div>';
    const baseUiPortal = document.createElement('div');
    baseUiPortal.setAttribute('data-base-ui-portal', '');
    baseUiPortal.innerHTML = \`<div style="position:fixed;left:\${Math.round(actorRect.left)}px;top:\${Math.round(actorRect.top + 24)}px;width:120px;height:28px;"><div role="tooltip">Base UI tooltip</div></div>\`;
    document.body.append(sideDialog, closedDrawer, radixTip, baseUiPortal);
    for (let i = 0; i < 6; i++) {
      window.dispatchEvent(new Event('resize'));
      await window.__nextFrame();
    }
    const res = { shown: dbg.state.shown, toggleDelta: dbg.state.showToggleCount - startToggles };
    sideDialog.remove();
    closedDrawer.remove();
    radixTip.remove();
    baseUiPortal.remove();
    return res;
  }`);
  assert.deepEqual(nonBlockingPopups, { shown: true, toggleDelta: 0 }, 'Non-modal side dialog, closed 2.35.0 drawer, and Radix/Base-UI hover tooltips must not flicker Nailoong');

  // 3d. Overlapping [role="listbox"] / [data-select-popup] hides cleanly with zero oscillation across repeated ticks + transient bounce guard
  const collisionStability = await evalJs(`async () => {
    const host = document.querySelector('[data-ag-pulse-neon-mascot]');
    const dbg = host.__agPulseNailongDebug;
    const actorRect = host.shadowRoot.querySelector('.actor').getBoundingClientRect();
    const startToggles = dbg.state.showToggleCount;
    const listbox = document.createElement('div');
    listbox.id = 'overlap-listbox';
    listbox.setAttribute('role', 'listbox');
    listbox.setAttribute('data-select-popup', '');
    listbox.style.cssText = \`position:fixed;left:\${Math.round(actorRect.left - 8)}px;top:\${Math.round(actorRect.top + 12)}px;width:160px;height:130px;background:#2a2b2f;\`;
    document.body.append(listbox);
    window.dispatchEvent(new Event('resize'));
    await window.__nextFrame();
    await window.__nextFrame();
    const hiddenCleanly = !dbg.state.shown && !dbg.state.stageShown;
    const togglesAfterHide = dbg.state.showToggleCount;
    // Immediate transient 40ms close -> reopen (< 240ms since hide) must be absorbed by unhide cooldown without flashing
    listbox.remove();
    window.dispatchEvent(new Event('resize'));
    await new Promise(r => setTimeout(r, 45));
    document.body.append(listbox);
    window.dispatchEvent(new Event('resize'));
    await new Promise(r => setTimeout(r, 60));
    const absorbedTransientBounce = !dbg.state.shown && dbg.state.showToggleCount === togglesAfterHide;
    for (let i = 0; i < 10; i++) {
      listbox.style.top = \`\${Math.round(actorRect.top + 12 + (i % 2 ? 2 : -2))}px\`;
      window.dispatchEvent(new Event('resize'));
      await window.__nextFrame();
    }
    const zeroOscillationWhileOverlapped = !dbg.state.shown && dbg.state.showToggleCount === togglesAfterHide;
    listbox.remove();
    window.dispatchEvent(new Event('resize'));
    return {
      hiddenCleanly,
      hideIncrement: togglesAfterHide - startToggles,
      zeroOscillationWhileOverlapped,
      absorbedTransientBounce,
    };
  }`);
  assert.deepEqual(collisionStability, {
    hiddenCleanly: true,
    hideIncrement: 1,
    zeroOscillationWhileOverlapped: true,
    absorbedTransientBounce: true,
  });
  await waitUntil(`() => {
    const st = document.querySelector('[data-ag-pulse-neon-mascot]')?.__agPulseNailongDebug?.state;
    return st?.shown === true && st.stageShown === true;
  }`, 'Nailoong smoothly restores after overlapping listbox closes');

  // 3e. Viewport top-threshold hysteresis: jittering composer top across 91..98px while visible must never toggle
  const boundaryHysteresis = await evalJs(`async () => {
    const host = document.querySelector('[data-ag-pulse-neon-mascot]');
    const dbg = host.__agPulseNailongDebug;
    const comp = document.querySelector('.composer');
    const startToggles = dbg.state.showToggleCount;
    for (const topPx of [97, 93, 95, 91, 96, 92, 98, 94]) {
      comp.style.marginTop = topPx + 'px';
      window.dispatchEvent(new Event('resize'));
      await window.__nextFrame();
      await window.__nextFrame();
    }
    const res = { shown: dbg.state.shown, toggleDelta: dbg.state.showToggleCount - startToggles };
    comp.style.marginTop = '160px';
    window.dispatchEvent(new Event('resize'));
    await window.__nextFrame();
    return res;
  }`);
  assert.deepEqual(boundaryHysteresis, { shown: true, toggleDelta: 0 }, 'Composer top jitter inside hysteresis deadband must never toggle Nailoong');

  // 3f. Unready / evicted atlas source retains last painted frame (zero blank-canvas flash)
  const frameRetention = await evalJs(`async () => {
    const host = document.querySelector('[data-ag-pulse-neon-mascot]');
    const dbg = host.__agPulseNailongDebug;
    const cv = host.shadowRoot.querySelector('.rig-canvas');
    const countOpaque = () => {
      const data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 3; i < data.length; i += 16) if (data[i] > 16) n++;
      return n;
    };
    const beforePixels = countOpaque();
    const skippedBefore = dbg.state.skippedUnreadyCount;
    const waveMeta = dbg.atlases.wave;
    const savedImg = waveMeta.img;
    waveMeta.img = new Image(); // incomplete, 0x0 unready image
    let minPixelsDuringUnready = Infinity;
    for (let i = 0; i < 6; i++) {
      dbg.stepFrame(0.08);
      await window.__nextFrame();
      minPixelsDuringUnready = Math.min(minPixelsDuringUnready, countOpaque());
    }
    const skippedDelta = dbg.state.skippedUnreadyCount - skippedBefore;
    const paintsBeforeRestore = dbg.state.paintCount;
    waveMeta.img = savedImg;
    dbg.stepFrame(0.08);
    await window.__nextFrame();
    const paintsAfterRestore = dbg.state.paintCount;
    return {
      beforePixels,
      minPixelsDuringUnready,
      skippedDelta,
      resumedPainting: paintsAfterRestore > paintsBeforeRestore,
    };
  }`);
  assert.ok(frameRetention.beforePixels > 200, 'Canvas should have Nailoong pixels before unready test');
  assert.equal(frameRetention.minPixelsDuringUnready, frameRetention.beforePixels, 'Canvas must retain exact painted frame without flashing blank while atlas is unready');
  assert.ok(frameRetention.skippedDelta >= 1, 'Unready atlas ticks should increment skippedUnreadyCount');
  assert.equal(frameRetention.resumedPainting, true, 'Canvas animation must resume advancing once atlas source is ready again');

  // 3g. Rim-Patrol Walk (position() -> ensureLoop() inside tickAnimation) must NEVER fork-bomb rAF or speed up playback > 1x
  const patrolLoopCheck = await evalJs(`async () => {
    const host = document.querySelector('[data-ag-pulse-neon-mascot]');
    const dbg = host.__agPulseNailongDebug;
    const patrolBtn = host.shadowRoot.querySelectorAll('.menu .m-btn')[3];
    patrolBtn.click();
    await window.__nextFrame();
    const startedWalking = dbg.state.walking;
    const ticks0 = dbg.state.tickCount;
    let walkVsyncs = 0, countingWalk = true;
    const countWalk = () => { if (!countingWalk) return; walkVsyncs++; requestAnimationFrame(countWalk); };
    requestAnimationFrame(countWalk);
    await new Promise(r => setTimeout(r, 420));
    countingWalk = false;
    const walkTickDelta = dbg.state.tickCount - ticks0;
    const midWalkX = dbg.state.walkX;
    // Switch to eat action (cancels walk cleanly) and verify 1x steady cadence afterward
    const eatBtn = host.shadowRoot.querySelectorAll('.menu .m-btn')[0];
    eatBtn.click();
    await window.__nextFrame();
    const ticks1 = dbg.state.tickCount;
    const paints1 = dbg.state.paintCount;
    const startFrameIdx = Number((dbg.state.lastPaintSig || '').split('|')[1] || 0);
    let postVsyncs = 0, countingPost = true;
    const countPost = () => { if (!countingPost) return; postVsyncs++; requestAnimationFrame(countPost); };
    requestAnimationFrame(countPost);
    await new Promise(r => setTimeout(r, 500));
    countingPost = false;
    const postTickDelta = dbg.state.tickCount - ticks1;
    const postPaintDelta = dbg.state.paintCount - paints1;
    const endFrameIdx = Number((dbg.state.lastPaintSig || '').split('|')[1] || 0);
    const frameAdvance = (endFrameIdx - startFrameIdx + 64) % 64;
    return {
      startedWalking,
      walkVsyncs,
      walkTickDelta,
      midWalkX,
      postVsyncs,
      postTickDelta,
      postPaintDelta,
      frameAdvance,
    };
  }`);
  assert.equal(patrolLoopCheck.startedWalking, true, 'Patrol action should start rim-patrol walking');
  assert.ok(patrolLoopCheck.walkTickDelta <= patrolLoopCheck.walkVsyncs + 2, `Rim-patrol must run at most 1 tickAnimation per VSync (got ${patrolLoopCheck.walkTickDelta} ticks in ${patrolLoopCheck.walkVsyncs} VSyncs)`);
  if (patrolLoopCheck.walkVsyncs >= 4) {
    assert.ok(patrolLoopCheck.midWalkX < 0 && patrolLoopCheck.midWalkX > -95, `Rim-patrol should walk smoothly at 86px/s, got ${patrolLoopCheck.midWalkX}`);
  }
  assert.ok(patrolLoopCheck.postTickDelta <= patrolLoopCheck.postVsyncs + 2, `Post-patrol animation must retain single rAF loop (got ${patrolLoopCheck.postTickDelta} ticks in ${patrolLoopCheck.postVsyncs} VSyncs)`);
  assert.ok(patrolLoopCheck.postPaintDelta <= patrolLoopCheck.postVsyncs + 2 && patrolLoopCheck.frameAdvance <= 16, `Post-patrol clip must play at 1x ~17fps, got paintDelta=${patrolLoopCheck.postPaintDelta}, frameAdvance=${patrolLoopCheck.frameAdvance}`);

  // 3h. Composer-dock queued-message buttons auto-avoidance + free horizontal rim drag persistence
  const dockAvoidAndDrag = await evalJs(`async () => {
    const host = document.querySelector('[data-ag-pulse-neon-mascot]');
    const dbg = host.__agPulseNailongDebug;
    const actor = host.shadowRoot.querySelector('.actor');
    const comp = document.querySelector('.composer');
    // Wrap composer in a 2.35+ non-scrolling composer dock container with a sibling queued-message slot above it
    const dock = document.createElement('div');
    dock.className = 'composer-dock-test';
    dock.style.cssText = 'display:flex;flex-direction:column;width:100%;margin-top:160px;';
    comp.style.marginTop = '0px';
    comp.parentElement.insertBefore(dock, comp);
    const queueSlot = document.createElement('div');
    queueSlot.style.cssText = 'display:none;margin-bottom:8px;';
    dock.append(queueSlot, comp);
    window.dispatchEvent(new Event('resize'));
    await window.__nextFrame();
    await window.__nextFrame();

    const initialLeft = parseFloat(dbg.state.stageLeft);
    const initialAvoided = dbg.state.autoAvoided;

    // Mount a queued-message bar right above composer with Edit & Delete buttons on the right
    queueSlot.style.cssText = 'display:flex;align-items:center;justify-content:space-between;width:844px;box-sizing:border-box;height:44px;padding:0 12px;margin:0 auto 8px;border-radius:12px;border:1px solid #ccc;background:#fff;';
    queueSlot.innerHTML = '<span>Queued prompt text</span><div style="display:flex;gap:6px;"><button id="q-edit" type="button" style="width:28px;height:28px;">✏️</button><button id="q-del" type="button" style="width:28px;height:28px;">🗑️</button></div>';
    await window.__nextFrame();
    await window.__nextFrame();

    const editBtn = document.getElementById('q-edit');
    const editRect = editBtn.getBoundingClientRect();
    const actorRect = actor.getBoundingClientRect();
    const hitEl = document.elementFromPoint(editRect.left + editRect.width / 2, editRect.top + editRect.height / 2);
    const avoidedState = {
      shown: dbg.state.shown,
      autoAvoided: dbg.state.autoAvoided,
      avoidedLeft: parseFloat(dbg.state.stageLeft),
      actorRight: actorRect.right,
      editLeft: editRect.left,
      editUnblocked: hitEl === editBtn || editBtn.contains(hitEl),
    };

    // Clear queued message -> Nailoong returns to home right corner
    queueSlot.innerHTML = '';
    queueSlot.style.display = 'none';
    await window.__nextFrame();
    await window.__nextFrame();
    const restoredLeft = parseFloat(dbg.state.stageLeft);
    const restoredAvoided = dbg.state.autoAvoided;

    // Drag Nailoong horizontally 180px left along the composer rim and verify persistence
    const ar = actor.getBoundingClientRect();
    const sx = ar.left + ar.width / 2, sy = ar.top + ar.height / 2;
    actor.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: sx, clientY: sy, pointerId: 1, bubbles: true }));
    actor.dispatchEvent(new PointerEvent('pointermove', { button: 0, clientX: sx - 20, clientY: sy + 1, pointerId: 1, bubbles: true }));
    actor.dispatchEvent(new PointerEvent('pointermove', { button: 0, clientX: sx - 180, clientY: sy + 2, pointerId: 1, bubbles: true }));
    actor.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientX: sx - 180, clientY: sy + 2, pointerId: 1, bubbles: true }));
    await window.__nextFrame();

    const draggedLeft = parseFloat(dbg.state.stageLeft);
    const savedRx = localStorage.getItem('ag-pulse-nailong-v3-rx');
    return {
      initialLeft,
      initialAvoided,
      avoidedState,
      restoredLeft,
      restoredAvoided,
      draggedLeft,
      savedRx,
    };
  }`);
  assert.equal(dockAvoidAndDrag.initialAvoided, false, 'Nailoong starts un-avoided when no dock buttons exist above composer');
  assert.equal(dockAvoidAndDrag.avoidedState.shown, true, 'Nailoong stays visible by stepping aside when room exists on composer rim');
  assert.equal(dockAvoidAndDrag.avoidedState.autoAvoided, true, 'Nailoong enters autoAvoided mode when queued-message buttons appear above composer');
  assert.ok(dockAvoidAndDrag.avoidedState.actorRight <= dockAvoidAndDrag.avoidedState.editLeft - 4, `Nailoong actor (${dockAvoidAndDrag.avoidedState.actorRight}) must step left of queued Edit button (${dockAvoidAndDrag.avoidedState.editLeft})`);
  assert.equal(dockAvoidAndDrag.avoidedState.editUnblocked, true, 'Queued-message Edit button must be 100% unblocked for clicks');
  assert.equal(dockAvoidAndDrag.restoredAvoided, false, 'Nailoong clears autoAvoided once queued message disappears');
  assert.equal(dockAvoidAndDrag.restoredLeft, dockAvoidAndDrag.initialLeft, 'Nailoong returns to home rim position after queued message clears');
  assert.ok(Math.abs((dockAvoidAndDrag.initialLeft - dockAvoidAndDrag.draggedLeft) - 180) <= 6, `Horizontal rim drag should shift Nailoong ~180px left (from ${dockAvoidAndDrag.initialLeft} to ${dockAvoidAndDrag.draggedLeft})`);
  assert.ok(Number(dockAvoidAndDrag.savedRx) > 0.1, `Horizontal rim drag must persist ag-pulse-nailong-v3-rx in localStorage (got ${dockAvoidAndDrag.savedRx})`);
  } finally {
    try { cdp?.close(); } catch {}
    killBrowser(child);
    if (server) {
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(() => resolve()));
    }
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
});
