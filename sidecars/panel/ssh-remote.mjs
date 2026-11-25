// Safe remote SSH tunnel discovery, authority parsing and BatchMode host probing.
// Credentials stay strictly in process memory and never enter logs or disk.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { httpLogPorts, isProcessAlive } from './discovery.mjs';
import { probeSocks5Port } from './socks5.mjs';
import { AntigravityClient } from './client.mjs';

const exec = promisify(execFile);

function execWithInput(file, args, { input = null, ...options } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        if (stdout !== undefined && error.stdout === undefined) error.stdout = stdout;
        if (stderr !== undefined && error.stderr === undefined) error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
    if (child.stdin) {
      // Ignore EPIPE / stream-destroyed errors if ssh exits early (e.g. auth failure or ENOENT).
      child.stdin.on('error', () => {});
      try {
        if (typeof input === 'string' || Buffer.isBuffer(input)) {
          child.stdin.end(input);
        } else {
          child.stdin.end();
        }
      } catch {
        // Handled by execFile callback.
      }
    }
  });
}

const SSH_EXECUTABLE = /^ssh(?:\.exe)?$/i;
const SSH_FLAGS_WITH_ARG = new Set(['b', 'B', 'c', 'D', 'E', 'e', 'F', 'I', 'i', 'J', 'L', 'l', 'm', 'O', 'o', 'P', 'p', 'Q', 'R', 'S', 'W', 'w']);
const LOOPBACK_BINDS = new Set(['', '127.0.0.1', '[127.0.0.1]', 'localhost', '::1', '[::1]']);
const SAFE_SSH_OPTIONS = new Set([
  'hostname',
  'user',
  'port',
  'identityfile',
  'identitiesonly',
  'proxyjump',
  'stricthostkeychecking',
  'userknownhostsfile',
  'globalknownhostsfile',
  'preferredauthentications',
  'pubkeyauthentication',
  'addkeystoagent',
  'forwardagent',
  'addressfamily',
  'ipqos',
  'certificatefile',
  'hostkeyalias',
  'canonicalizehostname',
  'canonicaldomains',
  'serveraliveinterval',
  'serveralivecountmax',
]);
const DAEMON_FILE_NAME = /^(?:ls|hub)_[^/\\]+\.json$/i;

const validPort = value => Number.isInteger(value) && value >= 1 && value <= 65535;
const validPid = value => Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff;
const integer = value => (typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN);

export function validSshDestination(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 255 || trimmed.startsWith('-')) return false;
  return /^[A-Za-z0-9._:@\[\]-]+$/.test(trimmed);
}

export function validSshUser(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128 || trimmed.startsWith('-')) return false;
  return /^[A-Za-z0-9._-]+$/.test(trimmed);
}

function validSshJump(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 512 || trimmed.startsWith('-')) return false;
  if (!/^[A-Za-z0-9._:@\[\],-]+$/.test(trimmed)) return false;
  return trimmed.split(',').every(part => part.length > 0 && !part.startsWith('-'));
}

function validSshPath(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 1024 || trimmed.startsWith('-')) return false;
  return !/[\0\r\n]/.test(trimmed);
}

export function tokenizeCommandLine(command) {
  const tokens = [];
  const text = String(command || '');
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    let token = '';
    let quote = null;
    while (i < text.length) {
      const ch = text[i];
      if (quote) {
        if (ch === quote) {
          quote = null;
          i++;
          continue;
        }
        if (quote === '"' && ch === '\\' && text[i + 1] === '"') {
          token += '"';
          i += 2;
          continue;
        }
        token += ch;
        i++;
        continue;
      }
      if (/\s/.test(ch)) break;
      if (ch === '"' || ch === "'") {
        quote = ch;
        i++;
        continue;
      }
      token += ch;
      i++;
    }
    tokens.push(token);
  }
  return tokens;
}

function executableBase(value) {
  return String(value || '').replace(/\\/g, '/').split('/').at(-1) || '';
}

function parseLoopbackDynamicForward(spec) {
  if (typeof spec !== 'string') return null;
  const trimmed = spec.trim();
  if (!trimmed) return null;
  if (/^\d{1,5}$/.test(trimmed)) {
    const port = Number(trimmed);
    return validPort(port) ? { bindAddress: '127.0.0.1', port } : null;
  }
  const match = trimmed.match(/^(\[[^\]]+\]|[^:\s]+):(\d{1,5})$/);
  if (!match) return null;
  const bind = match[1].toLowerCase();
  const port = Number(match[2]);
  if (!LOOPBACK_BINDS.has(bind) || !validPort(port)) return null;
  return { bindAddress: bind, port };
}

