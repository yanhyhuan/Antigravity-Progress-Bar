import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  REMOTE_DISCOVERY_SCRIPT,
  RemoteAppClient,
  RemoteAppSshRegistry,
  buildRemoteProbeArgs,
  decodeWebviewRemoteAuthority,
  matchRemoteAppEndpoints,
  matchRemoteIdeCandidates,
  parseRemoteSshDiscovery,
  parseSshRemoteAuthority,
  parseSshTunnelCommand,
  probeRemoteSshHost,
} from '../ssh-remote.mjs';
import { RuntimeUi } from '../../../compat/runtime-ui.mjs';

test('parseSshTunnelCommand parses loopback -D tunnels, preserves safe flags and blocks unsafe options/injection', () => {
  const winCmd = '"C:\\Windows\\System32\\OpenSSH\\ssh.exe" -T -D 127.0.0.1:54321 -p 2222 -i "C:\\Users\\me\\.ssh\\id_ed25519" -o ServerAliveInterval=30 -o ProxyCommand="evil" -o LocalCommand="bad" -- ubuntu@10.0.0.5 sh -s';
  const parsed = parseSshTunnelCommand(winCmd, 4200);
  assert.equal(parsed.pid, 4200);
  assert.equal(parsed.socksPort, 54321);
  assert.equal(parsed.destination, 'ubuntu@10.0.0.5');
  assert.deepEqual(parsed.remoteCommand, ['sh', '-s']);
  assert.deepEqual(parsed.forwardedArgs, ['-p', '2222', '-i', 'C:\\Users\\me\\.ssh\\id_ed25519', '-o', 'ServerAliveInterval=30']);

  const clustered = parseSshTunnelCommand('/usr/bin/ssh -TD55555 -l dev my-box.local sh -s', 88);
  assert.equal(clustered.socksPort, 55555);
  assert.equal(clustered.destination, 'my-box.local');
  assert.deepEqual(clustered.forwardedArgs, ['-l', 'dev']);

  // Reject non-loopback -D, missing -D, non-ssh binaries, and option-injected destinations.
  for (const bad of [
    'ssh -T -D 0.0.0.0:1080 -- host sh -s',
    'ssh -T -D 192.168.1.5:1080 -- host sh -s',
    'ssh -T -- host sh -s',
    'not-ssh -D 127.0.0.1:1080 -- host sh -s',
    'ssh -D 127.0.0.1:1080 -- -oProxyCommand=calc host',
    'ssh -D 127.0.0.1:1080 -- "host; rm -rf /" sh -s',
  ]) {
    assert.equal(parseSshTunnelCommand(bad), null, bad);
  }
});

test('parseSshRemoteAuthority and decodeWebviewRemoteAuthority handle plain and hex-JSON authorities safely', () => {
  assert.deepEqual(parseSshRemoteAuthority('ssh-remote+dev-box'), {
    remoteAuthority: 'ssh-remote+dev-box',
    destination: 'dev-box',
    user: null,
    port: null,
  });

  const hexJson = Buffer.from(JSON.stringify({ hostName: '10.1.2.3', user: 'ubuntu', port: 2222 }), 'utf8').toString('hex');
  assert.deepEqual(parseSshRemoteAuthority(`ssh-remote+${hexJson}`), {
    remoteAuthority: `ssh-remote+${hexJson}`,
    destination: '10.1.2.3',
    user: 'ubuntu',
    port: 2222,
  });

  const encodedHost = `vscode-remote+ssh-002dremote-002b${hexJson}.vscode-resource.vscode-cdn.net`;
  assert.deepEqual(decodeWebviewRemoteAuthority(encodedHost), {
    remoteAuthority: `ssh-remote+${hexJson}`,
    destination: '10.1.2.3',
    user: 'ubuntu',
    port: 2222,
  });

  const plainEncodedHost = 'vscode-remote+ssh-002dremote-002bmy-002dserver-002elocal.vscode-resource.vscode-cdn.net';
  assert.deepEqual(decodeWebviewRemoteAuthority(plainEncodedHost), {
    remoteAuthority: 'ssh-remote+my-server.local',
    destination: 'my-server.local',
    user: null,
    port: null,
  });

  for (const bad of [
    'wsl+Ubuntu',
    'ssh-remote+-oProxyCommand=evil',
    'ssh-remote+bad host',
    'file+.vscode-resource.vscode-cdn.net',
    'vscode-remote+wsl-002bUbuntu.vscode-resource.vscode-cdn.net',
    'vscode-remote+ssh-002dremote-002bhost.evil.example',
  ]) {
    assert.equal(decodeWebviewRemoteAuthority(bad), null, bad);
  }
});

