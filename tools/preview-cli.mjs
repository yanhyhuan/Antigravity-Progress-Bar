#!/usr/bin/env node
// Builds dist/cli-preview.html from the real CLI renderer and report code with
// synthetic data, so the browser shows exactly what the terminal would print.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize, conversationKey } from '../cli/metrics.mjs';
import { render } from '../cli/render.mjs';
import { update, stats } from '../cli/ledger.mjs';
import { buildReport, renderReport } from '../cli/report.mjs';
import { previewPayload, previewStats } from '../cli/samples.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2] || join(root, 'dist', 'cli-preview.html');
const now = Date.parse('2026-11-23T15:30:00');
const HOUR = 3600000, DAY = 24 * HOUR;

// Deterministic synthetic history: two models over 14 days.
let seed = 7;
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const records = [];
function conversation(id, model, start, turns) {
  const key = conversationKey(id);
  let record = null, input = 0, output = 0, cost = 0, t = start;
  const step = (state, extra = {}) => {
    record = update(record, normalize({ conversation_id: id, agent_state: state, model: { display_name: model },
      context_window: { total_input_tokens: input, total_output_tokens: output, used_percentage: Math.min(96, input / 12000), context_window_size: 1048576, ...extra },
      cost: { total_usd: cost }, quota: { 'gemini-5h': { remaining_fraction: 0.72, reset_time: new Date(now + 8100000).toISOString() },
        'gemini-weekly': { remaining_fraction: 0.938, reset_time: new Date(now + 560580000).toISOString() },
        '3p-5h': { remaining_fraction: 0.45, reset_time: new Date(now + 4000000).toISOString() },
        '3p-weekly': { remaining_fraction: 0.08, reset_time: new Date(now + 300000000).toISOString() } } }), key, t).record;
  };
  step('idle');
  for (let i = 0; i < turns; i++) {
    t += 60000; step('thinking');
    const requests = 1 + Math.floor(random() * 3);
    for (let r = 0; r < requests; r++) {
      const uncached = 2000 + Math.floor(random() * 9000), read = Math.floor(random() * 40000), out = 300 + Math.floor(random() * 2500);
      input += uncached + read; output += out; cost += (uncached + read * 0.1) / 1e6 * 1.25 + out / 1e6 * 10;
      t += 4000 + out / 45 * 1000; step('working', { current_usage: { input_tokens: uncached, output_tokens: out, cache_read_input_tokens: read, cache_creation_input_tokens: 0 } });
      t += 3000; step('tool_use', { current_usage: { input_tokens: uncached, output_tokens: out, cache_read_input_tokens: read, cache_creation_input_tokens: 0 } });
    }
    t += 2000; step('idle');
  }
  records.push(record);
  return record;
}
for (let day = 13; day >= 0; day--) {
  const count = day % 6 === 5 ? 0 : 1 + Math.floor(random() * 2);
  for (let i = 0; i < count; i++) conversation(`preview-${day}-${i}`, random() > 0.3 ? 'Gemini 3.5 Flash (High)' : 'Claude Sonnet 4.6 (Thinking)',
    now - day * DAY - (8 - i * 3) * HOUR, 2 + Math.floor(random() * 6));
}
const current = conversation('preview-current', 'Gemini 3.5 Flash (High)', now - 40 * 60000, 5);
records.sort((a, b) => b.lastSeen - a.lastSeen);
const report = buildReport({ records, current, isCurrent: true, now });

const quota = { 'gemini-5h': { remaining_fraction: 0.72, reset_in_seconds: 8100 }, 'gemini-weekly': { remaining_fraction: 0.938, reset_in_seconds: 560580 },
  '3p-5h': { remaining_fraction: 0.45, reset_in_seconds: 4000 }, '3p-weekly': { remaining_fraction: 0.08, reset_in_seconds: 300000 } };
const idleStats = { session: { cacheRate: 58.2, tps: 47.6 }, turn: null,
  lastTurn: { input: 48210, output: 3920, cost: 0.06, requests: 4, cacheRate: 71.3, tps: 52.4, elapsed: 74000, end: now - 5000 } };
