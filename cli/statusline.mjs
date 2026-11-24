#!/usr/bin/env node
import { normalize, conversationKey } from './metrics.mjs';
import { render } from './render.mjs';
import { dataDir, load, save, update, stats } from './ledger.mjs';
import { readStdin, debug, savedLanguage, colorEnabled, isUsageTrigger, asciiGlyphs } from './common.mjs';
import { previewPayload, previewArgonPayload, previewStats } from './samples.mjs';

const MAX_INPUT = 256 * 1024;
const help = `Antigravity Progress Bar for Antigravity CLI (Node.js 20+)
Reads the official statusLine JSON from stdin. No network or transcript access.
  --preview                  Render synthetic data; does not write statistics
  --preview-argon            Render synthetic Gemini, Argon weekly and Claude/GPT quotas
  --language en|zh-CN|zh-TW  Override shared desktop language preference
  --width 1..500             Override terminal columns
  --details                  Include capacity and current request token counts
  --no-color                 Disable ANSI (also honors NO_COLOR and TERM=dumb)
  --ascii | --unicode        Force ASCII-only symbols (hollow boxes in the legacy Windows
                             console) or Unicode; default is auto, env AG_PULSE_CLI_GLYPHS
  --no-ledger                Do not record local usage statistics
  --no-hint                  Hide the "#usage" hint
  --json                     Print only normalized, whitelisted metrics
  --doctor                   Check Node, platform, paths and storage, then exit
  --help                     Show this help
In agy, type #usage (or #u, #用量, ##) for usage details without a model call.
`;

function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--preview', '--preview-argon', '--details', '--json', '--help', '--no-color', '--no-ledger', '--no-hint', '--doctor', '--ascii', '--unicode'].includes(arg)) result[arg.slice(2)] = true;
    else if (arg === '--language') {
      const value = args[++i];
      if (!['en', 'zh-CN', 'zh-TW'].includes(value)) throw new Error('Invalid option');
      result.language = value;
    } else if (arg === '--width') {
      const value = Number(args[++i]);
      if (!Number.isInteger(value) || value < 1 || value > 500) throw new Error('Invalid option');
      result.width = value;
    } else throw new Error('Invalid option');
  }
  return result;
}

async function doctor() {
  const rows = []; let failed = false;
  const check = (name, ok, detail = '') => { failed ||= !ok; rows.push(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); };
  check('node', Number(process.versions.node.split('.')[0]) >= 20, process.version);
  check('platform', true, `${process.platform}/${process.arch}${process.platform === 'android' ? ' (Termux: Linux paths)' : ''}`);
  check('Intl.Segmenter', true, typeof Intl.Segmenter === 'function' ? 'available' : 'missing (code-point fallback)');
  try { const { platformPaths } = await import('../compat/platform.mjs'); platformPaths(); check('desktop paths', true); }
  catch { check('desktop paths', false, 'unsupported platform'); }
  check('language', true, (await savedLanguage()) || 'not saved (en)');
  check('symbols', true, `${asciiGlyphs() ? 'ASCII (legacy console detected; --unicode to override)' : 'Unicode'}`);
  try {
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = dataDir(); mkdirSync(dir, { recursive: true });
    const probe = join(dir, `.doctor-${process.pid}.tmp`); writeFileSync(probe, '1'); rmSync(probe, { force: true });
    check('ledger', true, 'writable');
  } catch { check('ledger', false, 'data directory is not writable'); }
  try { render(normalize(previewPayload()), { color: false, width: 40, stats: previewStats() }); check('render', true); }
  catch { check('render', false); }
  check('#usage trigger', isUsageTrigger('＃用量') && isUsageTrigger(' #U ') && !isUsageTrigger('#usage of this API'));
  process.stdout.write(rows.join('\n') + '\n');
  process.exitCode = failed ? 1 : 0;
}

let opts;
try { opts = options(process.argv.slice(2)); }
catch { process.stdout.write('Antigrative Dashboard: --\n'); process.exitCode = 1; }
if (opts?.help) process.stdout.write(help);
else if (opts?.doctor) await doctor();
else if (opts) {
  try {
    const isPreview = !!(opts.preview || opts['preview-argon']);
    const payload = opts['preview-argon'] ? previewArgonPayload() : opts.preview ? previewPayload() : await readStdin(MAX_INPUT);
    const metrics = normalize(payload);
    let summary = isPreview ? previewStats() : null;
    if (!isPreview && !opts['no-ledger'] && !process.env.AG_PULSE_CLI_NO_LEDGER) {
      try {
        const key = conversationKey(payload.conversation_id || payload.session_id);
        if (key) {
          const dir = dataDir();
          const { record, dirty } = update(load(dir, key), metrics, key);
          if (dirty) save(dir, record);
          summary = stats(record);
        }
      } catch { debug('ledger'); }
    }
    const language = opts.language || await savedLanguage() || 'en';
    process.stdout.write((opts.json ? JSON.stringify(metrics) : render(metrics, {
      language, width: opts.width || metrics.width, details: opts.details, stats: summary, hint: !opts['no-hint'],
      ascii: opts.ascii || (!opts.unicode && asciiGlyphs()),
      // Common light-background palette hints; never probe or alter the terminal.
      lightBackground: /(?:^|;)(?:7|15)$/.test(process.env.COLORFGBG || ''),
      color: !opts['no-color'] && colorEnabled(),
    })) + '\n');
  } catch (error) {
    debug(error?.code || 'payload');
    // Never echo raw payload/exception text. Exit 0 so a bad payload cannot
    // trip agy's "disabled after 30 consecutive failures" guard.
    process.stdout.write('Antigrative Dashboard: --\n');
  }
}