function parseSafeSshOption(rawOption) {
  if (typeof rawOption !== 'string' || /[\0\r\n]/.test(rawOption) || rawOption.length > 1024) return null;
  const match = rawOption.trim().match(/^([A-Za-z][A-Za-z0-9]*)\s*(?:=|\s+)\s*(.+)$/);
  if (!match) return null;
  const key = match[1];
  const lower = key.toLowerCase();
  const value = match[2].trim();
  if (!SAFE_SSH_OPTIONS.has(lower) || !value) return null;
  if (lower === 'port') {
    const port = Number(value);
    return validPort(port) ? `${key}=${port}` : null;
  }
  if (lower === 'user') return validSshUser(value) ? `${key}=${value}` : null;
  if (lower === 'hostname') return validSshDestination(value) ? `${key}=${value}` : null;
  if (lower === 'proxyjump') return validSshJump(value) ? `${key}=${value}` : null;
  return `${key}=${value}`;
}

export function parseSshTunnelCommand(commandLine, pid = null) {
  const tokens = tokenizeCommandLine(commandLine);
  if (tokens.length < 3) return null;
  const exe = tokens[0];
  if (!SSH_EXECUTABLE.test(executableBase(exe))) return null;

  let socksPort = null;
  let destination = null;
  let remoteCommand = [];
  const forwardedArgs = [];
  let i = 1;
  let afterDoubleDash = false;

  while (i < tokens.length) {
    const token = tokens[i];
    if (!afterDoubleDash && token === '--') {
      afterDoubleDash = true;
      i++;
      continue;
    }
    if (!afterDoubleDash && token.startsWith('-') && token.length > 1) {
      // Handle short flags (possibly clustered like -TN or attached like -D127.0.0.1:1080)
      let j = 1;
      while (j < token.length) {
        const flag = token[j];
        if (SSH_FLAGS_WITH_ARG.has(flag)) {
          const arg = j + 1 < token.length ? token.slice(j + 1) : tokens[++i];
          if (typeof arg !== 'string') return null;
          if (flag === 'D') {
            const parsed = parseLoopbackDynamicForward(arg);
            if (!parsed) return null;
            socksPort = parsed.port;
          } else if (flag === 'p') {
            const p = Number(arg);
            if (validPort(p)) forwardedArgs.push('-p', String(p));
          } else if (flag === 'l') {
            if (validSshUser(arg)) forwardedArgs.push('-l', arg.trim());
          } else if (flag === 'i') {
            if (validSshPath(arg)) forwardedArgs.push('-i', arg.trim());
          } else if (flag === 'F') {
            if (validSshPath(arg)) forwardedArgs.push('-F', arg.trim());
          } else if (flag === 'J') {
            if (validSshJump(arg)) forwardedArgs.push('-J', arg.trim());
          } else if (flag === 'o') {
            const safeOpt = parseSafeSshOption(arg);
            if (safeOpt) forwardedArgs.push('-o', safeOpt);
          }
          break;
        }
        j++;
      }
      i++;
      continue;
    }
    destination = token;
    remoteCommand = tokens.slice(i + 1);
    break;
  }

  if (!validPort(socksPort) || !validSshDestination(destination)) return null;
  return {
    pid: validPid(pid) ? pid : null,
    executable: exe,
    socksPort,
    destination: destination.trim(),
    forwardedArgs,
    remoteCommand,
  };
}

export async function discoverLocalSshTunnels({ platform = process.platform, run = exec, uid = process.getuid?.() } = {}) {
  const rows = [];
  if (platform === 'win32') {
    const script = "Get-CimInstance Win32_Process -Filter \"Name='ssh.exe'\" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress";
    try {
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        timeout: 6000,
        maxBuffer: 2 * 1024 * 1024,
      });
      const text = String(stdout || '').replace(/^\uFEFF/, '').trim();
      const parsed = text ? JSON.parse(text) : [];
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        const pid = integer(item?.ProcessId);
        const tunnel = parseSshTunnelCommand(item?.CommandLine, pid);
        if (tunnel) rows.push(tunnel);
      }
    } catch {
      return [];
    }
  } else if (platform === 'darwin' || platform === 'linux') {
    try {
      const { stdout } = await run('/bin/ps', ['-ww', '-axo', 'pid=,ppid=,uid=,args='], {
        timeout: 6000,
        maxBuffer: 4 * 1024 * 1024,
      });
      for (const line of String(stdout || '').split(/\r?\n/)) {
        const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
        if (!match || Number(match[3]) !== uid) continue;
        const tunnel = parseSshTunnelCommand(match[4], Number(match[1]));
        if (tunnel) rows.push(tunnel);
      }
    } catch {
      return [];
    }
  }
  const byPort = new Map();
  for (const tunnel of rows) {
    byPort.set(tunnel.socksPort, tunnel);
  }
  return [...byPort.values()];
}