test('buildRemoteProbeArgs enforces non-interactive BatchMode, runs POSIX sh -s over stdin and keeps script out of argv', () => {
  const args = buildRemoteProbeArgs({
    destination: 'ubuntu@dev-box',
    user: 'alt',
    port: 2222,
    forwardedArgs: ['-o', 'ProxyCommand=calc', '-o', 'IdentityFile=/keys/id'],
  });
  assert.ok(args.includes('-T'));
  assert.equal(args.includes('-n'), false, 'must not pass -n because discovery script is piped over stdin to sh -s');
  assert.ok(args.includes('BatchMode=yes'));
  assert.ok(args.includes('PasswordAuthentication=no'));
  assert.ok(args.includes('KbdInteractiveAuthentication=no'));
  assert.ok(args.includes('ControlMaster=no'));
  assert.equal(args.some(a => /ProxyCommand/i.test(a)), false);
  assert.equal(args.some(a => a.includes('===AGP_DAEMON===') || a.includes('language_server')), false);
  const sep = args.indexOf('--');
  assert.ok(sep > 0);
  assert.deepEqual(args.slice(sep + 1), ['ubuntu@dev-box', 'sh', '-s']);
});

test('probeRemoteSshHost feeds REMOTE_DISCOVERY_SCRIPT via stdin and classifies SSH errors safely', async () => {
  let captured = null;
  const discovery = await probeRemoteSshHost({ destination: 'ubuntu@dev-box', port: 2222 }, {
    sshBinary: 'ssh',
    run: async (bin, args, opts) => {
      captured = { bin, args, opts };
      return {
        stdout: [
          '===AGP_PS===',
          '1001 /home/u/.antigravity-hub-server/bin/2.35.1/language_server --standalone',
          '===AGP_DAEMON===',
          '===AGP_FILE:ls_only.json===',
          '{"pid":1001,"httpPort":41235,"httpsPort":41234,"csrfToken":"stdin-token"}',
          '===AGP_END===',
          '===AGP_LOGS===',
        ].join('\n'),
        stderr: '',
      };
    },
  });
  assert.equal(captured.bin, 'ssh');
  assert.deepEqual(captured.args.slice(-3), ['ubuntu@dev-box', 'sh', '-s']);
  assert.equal(captured.opts.input, `${REMOTE_DISCOVERY_SCRIPT}\n`);
  assert.equal(discovery.daemonFiles.length, 1);
  assert.equal(discovery.daemonFiles[0].csrfToken, 'stdin-token');

  // Missing binary / early exit must reject cleanly without unhandled stdin EPIPE errors.
  await assert.rejects(
    probeRemoteSshHost({ destination: 'ubuntu@dev-box' }, { sshBinary: join(tmpdir(), 'nonexistent-ssh-binary-agp-test') }),
    err => err?.code === 'SSH_DISCOVERY_FAILED',
  );
  await assert.rejects(
    probeRemoteSshHost({ destination: 'ubuntu@dev-box' }, {
      run: async () => { throw Object.assign(new Error('denied'), { code: 255, stderr: 'Permission denied (publickey).' }); },
    }),
    err => err?.code === 'SSH_AUTH_UNAVAILABLE',
  );
});

