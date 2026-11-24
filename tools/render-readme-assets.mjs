// Production widget in illustrative Antigravity Desktop 2.32.2 host fixtures. No account data is read.
// Stage for review: node tools/render-readme-assets.mjs --output=.data/readme-review
import { createServer } from 'node:http';
import { accessSync } from 'node:fs';
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { trajectoryMetrics } from '../sidecars/panel/metrics.mjs';
import { CdpConnection } from '../compat/runtime-ui.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(await readFile(join(repo, 'plugin.json'), 'utf8')).version;
const output = resolve(repo, process.argv.find(x => x.startsWith('--output='))?.slice(9) || 'docs/assets');
const sources = await Promise.all(['i18n.cjs', 'theme.cjs', 'inline-widget.cjs', 'usage-ui.cjs', 'update-ui.cjs', 'pricing.cjs'].map(f => readFile(join(repo, 'compat', f), 'utf8')));
const extract = s => { assert.ok(s.includes('module.exports = ')); return s.slice(s.indexOf('module.exports = ') + 17).trim().replace(/;$/, ''); };
const install = `window.__agPulseI18nFactory=(${extract(sources[0])});window.__agPulseThemeFactory=(${extract(sources[1])});window.__agPulsePricingFactory=(${extract(sources[5])});window.__agPulseUsageFactory=(${extract(sources[3])});window.__agPulseUpdateFactory=(${extract(sources[4])});(${extract(sources[2])})();`;

const ids = { main: '11111111-1111-1111-1111-111111111111', subagent: '22222222-2222-2222-2222-222222222222' };
const now = Date.now(), files = [], diagnostics = [], errors = [];
const today = '2026-11-17', models = ['Gemini 4 Hydrogen', 'Claude Sonnet 4.6', 'GPT 5.4'];
const days = Array.from({ length: 120 }, (_, i) => {
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 119 + i);
  return {
    date: d.toISOString().slice(0, 10),
    models: Object.fromEntries(models.map((m, j) => {
      const n = ((i * 17 + j * 3) % 11) * 1400;
      return [m, { uncached: n, cacheRead: n * 3, cacheWrite: 0, output: n, total: n * 5, requests: n ? 1 : 0 }];
    })),
  };
});
const total = ds => ds.reduce((n, d) => n + Object.values(d.models).reduce((sum, r) => sum + r.total, 0), 0);
const usage = {
  accountKey: 'all-local',
  scope: 'local',
  accountAvailable: true,
  accountsCount: 2,
  today,
  timeZone: 'Asia/Shanghai',
  models,
  days,
  todayTokens: total(days.slice(-1)),
  weekTokens: total(days.slice(-7)),
  monthTokens: total(days.filter(d => d.date.startsWith('2026-11'))),
  totalTokens: total(days),
  requests: days.reduce((n, d) => n + Object.values(d.models).reduce((s, r) => s + r.requests, 0), 0),
  firstDate: days[0].date,
  syncing: false,
  unknownRequests: 0,
  partialRequests: 0,
  unreadableFiles: 0,
  quotaWindows: {
    'gemini:5h': { observedTokens: 1840000, estimatedFullTokens: 8520000, requests: 26, usedFraction: 0.216 },
    'gemini:weekly': { observedTokens: 5420000, estimatedFullTokens: 14150000, requests: 74, usedFraction: 0.383 },
    '3p:5h': { observedTokens: 960000, estimatedFullTokens: 3720000, requests: 14, usedFraction: 0.258 },
    '3p:weekly': { observedTokens: 3180000, estimatedFullTokens: 5990000, requests: 42, usedFraction: 0.531 },
  },
};
const reset = ms => new Date(now + ms).toISOString();