export function parseSshRemoteAuthority(rawAuthority) {
  if (typeof rawAuthority !== 'string' || rawAuthority.length > 1024 || /[\0\r\n]/.test(rawAuthority)) return null;
  let value = rawAuthority.trim();
  if (!value.startsWith('ssh-remote+')) {
    try {
      const decoded = decodeURIComponent(value);
      if (decoded.startsWith('ssh-remote+')) value = decoded;
    } catch {
      return null;
    }
  }
  if (!value.startsWith('ssh-remote+')) return null;
  const payload = value.slice('ssh-remote+'.length);
  if (!payload || payload.length > 1024) return null;

  // VS Code Remote-SSH encodes structured host configs as hex-encoded JSON.
  if (payload.length >= 4 && payload.length % 2 === 0 && /^[0-9a-f]+$/i.test(payload)) {
    try {
      const decodedJson = Buffer.from(payload, 'hex').toString('utf8');
      if (decodedJson.startsWith('{') && decodedJson.endsWith('}')) {
        const parsed = JSON.parse(decodedJson);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        const rawHost = typeof parsed.hostName === 'string' ? parsed.hostName : typeof parsed.host === 'string' ? parsed.host : '';
        if (!validSshDestination(rawHost)) return null;
        const rawUser = typeof parsed.user === 'string' && parsed.user.trim() ? parsed.user.trim() : null;
        if (rawUser !== null && !validSshUser(rawUser)) return null;
        const rawPort = parsed.port !== undefined && parsed.port !== null && parsed.port !== '' ? integer(parsed.port) : null;
        if (rawPort !== null && !validPort(rawPort)) return null;
        return {
          remoteAuthority: `ssh-remote+${payload}`,
          destination: rawHost.trim(),
          user: rawUser,
          port: rawPort,
        };
      }
    } catch {
      // Fall through to plain host validation if hex payload isn't JSON (e.g. a hex hostname like "deadbeef").
    }
  }

  let plain = payload;
  if (plain.includes('%')) {
    try {
      plain = decodeURIComponent(plain);
    } catch {
      return null;
    }
  }
  if (!validSshDestination(plain)) return null;
  return {
    remoteAuthority: `ssh-remote+${payload}`,
    destination: plain.trim(),
    user: null,
    port: null,
  };
}