test('parseRemoteSshDiscovery ignores echoed probe script lines, login banners and CRLF endings (#25)', () => {
  const collapsedScript = REMOTE_DISCOVERY_SCRIPT.replace(/\r?\n/g, ' ');
  const stdout = [
    'Welcome to Ubuntu 24.04 LTS (banner before markers)',
    '===AGP_PS===',
    `50001 /usr/bin/zsh -c ${collapsedScript}`,
    `50002 /bin/bash -c ${REMOTE_DISCOVERY_SCRIPT}`,
    '1001 /home/u/.antigravity-hub-server/bin/2.35.1/language_server --standalone --subclient_type hub',
    '2002 /home/u/.antigravity-ide-server/bin/2.35.1/agy --hub --hub-port=45123 --workspace_id /home/u/repo',
    '===AGP_DAEMON===',
    '===AGP_FILE:ls_hub.json===',
    '{',
    '  "pid": 1001,',
    '  "httpPort": 41235,',
    '  "httpsPort": 41234,',
    '  "lsVersion": "2.35.1",',
    '  "csrfToken": "app-token-after-echo"',
    '}',
    '===AGP_END===',
    '===AGP_FILE:hub_ide.json===',
    '{',
    '  "pid": 2002,',
    '  "httpPort": 45123,',
    '  "httpsPort": 45122,',
    '  "lsVersion": "2.35.1",',
    '  "csrfToken": "ide-token-after-echo"',
    '}',
    '===AGP_END===',
    '===AGP_LOGS===',
    '2026-11-25 listening on random port at 41235 for HTTP',
  ].join('\r\n');

  const discovery = parseRemoteSshDiscovery(stdout);
  assert.deepEqual(discovery.processes.map(p => p.pid), [1001, 2002]);
  assert.equal(discovery.daemonFiles.length, 2);
  assert.deepEqual(discovery.logPorts, [41235]);

  const appEndpoints = matchRemoteAppEndpoints(discovery);
  assert.equal(appEndpoints.length, 1);
  assert.equal(appEndpoints[0].csrf, 'app-token-after-echo');
  assert.equal(appEndpoints[0].port, 41235);

  const ideCandidates = matchRemoteIdeCandidates(discovery, { backendPort: 45123, workspaceUri: 'vscode-remote://ssh-remote+dev/home/u/repo' });
  assert.equal(ideCandidates.length, 1);
  assert.equal(ideCandidates[0].csrf, 'ide-token-after-echo');
});

