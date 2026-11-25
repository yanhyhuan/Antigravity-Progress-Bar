import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createConnection, createServer as createTcpServer } from 'node:net';
import { connectSocks5, createSocks5Agent, probeSocks5Port } from '../socks5.mjs';
import { AntigravityClient } from '../client.mjs';

const stopHttp = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
const stopTcp = (server, sockets) => new Promise(resolve => {
  for (const s of sockets) s.destroy();
  server.close(resolve);
});

async function startMockSocks5(t, { mode = 'relay', splitGreeting = false, replyAtyp = 0x01, rejectRep = 0x00, authMethod = 0x00 } = {}) {
  const sockets = new Set();
  const connects = [];
  const server = createTcpServer(client => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    let stage = 'greeting';
    let buf = Buffer.alloc(0);
    client.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 'greeting') {
        if (buf.length < 3) return;
        const nmethods = buf[1];
        if (buf.length < 2 + nmethods) return;
        buf = buf.subarray(2 + nmethods);
        stage = 'request';
        if (splitGreeting) {
          client.write(Buffer.from([0x05]));
          setTimeout(() => client.write(Buffer.from([authMethod])), 10);
        } else {
          client.write(Buffer.from([0x05, authMethod]));
        }
        if (authMethod !== 0x00) {
          client.end();
          return;
        }
      }
      if (stage === 'request') {
        if (buf.length < 4) return;
        const atyp = buf[3];
        const reqLen = atyp === 0x01 ? 10 : atyp === 0x04 ? 22 : -1;
        if (reqLen < 0 || buf.length < reqLen) return;
        const host = atyp === 0x01 ? `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}` : '::1';
        const port = buf.readUInt16BE(reqLen - 2);
        const trailing = buf.subarray(reqLen);
        connects.push({ host, port });
        stage = 'connected';
        if (rejectRep !== 0x00) {
          client.write(Buffer.from([0x05, rejectRep, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          client.end();
          return;
        }
        if (mode === 'bad-version') {
          client.write(Buffer.from([0x04, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          client.end();
          return;
        }
        const upstream = createConnection({ host, port });
        sockets.add(upstream);
        upstream.on('close', () => sockets.delete(upstream));
        upstream.once('connect', () => {
          let reply;
          if (replyAtyp === 0x03) {
            const domain = Buffer.from('localhost');
            reply = Buffer.concat([Buffer.from([0x05, 0x00, 0x00, 0x03, domain.length]), domain, Buffer.from([0, 0])]);
          } else if (replyAtyp === 0x04) {
            reply = Buffer.concat([Buffer.from([0x05, 0x00, 0x00, 0x04]), Buffer.alloc(16), Buffer.from([0, 0])]);
          } else {
            reply = Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]);
          }
          client.write(reply);
          if (trailing.length) upstream.write(trailing);
          client.removeAllListeners('data');
          client.pipe(upstream);
          upstream.pipe(client);
        });
        upstream.once('error', () => {
          client.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          client.end();
        });
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => stopTcp(server, sockets));
  return { port: server.address().port, connects };
}

test('SOCKS5 client tunnels AntigravityClient RPC and streamTrajectoryPage over loopback proxy', async t => {
  const rpcCalls = [];
  const rpcServer = createHttpServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      rpcCalls.push({ url: req.url, csrf: req.headers['x-codeium-csrf-token'], body: JSON.parse(body || '{}') });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url.endsWith('/GetUserStatus')) {
        res.end(JSON.stringify({ userStatus: { email: 'remote@example.com' } }));
      } else if (req.url.endsWith('/GetCascadeTrajectorySteps')) {
        res.end(JSON.stringify({ steps: [{ type: 'CORTEX_STEP_TYPE_USER_INPUT', metadata: { createdAt: '2026-11-24T00:00:00Z' } }] }));
      } else {
        res.end('{}');
      }
    });
  });
  await new Promise(resolve => rpcServer.listen(0, '127.0.0.1', resolve));
  t.after(() => stopHttp(rpcServer));
  const targetPort = rpcServer.address().port;

  const proxy = await startMockSocks5(t, { splitGreeting: true, replyAtyp: 0x03 });

  let pidAliveCalled = false;
  let now = 1000;
  const client = new AntigravityClient({
    now: () => now,
    pidAlive: () => { pidAliveCalled = true; return false; },
    socksAgentFactory: (p, opts) => createSocks5Agent(p, opts),
  });
  const remoteEndpoint = { port: targetPort, csrf: 'remote-csrf-token', pid: 999999 };
  Object.defineProperty(remoteEndpoint, 'socksPort', { value: proxy.port, enumerable: false });
  Object.defineProperty(remoteEndpoint, 'remote', { value: true, enumerable: false });
  client.discoverNow = async () => { client.server = remoteEndpoint; return remoteEndpoint; };

  const status = await client.call('GetUserStatus');
  assert.deepEqual(status, { userStatus: { email: 'remote@example.com' } });
  assert.equal(rpcCalls[0].csrf, 'remote-csrf-token');
  assert.equal(proxy.connects[0].port, targetPort);

  const streamed = [];
  await client.streamTrajectoryPage('GetCascadeTrajectorySteps', { cascadeId: '11111111-1111-1111-1111-111111111111', stepOffset: 0 }, {
    onRecord: async (kind, index, value) => { streamed.push({ kind, index, value }); },
  });
  assert.equal(streamed.length, 1);
  assert.equal(streamed[0].kind, 'steps');

  // Lease verification after 20s probes via SOCKS5 instead of local pidAlive().
  now += 20000;
  const renewed = await client.discover();
  assert.equal(renewed.port, targetPort);
  assert.equal(pidAliveCalled, false, 'remote SOCKS5 server must not check local pidAlive');
  assert.equal(await probeSocks5Port(proxy.port, targetPort), true);
});

test('SOCKS5 client enforces loopback-only targets and rejects protocol/auth errors cleanly', async t => {
  const authProxy = await startMockSocks5(t, { authMethod: 0x02 });
  await assert.rejects(connectSocks5({ proxyPort: authProxy.port, targetPort: 8080 }), err => err.code === 'SOCKS5_AUTH_UNSUPPORTED');

  const refusedProxy = await startMockSocks5(t, { rejectRep: 0x05 });
  await assert.rejects(connectSocks5({ proxyPort: refusedProxy.port, targetPort: 8080 }), err => err.code === 'ECONNREFUSED');
  assert.equal(await probeSocks5Port(refusedProxy.port, 8080), false);

  const badVerProxy = await startMockSocks5(t, { mode: 'bad-version' });
  await assert.rejects(connectSocks5({ proxyPort: badVerProxy.port, targetPort: 8080 }), err => err.code === 'SOCKS5_PROTOCOL_ERROR');

  await assert.rejects(connectSocks5({ proxyPort: authProxy.port, targetHost: '192.168.1.10', targetPort: 8080 }), err => err.code === 'SOCKS5_TARGET_FORBIDDEN');
  await assert.rejects(connectSocks5({ proxyPort: authProxy.port, targetHost: 'example.com', targetPort: 8080 }), err => err.code === 'SOCKS5_TARGET_FORBIDDEN');
  await assert.rejects(connectSocks5({ proxyPort: 0, targetPort: 8080 }), err => err.code === 'SOCKS5_INVALID_PORT');
  await assert.rejects(connectSocks5({ proxyPort: authProxy.port, targetPort: 70000 }), err => err.code === 'SOCKS5_INVALID_PORT');
});