const scenarios = {
  working: { metrics: normalize(previewPayload({ quota })), stats: previewStats() },
  idle: { metrics: normalize(previewPayload({ agent_state: 'idle', quota })), stats: idleStats },
  alert: { metrics: normalize(previewPayload({ agent_state: 'tool_use', model: { display_name: 'Claude Sonnet 4.6 (Thinking)' }, quota,
    context_window: { total_input_tokens: 1842210, total_output_tokens: 214880, used_percentage: 93.4, context_window_size: 200000,
      current_usage: { input_tokens: 4120, output_tokens: 880, cache_read_input_tokens: 176400, cache_creation_input_tokens: 2100 } },
    cost: { total_usd: 6.82 } })), stats: { session: { cacheRate: 88.6, tps: 61.2 }, turn: { input: 362100, output: 9100, cost: 0.41, requests: 6, cacheRate: 92.4, tps: 63.8, elapsed: 151000, end: null }, lastTurn: null } },
  fresh: { metrics: normalize({ agent_state: 'idle', model: { display_name: 'Gemini 3.5 Flash (High)' }, terminal_width: 100,
    context_window: { used_percentage: 0, context_window_size: 1048576 }, quota }), stats: null },
};

const widths = Array.from({ length: 141 - 28 }, (_, index) => index + 28);
const frames = {};
for (const [name, scenario] of Object.entries(scenarios)) for (const language of ['zh-CN', 'en']) for (const light of [false, true]) for (const ascii of [false, true]) {
  frames[`${name}|${language}|${light ? 'light' : 'dark'}|${ascii ? 'ascii' : 'unicode'}`] = widths.map(width =>
    render(scenario.metrics, { width, language, color: true, stats: scenario.stats, lightBackground: light, now, ascii }));
}
const reports = {};
for (const language of ['zh-CN', 'en']) for (const ascii of [false, true]) {
  const glyphs = ascii ? 'ascii' : 'unicode';
  reports[`${language}|plain|${glyphs}`] = renderReport(report, { language, color: false, ascii });
  reports[`${language}|color|${glyphs}`] = renderReport(report, { language, color: true, ascii });
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Antigravity Progress Bar · CLI 预览</title>
<style>
:root { --bg:#0f1117; --panel:#161922; --line:#262b38; --text:#d7dbe6; --muted:#8a91a3; --accent:#91adff; --mono:"Cascadia Mono","JetBrains Mono","Sarasa Mono SC","Noto Sans Mono CJK SC","Microsoft YaHei Mono",Consolas,monospace; }
* { box-sizing:border-box }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif }
header { padding:28px 32px 8px; max-width:1280px; margin:0 auto }
h1 { margin:0; font-size:22px; font-weight:650; letter-spacing:.2px }
header p { margin:6px 0 0; color:var(--muted) }
main { max-width:1280px; margin:0 auto; padding:12px 32px 48px; display:grid; gap:20px }
.controls { display:flex; flex-wrap:wrap; gap:14px 22px; align-items:center; padding:14px 16px; background:var(--panel); border:1px solid var(--line); border-radius:12px; position:sticky; top:8px; z-index:2 }
.group { display:flex; gap:6px; align-items:center }
.group > span { color:var(--muted); font-size:12px; margin-right:4px }
button { font:inherit; font-size:13px; color:var(--text); background:#1d212c; border:1px solid var(--line); border-radius:8px; padding:5px 10px; cursor:pointer }
button[aria-pressed="true"] { background:#25304d; border-color:#4d64a8; color:#fff }
input[type=range] { width:220px; accent-color:var(--accent) }
.width { font-family:var(--mono); min-width:7ch; color:var(--accent) }
section { background:var(--panel); border:1px solid var(--line); border-radius:14px; overflow:hidden }
section > h2 { margin:0; padding:12px 16px; font-size:13px; font-weight:600; color:var(--muted); border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:12px }
section > h2 em { font-style:normal; color:#6f7689; font-weight:400 }
.stage { padding:22px; overflow-x:auto }
.term { --tbg:#1a1b26; --tfg:#c0caf5; --tdim:#7a7f99; --tline:#2f3346; background:var(--tbg); color:var(--tfg); border-radius:10px; padding:14px 16px 12px; font:13.5px/1.55 var(--mono); width:max-content; box-shadow:0 10px 40px #0007; border:1px solid var(--tline) }
.term.light { --tbg:#fbfbfa; --tfg:#24292f; --tdim:#8c959f; --tline:#d8dee4; box-shadow:0 10px 30px #0002 }
.term pre { margin:0; font:inherit; white-space:pre }
.chrome { display:flex; gap:6px; margin:-2px 0 12px }
.chrome i { width:10px; height:10px; border-radius:50%; background:#ff5f57 } .chrome i:nth-child(2){background:#febc2e} .chrome i:nth-child(3){background:#28c840}
.convo { color:var(--tdim) } .convo b { color:var(--tfg); font-weight:600 }
.prompt { border-top:1px solid var(--tline); border-bottom:1px solid var(--tline); padding:4px 0; margin:10px 0 6px; color:var(--tdim) }
.ruler { color:#3a4057; font-size:11px; margin-top:6px; overflow:hidden }
.term.light .ruler { color:#c9d1d9 }
.error { border-left:3px solid #f7768e; padding:6px 0 6px 12px; margin:8px 0 2px; background:#f7768e0f }
.term.light .error { border-color:#cf222e; background:#cf222e0a }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(420px,1fr)); gap:20px }
.notes { padding:16px 20px; color:var(--muted); font-size:13px } .notes li { margin:4px 0 } .notes code { font-family:var(--mono); color:var(--text); background:#1d212c; padding:1px 5px; border-radius:5px }
</style>
</head>
<body>
<header>
  <h1>Antigravity Progress Bar · CLI 状态栏与 #usage 预览</h1>
  <p>页面内容由仓库里真实的 <code>cli/render.mjs</code> / <code>cli/report.mjs</code> 生成，数值为合成示例；终端外框与对话区是示意，不是 agy 的真实截图。</p>
</header>
<main>
  <div class="controls" role="toolbar">
    <div class="group" data-key="scenario"><span>场景</span>
      <button data-value="working" aria-pressed="true">生成中</button><button data-value="idle">一轮结束</button><button data-value="alert">上下文告警</button><button data-value="fresh">新会话</button></div>
    <div class="group" data-key="language"><span>语言</span><button data-value="zh-CN" aria-pressed="true">中文</button><button data-value="en">English</button></div>
    <div class="group" data-key="theme"><span>终端</span><button data-value="dark" aria-pressed="true">深色</button><button data-value="light">浅色</button></div>
    <div class="group" data-key="glyphs"><span>符号</span><button data-value="unicode" aria-pressed="true">Unicode</button><button data-value="ascii">ASCII（旧版 Windows 控制台）</button></div>
    <div class="group"><span>宽度</span><input id="width" type="range" min="28" max="140" value="100"><span class="width" id="widthLabel">100 列</span>
      <button data-width="40">Termux 竖屏</button><button data-width="80">80 列</button><button data-width="120">宽屏</button></div>
  </div>

  <section>
    <h2>状态栏 <em>宽度调小时：先去掉花费与进度条，再缩短标签，最后才截断</em></h2>
    <div class="stage"><div class="term" id="status">
      <div class="chrome"><i></i><i></i><i></i></div>
      <pre class="convo" id="convo"></pre>
      <pre class="prompt" id="prompt"></pre>
      <pre id="statusText"></pre>
      <pre class="ruler" id="ruler"></pre>
    </div></div>
  </section>

  <div class="grid">
    <section>
      <h2>在 agy 中输入 #usage <em>PreInvocation hook 本地响应，不调用模型</em></h2>
      <div class="stage"><div class="term" id="hookTerm">
        <div class="chrome"><i></i><i></i><i></i></div>
        <pre class="convo" id="hookUser"></pre>
        <pre class="error" id="hookText"></pre>
      </div></div>
    </section>
    <section>
      <h2>node cli/usage.mjs <em>终端彩色版，可加 --watch 分屏常驻</em></h2>
      <div class="stage"><div class="term" id="usageTerm">
        <div class="chrome"><i></i><i></i><i></i></div>
        <pre class="convo">$ node cli/usage.mjs</pre>
        <pre id="usageText"></pre>
      </div></div>
    </section>
  </div>

  <section class="notes">
    <ul>
      <li>触发词：<code>#usage</code> <code>#u</code> <code>#用量</code> <code>##</code>，全角 <code>＃</code> 同样有效；只在整条输入完全等于触发词时拦截。</li>
      <li>hook 输出用 agy 的 <code>errorMessage</code> 显示：实际样式（颜色、多行、宽度）以 agy 为准，这里的红色竖线只是示意。</li>
      <li><code>≈ t/s</code> 是估算：输出 Token 增量 ÷ 状态为思考/生成的时间，不含工具执行时间。缓存命中 = 缓存读取 ÷（未缓存输入 + 缓存读取 + 缓存写入）。</li>
    </ul>
  </section>
</main>
<script>
const frames = ${JSON.stringify(frames)};
const reports = ${JSON.stringify(reports)};
const MIN = ${widths[0]};
const state = { scenario: 'working', language: 'zh-CN', theme: 'dark', glyphs: 'unicode', width: 100 };
const palettes = {
  dark: { 31:'#f7768e', 32:'#9ece6a', 33:'#e0af68', 35:'#bb9af7', 36:'#7dcfff', 39:null },
  light: { 31:'#cf222e', 32:'#1a7f37', 33:'#9a6700', 35:'#8250df', 36:'#0969da', 39:null },
};
// No backslash escapes here: this script lives inside a Node template literal.
const ESC = String.fromCharCode(27), NL = String.fromCharCode(10);
const SPLIT = new RegExp('(' + ESC + '[[][0-9;]*m)'), CODE = new RegExp('^' + ESC + '[[]([0-9;]*)m$');
const escape = text => text.replace(/[&<>]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' })[c]);
function ansi(text) {
  const palette = palettes[state.theme];
  let html = '', style = {};
  const parts = text.split(SPLIT);
  for (const piece of parts) {
    const match = CODE.exec(piece);
    if (!match) {
      if (!piece) continue;
      const css = [style.color && 'color:' + style.color, style.bold && 'font-weight:700', style.dim && 'opacity:.55'].filter(Boolean).join(';');
      html += css ? '<span style="' + css + '">' + escape(piece) + '</span>' : escape(piece);
      continue;
    }
    const codes = match[1].split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) style = {};
      else if (code === 1) style.bold = true;
      else if (code === 2) style.dim = true;
      else if (code === 38 && codes[i + 1] === 2) { style.color = 'rgb(' + codes.slice(i + 2, i + 5).join(',') + ')'; i += 4; }
      else if (code in palette) style.color = palette[code];
    }
  }
  return html;
}
const text = {
  'zh-CN': { convo: { working: ['> 把登录页的表单校验改成实时提示', '  ● 读取 src/pages/login.tsx', '  ● 编辑 src/pages/login.tsx  +42 -9', '  …'],
    idle: ['> 把登录页的表单校验改成实时提示', '  ✓ 已完成：新增实时校验与错误提示，测试通过'],
    alert: ['> 继续重构订单模块', '  ● 运行 npm test', '  …'], fresh: [''] }, prompt: '> 描述你的下一个任务…', cols: '列' },
  en: { convo: { working: ['> Make the login form validate as you type', '  ● Read src/pages/login.tsx', '  ● Edit src/pages/login.tsx  +42 -9', '  …'],
    idle: ['> Make the login form validate as you type', '  ✓ Done: live validation and inline errors, tests pass'],
    alert: ['> Keep refactoring the order module', '  ● Run npm test', '  …'], fresh: [''] }, prompt: '> Describe your next task…', cols: 'cols' },
};
function draw() {
  const t = text[state.language];
  const frame = frames[state.scenario + '|' + state.language + '|' + state.theme + '|' + state.glyphs][state.width - MIN];
  for (const id of ['status', 'hookTerm', 'usageTerm']) document.getElementById(id).classList.toggle('light', state.theme === 'light');
  document.getElementById('convo').textContent = t.convo[state.scenario].join(NL);
  document.getElementById('prompt').textContent = t.prompt.padEnd(state.width, ' ');
  document.getElementById('statusText').innerHTML = ansi(frame);
  document.getElementById('ruler').textContent = Array.from({ length: state.width }, (_, i) => (i + 1) % 10 === 0 ? '|' : '·').join('');
  document.getElementById('widthLabel').textContent = state.width + ' ' + t.cols;
  document.getElementById('hookUser').innerHTML = '<b>&gt; #usage</b>';
  document.getElementById('hookText').textContent = reports[state.language + '|plain|' + state.glyphs];
  document.getElementById('usageText').innerHTML = ansi(reports[state.language + '|color|' + state.glyphs]);
  document.getElementById('width').value = state.width;
  document.querySelectorAll('.group[data-key]').forEach(group => group.querySelectorAll('button').forEach(button =>
    button.setAttribute('aria-pressed', String(button.dataset.value === state[group.dataset.key]))));
}
document.querySelectorAll('.group[data-key] button').forEach(button => button.addEventListener('click', () => {
  state[button.closest('.group').dataset.key] = button.dataset.value; draw();
}));
document.querySelectorAll('button[data-width]').forEach(button => button.addEventListener('click', () => { state.width = Number(button.dataset.width); draw(); }));
document.getElementById('width').addEventListener('input', event => { state.width = Number(event.target.value); draw(); });
draw();
</script>
</body>
</html>
`;
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, html);
console.log(output);
