// End-to-end headless Chromium/Edge CDP regression for Issue #20 (manual
// minimal/full strip toggle + narrow compression compatibility) and Issue #21
// (cost-space estimatedFullUsd display in usage-ui). Zero external dependencies.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { accessSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CdpConnection } from '../compat/runtime-ui.mjs';
import { trajectoryMetrics } from '../sidecars/panel/metrics.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const extract = s => s.slice(s.indexOf('module.exports = ') + 17).trim().replace(/;$/, '');
const SCREENSHOT_DIR = process.env.AG_PULSE_STRIP_SCREENSHOTS || null;

function findBrowser() {
  const candidates = [
    process.env.AG_EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  for (const file of candidates) {
    try { accessSync(file); return file; } catch {}
  }
  return null;
}

const BROWSER_EXE = findBrowser();
if (!BROWSER_EXE) {
  console.log('SKIP: No Chromium/Edge executable found');
  process.exit(0);
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

async function launchBrowser(userDataDir, url) {
  const child = spawn(BROWSER_EXE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`, url,
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  child.unref();
  let cdp = null;
  try {
    const port = await new Promise((resolve, reject) => {
      let errText = '';
      const cleanup = () => { child.stderr?.removeAllListeners('data'); try { child.stderr?.destroy(); } catch {} };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Browser start timeout: ' + errText)); }, 30000);
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => {
        errText += chunk;
        const m = errText.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
        if (m) { clearTimeout(timer); cleanup(); resolve(Number(m[1])); }
      });
      child.once('exit', code => { clearTimeout(timer); cleanup(); reject(new Error('Browser exited ' + code)); });
    });
    let target;
    for (let i = 0; i < 150; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find(t => t.type === 'page' && t.url.startsWith('http://127.0.0.1'));
        if (target) break;
      } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    if (!target) throw new Error('Page target not found');
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

const [i18nSrc, themeSrc, pricingSrc, usageSrc, updateSrc, widgetSrc, ideSurfaceSrc] = await Promise.all(
  ['compat/i18n.cjs', 'compat/theme.cjs', 'compat/pricing.cjs', 'compat/usage-ui.cjs', 'compat/update-ui.cjs', 'compat/inline-widget.cjs', 'ide/surface.cjs'].map(p => readFile(join(REPO, p), 'utf8'))
);

const id = '11111111-1111-1111-1111-111111111111';
const emptyId = '22222222-2222-2222-2222-222222222222';
const reset5h = new Date(Date.now() + 3 * 3600000).toISOString();
const resetWk = new Date(Date.now() + 5 * 86400000).toISOString();

const fullSpeed = trajectoryMetrics({
  trajectory: {
    cascadeId: id,
    steps: [{ type: 'USER_INPUT' }],
    generatorMetadata: [{
      chatModel: {
        modelDisplayName: 'Gemini 4 Neon (Extra High)',
        chatStartMetadata: { contextWindowMetadata: { estimatedTokensUsed: 470000, maxContextTokens: 1000000 } },
        usage: { messageId: 'm1', inputTokens: '3334500', cacheReadTokens: '31765500', outputTokens: '88000', responseOutputTokens: '88000', apiProvider: 'API_PROVIDER_GOOGLE_GEMINI' },
        streamingDuration: '2s',
      },
    }],
  },
});

const usageFixture = {
  accountKey: 'fixture',
  scope: 'local',
  pricing: { exchangeRate: 7.2 },
  today: '2026-11-24',
  timeZone: 'Asia/Shanghai',
  models: ['Gemini 4 Hydrogen', 'Gemini 4 Neon'],
  days: [
    { date: '2026-11-20', models: { 'Gemini 4 Hydrogen': { uncached: 4_000_000, cacheRead: 38_000_000, cacheWrite: 0, output: 1_170_000, total: 43_170_000, requests: 55 } } },
    { date: '2026-11-24', models: { 'Gemini 4 Neon': { uncached: 2_500_000, cacheRead: 27_400_000, cacheWrite: 0, output: 660_000, total: 30_560_000, requests: 65 } } },
  ],
  todayTokens: 30_560_000,
  weekTokens: 73_730_000,
  monthTokens: 73_730_000,
  totalTokens: 73_730_000,
  requests: 120,
  firstDate: '2026-11-20',
  syncing: false,
  quotaWindows: {
    'gemini:5h': { observedTokens: 12_000_000, observedCostUsd: 6.4, estimatedFullUsd: 25.0, estimatedFullTokens: 42_000_000, requests: 20, usedFraction: 0.25 },
    'gemini:weekly': { observedTokens: 73_730_000, observedCostUsd: 43.53, estimatedFullUsd: 97.50, estimatedFullTokens: 163_865_546, requests: 120, usedFraction: 0.4457 },
  },
};

const html = `<!doctype html>
<html data-theme="light">
<head>
<meta charset="utf-8">
<style>
  body{margin:0;padding:40px 28px;background:#f7f7f8;color:#18191b;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}
  html[data-theme="dark"] body{background:#16171a;color:#eceef2}
  .composer{box-sizing:border-box;width:820px;max-width:100%;margin:260px auto 0;padding:12px 14px 10px;border-radius:18px;background:#ffffff;border:1px solid #e4e5e8;box-shadow:0 2px 10px rgba(0,0,0,.04)}
  html[data-theme="dark"] .composer{background:#212226;border-color:#34363c;box-shadow:0 2px 12px rgba(0,0,0,.25)}
  .editor{height:44px;color:#71757e;font-size:14px;outline:none}
  .actions{display:flex;align-items:center;gap:6px;height:32px;position:relative}
  .left{display:flex;align-items:center;gap:4px;flex:1 1 auto;min-width:0;overflow:hidden}
  .right{display:flex;align-items:center;gap:6px;flex:none}
  button{font:inherit;border:0;color:inherit;background:transparent;height:28px;border-radius:8px;white-space:nowrap;cursor:pointer;display:inline-flex;align-items:center;gap:4px}
  .protected{flex:none;padding:0 6px}
  .send{width:28px;height:28px;justify-content:center;border-radius:999px;background:#18191b;color:#fff;padding:0}
  html[data-theme="dark"] .send{background:#eceef2;color:#16171a}
  .model{min-width:0;overflow:hidden;text-overflow:ellipsis;padding:0 6px;color:inherit;font-size:13px}
</style>
</head>
<body>
<section class="composer" data-testid="agent-input-box">
  <div class="editor" contenteditable="true" role="combobox" aria-label="Message input">Ask anything, @ to mention, / for actions</div>
  <div class="actions">
    <div class="left">
      <button class="protected" aria-label="Add context">＋</button>
      <button class="model" data-testid="model-selector-trigger">Gemini 4 Neon Extra High ⌄</button>
    </div>
    <div class="right">
      <button class="protected">Turbo ⌄</button>
      <button class="protected" aria-label="Voice">🎤</button>
      <button class="protected send" data-testid="send-button">↑</button>
    </div>
  </div>
</section>
<script>
  history.replaceState({}, '', '/c/${id}');
  window.testPrefs = { language: 'zh-CN', languageGuideDismissed: true, usageGuideDismissed: true, speedStyle: 'minimal', revision: 1 };
  window.testPrefWrites = [];
  window.testEmpty = false;
  window.testMetrics = {
    connection: 'live',
    groups: [{ id: 'gemini', name: 'Gemini', windows: { '5h': { available: true, remaining: 0.75, resetAt: '${reset5h}' }, weekly: { available: true, remaining: 0.5543, resetAt: '${resetWk}' } } }],
    quotaUpdatedAt: new Date().toISOString(),
    speed: ${JSON.stringify(fullSpeed)},
    usage: ${JSON.stringify(usageFixture)},
  };
  window.agPulseHost = {
    getMetrics: async input => ({
      ...window.testMetrics,
      speed: window.testEmpty || !input.conversationId ? null : window.testMetrics.speed,
      preferences: { ...window.testPrefs },
    }),
    getPreferences: async () => ({ ...window.testPrefs }),
    setPreferences: async input => {
      window.testPrefWrites.push(input);
      window.testPrefs = { ...window.testPrefs, ...input, revision: window.testPrefs.revision + 1 };
      return { ...window.testPrefs };
    },
    updatePlugin: async () => ({ state: 'current', currentVersion: '0.9.16', latestVersion: '0.9.16' }),
    report: () => {},
  };
  window.__agPulseI18nFactory = (${extract(i18nSrc)});
  window.__agPulseThemeFactory = (${extract(themeSrc)});
  window.__agPulsePricingFactory = (${extract(pricingSrc)});
  window.__agPulseUsageFactory = (${extract(usageSrc)});
  window.__agPulseUpdateFactory = (${extract(updateSrc)});
  window.__agPulseIdeSurfaceFactory = (${extract(ideSurfaceSrc)});
  window.__installWidget = () => (${extract(widgetSrc)})();
  window.__installWidget();
</script>
</body>
</html>`;

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const userDataDir = await mkdtemp(join(tmpdir(), 'ag-strip-collapse-'));
let child = null, cdp = null;
const errors = [];

try {
  ({ child, cdp } = await launchBrowser(userDataDir, `http://127.0.0.1:${server.address().port}/`));
  cdp.onEvent = msg => {
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params?.exceptionDetails?.text || 'exception');
  };
  await cdp.command('Emulation.setDeviceMetricsOverride', { width: 1000, height: 640, deviceScaleFactor: 2, mobile: false });

  const evalJs = async fn => {
    const res = await cdp.command('Runtime.evaluate', { expression: `(${fn})()`, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error('Eval failed: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
    return res.result?.value;
  };
  const waitUntil = async (fn, label, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evalJs(fn)) return;
      await new Promise(r => setTimeout(r, 40));
    }
    throw new Error('Timed out waiting for: ' + label);
  };
  const shot = async (name, clip = null) => {
    if (!SCREENSHOT_DIR) return;
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    const params = { format: 'png' };
    if (clip) params.clip = { ...clip, scale: 2 };
    const { data } = await cdp.command('Page.captureScreenshot', params);
    await writeFile(join(SCREENSHOT_DIR, name), Buffer.from(data, 'base64'));
  };
  const inspect = () => evalJs(`() => {
    const w = document.getElementById('ag-pulse-status-bar');
    if (!w) return null;
    const sr = w.shadowRoot, bar = sr.querySelector('.bar');
    const vis = el => Boolean(el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none');
    const r = w.getBoundingClientRect();
    const toggle = sr.getElementById('strip-toggle');
    const card = sr.getElementById('context-card');
    const footer = card?.querySelector('.card-language');
    const nativeSafe = [...document.querySelectorAll('.protected')].every(b => {
      const q = b.getBoundingClientRect();
      const hit = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2);
      return hit === b || b.contains(hit);
    });
    return {
      density: w.dataset.density,
      layout: w.dataset.layout,
      stripMode: w.dataset.stripMode,
      width: Math.round(r.width),
      barOverflow: bar.scrollWidth - bar.clientWidth,
      toggleVisible: vis(toggle),
      toggleExpanded: toggle?.getAttribute('aria-expanded'),
      speedVisible: vis(sr.querySelector('[data-card="speed"]')),
      cacheVisible: vis(sr.querySelector('[data-card="cache"]')),
      ctxVisible: vis(sr.querySelector('[data-card="context"]')),
      ctxLabelVisible: vis(sr.querySelector('.context-label')),
      ctxPctVisible: vis(sr.getElementById('context-percent')),
      ctxPctText: sr.getElementById('context-percent')?.textContent,
      ctxCardVisible: Boolean(card && !card.hidden),
      ctxCardOverflowY: card ? card.scrollHeight - card.clientHeight : 0,
      footerHeight: footer ? Math.round(footer.getBoundingClientRect().height) : 0,
      footerOverflowX: footer ? footer.scrollWidth - footer.clientWidth : 0,
      nativeSafe,
      prefWrites: window.testPrefWrites.slice(),
      localCache: localStorage.getItem('ag-pulse-strip-mode'),
    };
  }`);

  // 1. Default wide state -> full mode with subtle collapse chevron
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar')?.shadowRoot?.getElementById('context-percent')?.textContent === '47%' && document.getElementById('ag-pulse-status-bar')?.dataset.density === 'full'`, 'initial full render');
  await new Promise(r => setTimeout(r, 320));
  const fullState = await inspect();
  assert.equal(fullState.density, 'full');
  assert.equal(fullState.stripMode, 'full');
  assert.equal(fullState.toggleVisible, true);
  assert.equal(fullState.toggleExpanded, 'true');
  assert.equal(fullState.speedVisible, true);
  assert.equal(fullState.cacheVisible, true);
  assert.equal(fullState.ctxLabelVisible, true);
  assert.equal(fullState.nativeSafe, true);
  assert.ok(fullState.barOverflow <= 1, 'no bar overflow in full mode');

  const composerClip = await evalJs(`() => {
    const r = document.querySelector('.composer').getBoundingClientRect();
    return { x: Math.max(0, r.x - 16), y: Math.max(0, r.y - 16), width: r.width + 32, height: r.height + 32 };
  }`);
  await shot('01-full-light.png', composerClip);

  // 2. One-click collapse via #strip-toggle -> minimal mode (< ○ 47%)
  await evalJs(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('strip-toggle').click()`);
  await waitUntil(`() => { const w = document.getElementById('ag-pulse-status-bar'); return w?.dataset.density === 'minimal' && !w.dataset.motion; }`, 'minimal fold settle');
  const minState = await inspect();
  assert.equal(minState.density, 'minimal');
  assert.equal(minState.stripMode, 'minimal');
  assert.equal(minState.toggleVisible, true);
  assert.equal(minState.toggleExpanded, 'false');
  assert.equal(minState.speedVisible, false);
  assert.equal(minState.cacheVisible, false);
  assert.equal(minState.ctxLabelVisible, false);
  assert.equal(minState.ctxVisible, true);
  assert.equal(minState.ctxPctVisible, true);
  assert.equal(minState.ctxPctText, '47%');
  assert.ok(minState.width <= 80, `minimal strip should stay ultra-compact, got ${minState.width}px`);
  assert.equal(minState.localCache, 'minimal');
  assert.deepEqual(minState.prefWrites.at(-1), { stripMode: 'minimal' });
  await shot('02-minimal-light.png', composerClip);

  // 3. Context card still opens cleanly in minimal mode and footer toggle stays single-row with no overflow
  await evalJs(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.querySelector('[data-card="context"]').click()`);
  await waitUntil(`() => !document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('context-card').hidden`, 'context card opens');
  await new Promise(r => setTimeout(r, 120));
  const cardState = await inspect();
  assert.equal(cardState.ctxCardVisible, true);
  assert.ok(cardState.ctxCardOverflowY <= 1, `context card should not overflow vertically: ${cardState.ctxCardOverflowY}`);
  assert.ok(cardState.footerOverflowX <= 1, `context footer should fit cleanly on one row: ${cardState.footerOverflowX}`);
  assert.ok(cardState.footerHeight <= 40, `context footer stays single-row: ${cardState.footerHeight}px`);
  await shot('03-minimal-card-light.png');

  // Switch back to full from inside context card: card stays open and tracks ring!
  await evalJs(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('strip-mode-full').click()`);
  await waitUntil(`() => { const w = document.getElementById('ag-pulse-status-bar'); return w?.dataset.density === 'full' && !w.dataset.motion; }`, 'expand from context card');
  assert.equal((await inspect()).ctxCardVisible, true, 'context card remains open when toggling strip mode from footer');

  // Verify Issue #21 & #26: Usage dashboard directly uses cost-space estimatedFullUsd ($97.50)
  // and keeps weekly fullTokens aligned with quotaWindows.estimatedFullTokens (163.9M, not 7-day days rate 183.7M)
  await evalJs(`() => {
    const sr = document.getElementById('ag-pulse-status-bar').shadowRoot;
    sr.querySelector('[data-card="cache"]').click();
    sr.getElementById('open-usage').click();
  }`);
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard')?.open === true`, 'usage dashboard open');
  const kpiEst = await evalJs(`() => {
    const sr = document.getElementById('ag-pulse-status-bar').shadowRoot;
    const vs = sr.getElementById('usage-dashboard').firstElementChild.shadowRoot;
    const card = vs.querySelector('.metric-est');
    return {
      val: card?.querySelector('.value')?.textContent,
      cny: card?.querySelector('.metric-sub')?.textContent,
      title: card?.title,
      stripWeekUsage: sr.getElementById('week-usage-value')?.textContent,
    };
  }`);
  assert.equal(kpiEst.val, '≈$97.50USD', `Usage dashboard should show direct cost-space $97.50, got ${kpiEst.val}`);
  assert.equal(kpiEst.cny, '≈¥702.00', 'Weekly CNY cost must use the supplied exchange rate');
  assert.ok(kpiEst.title.includes('等效 API 成本'), `Tooltip should note cost-space basis: ${kpiEst.title}`);
  assert.ok(kpiEst.title.includes('满额约 163.9M Token'), `Overview tooltip fullTokens must match quotaWindows.estimatedFullTokens (163.9M): ${kpiEst.title}`);
  assert.ok(kpiEst.stripWeekUsage.includes('约 163.9M 满额'), `Inline strip weekly full ref must match 163.9M: ${kpiEst.stripWeekUsage}`);
  const weeklyCard = "document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot.querySelector('.metric-est')";
  await evalJs(`() => { window.testMetrics.usage.quotaWindows['gemini:weekly'].usedFraction = 0.5; }`);
  await waitUntil(`() => ${weeklyCard}.title.includes('已用 50%')`, 'weekly usage-only change');
  await evalJs(`() => { window.testMetrics.usage.quotaWindows['gemini:weekly'].estimatedFullUsd = 100; }`);
  await waitUntil(`() => ${weeklyCard}.querySelector('.metric-sub').textContent === '≈¥720.00'`, 'weekly cost-only change');
  await evalJs(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot.getElementById('close').click()`);

  // 4. Re-collapse to minimal & test dark theme visual
  await evalJs(`() => {
    document.documentElement.dataset.theme = 'dark';
    document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('strip-toggle').click();
  }`);
  await waitUntil(`() => { const w = document.getElementById('ag-pulse-status-bar'); return w?.dataset.density === 'minimal' && !w.dataset.motion; }`, 'minimal dark settle');
  await new Promise(r => setTimeout(r, 150));
  await shot('04-minimal-dark.png', composerClip);

  // 5. Reinstall persistence: starts straight in minimal mode (no flash of full)
  await evalJs(`() => { window.__agPulseDispose(); window.__installWidget(); }`);
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar')?.shadowRoot?.getElementById('context-percent')?.textContent === '47%'`, 'remounted minimal');
  assert.equal((await inspect()).density, 'minimal');

  // 6. Composer compression cascade while in minimal mode!
  //    minimal (< ○ 47%) -> minimal-tight (○ 47%) -> minimal-icon (○) -> blocked (0px) -> recover minimal!
  await evalJs(`() => { const w = document.getElementById('ag-pulse-status-bar'); w.style.flex = '0 0 54px'; w.style.maxWidth = '54px'; }`);
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar')?.dataset.density === 'minimal-tight'`, 'compress to minimal-tight');
  const tightState = await inspect();
  assert.equal(tightState.layout, 'ready');
  assert.equal(tightState.toggleVisible, false, 'toggle chevron hides when compressed to minimal-tight');
  assert.equal(tightState.ctxPctVisible, true, '47% stays visible in minimal-tight');
  assert.equal(tightState.nativeSafe, true);

  await evalJs(`() => { const w = document.getElementById('ag-pulse-status-bar'); w.style.flex = '0 0 30px'; w.style.maxWidth = '30px'; }`);
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar')?.dataset.density === 'minimal-icon'`, 'compress to minimal-icon');
  const iconState = await inspect();
  assert.equal(iconState.layout, 'ready');
  assert.equal(iconState.toggleVisible, false);
  assert.equal(iconState.ctxPctVisible, false);
  assert.equal(iconState.ctxVisible, true);
  assert.equal(iconState.nativeSafe, true);
  // Context card STILL opens when clicking bare 24px context ring!
  await evalJs(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.querySelector('[data-card="context"]').click()`);
  await waitUntil(`() => !document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('context-card').hidden`, 'card opens in minimal-icon');
  await evalJs(`() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

  await evalJs(`() => { const w = document.getElementById('ag-pulse-status-bar'); w.style.flex = '0 0 14px'; w.style.maxWidth = '14px'; }`);
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar')?.dataset.layout === 'blocked'`, 'crushed minimal goes blocked');
  assert.equal((await inspect()).nativeSafe, true);

  // Restore room -> recovers to minimal (< ○ 47%), NOT full!
  await evalJs(`() => { const w = document.getElementById('ag-pulse-status-bar'); w.style.flex = '0 1 auto'; w.style.maxWidth = '100%'; }`);
  await waitUntil(`() => { const w = document.getElementById('ag-pulse-status-bar'); return w?.dataset.layout === 'ready' && w.dataset.density === 'minimal' && !w.dataset.motion; }`, 'recover minimal');
  assert.equal((await inspect()).stripMode, 'minimal');

  // 7. Empty conversation while in minimal mode: hides dash, stays minimal when data arrives (no unwanted spring expand!)
  await evalJs(`() => { window.testEmpty = true; history.pushState({}, '', '/c/${emptyId}'); }`);
  await waitUntil(`() => { const w = document.getElementById('ag-pulse-status-bar'); return w?.classList.contains('minimal-empty') && w.dataset.density === 'minimal'; }`, 'empty minimal hides dash');
  const emptyMin = await inspect();
  assert.equal(emptyMin.ctxPctVisible, false, 'empty minimal hides dash placeholder');
  assert.equal(emptyMin.toggleVisible, true);
  assert.equal(emptyMin.ctxVisible, true);
  // First reply arrives -> reveals 47% while STAYING in minimal mode (never expands into full!)
  await evalJs(`() => { window.testEmpty = false; history.pushState({}, '', '/c/${id}'); }`);
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar')?.shadowRoot?.getElementById('context-percent')?.textContent === '47%'`, 'data arrives in minimal');
  await new Promise(r => setTimeout(r, 150));
  const afterData = await inspect();
  assert.equal(afterData.density, 'minimal', 'first reply must respect manual minimal mode instead of expanding to full');
  assert.equal(afterData.ctxPctVisible, true);
  assert.equal(afterData.speedVisible, false);

  // 8. Narrow auto-icons-only in full mode -> switch to minimal from context card -> expand back
  await evalJs(`() => document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('strip-toggle').click()`);
  await waitUntil(`() => { const w = document.getElementById('ag-pulse-status-bar'); return w?.dataset.density === 'full' && !w.dataset.motion; }`, 'back to full');
  await evalJs(`() => { const w = document.getElementById('ag-pulse-status-bar'); w.style.flex = '0 0 80px'; w.style.maxWidth = '80px'; }`);
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar')?.dataset.density === 'icons'`, 'narrow full drops to 3 icons');
  const iconsState = await inspect();
  assert.equal(iconsState.layout, 'ready');
  assert.equal(iconsState.toggleVisible, false, 'auto icons-only keeps 76px budget by hiding chevron');
  assert.equal(iconsState.speedVisible, true);
  assert.equal(iconsState.cacheVisible, true);
  assert.equal(iconsState.ctxVisible, true);
  // Switch to minimal from inside context card even while narrow (80px)!
  await evalJs(`() => {
    const sr = document.getElementById('ag-pulse-status-bar').shadowRoot;
    sr.querySelector('[data-card="context"]').click();
    sr.getElementById('strip-mode-minimal').click();
  }`);
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar')?.dataset.density === 'minimal'`, 'minimal fits inside 80px narrow slot');
  const narrowMin = await inspect();
  assert.equal(narrowMin.layout, 'ready');
  assert.equal(narrowMin.ctxPctVisible, true, 'minimal (< ○ 47%) fits even where full had to collapse to 3 icons');

  // 9. Subagent narrow-pane compression: native-no-room uses 24px budget in minimal mode
  //    (instead of 76px in full mode), so minimal stays alive down to tight widths without
  //    ever wrapping or shrinking the native subagent badge.
  await evalJs(`() => {
    window.__agPulseDispose();
    document.querySelector('.composer').innerHTML =
      '<div class="editor" contenteditable="true" role="textbox"></div>' +
      '<div class="actions"><div class="left"><button class="protected">＋</button>' +
      '<div class="identity" style="display:flex;align-items:center;gap:4px;font-size:12px;padding:4px 8px;white-space:normal;min-width:0">' +
      '<svg viewBox="0 0 16 16" style="width:14px;height:14px;flex-shrink:1"><circle cx="8" cy="8" r="6"/></svg>' +
      '<span>layout-worker</span></div></div>' +
      '<div class="right"><button class="protected" data-testid="send-button">↑</button></div></div>';
    document.querySelector('.composer').style.width = '280px';
    window.__installWidget();
  }`);
  await waitUntil(`() => document.getElementById('ag-pulse-status-bar')?.dataset.scope === 'subagent' && document.getElementById('ag-pulse-status-bar')?.shadowRoot?.getElementById('context-percent')?.textContent === '47%'`, 'subagent minimal mounted');
  // Compress subagent composer so remaining room is ~52px (< 76px full/icons threshold, >= 24px minimal threshold)
  const subMinimalTight = await evalJs(`async () => {
    const comp = document.querySelector('.composer');
    const w = document.getElementById('ag-pulse-status-bar');
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    let observed = null;
    for (let px = 280; px >= 160; px -= 12) {
      comp.style.width = px + 'px';
      await frame();
      const badge = document.querySelector('.identity');
      const range = document.createRange();
      range.selectNodeContents(badge.querySelector('span'));
      const lines = new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top))).size;
      const iconW = badge.querySelector('svg').getBoundingClientRect().width;
      const room = parseInt(w.style.getPropertyValue('--pulse-native-room') || '999', 10);
      if (lines !== 1 || iconW < 13.5) throw new Error('Subagent native badge deformed at ' + px + 'px: lines=' + lines + ' iconW=' + iconW);
      if (room >= 24 && room < 76 && w.dataset.layout === 'ready') {
        observed = { px, room, density: w.dataset.density, width: Math.round(w.getBoundingClientRect().width) };
      }
      if (room < 24 && w.dataset.layout === 'blocked' && Math.round(w.getBoundingClientRect().width) === 0) {
        return { observed, blockedAt: { px, room } };
      }
    }
    return { observed, blockedAt: null };
  }`);
  assert.ok(subMinimalTight.observed, 'minimal subagent stays visible when room is between 24px and 76px: ' + JSON.stringify(subMinimalTight));
  assert.ok(subMinimalTight.blockedAt, 'crushed minimal subagent (< 24px) releases 100% space back to host: ' + JSON.stringify(subMinimalTight));

  assert.deepEqual(errors, [], 'zero page exceptions: ' + JSON.stringify(errors));
  console.log(JSON.stringify({
    passed: true,
    fullWidth: fullState.width,
    minimalWidth: minState.width,
    compressionCascade: ['minimal', 'minimal-tight', 'minimal-icon', 'blocked', 'minimal'],
    subagentNarrowMinimal: subMinimalTight,
    emptyMinimalStaysMinimal: true,
    narrowIconsToMinimalViaCard: true,
    costSpaceKpi: kpiEst.val,
    weeklyCny: kpiEst.cny,
    pageErrors: errors,
  }, null, 2));
} finally {
  try { cdp?.close(); } catch {}
  killBrowser(child);
  await new Promise(r => server.close(r));
  await rm(userDataDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }).catch(() => {});
}
