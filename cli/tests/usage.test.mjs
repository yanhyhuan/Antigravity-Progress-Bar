import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize, conversationKey } from '../metrics.mjs';
import { update, stats, load, save, dayKey } from '../ledger.mjs';
import { buildReport, renderReport, sparkline, usageText } from '../report.mjs';
import { isUsageTrigger, fromCli, asciiGlyphs, toAscii } from '../common.mjs';
import { render, displayWidth } from '../render.mjs';
import { previewPayload, previewStats } from '../samples.mjs';

const statusline = fileURLToPath(new URL('../statusline.mjs', import.meta.url));
const hook = fileURLToPath(new URL('../hook.mjs', import.meta.url));
const ID = '12345678-abcd-ef01-2345-6789abcdef01';
const payload = (state, input, output, usage = null, extra = {}) => ({
  conversation_id: ID, session_id: ID, agent_state: state, model: { display_name: 'Gemini 3.5 Flash (High)' },
  context_window: { total_input_tokens: input, total_output_tokens: output, used_percentage: 12, context_window_size: 1048576,
    ...(usage ? { current_usage: usage } : {}) }, ...extra,
});
const usage = (input, output, read, write = 0) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: write });

function simulate(steps, start = Date.parse('2026-11-23T10:00:00')) {
  let record = null;
  for (const [offset, value] of steps) record = update(record, normalize(value), conversationKey(ID), start + offset).record;
  return record;
}

test('ledger attributes only observed deltas, tracks turns, cache hit and generation speed', () => {
  const record = simulate([
    [0, payload('idle', 100, 50)],                                 // resumed totals: baseline only
    [1000, payload('thinking', 100, 50)],
    [6000, payload('working', 600, 350, usage(300, 300, 200))],    // first request
    [11000, payload('tool_use', 1100, 650, usage(100, 300, 400))], // second request
    [20000, payload('working', 1100, 650, usage(100, 300, 400))],
    [23000, payload('idle', 1100, 650, usage(100, 300, 400))],
  ]);
  assert.deepEqual(record.baseline, { input: 100, output: 50, cost: null });
  const day = record.days[dayKey(Date.parse('2026-11-23T10:00:00'))];
  assert.equal(day.input, 1000); assert.equal(day.output, 600); assert.equal(day.requests, 2);
  // (200 + 400) / (300 + 200 + 100 + 400)
  assert.equal(day.cacheRead, 600); assert.equal(day.cacheBase, 1000);
  // Generation = thinking 1s..6s + working 6s..11s + working 20s..23s; tool time excluded.
  assert.equal(record.genMs, 13000);
  const summary = stats(record);
  assert.equal(summary.turn, null);
  assert.equal(summary.lastTurn.output, 600); assert.equal(summary.lastTurn.elapsed, 22000);
  assert.ok(Math.abs(summary.lastTurn.tps - 600 / 13) < 0.01);
  assert.equal(summary.session.cacheRate, 60);
  assert.deepEqual(day.models, { 'Gemini 3.5 Flash (High)': { input: 1000, output: 600 } });
});

test('compaction or counter resets rebaseline instead of producing negative usage', () => {
  const record = simulate([[0, payload('idle', 1000, 500)], [1000, payload('working', 2000, 900)], [2000, payload('working', 300, 100)], [3000, payload('idle', 400, 150)]]);
  const day = Object.values(record.days)[0];
  assert.equal(day.input, 1100); assert.equal(day.output, 450);
});

test('idle samples without new numbers are not rewritten', () => {
  const key = conversationKey(ID), first = update(null, normalize(payload('idle', 1, 1)), key, 1000);
  assert.equal(first.dirty, true);
  assert.equal(update(first.record, normalize(payload('idle', 1, 1)), key, 2000).dirty, false);
  assert.equal(update(first.record, normalize(payload('working', 1, 1)), key, 2000).dirty, true);
});