export function decodeWebviewRemoteAuthority(hostname) {
  if (typeof hostname !== 'string' || hostname.length > 1024) return null;
  const match = hostname.match(/^vscode-remote\+([a-z0-9+-]+)\.vscode-resource\.vscode-cdn\.net$/i);
  if (!match) return null;
  const rawEncoded = match[1];
  const decoded = rawEncoded.replace(/-([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  if (/[\0\r\n]/.test(decoded)) return null;
  return parseSshRemoteAuthority(decoded);
}

// Self-contained POSIX sh probe (fed over stdin to `sh -s`): enumerates same-UID
// language_server/agy processes (excluding probe shell/awk cmdlines) and reads
// newest-first bounded regular ~/.gemini/antigravity/daemon/{hub,ls}_*.json files
// without shell globs or IFS word-splitting so zsh/fish/bash/sh hosts behave identically.
export const REMOTE_DISCOVERY_SCRIPT = [
  "printf '===AGP_PS===\\n'",
  'if [ -d /proc ] && [ -r /proc/self/cmdline ]; then',
  "  u=$(id -u 2>/dev/null || echo '')",
  '  for p in /proc/[0-9]*; do',
  '    pid="${p#/proc/}"',
  '    [ "$pid" != "$$" ] || continue',
  '    [ -r "$p/status" ] && [ -r "$p/cmdline" ] || continue',
  '    pu=$(awk \'/^Uid:/ { print $2; exit }\' "$p/status" 2>/dev/null)',
  '    [ -n "$u" ] && [ "$pu" = "$u" ] || continue',
  "    cmd=$(tr '\\000\\015\\012' '   ' < \"$p/cmdline\" 2>/dev/null)",
  '    case "$cmd" in *===AGP_PS===*|*===AGP_DAEMON===*) continue ;; esac',
  '    case "$cmd" in *language_server*|*agy*) printf \'%s %s\\n\' "$pid" "$cmd" ;; esac',
  '  done',
  'else',
  '  ps -ww -axo pid=,uid=,args= 2>/dev/null | awk -v uid="$(id -u 2>/dev/null)" -v self="$$" \'$1 != self && $2 == uid { p=$1; $1=""; $2=""; sub(/^ +/, ""); if ($0 ~ /language_server|agy/ && $0 !~ /===AGP_PS===|===AGP_DAEMON===/) print p, $0 }\'',
  'fi',
  "printf '===AGP_DAEMON===\\n'",
  'd="$HOME/.gemini/antigravity/daemon"',
  'if [ -d "$d" ] && [ ! -L "$d" ]; then',
  '  n=0',
  '  ls -1t -- "$d" 2>/dev/null | while IFS= read -r name; do',
  '    case "$name" in hub_*.json|ls_*.json) ;; *) continue ;; esac',
  '    f="$d/$name"',
  '    [ -f "$f" ] && [ ! -L "$f" ] || continue',
  '    n=$((n + 1)); [ "$n" -le 64 ] || break',
  "    sz=$(wc -c < \"$f\" 2>/dev/null | tr -d ' \\011')",
  '    case "$sz" in \'\'|*[!0-9]*) continue ;; esac',
  '    [ "$sz" -gt 0 ] && [ "$sz" -le 16384 ] || continue',
  "    printf '===AGP_FILE:%s===\\n' \"$name\"",
  '    cat < "$f"',
  "    printf '\\n===AGP_END===\\n'",
  '  done',
  'fi',
  "printf '===AGP_LOGS===\\n'",
  'ld="$HOME/.antigravity-hub-server/data"',
  'if [ -d "$ld" ] && [ ! -L "$ld" ]; then',
  "  ls -1tr -- \"$ld\" 2>/dev/null | grep '^ls-.*\\.log$' | tail -n 8 | while IFS= read -r ln; do",
  '    lf="$ld/$ln"',
  '    [ -f "$lf" ] && [ ! -L "$lf" ] || continue',
  "    grep 'listening on random port at [0-9]* for HTTP' < \"$lf\" 2>/dev/null | tail -n 16",
  '  done | tail -n 16',
  'fi',
  'exit 0',
].join('\n');

export function resolveSshBinary(preferredExecutable = null, { exists = existsSync } = {}) {
  if (typeof preferredExecutable === 'string' && preferredExecutable.trim()) {
    const trimmed = preferredExecutable.trim();
    if (SSH_EXECUTABLE.test(executableBase(trimmed)) && /[\\/]/.test(trimmed) && exists(trimmed)) {
      return trimmed;
    }
  }
  return process.platform === 'win32' ? 'ssh.exe' : 'ssh';
}

export function buildRemoteProbeArgs(target) {
  if (!target || !validSshDestination(target.destination)) {
    throw Object.assign(new Error('Invalid SSH destination'), { code: 'SSH_INVALID_DESTINATION' });
  }
  const args = [
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=5',
    '-o', 'NumberOfPasswordPrompts=0',
    '-o', 'KbdInteractiveAuthentication=no',
    '-o', 'PasswordAuthentication=no',
    '-o', 'ControlMaster=no',
    '-o', 'ControlPath=none',
  ];
  if (validSshUser(target.user)) args.push('-l', target.user.trim());
  if (validPort(target.port)) args.push('-p', String(target.port));
  if (Array.isArray(target.forwardedArgs)) {
    for (let i = 0; i < target.forwardedArgs.length; i += 2) {
      const flag = target.forwardedArgs[i];
      const val = target.forwardedArgs[i + 1];
      if (typeof flag !== 'string' || typeof val !== 'string') continue;
      if (flag === '-p' && validPort(Number(val))) args.push('-p', String(Number(val)));
      else if (flag === '-l' && validSshUser(val)) args.push('-l', val);
      else if ((flag === '-i' || flag === '-F') && validSshPath(val)) args.push(flag, val);
      else if (flag === '-J' && validSshJump(val)) args.push('-J', val);
      else if (flag === '-o') {
        const safeOpt = parseSafeSshOption(val);
        if (safeOpt) args.push('-o', safeOpt);
      }
    }
  }
  args.push('--', target.destination.trim(), 'sh', '-s');
  return args;
}

function parseRemoteHubPort(commandLine) {
  const tokens = tokenizeCommandLine(commandLine).slice(1);
  let found = null;
  let count = 0;
  for (let i = 0; i < tokens.length; i++) {
    const arg = tokens[i];
    if (arg === '--') break;
    const match = arg.match(/^--hub-port(?:=(.*))?$/i);
    if (!match) continue;
    count++;
    const raw = match[1] === undefined ? tokens[++i] : match[1];
    if (typeof raw !== 'string' || !/^\d{1,5}$/.test(raw)) return null;
    const port = Number(raw);
    if (!validPort(port)) return null;
    found = port;
  }
  return count === 1 ? found : null;
}

function findMarkerLine(text, marker, fromIndex = 0) {
  const re = new RegExp(`^${marker}\\r?$`, 'gm');
  re.lastIndex = fromIndex;
  const match = re.exec(text);
  if (!match) return null;
  let end = match.index + match[0].length;
  if (text[end] === '\n') end += 1;
  return { start: match.index, end };
}

export function parseRemoteSshDiscovery(stdout) {
  const text = String(stdout || '');
  const psMarker = findMarkerLine(text, '===AGP_PS===', 0);
  const daemonSearchFrom = psMarker ? psMarker.end : 0;
  const daemonMarker = findMarkerLine(text, '===AGP_DAEMON===', daemonSearchFrom);
  const logsSearchFrom = daemonMarker ? daemonMarker.end : daemonSearchFrom;
  const logsMarker = findMarkerLine(text, '===AGP_LOGS===', logsSearchFrom);

  const psEnd = daemonMarker ? daemonMarker.start : logsMarker ? logsMarker.start : text.length;
  const psSection = psMarker ? text.slice(psMarker.end, psEnd) : '';
  const daemonEnd = logsMarker ? logsMarker.start : text.length;
  const daemonSection = daemonMarker ? text.slice(daemonMarker.end, daemonEnd) : '';
  const logsSection = logsMarker ? text.slice(logsMarker.end) : '';

  const processes = [];
  for (const line of psSection.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = integer(match[1]);
    const commandLine = match[2].trim();
    if (!validPid(pid) || !commandLine) continue;
    if (commandLine.includes('===AGP_PS===') || commandLine.includes('===AGP_DAEMON===')) continue;
    const first = tokenizeCommandLine(commandLine)[0] || '';
    const base = executableBase(first);
    const isLsBinary = /^language_server(?:_(?:linux|macos|darwin)(?:_(?:x64|arm64))?)?(?:\.exe)?$/i.test(base);
    const isAgyBinary = /^agy(?:\.exe)?$/i.test(base);
    const isStandalone = isLsBinary && /(?:^|\s)--standalone(?:\s|=|$)/.test(commandLine);
    const isIdeServer = isLsBinary && /(?:^|\s)--subclient_type(?:=|\s+)["']?ide["']?(?:\s|$)/i.test(commandLine)
      && !/(?:^|\s)--enable_lsp(?:\s|=|$)/i.test(commandLine);
    const isHub = isAgyBinary && /(?:^|\s)--hub(?:\s|$)/i.test(commandLine)
      && !/(?:^|\s)--enable_lsp(?:\s|=|$)/i.test(commandLine);
    const cliCsrf = commandLine.match(/--csrf_token(?:=|\s+)"?([^\s"]+)/)?.[1] || '';
    const hubPort = isHub ? parseRemoteHubPort(commandLine) : null;
    const workspaceId = commandLine.match(/--workspace_id(?:=|\s+)"?([^\s"]+)/)?.[1] || null;
    processes.push({ pid, commandLine, base, isStandalone, isIdeServer, isHub, cliCsrf, hubPort, workspaceId });
  }

  const daemonFiles = [];
  const blockPattern = /^===AGP_FILE:([^\r\n=]+)===\r?\n([\s\S]*?)\r?\n===AGP_END===\r?$/gm;
  for (const match of daemonSection.matchAll(blockPattern)) {
    const file = match[1].trim();
    const body = match[2].trim();
    if (!DAEMON_FILE_NAME.test(file) || !body || body.length > 16384) continue;
    try {
      const data = JSON.parse(body.replace(/^\uFEFF/, ''));
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
      const pid = integer(data.pid);
      if (!validPid(pid)) continue;
      const rawHttp = integer(data.httpPort ?? data.http_port);
      const rawHttps = integer(data.httpsPort ?? data.https_port);
      const httpPort = validPort(rawHttp) ? rawHttp : null;
      const httpsPort = validPort(rawHttps) ? rawHttps : null;
      if (httpPort === null && httpsPort === null) continue;
      const rawToken = data.csrfToken ?? data.csrf_token;
      const csrfToken = typeof rawToken === 'string' ? rawToken.trim() : '';
      if (!csrfToken || csrfToken.length > 512) continue;
      const rawVer = data.lsVersion ?? data.ls_version;
      const lsVersion = typeof rawVer === 'string' && rawVer.trim() ? rawVer.trim().slice(0, 64) : null;
      daemonFiles.push({ pid, httpPort, httpsPort, csrfToken, lsVersion, file });
    } catch {
      // Ignore corrupt daemon JSON files.
    }
  }

  return {
    processes,
    daemonFiles,
    logPorts: httpLogPorts(logsSection),
  };
}

