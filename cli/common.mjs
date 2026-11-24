// Small helpers shared by the status line, the #usage hook and the usage command.

export class InputError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export async function readStdin(limit, stream = process.stdin) {
  let size = 0; const chunks = [];
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw new InputError('input-size');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')); }
  catch { throw new InputError('input-json'); }
}

// Diagnostics name only the failing stage; payload text and exception
// messages (which can quote input) are never printed.
export function debug(stage) {
  if (process.env.AG_PULSE_CLI_DEBUG) process.stderr.write(`antigrative-dashboard: ${stage}\n`);
}

export async function savedLanguage() {
  try {
    const { PreferencesStore } = await import('../compat/preferences.mjs');
    const saved = await new PreferencesStore().snapshot();
    return ['en', 'zh-CN', 'zh-TW'].includes(saved.language) ? saved.language : null;
  } catch { return null; }
}

// `#` is typed identically with Chinese and English input methods. NFKC folds
// the full-width ＃ and full-width letters some keyboards produce.
export const TRIGGERS = ['#usage', '#u', '#用量', '##'];
export function isUsageTrigger(text) {
  if (typeof text !== 'string' || text.length > 40) return false;
  return TRIGGERS.includes(text.normalize('NFKC').trim().toLowerCase());
}

// The global hooks file is shared with the desktop App; only CLI conversations
// (whose brain directory is under ~/.gemini/antigravity-cli) are answered.
export function fromCli(payload) {
  const paths = [payload.transcriptPath, payload.artifactDirectoryPath].filter(value => typeof value === 'string' && value);
  return !paths.length || paths.some(value => /antigravity-cli/i.test(value));
}

// The legacy Windows console host (conhost) often lacks glyphs for these
// symbols and draws hollow boxes. Every replacement keeps the same cell width.
const ASCII = { '█': '#', '░': '-', '▁': '_', '▂': '.', '▃': ':', '▄': '-', '▅': '=', '▆': '+', '▇': '*',
  '·': '|', '●': '*', '↑': '^', '↓': 'v', '≈': '~', '↻': '~', '─': '-', '…': '.' };
export const toAscii = text => text.replace(/[█░▁-▇·●↑↓≈↻─…]/g, char => ASCII[char]);

// AG_PULSE_CLI_GLYPHS=ascii|unicode forces a mode. Otherwise only a Windows
// session with no modern-terminal marker (Windows Terminal, VS Code, ConEmu,
// mintty/Git Bash set one of these) falls back to ASCII.
export function asciiGlyphs(env = process.env, platform = process.platform) {
  const mode = String(env.AG_PULSE_CLI_GLYPHS || '').toLowerCase();
  if (mode === 'ascii') return true;
  if (mode === 'unicode') return false;
  return platform === 'win32' && !env.WT_SESSION && !env.TERM_PROGRAM && !env.ConEmuANSI && !env.TERM;
}

export const colorEnabled = (env = process.env) => !Object.hasOwn(env, 'NO_COLOR') && env.TERM !== 'dumb';
