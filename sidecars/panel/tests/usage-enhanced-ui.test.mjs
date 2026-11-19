// End-to-end headless Chromium verification for merged usage dashboard enhancements:
// 24h hourly view, CNY/USD cost estimation & sorting, component filtering, bar drill-down,
// model isolation/hiding, and dormant trace folding alongside official scope switching.
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

async function launchBrowser(userDataDir, initialUrl) {
  const child = spawn(EDGE_EXE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`, initialUrl,
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
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = targets.find(t => t.type === 'page' && t.url.startsWith('http://127.0.0.1'));
        if (target) break;
      } catch {}
      await new Promise(r => setTimeout(r, 80));
    }
    if (!target) throw new Error('Failed to discover browser target');
    cdp = new CdpConnection(target.webSocketDebuggerUrl, { timeout: 30000 });
    await cdp.open();
    await cdp.command('Runtime.enable');
    return { child, cdp };
  } catch (err) {
    try { cdp?.close(); } catch {}
    killBrowser(child);
    throw err;
  }
}

test('merged usage dashboard renders 24h hourly view, CNY/USD cost sorting, component filters, drill-down and trace folding', { skip: !EDGE_EXE }, async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ag-enhanced-ui-'));
  let child = null, cdp = null, server = null;
  try {
    const [i18nSrc, themeSrc, usageSrc] = await Promise.all([
      read('compat/i18n.cjs'), read('compat/theme.cjs'), read('compat/usage-ui.cjs'),
    ]);
    const fixture = {
      accountKey: 'all-local',
      scope: 'local',
      accountAvailable: true,
      timeZone: 'Asia/Shanghai',
      today: '2026-11-19',
      hoursFrom: '2026-07-22',
      models: ['Gemini 4 Carbon', 'Claude Opus 4.6', 'Old Trace Model'],
      days: [
        {
          date: '2026-11-01',
          models: {
            'Old Trace Model': { uncached: 50, cacheRead: 0, cacheWrite: 0, output: 10, total: 60, requests: 1 },
          },
        },
        {
          date: '2026-11-19',
          models: {
            'Gemini 4 Carbon': { uncached: 500000, cacheRead: 1500000, cacheWrite: 0, output: 200000, total: 2200000, requests: 12 },
            'Claude Opus 4.6': { uncached: 200000, cacheRead: 300000, cacheWrite: 0, output: 100000, total: 600000, requests: 5 },
          },
          hours: {
            9: { uncached: 200000, cacheRead: 500000, cacheWrite: 0, output: 100000, total: 800000, requests: 6, models: { 'Gemini 4 Carbon': { total: 800000 } } },
            21: { uncached: 500000, cacheRead: 1300000, cacheWrite: 0, output: 200000, total: 2000000, requests: 11, models: { 'Gemini 4 Carbon': { total: 1400000 }, 'Claude Opus 4.6': { total: 600000 } } },
          },
        },
      ],
      todayTokens: 2800000,
      weekTokens: 2800000,
      monthTokens: 2800060,
      totalTokens: 2800060,
      requests: 18,
      firstDate: '2026-11-01',
      syncing: false,
      pricing: {
        exchangeRate: 7.0,
        models: {
          'Gemini 4 Carbon': { prompt: 0.000002, completion: 0.00001, cacheRead: 0.0000002, cacheWrite: 0 },
          'Claude Opus 4.6': { prompt: 0.000005, completion: 0.000025, cacheRead: 0.0000005, cacheWrite: 0 },
          'Old Trace Model': { prompt: 0.000001, completion: 0.000002, cacheRead: 0, cacheWrite: 0 },
        },
      },
    };

    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#17181a;color:#eee">
      <button id="opener">Open</button><div id="host"></div>
      <script>
        const root = document.getElementById('host').attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = (${extract(themeSrc)})().shadowCss();
        root.append(style);
        window.lang = (${extract(i18nSrc)})('zh-CN');
        window.fixture = ${JSON.stringify(fixture)};
        window.dashboard = (${extract(usageSrc)})({
          root,
          language: window.lang,
          setMarkup: (n, h) => { n.innerHTML = h; },
          guideDismissed: true,
          onDismissGuide: async () => {},
          onLanguage: async next => { window.lang.setLanguage(next); window.dashboard.update({ ...window.fixture, updatedAt: String(Math.random()) }); },
          onRefresh: async () => {},
          onScope: async () => {},
        });
        window.dashboard.open(window.fixture, document.getElementById('opener'));
      </script></body></html>`;

    server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    ({ child, cdp } = await launchBrowser(userDataDir, `http://127.0.0.1:${server.address().port}`));

    const evalJs = async expr => {
      const res = await cdp.command('Runtime.evaluate', { expression: `(${expr})()`, awaitPromise: true, returnByValue: true });
      if (res.exceptionDetails) throw new Error('Page error: ' + JSON.stringify(res.exceptionDetails));
      return res.result?.value;
    };

    for (let i = 0; i < 100; i++) {
      if (await evalJs(`() => Boolean(document.getElementById('host')?.shadowRoot?.getElementById('usage-dashboard')?.open)`)) break;
      await new Promise(r => setTimeout(r, 50));
    }

    // 1. Verify overview totals show CNY estimated cost and selection composition bar
    const overviewState = await evalJs(`() => {
      const vs = document.getElementById('host').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot;
      return {
        todaySub: vs.querySelector('#totals .metric .metric-sub')?.textContent,
        selectionVal: vs.getElementById('selection-value').textContent,
        compHidden: vs.getElementById('selection-comp-wrap').hidden,
        compSegs: vs.querySelectorAll('#selection-comp-bar .comp-seg').length,
      };
    }`);
    assert.ok(overviewState.todaySub.includes('¥'), 'Today metric subtitle shows CNY cost: ' + overviewState.todaySub);
    assert.ok(overviewState.selectionVal.includes('预估成本 ¥'), 'Selection card shows estimated CNY cost');
    assert.equal(overviewState.compHidden, false, 'Composition bar is visible when day has tokens');
    assert.equal(overviewState.compSegs, 3);

    // 2. Switch to 24h Hourly view and verify peak hour & 24 bars
    const hourlyState = await evalJs(`() => {
      const vs = document.getElementById('host').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot;
      vs.querySelector('[data-heat="hour"]').click();
      return {
        heatHidden: vs.getElementById('heat-view').hidden,
        hourlyHidden: vs.getElementById('hourly-view').hidden,
        sub: vs.getElementById('heat-sub').textContent,
        bars: vs.querySelectorAll('#hourly-plot .bar-column').length,
        pills: vs.querySelectorAll('#day-pills .day-pill').length,
      };
    }`);
    assert.equal(hourlyState.heatHidden, true);
    assert.equal(hourlyState.hourlyHidden, false);
    assert.ok(hourlyState.sub.includes('21:00–22:00'), 'Identifies 21:00 as peak hour: ' + hourlyState.sub);
    assert.equal(hourlyState.bars, 24);
    assert.ok(hourlyState.pills >= 7);

    // 3. Switch to Details tab: verify dormant trace folding, cost column sorting, component filtering, and bar drill-down
    const detailsState = await evalJs(`() => {
      const vs = document.getElementById('host').shadowRoot.getElementById('usage-dashboard').firstElementChild.shadowRoot;
      vs.getElementById('details-tab').click();
      const traceBtn = vs.querySelector('.legend-trace-btn');
      const headers = [...vs.querySelectorAll('#table-head th')].map(th => th.textContent);
      const initialFirstModel = vs.querySelector('#table-body tr td')?.textContent;

      // Sort by Cost descending (Claude Opus 4.6 costs $3.65 vs Gemini 4 Carbon $3.30)
      vs.querySelectorAll('#table-head th')[6].click();
      const costSortedFirstModel = vs.querySelector('#table-body tr td')?.textContent;

      // Toggle off cacheRead component filter and verify strikethrough
      vs.querySelectorAll('#comp-filters button')[1].click();
      const hasStrikethrough = vs.querySelectorAll('#table-body .excluded-val').length > 0;

      // Click the last bar (Nov 19) to drill down
      const bars = vs.querySelectorAll('#plot .bar-column');
      bars[18].click();
      const drilldownVisible = !vs.getElementById('drilldown-banner').hidden;
      const drilldownText = vs.getElementById('drilldown-banner-text').textContent;

      return { hasTraceBtn: Boolean(traceBtn), headers, initialFirstModel, costSortedFirstModel, hasStrikethrough, drilldownVisible, drilldownText };
    }`);
    assert.equal(detailsState.hasTraceBtn, true, 'Dormant <0.1% model is folded into trace button');
    assert.ok(detailsState.headers.some(h => h.includes('成本')), 'Table includes Cost column');
    assert.equal(detailsState.initialFirstModel, 'Gemini 4 Carbon');
    assert.equal(detailsState.costSortedFirstModel, 'Claude Opus 4.6', 'Sorting by cost puts higher-cost Opus first despite fewer tokens');
    assert.equal(detailsState.hasStrikethrough, true, 'Excluded cacheRead cells render with strikethrough');
    assert.equal(detailsState.drilldownVisible, true, 'Clicking a bar opens drill-down filter banner');
    assert.ok(detailsState.drilldownText.includes('2026-11-19'));
  } finally {
    try { cdp?.close(); } catch {}
    killBrowser(child);
    await new Promise(resolve => server ? server.close(resolve) : resolve());
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
});