export function matchRemoteAppEndpoints(discovery) {
  const liveStandalone = (discovery?.processes || []).filter(p => p.isStandalone);
  const byPid = new Map(liveStandalone.map(p => [p.pid, p]));
  const endpoints = [];
  const seen = new Set();

  for (const rec of discovery?.daemonFiles || []) {
    const proc = byPid.get(rec.pid);
    if (!proc) continue;
    const httpPort = rec.httpPort;
    const httpsPort = rec.httpsPort;
    if (!validPort(httpPort)) continue;
    const csrf = proc.cliCsrf || rec.csrfToken;
    if (!csrf) continue;
    const key = `${rec.pid}:${httpPort}`;
    if (seen.has(key)) continue;
    seen.add(key);
    endpoints.push({
      pid: rec.pid,
      port: httpPort,
      httpsPort: validPort(httpsPort) ? httpsPort : null,
      csrf,
      lsVersion: rec.lsVersion || null,
      credentialSource: proc.cliCsrf ? 'remote-cmdline' : 'remote-daemon-file',
      remote: true,
      remoteHub: true,
    });
  }

  // Fallback for pre-2.34 remote hubs where --csrf_token is on cmdline and port is in ls-*.log.
  if (!endpoints.length && liveStandalone.length === 1 && liveStandalone[0].cliCsrf && discovery?.logPorts?.length) {
    const proc = liveStandalone[0];
    endpoints.push({
      pid: proc.pid,
      port: discovery.logPorts[0],
      httpsPort: null,
      csrf: proc.cliCsrf,
      lsVersion: null,
      credentialSource: 'remote-cmdline',
      remote: true,
      remoteHub: true,
    });
  }
  return endpoints;
}