test('status line process writes a whitelisted ledger keyed by a one-way hash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pulse-ledger-'));
  try {
    const env = { ...process.env, AG_PULSE_CLI_DATA: dir };
    for (const value of [payload('idle', 10, 5), payload('working', 510, 205, usage(400, 200, 100)), payload('idle', 510, 205, usage(400, 200, 100))]) {
      const result = spawnSync(process.execPath, [statusline, '--no-color', '--language', 'en'], { input: JSON.stringify({ ...value,
        email: 'SECRET_EMAIL', cwd: 'SECRET_DIR', transcript_path: 'SECRET_PATH', conversation_title: 'SECRET_TITLE' }), encoding: 'utf8', env });
      assert.equal(result.status, 0); assert.match(result.stdout, /Context 12%/);
    }
    const files = readdirSync(join(dir, 'conversations'));
    assert.deepEqual(files, [conversationKey(ID) + '.json']);
    const content = readFileSync(join(dir, 'conversations', files[0]), 'utf8');
    assert.doesNotMatch(content, /SECRET|12345678-abcd|email|cwd|transcript|title/);
    assert.equal(load(dir, conversationKey(ID)).observed.output, 200);
    // Preview and --no-ledger never write.
    const other = mkdtempSync(join(tmpdir(), 'pulse-ledger-none-'));
    spawnSync(process.execPath, [statusline, '--preview'], { encoding: 'utf8', env: { ...process.env, AG_PULSE_CLI_DATA: other } });
    spawnSync(process.execPath, [statusline, '--no-ledger'], { input: JSON.stringify(payload('working', 1, 1)), encoding: 'utf8', env: { ...process.env, AG_PULSE_CLI_DATA: other } });
    assert.throws(() => readdirSync(join(other, 'conversations')));
    rmSync(other, { recursive: true, force: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('#usage trigger accepts exact half/full-width forms only', () => {
  for (const value of ['#usage', '#u', '#用量', '##', ' #USAGE ', '＃usage', '＃用量', '＃＃', '#ｕｓａｇｅ'])
    assert.ok(isUsageTrigger(value), value);
  for (const value of ['#usage please', 'usage', '@usage', '/usage', '# usage', '#', '', null, '#u'.repeat(30)])
    assert.ok(!isUsageTrigger(value), String(value));
  assert.ok(fromCli({ transcriptPath: 'C:\\Users\\a\\.gemini\\antigravity-cli\\brain\\x\\transcript.jsonl' }));
  assert.ok(!fromCli({ transcriptPath: '/home/a/.gemini/antigravity/brain/x/transcript.jsonl' }));
  assert.ok(fromCli({}));
});

const runHook = (value, env = {}) => spawnSync(process.execPath, [hook], {
  input: typeof value === 'string' ? value : JSON.stringify(value), encoding: 'utf8', env: { ...process.env, ...env }, timeout: 10000 });

test('hook answers #usage locally and terminates before the model; everything else passes through', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pulse-hook-'));
  try {
    const record = simulate([[0, payload('idle', 0, 0)], [1000, payload('working', 0, 0)], [5000, payload('working', 2000, 400, usage(1500, 400, 500))], [6000, payload('idle', 2000, 400, usage(1500, 400, 500))]], Date.now() - 10000);
    save(dir, record);
    const env = { AG_PULSE_CLI_DATA: dir, LOCALAPPDATA: dir, XDG_DATA_HOME: dir, HOME: dir, AG_PULSE_CLI_GLYPHS: 'unicode' };
    const base = { conversationId: ID, invocationNum: 0, transcriptPath: '/home/u/.gemini/antigravity-cli/brain/x/transcript.jsonl' };
    const answered = runHook({ ...base, lastUserInput: '＃用量' }, env);
    assert.equal(answered.status, 0);
    const output = JSON.parse(answered.stdout);
    assert.equal(output.terminationBehavior, 'terminate');
    const text = output.injectSteps[0].errorMessage.userMessage;
    assert.match(text, /Usage details/); assert.match(text, /↑2K · ↓400/); assert.match(text, /hit 25%/);
    assert.doesNotMatch(text, /\x1b/);
    for (const value of [{ ...base, lastUserInput: 'fix the failing test' }, { ...base, lastUserInput: '#usage of fetch()' },
      { ...base, lastUserInput: '#usage', transcriptPath: '/home/u/.gemini/antigravity/brain/x/transcript.jsonl' }]) {
      const result = runHook(value, env);
      assert.equal(result.status, 0); assert.deepEqual(JSON.parse(result.stdout), {});
    }
    for (const value of ['{bad', '[]', 'null']) assert.deepEqual(JSON.parse(runHook(value, env).stdout), {});
    // Unknown conversations still get an answer instead of reaching the model.
    const unknown = JSON.parse(runHook({ ...base, conversationId: 'other', lastUserInput: '#u' }, env).stdout);
    assert.match(unknown.injectSteps[0].errorMessage.userMessage, /no recorded usage yet/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('legacy Windows console falls back to ASCII symbols; modern terminals and overrides keep Unicode', () => {
  const legacy = {}, modern = { WT_SESSION: 'x' };
  assert.equal(asciiGlyphs(legacy, 'win32'), true);
  for (const marker of ['WT_SESSION', 'TERM_PROGRAM', 'ConEmuANSI', 'TERM']) assert.equal(asciiGlyphs({ [marker]: 'x' }, 'win32'), false, marker);
  assert.equal(asciiGlyphs(legacy, 'linux'), false); assert.equal(asciiGlyphs(legacy, 'android'), false); assert.equal(asciiGlyphs(legacy, 'darwin'), false);
  assert.equal(asciiGlyphs({ ...modern, AG_PULSE_CLI_GLYPHS: 'ascii' }, 'linux'), true);
  assert.equal(asciiGlyphs({ AG_PULSE_CLI_GLYPHS: 'unicode' }, 'win32'), false);
  assert.equal(toAscii('█░ ↑↓ ≈ ↻ ● · ─ … 中文'), '#- ^v ~ ~ * | - . 中文');
});

test('ASCII mode emits no risky symbols, keeps widths and ANSI, in the status line, report and hook', () => {
  const metrics = normalize(previewPayload({ quota: { 'gemini-5h': { remaining_fraction: 0.72, reset_in_seconds: 8100 }, 'gemini-weekly': { remaining_fraction: 0.7, reset_in_seconds: 560580 },
    '3p-5h': { remaining_fraction: 1 }, '3p-weekly': { remaining_fraction: 0.2 } } }));
  const risky = /[█░▁-▇·●↑↓≈↻─…]/;
  for (const language of ['en', 'zh-CN']) for (const width of [30, 40, 60, 100, 140]) {
    const unicode = render(metrics, { width, language, color: false, stats: previewStats() }).split('\n');
    const ascii = render(metrics, { width, language, color: false, stats: previewStats(), ascii: true }).split('\n');
    assert.equal(ascii.length, unicode.length);
    ascii.forEach((line, index) => { assert.doesNotMatch(line, risky); assert.equal(displayWidth(line), displayWidth(unicode[index])); });
  }
  assert.match(render(metrics, { width: 100, ascii: true }), /\x1b\[2;39m/);
  const dir = mkdtempSync(join(tmpdir(), 'pulse-ascii-'));
  try {
    save(dir, simulate([[0, payload('idle', 0, 0)], [1000, payload('working', 0, 0)], [5000, payload('working', 2000, 400, usage(1500, 400, 500))], [6000, payload('idle', 2000, 400, usage(1500, 400, 500))]], Date.now() - 10000));
    const env = { AG_PULSE_CLI_DATA: dir, LOCALAPPDATA: dir, XDG_DATA_HOME: dir, HOME: dir };
    const base = { conversationId: ID, transcriptPath: '/home/u/.gemini/antigravity-cli/brain/x/transcript.jsonl', lastUserInput: '#usage' };
    const text = JSON.parse(runHook(base, { ...env, AG_PULSE_CLI_GLYPHS: 'ascii' }).stdout).injectSteps[0].errorMessage.userMessage;
    assert.doesNotMatch(text, risky); assert.match(text, /\^2K \| v400/); assert.match(text, /\|/);
    const cli = spawnSync(process.execPath, [statusline, '--no-color', '--ascii', '--language', 'en'], { input: JSON.stringify(payload('working', 10, 5)), encoding: 'utf8', env: { ...process.env, ...env } });
    assert.doesNotMatch(cli.stdout, risky);
    assert.match(spawnSync(process.execPath, [statusline, '--doctor'], { encoding: 'utf8', env: { ...process.env, ...env, AG_PULSE_CLI_GLYPHS: 'ascii' } }).stdout, /OK\s+symbols\s+ASCII/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('report aggregates ranges, models and a 14-day sparkline in both languages', async () => {
  const now = Date.parse('2026-11-23T12:00:00');
  const record = simulate([[0, payload('idle', 0, 0)], [1000, payload('working', 0, 0)], [4000, payload('working', 9000, 1000, usage(3000, 1000, 6000))], [5000, payload('idle', 9000, 1000, usage(3000, 1000, 6000))]], now - 3600000);
  const report = buildReport({ records: [record], current: record, isCurrent: true, now });
  assert.equal(report.ranges.today.input + report.ranges.today.output, 10000);
  assert.equal(report.ranges.week.conversations, 1);
  assert.equal(report.daily.length, 14); assert.equal(report.daily[13], 10000);
  for (const language of ['en', 'zh-CN']) {
    const text = renderReport(report, { language });
    assert.match(text, language === 'en' ? /Today\s+10K\s+67%/ : /今天\s+10K\s+67%/);
    assert.match(text, /Gemini 3\.5 Flash \(High\)\s+10K/);
  }
  assert.equal(sparkline([0, 1, 8]), '·▁█');
  assert.equal(sparkline([0, 1, 8], true), '.:@');
  const empty = await usageText({ dir: join(tmpdir(), 'pulse-missing-dir'), language: 'zh-CN' });
  assert.match(empty, /暂无用量记录/);
});
