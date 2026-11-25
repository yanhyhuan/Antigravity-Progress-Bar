import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { discoverIdeWebviews } from '../webview-targets.mjs';
import { RemoteIdeClient } from '../remote-client.mjs';

const stopServer = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });

const port = 9000;
const app = '/d:/IDE/resources/app';
const uuid = '11111111-1111-1111-1111-111111111111';
const wrapperOrigin = 'vscode-webview://fixture-host';
const wrapperUrl = `${wrapperOrigin}/index.html?id=${uuid}&parentId=1&origin=${uuid}&extensionId=&platform=electron&parentOrigin=vscode-file%3A%2F%2Fvscode-app&purpose=webviewView`;
const backend = 'http://127.0.0.1:17000/?extensionView=true&extensionVariant=vs-code&useWebSocket=true&platform=electron';
const hexAuthority = Buffer.from(JSON.stringify({ hostName: 'ubuntu@10.0.0.5' }), 'utf8').toString('hex');
const remoteBridge = `https://vscode-remote+ssh-002dremote-002b${hexAuthority}.vscode-resource.vscode-cdn.net/home/ubuntu/.antigravity-ide-server/bin/2.8.0-abcdef/extensions/agy/bridge.js`;
const target = (id, type, url) => ({ id, type, url, webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${id}` });

function remoteFixture({ bridge = remoteBridge, overlayExtra = {}, backendUrl = backend } = {}) {
  const wb = target('workbench', 'page', `vscode-file://vscode-app${app}/out/vs/code/electron-browser/workbench/workbench.html`);
  const wrapper = target('wrapper', 'iframe', wrapperUrl);
  const inner = target('jetski', 'iframe', backendUrl);
  const state = {
    targets: [wb, wrapper, inner],
    workbenches: [wb],
    port,
    overlays: [{ url: wrapperUrl, id: uuid, ...overlayExtra }],
    contexts: [
      { id: 1, origin: wrapperOrigin, auxData: { isDefault: true, frameId: 'wrapper' } },
      { id: 2, origin: wrapperOrigin, auxData: { isDefault: true, frameId: 'content' } },
    ],
    content: { host: 'antigravity', url: backendUrl, scripts: [bridge] },
    tree: {
      frame: { id: 'wrapper', url: wrapperUrl },
      childFrames: [{ frame: { id: 'content', parentId: 'wrapper', url: `${wrapperOrigin}/fake.html` }, childFrames: [{ frame: { id: 'jetski', parentId: 'content', url: backendUrl } }] }],
    },
  };
  state.connect = (url, options) => {
    const isMain = url === wb.webSocketDebuggerUrl;
    const isWrapper = url === wrapper.webSocketDebuggerUrl;
    return {
      async open() { return this; },
      async command(method, params = {}) {
        if (method === 'Runtime.enable') for (const context of state.contexts) options.onEvent({ method: 'Runtime.executionContextCreated', params: { context } });
        if (method === 'Page.getFrameTree') {
          if (isWrapper) return { frameTree: state.tree };
          return { frameTree: state.tree.childFrames[0].childFrames[0] };
        }
        if (method === 'DOM.getFrameOwner') return { backendNodeId: 4 };
        if (method === 'DOM.describeNode') return { node: { localName: 'iframe', attributes: ['id', 'jetski-frame', 'src', state.content.url] } };
        if (method === 'Runtime.evaluate') return { result: { value: isMain ? state.overlays : (params.contextId === 2 ? state.content : null) } };
        return {};
      },
      close() {},
    };
  };
  return state;
}

test('discoverIdeWebviews authorizes verified Remote-SSH bridge and forwards remoteAuthority, backendPort and workspaceUri', async () => {
  const wsUri = `vscode-remote://ssh-remote+${hexAuthority}/home/ubuntu/project`;
  const f = remoteFixture({ overlayExtra: { remoteAuthority: `ssh-remote+${hexAuthority}`, workspaceUri: wsUri } });
  const result = await discoverIdeWebviews(f);
  assert.equal(result.length, 1);
  assert.equal(result[0].ideWebview, true);
  assert.equal(result[0].remoteAuthority, `ssh-remote+${hexAuthority}`);
  assert.equal(result[0].backendPort, 17000);
  assert.equal(result[0].workspaceUri, wsUri);

  // Also works with CLI server layout and plain SSH host authority, preserving original workbench casing.
  const cliBridge = 'https://vscode-remote+ssh-002dremote-002bdev-002dbox.vscode-resource.vscode-cdn.net/home/u/.antigravity-ide-server/cli/servers/Stable-123/server/extensions/agy/bridge.js';
  const cliResult = await discoverIdeWebviews(remoteFixture({ bridge: cliBridge, overlayExtra: { remoteAuthority: 'ssh-remote+Dev-Box' } }));
  assert.equal(cliResult.length, 1);
  assert.equal(cliResult[0].remoteAuthority, 'ssh-remote+Dev-Box');
  assert.equal(cliResult[0].backendPort, 17000);
});

test('discoverIdeWebviews rejects forged Remote-SSH paths, non-SSH remote authorities and authority mismatches', async () => {
  const badCases = [
    // Non-SSH remote authority (WSL)
    { bridge: 'https://vscode-remote+wsl-002bUbuntu.vscode-resource.vscode-cdn.net/home/u/.antigravity-ide-server/bin/2.8.0/extensions/agy/bridge.js' },
    // Arbitrary path outside .antigravity-ide-server/bin/*/extensions/agy/bridge.js
    { bridge: `https://vscode-remote+ssh-002dremote-002b${hexAuthority}.vscode-resource.vscode-cdn.net/tmp/extensions/agy/bridge.js` },
    { bridge: `https://vscode-remote+ssh-002dremote-002b${hexAuthority}.vscode-resource.vscode-cdn.net/home/u/.antigravity-ide-server/extensions/other/bridge.js` },
    // Traversal
    { bridge: `https://vscode-remote+ssh-002dremote-002b${hexAuthority}.vscode-resource.vscode-cdn.net/home/u/.antigravity-ide-server/bin/2.8.0/../../evil/extensions/agy/bridge.js` },
    // Query param
    { bridge: `${remoteBridge}?forged=1` },
    // Mismatched workbench remoteAuthority vs bridge remoteAuthority
    { bridge: remoteBridge, overlayExtra: { remoteAuthority: 'ssh-remote+different-host' } },
  ];
  for (const cfg of badCases) {
    assert.deepEqual(await discoverIdeWebviews(remoteFixture(cfg)), [], cfg.bridge);
  }
});

test('RemoteIdeClient pairs remote multi-line daemon csrfToken against locally forwarded backendPort without extra SSH probes', async t => {
  const seenTokens = [];
  const server = createServer((req, res) => {
    req.resume();
    const token = req.headers['x-codeium-csrf-token'];
    seenTokens.push(token);
    if (token === 'correct-remote-csrf') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ userStatus: { email: 'ide-remote@example.com' } }));
    } else {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end('{}');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => stopServer(server));
  const forwardedPort = server.address().port;

  let sshProbes = 0;
  let now = 50000;
  const client = new RemoteIdeClient({
    remoteAuthority: `ssh-remote+${hexAuthority}`,
    backendPort: forwardedPort,
    workspaceUri: `vscode-remote://ssh-remote+${hexAuthority}/home/ubuntu/project`,
    now: () => now,
    probeHost: async target => {
      sshProbes++;
      assert.equal(target.destination, 'ubuntu@10.0.0.5');
      return {
        processes: [
          { pid: 3001, commandLine: '/home/ubuntu/.antigravity-ide-server/bin/2.8.0/agy --hub --hub-port=51000', isHub: true, cliCsrf: '' },
          { pid: 3002, commandLine: '/home/ubuntu/.antigravity-ide-server/bin/2.8.0/agy --hub --hub-port=52000 --workspace_id /home/ubuntu/project', isHub: true, cliCsrf: '' },
        ],
        daemonFiles: [
          { pid: 3001, httpPort: 51000, httpsPort: 51001, csrfToken: 'wrong-remote-csrf', lsVersion: '2.35.0', file: 'hub_51000.json' },
          { pid: 3002, httpPort: 52000, httpsPort: 52001, csrfToken: 'correct-remote-csrf', lsVersion: '2.35.0', file: 'hub_52000.json' },
        ],
        logPorts: [],
      };
    },
  });

  const discovered = await client.discover();
  assert.deepEqual(discovered, { port: forwardedPort, csrf: 'correct-remote-csrf', pid: 3002 });
  assert.equal(discovered.remote, true);
  assert.equal(sshProbes, 1);
  // Workspace match was prioritized first!
  assert.equal(seenTokens[0], 'correct-remote-csrf');

  const user = await client.call('GetUserStatus');
  assert.equal(user.userStatus.email, 'ide-remote@example.com');

  // After lease expires, verifyCachedServer probes local loopback port without calling SSH again.
  now += 25000;
  await client.discover();
  assert.equal(sshProbes, 1, 'Healthy forwarded port must renew lease without re-running ssh');
});

test('RemoteIdeClient backs off gracefully when SSH BatchMode auth fails', async () => {
  let sshProbes = 0;
  let now = 10000;
  const client = new RemoteIdeClient({
    remoteAuthority: 'ssh-remote+2fa-host',
    backendPort: 17000,
    now: () => now,
    probe: async () => true,
    probeHost: async () => {
      sshProbes++;
      throw Object.assign(new Error('auth required'), { code: 'SSH_AUTH_UNAVAILABLE' });
    },
  });

  await assert.rejects(client.discover(), /auth required/);
  assert.equal(sshProbes, 1);

  now += 15000; // Past default 3s client retryAt, still inside 60s auth backoff
  await assert.rejects(client.discover(), /authentication unavailable/);
  assert.equal(sshProbes, 1);
});