function sample(scope) {
  const sub = scope === 'subagent';
  const steps = Array.from({ length: sub ? 2 : 5 }, (_, i) => [
    { type: 'USER_INPUT' },
    { type: 'READ_FILE', metadata: { startedAt: new Date(now - 60000 + i * 10000).toISOString(), completedAt: new Date(now - 60000 + i * 10000 + (sub ? 1000 : 1600)).toISOString() } },
    { type: 'ASSISTANT_RESPONSE' },
  ]).flat();
  const speed = trajectoryMetrics({
    trajectory: {
      cascadeId: ids[scope],
      steps,
      generatorMetadata: Array.from({ length: sub ? 2 : 5 }, (_, i) => ({
        chatModel: {
          modelDisplayName: sub ? 'Claude Sonnet 4.6' : 'Gemini 4 Hydrogen (High)',
          streamingDuration: sub ? '4s' : `${[11, 9, 10, 8, 10][i]}s`,
          timeToFirstToken: sub ? '0.4s' : '0.6s',
          chatStartMetadata: { contextWindowMetadata: { estimatedTokensUsed: sub ? 24000 : 92000 + i * 5000, maxContextTokens: sub ? 200000 : 256000 } },
          usage: {
            inputTokens: sub ? 3200 : 18850,
            cacheReadTokens: sub ? 9600 : 97600,
            responseOutputTokens: sub ? 640 : [980, 1090, 1010, 1140, 1046][i],
            thinkingOutputTokens: sub ? 0 : (i === 4 ? 405 : 406),
            outputTokens: sub ? 640 : ([980, 1090, 1010, 1140, 1046][i] + (i === 4 ? 405 : 406)),
            apiProvider: sub ? 'API_PROVIDER_ANTHROPIC' : 'API_PROVIDER_GOOGLE_GEMINI',
          },
        },
      })),
    },
  });
  return {
    connection: 'live',
    usage,
    serverTime: new Date(now).toISOString(),
    quotaUpdatedAt: new Date(now).toISOString(),
    speed,
    groups: [
      { id: 'gemini', name: 'Gemini', windows: { '5h': { available: true, remaining: 0.784, resetAt: reset(10800000) }, weekly: { available: true, remaining: 0.617, resetAt: reset(345600000) } } },
      { id: '3p', name: 'Claude / GPT', windows: { '5h': { available: true, remaining: 0.742, resetAt: reset(7812000) }, weekly: { available: true, remaining: 0.469, resetAt: reset(327846000) } } },
    ],
  };
}