export function matchRemoteIdeCandidates(discovery, { backendPort = null, workspaceUri = null } = {}) {
  const processes = discovery?.processes || [];
  const livePids = new Set(processes.map(p => p.pid));
  const ideProcsByPid = new Map();
  for (const proc of processes) {
    if (proc.isHub || proc.isIdeServer) ideProcsByPid.set(proc.pid, proc);
  }

  const workspaceSlug = typeof workspaceUri === 'string' && workspaceUri
    ? workspaceUri.toLowerCase().replace(/^vscode-remote:\/\/[^/]+/, '')
    : '';
  const candidates = [];
  const seen = new Set();

  const addCandidate = item => {
    const key = `${item.csrf}:${item.pid}:${item.httpPort ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(item);
  };

  for (const rec of discovery?.daemonFiles || []) {
    if (!livePids.has(rec.pid)) continue;
    const proc = ideProcsByPid.get(rec.pid) || processes.find(p => p.pid === rec.pid);
    const isIde = Boolean(ideProcsByPid.has(rec.pid)) || /^hub_/i.test(rec.file);
    if (!isIde) continue;
    const csrf = proc?.cliCsrf || rec.csrfToken;
    if (!csrf) continue;
    const exactPort = validPort(backendPort) && (rec.httpPort === backendPort || rec.httpsPort === backendPort);
    const workspaceMatch = Boolean(workspaceSlug && proc?.commandLine?.toLowerCase().includes(workspaceSlug));
    addCandidate({
      pid: rec.pid,
      httpPort: rec.httpPort,
      httpsPort: rec.httpsPort,
      csrf,
      lsVersion: rec.lsVersion || null,
      credentialSource: proc?.cliCsrf ? 'remote-cmdline' : 'remote-daemon-file',
      file: rec.file,
      isHubFile: /^hub_/i.test(rec.file),
      exactPort,
      workspaceMatch,
    });
  }

  for (const proc of ideProcsByPid.values()) {
    if (!proc.cliCsrf) continue;
    const exactPort = validPort(backendPort) && proc.hubPort === backendPort;
    const workspaceMatch = Boolean(workspaceSlug && proc.commandLine.toLowerCase().includes(workspaceSlug));
    addCandidate({
      pid: proc.pid,
      httpPort: proc.hubPort,
      httpsPort: null,
      csrf: proc.cliCsrf,
      lsVersion: null,
      credentialSource: 'remote-cmdline',
      file: null,
      isHubFile: proc.isHub,
      exactPort,
      workspaceMatch,
    });
  }

  candidates.sort((a, b) =>
    Number(b.exactPort) - Number(a.exactPort)
    || Number(b.workspaceMatch) - Number(a.workspaceMatch)
    || Number(b.isHubFile) - Number(a.isHubFile)
  );
  return candidates;
}

export async function probeRemoteSshHost(target, { run = execWithInput, timeoutMs = 8000, sshBinary = null } = {}) {
  const args = buildRemoteProbeArgs(target);
  const bin = sshBinary || resolveSshBinary(target.executable);
  try {
    const { stdout } = await run(bin, args, {
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      input: `${REMOTE_DISCOVERY_SCRIPT}\n`,
    });
    return parseRemoteSshDiscovery(stdout);
  } catch (error) {
    const stderr = String(error?.stderr || '');
    const authRejected = error?.code === 255
      || /permission denied|host key verification failed|authentication failed|passphrase|password|keyboard-interactive/i.test(stderr);
    const timedOut = Boolean(error?.killed || error?.code === 'ETIMEDOUT' || error?.signal === 'SIGTERM');
    if (authRejected) {
      throw Object.assign(new Error('SSH host requires interactive authentication; BatchMode probe skipped'), { code: 'SSH_AUTH_UNAVAILABLE' });
    }
    if (timedOut) {
      throw Object.assign(new Error('SSH remote discovery timed out'), { code: 'SSH_TIMEOUT' });
    }
    throw Object.assign(new Error('SSH remote discovery unavailable'), { code: 'SSH_DISCOVERY_FAILED' });
  }
}

// Manages local `ssh -D` tunnels and remote endpoint lookups for Antigravity App windows.
export class RemoteAppSshRegistry {
  constructor({
    discoverTunnels = discoverLocalSshTunnels,
    probeHost = probeRemoteSshHost,
    probeSocks5 = probeSocks5Port,
    pidAlive = isProcessAlive,
    now = Date.now,
    tunnelScanTtlMs = 5000,
    hostCacheTtlMs = 30000,
    authBackoffMs = 60000,
    errorBackoffMs = 15000,
    negativePortTtlMs = 10000,
    maxTunnels = 8,
  } = {}) {
    this.discoverTunnels = discoverTunnels;
    this.probeHost = probeHost;
    this.probeSocks5 = probeSocks5;
    this.pidAlive = pidAlive;
    this.now = now;
    this.tunnelScanTtlMs = tunnelScanTtlMs;
    this.hostCacheTtlMs = hostCacheTtlMs;
    this.authBackoffMs = authBackoffMs;
    this.errorBackoffMs = errorBackoffMs;
    this.negativePortTtlMs = negativePortTtlMs;
    this.maxTunnels = maxTunnels;
    this.tunnels = [];
    this.tunnelsScannedAt = -Infinity;
    this.tunnelsPending = null;
    this.tunnelCache = new Map(); // key `${socksPort}:${destination}` -> { endpoints, fetchedAt, retryAt, pending }
    this.portMap = new Map(); // windowPort -> { endpoint, matchedAt }
    this.negativePorts = new Map(); // windowPort -> expiresAt
  }

  async refreshTunnels(force = false) {
    if (!force && this.now() - this.tunnelsScannedAt < this.tunnelScanTtlMs) return this.tunnels;
    if (this.tunnelsPending) return this.tunnelsPending;
    this.tunnelsPending = Promise.resolve()
      .then(() => this.discoverTunnels())
      .then(list => {
        const clean = (Array.isArray(list) ? list : []).slice(0, this.maxTunnels);
        this.tunnels = clean;
        this.tunnelsScannedAt = this.now();
        const activeKeys = new Set(clean.map(t => `${t.socksPort}:${t.destination}`));
        for (const key of this.tunnelCache.keys()) {
          if (!activeKeys.has(key)) this.tunnelCache.delete(key);
        }
        for (const [port, entry] of this.portMap) {
          if (!activeKeys.has(`${entry.endpoint.socksPort}:${entry.endpoint.destination}`)) {
            this.portMap.delete(port);
          }
        }
        return this.tunnels;
      })
      .catch(() => {
        this.tunnelsScannedAt = this.now();
        return this.tunnels;
      })
      .finally(() => {
        this.tunnelsPending = null;
      });
    return this.tunnelsPending;
  }

  async endpointsForTunnel(tunnel, force = false) {
    const key = `${tunnel.socksPort}:${tunnel.destination}`;
    let entry = this.tunnelCache.get(key);
    if (entry?.pending) return entry.pending;
    if (!force && entry) {
      if (entry.endpoints && this.now() - entry.fetchedAt < this.hostCacheTtlMs) return entry.endpoints;
      if (entry.retryAt && this.now() < entry.retryAt) return entry.endpoints || [];
    }
    entry ||= { endpoints: [], fetchedAt: 0, retryAt: 0, pending: null };
    this.tunnelCache.set(key, entry);
    entry.pending = Promise.resolve()
      .then(() => this.probeHost(tunnel))
      .then(discovery => {
        const endpoints = matchRemoteAppEndpoints(discovery).map(ep => ({
          ...ep,
          socksPort: tunnel.socksPort,
          destination: tunnel.destination,
          tunnelPid: tunnel.pid,
        }));
        entry.endpoints = endpoints;
        entry.fetchedAt = this.now();
        entry.retryAt = 0;
        return endpoints;
      })
      .catch(error => {
        entry.retryAt = this.now() + (error?.code === 'SSH_AUTH_UNAVAILABLE' ? this.authBackoffMs : this.errorBackoffMs);
        return entry.endpoints || [];
      })
      .finally(() => {
        entry.pending = null;
      });
    return entry.pending;
  }

  async resolveEndpointForPort(windowPort, { force = false } = {}) {
    if (!validPort(windowPort)) return null;
    if (!force) {
      const cached = this.portMap.get(windowPort);
      if (cached) {
        const alive = !cached.endpoint.tunnelPid || this.pidAlive(cached.endpoint.tunnelPid);
        if (alive) return cached.endpoint;
        this.portMap.delete(windowPort);
      }
      const negUntil = this.negativePorts.get(windowPort);
      if (negUntil && this.now() < negUntil) return null;
    }

    let tunnels = await this.refreshTunnels(force);
    if (!tunnels.length && !force && this.now() - this.tunnelsScannedAt >= 1000) {
      tunnels = await this.refreshTunnels(true);
    }
    if (!tunnels.length) {
      this.negativePorts.set(windowPort, this.now() + Math.min(this.negativePortTtlMs, this.tunnelScanTtlMs));
      return null;
    }

    const findMatch = async list => {
      for (const tunnel of list) {
        const endpoints = await this.endpointsForTunnel(tunnel, force);
        const match = endpoints.find(ep => ep.httpsPort === windowPort || ep.port === windowPort);
        if (!match) continue;
        const reachable = await this.probeSocks5(tunnel.socksPort, match.port, { timeoutMs: 1000 }).catch(() => false);
        if (!reachable) continue;
        return { ...match, windowPort };
      }
      return null;
    };

    let endpoint = await findMatch(tunnels);
    if (!endpoint && !force && this.now() - this.tunnelsScannedAt >= 1000) {
      tunnels = await this.refreshTunnels(true);
      endpoint = await findMatch(tunnels);
    }
    if (endpoint) {
      this.portMap.set(windowPort, { endpoint, matchedAt: this.now() });
      this.negativePorts.delete(windowPort);
      return endpoint;
    }

    this.negativePorts.set(windowPort, this.now() + this.negativePortTtlMs);
    return null;
  }

  invalidatePort(windowPort) {
    this.portMap.delete(windowPort);
    this.negativePorts.delete(windowPort);
  }
}

export class RemoteAppClient extends AntigravityClient {
  constructor({ windowPort, registry, probeSocks5 = probeSocks5Port, socksAgentFactory, now = Date.now, onRpc = null } = {}) {
    super({ probeSocks5, ...(socksAgentFactory ? { socksAgentFactory } : {}), now, onRpc });
    this.windowPort = windowPort;
    this.registry = registry;
    this.hasAttemptedDiscovery = false;
  }

  async discoverNow() {
    this.server = null;
    this.verifiedServer = null;
    const force = this.hasAttemptedDiscovery;
    this.hasAttemptedDiscovery = true;
    if (force) this.registry.invalidatePort(this.windowPort);
    const matched = await this.registry.resolveEndpointForPort(this.windowPort, { force });
    if (!matched) {
      throw new Error('等待远程 SSH 语言服务连接');
    }
    const server = { port: matched.port, csrf: matched.csrf, pid: matched.pid };
    Object.defineProperty(server, 'socksPort', { value: matched.socksPort, enumerable: false });
    Object.defineProperty(server, 'httpsPort', { value: matched.httpsPort ?? null, enumerable: false });
    Object.defineProperty(server, 'destination', { value: matched.destination, enumerable: false });
    Object.defineProperty(server, 'credentialSource', { value: matched.credentialSource || 'remote-daemon-file', enumerable: false });
    Object.defineProperty(server, 'remote', { value: true, enumerable: false });
    Object.defineProperty(server, 'remoteHub', { value: true, enumerable: false });
    this.server = server;
    this.discoveredAt = this.now();
    return this.server;
  }
}