test('REMOTE_DISCOVERY_SCRIPT runs cleanly via POSIX sh -s without hub_*.json globs and enforces symlink/size guards', async t => {
  const shBin = process.platform === 'win32'
    ? ['C:\\Program Files\\Git\\bin\\sh.exe', 'C:\\Program Files\\Git\\usr\\bin\\sh.exe'].find(p => existsSync(p))
    : ['/bin/sh', '/usr/bin/sh'].find(p => existsSync(p));
  if (!shBin) {
    t.skip('No POSIX sh binary available on this runner');
    return;
  }

  const fakeHome = await mkdtemp(join(tmpdir(), 'agp-ssh-probe-'));
  t.after(() => rm(fakeHome, { recursive: true, force: true }));
  const daemonDir = join(fakeHome, '.gemini', 'antigravity', 'daemon');
  const logDir = join(fakeHome, '.antigravity-hub-server', 'data');
  await mkdir(daemonDir, { recursive: true });
  await mkdir(logDir, { recursive: true });

  // Only ls_*.json exists (no hub_*.json) — reproduces the zsh NOMATCH case from #25.
  await writeFile(join(daemonDir, 'ls_only.json'), JSON.stringify({
    pid: 4242,
    httpPort: 41235,
    httpsPort: 41234,
    lsVersion: '2.35.1',
    csrfToken: 'real-sh-token',
  }, null, 2));
  await writeFile(join(daemonDir, 'ls_oversized.json'), JSON.stringify({
    pid: 4243,
    httpPort: 41237,
    csrfToken: 'x'.repeat(20000),
  }));
  await writeFile(join(daemonDir, 'unrelated.txt'), 'ignored');
  const outsideFile = join(fakeHome, 'outside.json');
  await writeFile(outsideFile, JSON.stringify({ pid: 4244, httpPort: 41239, csrfToken: 'symlink-secret' }));
  let symlinkCreated = false;
  try {
    await symlink(outsideFile, join(daemonDir, 'ls_link.json'));
    symlinkCreated = true;
  } catch {
    // Windows without Developer Mode / admin cannot create symlinks; skip symlink assertion only.
  }
  await writeFile(join(logDir, 'ls-1.log'), 'info listening on random port at 41235 for HTTP\n');

  const runSh = (args, input = null) => new Promise((resolve, reject) => {
    const child = execFile(shBin, args, {
      env: { ...process.env, HOME: fakeHome },
      windowsHide: true,
      timeout: 8000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
    if (child.stdin) {
      child.stdin.on('error', () => {});
      if (input !== null) child.stdin.end(input);
      else child.stdin.end();
    }
  });

  // 1) Primary production mode: `sh -s` fed over stdin.
  const viaStdin = await runSh(['-s'], `${REMOTE_DISCOVERY_SCRIPT}\n`);
  const parsedStdin = parseRemoteSshDiscovery(viaStdin.stdout);
  assert.equal(parsedStdin.daemonFiles.length, 1);
  assert.equal(parsedStdin.daemonFiles[0].file, 'ls_only.json');
  assert.equal(parsedStdin.daemonFiles[0].csrfToken, 'real-sh-token');
  assert.deepEqual(parsedStdin.logPorts, [41235]);
  if (symlinkCreated) {
    assert.equal(parsedStdin.daemonFiles.some(f => f.csrfToken === 'symlink-secret'), false);
  }

  // 2) Defense-in-depth mode: even if run via `sh -c "<script>"`, self-echo must never truncate daemonFiles.
  const viaArg = await runSh(['-c', REMOTE_DISCOVERY_SCRIPT]);
  const parsedArg = parseRemoteSshDiscovery(viaArg.stdout);
  assert.equal(parsedArg.daemonFiles.length, 1);
  assert.equal(parsedArg.daemonFiles[0].csrfToken, 'real-sh-token');
  assert.equal(parsedArg.processes.some(p => p.commandLine.includes('===AGP_PS===')), false);

  // 3) Non-/proc ps+awk branch (macOS/BSD): excludes self PID, wrong UID, awk itself and echoed probe scripts.
  const psLine = REMOTE_DISCOVERY_SCRIPT.split('\n').find(line => line.includes('ps -ww'));
  assert.ok(psLine);
  const awkCmd = psLine.slice(psLine.indexOf('awk ')).replace('"$$"', '"100"');
  const psFixture = [
    '100 501 /bin/sh -s',
    '101 501 /home/u/language_server --standalone',
    '102 501 awk -v uid=501 ===AGP_PS===',
    '103 501 /usr/bin/zsh -c printf ===AGP_DAEMON=== agy',
    '104 502 /home/other/language_server --standalone',
    '105 501 /home/u/agy --hub --hub-port=45123',
  ].join('\n');
  const psScript = `id() { echo 501; }\n${awkCmd} <<'__PS__'\n${psFixture}\n__PS__\n`;
  const psOut = await runSh(['-s'], psScript);
  assert.deepEqual(psOut.stdout.trim().split(/\r?\n/), [
    '101 /home/u/language_server --standalone',
    '105 /home/u/agy --hub --hub-port=45123',
  ]);
});

test('parseRemoteSshDiscovery parses multi-line daemon JSON blocks and pairs live App and IDE processes', () => {
  const stdout = [
    '===AGP_PS===',
    '1001 /home/u/.antigravity-hub-server/bin/2.34.0-x64/language_server --standalone --subclient_type hub --workspace_id agy-hub-ssh',
    '2002 /home/u/.antigravity-ide-server/bin/2.8.0/agy --hub --hub-port=45123 --workspace_id /home/u/repo-alpha',
    '===AGP_DAEMON===',
    '===AGP_FILE:ls_stale.json===',
    '{',
    '  "pid": 99999,',
    '  "httpPort": 40001,',
    '  "httpsPort": 40000,',
    '  "csrfToken": "dead-pid-token"',
    '}',
    '===AGP_END===',
    '===AGP_FILE:ls_hub.json===',
    '{',
    '  "pid": 1001,',
    '  "httpPort": 41235,',
    '  "httpsPort": 41234,',
    '  "lsVersion": "2.34.0",',
    '  "csrfToken": "remote-app-token"',
    '}',
    '===AGP_END===',
    '===AGP_FILE:hub_ide.json===',
    '{',
    '  "pid": 2002,',
    '  "httpPort": 45123,',
    '  "httpsPort": 45122,',
    '  "lsVersion": "2.35.0",',
    '  "csrfToken": "remote-ide-token"',
    '}',
    '===AGP_END===',
    '===AGP_LOGS===',
  ].join('\n');

  const discovery = parseRemoteSshDiscovery(stdout);
  assert.equal(discovery.processes.length, 2);
  assert.equal(discovery.daemonFiles.length, 3);

  const appEndpoints = matchRemoteAppEndpoints(discovery);
  assert.equal(appEndpoints.length, 1);
  assert.equal(appEndpoints[0].pid, 1001);
  assert.equal(appEndpoints[0].port, 41235);
  assert.equal(appEndpoints[0].httpsPort, 41234);
  assert.equal(appEndpoints[0].csrf, 'remote-app-token');
  assert.equal(appEndpoints[0].remote, true);

  const ideCandidates = matchRemoteIdeCandidates(discovery, { backendPort: 45123, workspaceUri: 'vscode-remote://ssh-remote+dev/home/u/repo-alpha' });
  assert.equal(ideCandidates.length, 1);
  assert.equal(ideCandidates[0].pid, 2002);
  assert.equal(ideCandidates[0].csrf, 'remote-ide-token');
  assert.equal(ideCandidates[0].exactPort, true);
  assert.equal(ideCandidates[0].workspaceMatch, true);
});

test('RemoteAppSshRegistry maps remote window httpsPort via -D tunnel, caches probes and backs off auth failures', async () => {
  let now = 10000;
  let probeCalls = 0;
  let socksCalls = 0;
  let authFail = false;

  const registry = new RemoteAppSshRegistry({
    now: () => now,
    pidAlive: () => true,
    discoverTunnels: async () => [{ pid: 555, socksPort: 54321, destination: 'dev-box', forwardedArgs: [] }],
    probeHost: async () => {
      probeCalls++;
      if (authFail) throw Object.assign(new Error('auth required'), { code: 'SSH_AUTH_UNAVAILABLE' });
      return {
        processes: [{ pid: 1001, commandLine: 'language_server --standalone', isStandalone: true, cliCsrf: '' }],
        daemonFiles: [{ pid: 1001, httpPort: 41235, httpsPort: 41234, csrfToken: 'ssh-tok', lsVersion: '2.34.0', file: 'ls_1.json' }],
        logPorts: [],
      };
    },
    probeSocks5: async (proxyPort, targetPort) => {
      socksCalls++;
      return proxyPort === 54321 && targetPort === 41235;
    },
  });

  const resolved = await registry.resolveEndpointForPort(41234);
  assert.equal(resolved.port, 41235);
  assert.equal(resolved.socksPort, 54321);
  assert.equal(resolved.csrf, 'ssh-tok');
  assert.equal(probeCalls, 1);
  assert.equal(socksCalls, 1);

  // RemoteAppClient consumes cached registry entry on initial discovery without a redundant SSH probe.
  const remoteClient = new RemoteAppClient({ windowPort: 41234, registry, now: () => now });
  const server = await remoteClient.discover();
  assert.deepEqual(server, { port: 41235, csrf: 'ssh-tok', pid: 1001 });
  assert.equal(server.socksPort, 54321);
  assert.equal(server.remote, true);
  assert.equal(probeCalls, 1);

  // Auth failure degrades gracefully and respects backoff.
  authFail = true;
  registry.invalidatePort(41234);
  now += 40000;
  assert.equal(await registry.resolveEndpointForPort(49999), null);
  const callsAfterFailure = probeCalls;
  now += 10000; // Still inside 60s auth backoff
  assert.equal(await registry.resolveEndpointForPort(49998), null);
  assert.equal(probeCalls, callsAfterFailure);
});

test('RuntimeUi forwards targetContext metadata to snapshot so local and SSH windows route independently', async t => {
  const seen = [];
  const targets = [
    { id: 'local', type: 'page', url: 'https://127.0.0.1:5000/c/chat', webSocketDebuggerUrl: 'ws://127.0.0.1:9123/devtools/page/local' },
    { id: 'remote', type: 'page', url: 'https://127.0.0.1:41234/c/chat', webSocketDebuggerUrl: 'ws://127.0.0.1:9123/devtools/page/remote' },
  ];
  const connections = [];
  class FakeConn {
    constructor(options) { this.options = options; this.closed = false; }
    async open() { return this; }
    async command(method) {
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } };
      if (method === 'Runtime.enable') this.options.onEvent({ method: 'Runtime.executionContextCreated', params: { context: { id: 7, origin: this.origin, auxData: { isDefault: true, frameId: 'main' } } } });
      if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 's' };
      if (method === 'Runtime.evaluate') return { result: { value: { mounted: true, installed: true, bridge: true } } };
      return {};
    }
    close() { this.closed = true; }
  }
  const ui = new RuntimeUi({
    source: 'widget',
    discover: async () => targets,
    connect: (_url, options) => { const c = new FakeConn(options); connections.push(c); return c; },
    snapshot: async (input, targetContext) => {
      seen.push({ input, port: targetContext?.port, origin: targetContext?.origin });
      return { connection: 'live', groups: [], speed: null };
    },
  });
  t.after(() => ui.stop());
  await ui.tick();
  assert.equal(connections.length, 2);
  for (const conn of connections) {
    await ui.event(conn, {
      method: 'Runtime.bindingCalled',
      params: { name: ui.binding, executionContextId: 7, payload: JSON.stringify({ id: 1, type: 'metrics', input: { conversationId: null } }) },
    });
  }
  assert.deepEqual(seen.map(item => item.port), [5000, 41234]);
});