const hostIcon = name => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${{ add: '<path d="M12 5v14M5 12h14"/>', mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11v2a6 6 0 0 0 12 0v-2M12 19v3"/>', send: '<path d="M12 19V5m-6 6 6-6 6 6"/>' }[name]}</svg>`;

function fixture(lang, scope, width) {
  const zh = lang === 'zh', sub = scope === 'subagent';
  const anchor = sub
    ? '<div class="identity" title="layout-reviewer"><svg viewBox="0 0 16 16"><path d="M3 4h10v8H3zM6 1v3m4-3v3M6 12v3m4-3v3"/></svg><span>layout-reviewer</span></div>'
    : '<div class="model-branch"><button data-testid="model-selector-trigger">Gemini 4 Hydrogen (High) <span>⌃</span></button></div>';
  return `<!doctype html><html lang="${zh ? 'zh-CN' : 'en'}"><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;padding:14px;background:#17191d;color:#c7cbd3;font:12px "Segoe UI","Microsoft YaHei",sans-serif}.composer{width:${width}px;max-width:100%;padding:12px;border:1px solid #363b44;border-radius:16px;background:#20242a;margin:0 auto}.editor{height:44px;padding:2px 4px;outline:none;color:#949da9;font-size:13px}.actions,.left,.right{display:flex;align-items:center;gap:5px;height:30px}.left{flex:1;min-width:0}.right{flex:none;gap:8px}.model-branch{display:flex;flex:1 1 200px;min-width:20px;max-width:200px;overflow:hidden}.model-branch button{width:100%;overflow:hidden;text-align:left}.model-branch span{padding-left:5px}.identity{display:flex;align-items:center;gap:6px;padding:4px 6px;flex:none;font-size:11px}.identity svg{width:14px;height:14px;fill:none;stroke:currentColor}.protected{width:28px;flex:none;display:grid;place-items:center}button{font:inherit;border:0;background:transparent;color:#b9c1cd;height:28px;padding:0 4px;white-space:nowrap}.send{border-radius:50%;background:#343c49;color:#d5dcea}
  </style><body data-theme="dark"><section class="composer" data-testid="agent-input-box"><div><div role="textbox" contenteditable="true" class="editor" aria-label="Message input">${zh ? '输入消息，@ 提及，/ 选择操作' : 'Ask anything, @ to mention, / for actions'}</div></div><div class="actions"><div class="left"><button class="protected" aria-label="Add context">${hostIcon('add')}</button>${anchor}</div><div class="right"><button class="protected" aria-label="Record voice memo">${hostIcon('mic')}</button><button class="protected send" data-testid="send-button" aria-label="Send message" disabled>${hostIcon('send')}</button></div></div></section><script>
  history.replaceState({},'', '/c/${ids[scope]}');Date.now=()=>${now};window.agPulseHost={getMetrics:async()=>(${JSON.stringify(sample(scope))}),getPreferences:async()=>({language:'${zh ? 'zh-CN' : 'en'}',languageGuideDismissed:true,speedStyle:'cat',usageScope:'local',revision:1}),setPreferences:async x=>({...x,revision:2}),updatePlugin:async()=>({state:'current',currentVersion:'${version}',latestVersion:'${version}'}),report:()=>{}};
  </script><script src="/widget.js"></script></body></html>`;
}

function board(lang, kind) {
  const zh = lang === 'zh';
  const frame = (scope, width, hero = false) => `<iframe title="${scope} demo" src="/fixture?lang=${lang}&scope=${scope}&width=${width}" style="width:${hero ? '820px' : '100%'};height:136px;border:0;display:block;${hero ? 'transform:scale(1.35);transform-origin:top left' : ''}"></iframe>`;
  const note = zh ? `当前控件源码 (v${version}) · 适配 Antigravity Desktop 2.32.2 · 示例数据` : `Current widget source (v${version}) · Antigravity Desktop 2.32.2 layout · Illustrative data`;
  const css = `*{box-sizing:border-box}body{margin:0;padding:28px 36px;background:#17191d;color:#f0f3f8;font:14px "Segoe UI","Microsoft YaHei",sans-serif}.brand{font-size:12px;font-weight:600;letter-spacing:1.4px;color:#9fb9ee}h1{font-size:38px;font-weight:600;letter-spacing:-.8px;line-height:1.25;margin:16px 0 10px}p{margin:0;color:#aab5c6;font-size:16px;line-height:1.6}footer{font-size:11px;color:#7f8c9f;margin-top:12px}.hero-frame{height:184px;margin:18px -14px 4px}.features{display:flex;gap:28px;color:#c2cee0;font-size:13px;padding-top:10px;border-top:1px solid #303846}.grid{display:grid;grid-template-columns:440px 1fr;gap:28px;margin-top:20px}h2{font-size:18px;font-weight:600;margin:0 0 5px}.grid p{font-size:13px;margin-bottom:12px}.frame-wrap{margin:0 -14px}.badge{font-size:11px;letter-spacing:.8px;color:#9fb9ee;margin-bottom:8px}`;
  const content = kind === 'hero'
    ? `<div class="brand">ANTIGRAVITY PROGRESS BAR · v${version}</div><h1>${zh ? '主对话与子代理，统计都在输入框旁。' : 'Your agent. Your metrics. In view.'}</h1><p>${zh ? '像素猫速率、缓存与上下文常驻；悬停查看消耗预测与共享额度。' : 'Pixel-cat speed, cache and context beside your input. Hover for forecasts and shared quotas.'}</p><div class="hero-frame">${frame('main', 790, true)}</div><div class="features"><span>${zh ? '像素猫 / 简约速度卡' : 'Pixel cat / minimal speed'}</span><span>${zh ? '额度预测 · 本机全部用量' : 'Quota outlook · all-local usage'}</span><span>Windows · Linux · macOS</span></div>`
    : `<div class="brand">${zh ? '自适应布局 · 子代理独立统计' : 'RESPONSIVE · SUBAGENT AWARE'}</div><div class="grid"><section><div class="badge">01 · ${zh ? '自适应布局' : 'ADAPTIVE LAYOUT'}</div><h2>${zh ? '窗口变窄，入口还在。' : 'Less room. Same three controls.'}</h2><p>${zh ? '保留速度、缓存、上下文图标；悬停或点击查看详情。' : 'Speed, cache and context stay interactive.'}</p><div class="frame-wrap">${frame('main', 360)}</div></section><section><div class="badge">02 · ${zh ? '子代理独立统计' : 'CURRENT SUBAGENT'}</div><h2>${zh ? '显示这个子代理自己的数据。' : 'This child’s metrics, beside its input.'}</h2><p>${zh ? '子代理统计与主对话隔离，账号额度共享。' : 'Child statistics stay separate. Account quotas are shared.'}</p><div class="frame-wrap">${frame('subagent', 632)}</div></section></div>`;
  return `<!doctype html><html lang="${zh ? 'zh-CN' : 'en'}"><meta charset="utf-8"><style>${css}</style><body>${content}<footer>${note}</footer></body></html>`;
}

function findBrowserExecutable() {
  const candidates = [
    process.env.AG_EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const file of candidates) {
    try { accessSync(file); return file; } catch {}
  }
  return null;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let content, type = 'text/html; charset=utf-8';
  if (url.pathname === '/widget.js') { content = install; type = 'text/javascript'; }
  else if (url.pathname === '/fixture') content = fixture(url.searchParams.get('lang') || 'en', url.searchParams.get('scope') === 'subagent' ? 'subagent' : 'main', Number(url.searchParams.get('width')) || 940);
  else if (url.pathname === '/board') content = board(url.searchParams.get('lang') || 'en', url.searchParams.get('kind'));
  else { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
  res.end(content);
});
server.listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
await mkdir(output, { recursive: true });

const exe = findBrowserExecutable();
assert.ok(exe, 'Edge or Chrome executable not found');
const userDataDir = await mkdtemp(join(tmpdir(), 'ag-readme-assets-'));
const child = spawn(exe, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });

const port = await new Promise((resolvePort, rejectPort) => {
  let errText = '';
  const timer = setTimeout(() => rejectPort(new Error('Browser start timeout: ' + errText)), 15000);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    errText += chunk;
    const m = errText.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
    if (m) { clearTimeout(timer); resolvePort(Number(m[1])); }
  });
  child.once('exit', code => { clearTimeout(timer); rejectPort(new Error('Browser exited ' + code)); });
});

