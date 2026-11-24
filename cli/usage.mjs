#!/usr/bin/env node
// Terminal usage details outside agy: `node cli/usage.mjs [--watch]`.
import { usageText, buildReport } from './report.mjs';
import { dataDir, loadAll } from './ledger.mjs';
import { colorEnabled, asciiGlyphs } from './common.mjs';

const help = `Antigravity Progress Bar usage details (Node.js 20+)
  --language en|zh-CN|zh-TW  Override shared desktop language preference
  --watch                    Refresh every 2 seconds (Ctrl+C to exit)
  --json                     Print aggregated numbers only
  --no-color                 Disable ANSI colors
  --ascii | --unicode        Force ASCII-only or Unicode symbols (default: auto)
Inside agy, type #usage instead (no model call).
`;

const args = process.argv.slice(2), opts = {};
try {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--watch', '--json', '--no-color', '--help', '--ascii', '--unicode'].includes(arg)) opts[arg.slice(2)] = true;
    else if (arg === '--language' && ['en', 'zh-CN', 'zh-TW'].includes(args[i + 1])) opts.language = args[++i];
    else throw new Error('Invalid option');
  }
} catch { process.stdout.write(help); process.exit(1); }

const color = !opts['no-color'] && colorEnabled() && process.stdout.isTTY !== false;
const ascii = opts.ascii || (!opts.unicode && asciiGlyphs());
const draw = async () => usageText({ language: opts.language, color, ascii });
if (opts.help) process.stdout.write(help);
else if (opts.json) {
  const records = loadAll(dataDir(), { since: Date.now() - 31 * 86400000 });
  const report = buildReport({ records, current: records[0] || null });
  process.stdout.write(JSON.stringify({ ranges: report.ranges, daily: report.daily, conversation: report.conversation }) + '\n');
} else if (opts.watch) {
  const tick = async () => process.stdout.write('\x1b[H\x1b[2J' + await draw() + '\n');
  await tick(); setInterval(tick, 2000);
} else process.stdout.write(await draw() + '\n');