let target;
for (let i = 0; i < 40; i++) {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json/list`);
    const list = await resp.json();
    target = list.find(t => t.type === 'page');
    if (target) break;
  } catch {}
  await new Promise(r => setTimeout(r, 100));
}
assert.ok(target, 'No page target found');
const eventHandlers = new Map();
const cdp = new CdpConnection(target.webSocketDebuggerUrl, {
  timeout: 15000,
  onEvent: msg => {
    const list = eventHandlers.get(msg.method);
    if (list) for (const fn of [...list]) fn(msg.params || {});
  },
});
const onCdpEvent = (method, fn) => {
  if (!eventHandlers.has(method)) eventHandlers.set(method, new Set());
  eventHandlers.get(method).add(fn);
  return () => eventHandlers.get(method)?.delete(fn);
};
await cdp.open();
await cdp.command('Page.enable');
await cdp.command('Runtime.enable');
onCdpEvent('Runtime.exceptionThrown', ev => errors.push(ev?.exceptionDetails?.text || 'Page exception'));

async function navigate(url, width, height) {
  await cdp.command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  const loaded = new Promise(resolveLoad => {
    const off = onCdpEvent('Page.loadEventFired', () => { off(); resolveLoad(); });
  });
  await cdp.command('Page.navigate', { url });
  await loaded;
}

async function evalInPage(fn, arg = null, contextId = undefined) {
  const res = await cdp.command('Runtime.evaluate', {
    expression: `(${fn.toString()})(${JSON.stringify(arg)})`,
    awaitPromise: true,
    returnByValue: true,
    ...(contextId ? { contextId } : {}),
  });
  if (res.exceptionDetails) throw new Error('Eval error: ' + JSON.stringify(res.exceptionDetails));
  return res.result?.value;
}

async function waitForInContext(fn, arg = null, contextId = undefined, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ok = await evalInPage(fn, arg, contextId);
    if (ok) return ok;
    await new Promise(r => setTimeout(r, 40));
  }
  const diag = await evalInPage(() => {
    const w = document.getElementById('ag-pulse-status-bar');
    return { url: location.href, width: innerWidth, layout: w?.dataset?.layout, scope: w?.dataset?.scope, density: w?.dataset?.density, motion: w?.dataset?.motion, tps: w?.shadowRoot?.getElementById('tps')?.textContent };
  }, null, contextId);
  throw new Error('Timeout waiting for condition: ' + JSON.stringify({ arg, diag }));
}

async function getIframeContexts() {
  const tree = await cdp.command('Page.getFrameTree');
  const childFrames = (tree.frameTree.childFrames || []).map(f => f.frame.id);
  const contexts = [];
  for (const frameId of childFrames) {
    const world = await cdp.command('Page.createIsolatedWorld', { frameId, grantUniveralAccess: true });
    // Note: widget is in main world, so evaluate on window inside frame via main world or wait:
    // Actually Page.createIsolatedWorld creates an isolated world; DOM is shared, shadowRoot is open!
    contexts.push(world.executionContextId);
  }
  return contexts;
}

async function checkReady(scope, density, contextId) {
  const state = await waitForInContext(({ scope, density }) => {
    const w = document.getElementById('ag-pulse-status-bar');
    const r = w?.shadowRoot;
    const tps = r?.getElementById('tps')?.textContent;
    if (!w || !tps || tps === '—' || w.dataset.layout !== 'ready' || w.dataset.scope !== scope || w.dataset.density !== density || w.dataset.motion) return null;
    const rect = w.getBoundingClientRect();
    return {
      scope: w.dataset.scope,
      density: w.dataset.density,
      context: r.getElementById('context-percent').textContent,
      cache: r.getElementById('cache-rate').textContent,
      tps,
      nativeTargetsSafe: [...document.querySelectorAll('.protected')].every(b => {
        const q = b.getBoundingClientRect();
        return Math.min(rect.right, q.right) - Math.max(rect.left, q.left) <= 1 || Math.min(rect.bottom, q.bottom) - Math.max(rect.top, q.top) <= 1;
      }),
      language: {
        toolbarRemoved: !r.getElementById('language-toggle'),
        explicitChoices: !!r.getElementById('card-language-en') && !!r.getElementById('card-language-zh') && !!r.getElementById('card-language-zh-tw'),
        footerAfterQuota: !!(r.querySelector('#context-card .quota-details').compareDocumentPosition(r.querySelector('#context-card .card-language')) & Node.DOCUMENT_POSITION_FOLLOWING),
        guideHidden: r.getElementById('language-guide').hidden,
      },
    };
  }, { scope, density }, contextId);
  assert.equal(state.nativeTargetsSafe, true);
  assert.equal(state.context, scope === 'subagent' ? '12%' : '44%');
  assert.deepEqual(state.language, { toolbarRemoved: true, explicitChoices: true, footerAfterQuota: true, guideHidden: true });
  diagnostics.push({ scope: state.scope, density: state.density, context: state.context, cache: state.cache, tps: state.tps, nativeTargetsSafe: state.nativeTargetsSafe });
}

async function saveShot(name, clip = null) {
  const opts = { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) };
  const { data } = await cdp.command('Page.captureScreenshot', opts);
  await writeFile(join(output, name), Buffer.from(data, 'base64'));
  files.push(name);
}

try {
  for (const lang of ['en', 'zh']) {
    const suffix = lang === 'zh' ? '-zh' : '';
    for (const kind of ['hero', 'responsive']) {
      if (process.argv.includes('--details-only')) continue;
      const height = kind === 'hero' ? 440 : 340;
      await navigate(`${base}/board?lang=${lang}&kind=${kind}`, 1200, height);
      await waitForInContext(() => document.querySelectorAll('iframe').length > 0);
      const ctxs = await getIframeContexts();
      assert.equal(ctxs.length, kind === 'hero' ? 1 : 2);
      if (kind === 'hero') await checkReady('main', 'full', ctxs[0]);
      else { await checkReady('main', 'icons', ctxs[0]); await checkReady('subagent', 'full', ctxs[1]); }
      const fullHeight = await evalInPage(() => Math.ceil(document.documentElement.scrollHeight));
      if (fullHeight !== height) await cdp.command('Emulation.setDeviceMetricsOverride', { width: 1200, height: fullHeight, deviceScaleFactor: 2, mobile: false });
      await evalInPage(() => document.fonts.ready);
      await new Promise(r => setTimeout(r, 80));
      await saveShot(`${kind}${suffix}.png`);
    }
    for (const card of ['speed', 'cache', 'context']) {
      await navigate(`${base}/fixture?lang=${lang}&scope=main&width=940`, 1000, 920);
      await checkReady('main', 'full');
      const clip = await evalInPage(card => {
        const w = document.getElementById('ag-pulse-status-bar'), r = w.shadowRoot;
        r.querySelector(`[data-card="${card}"]`).click();
        const cardEl = r.getElementById(`${card}-card`);
        if (cardEl.hidden) throw new Error(`Card ${card} did not open`);
        const st = document.createElement('style');
        st.textContent = '.composer{background:transparent!important;border-color:transparent!important}.editor,.actions button,.identity{opacity:0}';
        document.head.append(st);
        const bar = r.querySelector('.bar');
        for (const e of bar.children) if (e.dataset.card !== card) e.style.visibility = 'hidden';
        const b1 = r.querySelector(`[data-card="${card}"]`).getBoundingClientRect();
        const b2 = cardEl.getBoundingClientRect();
        const pad = 20;
        const left = Math.max(0, Math.min(b1.left, b2.left) - pad);
        const top = Math.max(0, Math.min(b1.top, b2.top) - pad);
        const right = Math.min(1000, Math.max(b1.right, b2.right) + pad);
        const bottom = Math.min(920, Math.max(b1.bottom, b2.bottom) + pad);
        return { x: left, y: top, width: right - left, height: bottom - top };
      }, card);
      await evalInPage(() => document.fonts.ready);
      await new Promise(r => setTimeout(r, 80));
      await saveShot(`${card === 'cache' ? 'widget' : card}${suffix}.png`, clip);
    }
    for (const kind of ['overview', 'details', 'intro']) {
      await navigate(`${base}/fixture?lang=${lang}&scope=main&width=940`, 1200, 900);
      await checkReady('main', 'full');
      const clip = await evalInPage(kind => {
        const r = document.getElementById('ag-pulse-status-bar').shadowRoot;
        r.querySelector('[data-card="cache"]').click();
        r.getElementById('open-usage').click();
        const dlg = r.getElementById('usage-dashboard');
        const view = dlg.firstElementChild.shadowRoot;
        if (kind !== 'intro') view.getElementById('usage-intro-done').click();
        if (kind === 'details') view.getElementById('details-tab').click();
        const rect = dlg.getBoundingClientRect();
        return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      }, kind);
      await evalInPage(() => document.fonts.ready);
      await new Promise(r => setTimeout(r, 220));
      await saveShot(`usage-${kind}${suffix}.png`, clip);
    }
  }
  assert.deepEqual(errors, []);
  assert.equal(new Set(files).size, files.length, 'Every figure needs its own asset');
  await writeFile(join(output, 'capture-manifest.json'), JSON.stringify({ version, source: 'compat/inline-widget.cjs', data: 'illustrative', host: 'Antigravity Desktop 2.32.2', scale: 2, files, diagnostics }, null, 2));
  console.log(JSON.stringify({ version, output, files, pageErrors: errors }, null, 2));
} finally {
  try { await cdp.close(); } catch {}
  if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true, timeout: 3000 });
  else try { child.kill('SIGKILL'); } catch {}
  await new Promise(r => setTimeout(r, 150));
  try { await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch {}
  await new Promise(r => server.close(r));
}
