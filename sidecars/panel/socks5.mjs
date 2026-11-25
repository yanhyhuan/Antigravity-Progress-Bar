// Zero-dependency loopback-only SOCKS5 client for Antigravity SSH `-D` tunnels.
// Connects only to 127.0.0.1:<proxyPort> and tunnels only to loopback targets.
import { Agent } from 'node:http';
import { createConnection } from 'node:net';

const LOOPBACK_V4 = new Set(['127.0.0.1', 'localhost']);
const LOOPBACK_V6 = new Set(['::1', '[::1]']);
const MAX_HANDSHAKE_BYTES = 512;

const validPort = value => Number.isInteger(value) && value >= 1 && value <= 65535;

function encodeTargetAddress(host) {
  const normalized = String(host || '127.0.0.1').trim().toLowerCase();
  if (LOOPBACK_V4.has(normalized)) {
    return { atyp: 0x01, bytes: Buffer.from([127, 0, 0, 1]) };
  }
  if (LOOPBACK_V6.has(normalized)) {
    return { atyp: 0x04, bytes: Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]) };
  }
  throw Object.assign(new Error('SOCKS5 target must be a loopback address'), { code: 'SOCKS5_TARGET_FORBIDDEN' });
}

function socks5ReplyLength(buf) {
  if (buf.length < 4) return null;
  const atyp = buf[3];
  if (atyp === 0x01) return 10; // VER REP RSV ATYP + 4 IPv4 + 2 PORT
  if (atyp === 0x04) return 22; // VER REP RSV ATYP + 16 IPv6 + 2 PORT
  if (atyp === 0x03) {
    if (buf.length < 5) return null;
    return 7 + buf[4]; // VER REP RSV ATYP LEN + domain + 2 PORT
  }
  return -1;
}

export function connectSocks5({
  proxyPort,
  targetHost = '127.0.0.1',
  targetPort,
  timeoutMs = 5000,
  signal = null,
  connect = createConnection,
} = {}) {
  if (!validPort(proxyPort)) {
    return Promise.reject(Object.assign(new Error('Invalid SOCKS5 proxy port'), { code: 'SOCKS5_INVALID_PORT' }));
  }
  if (!validPort(targetPort)) {
    return Promise.reject(Object.assign(new Error('Invalid SOCKS5 target port'), { code: 'SOCKS5_INVALID_PORT' }));
  }
  let address;
  try {
    address = encodeTargetAddress(targetHost);
  } catch (error) {
    return Promise.reject(error);
  }
  if (signal?.aborted) {
    return Promise.reject(Object.assign(new Error('SOCKS5 connection aborted'), { code: 'ABORT_ERR' }));
  }
  const boundedTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 30000) : 5000;

  return new Promise((resolve, reject) => {
    let socket = null;
    let timer = null;
    let settled = false;
    let phase = 'greeting';
    let buffer = Buffer.alloc(0);

    const cleanupListeners = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (socket) {
        socket.removeListener('connect', onConnect);
        socket.removeListener('data', onData);
        socket.removeListener('error', onError);
        socket.removeListener('close', onClose);
        socket.removeListener('end', onEnd);
      }
    };

    const fail = error => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      socket?.destroy();
      reject(error);
    };

    const succeed = leftover => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      if (leftover && leftover.length > 0) {
        socket.unshift(leftover);
      }
      resolve(socket);
    };

    const onAbort = () => fail(Object.assign(new Error('SOCKS5 connection aborted'), { code: 'ABORT_ERR' }));
    const onError = error => fail(error || Object.assign(new Error('SOCKS5 proxy connection failed'), { code: 'ECONNREFUSED' }));
    const onClose = () => fail(Object.assign(new Error('SOCKS5 proxy closed connection during handshake'), { code: 'ECONNRESET' }));
    const onEnd = () => fail(Object.assign(new Error('SOCKS5 proxy ended connection during handshake'), { code: 'ECONNRESET' }));

    const onConnect = () => {
      if (settled) return;
      // VER=5, NMETHODS=1, METHODS=[0x00 NO AUTH]
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
    };

    const onData = chunk => {
      if (settled) return;
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk);
      if (buffer.length > MAX_HANDSHAKE_BYTES) {
        fail(Object.assign(new Error('SOCKS5 handshake exceeded byte limit'), { code: 'SOCKS5_PROTOCOL_ERROR' }));
        return;
      }

      if (phase === 'greeting') {
        if (buffer.length < 2) return;
        const ver = buffer[0];
        const method = buffer[1];
        if (ver !== 0x05) {
          fail(Object.assign(new Error('Invalid SOCKS5 proxy version'), { code: 'SOCKS5_PROTOCOL_ERROR' }));
          return;
        }
        if (method !== 0x00) {
          fail(Object.assign(new Error('SOCKS5 proxy requires unsupported authentication'), { code: 'SOCKS5_AUTH_UNSUPPORTED' }));
          return;
        }
        buffer = buffer.subarray(2);
        phase = 'connect';
        const portBuf = Buffer.allocUnsafe(2);
        portBuf.writeUInt16BE(targetPort, 0);
        const req = Buffer.concat([Buffer.from([0x05, 0x01, 0x00, address.atyp]), address.bytes, portBuf]);
        socket.write(req);
        if (!buffer.length) return;
      }

      if (phase === 'connect') {
        const needed = socks5ReplyLength(buffer);
        if (needed === -1) {
          fail(Object.assign(new Error('Invalid SOCKS5 reply address type'), { code: 'SOCKS5_PROTOCOL_ERROR' }));
          return;
        }
        if (needed === null || buffer.length < needed) return;
        const ver = buffer[0];
        const rep = buffer[1];
        if (ver !== 0x05) {
          fail(Object.assign(new Error('Invalid SOCKS5 connect reply version'), { code: 'SOCKS5_PROTOCOL_ERROR' }));
          return;
        }
        if (rep !== 0x00) {
          const code = rep === 0x05 ? 'ECONNREFUSED' : 'SOCKS5_CONNECT_FAILED';
          fail(Object.assign(new Error(`SOCKS5 connect rejected (0x${rep.toString(16).padStart(2, '0')})`), { code, socksReply: rep }));
          return;
        }
        const leftover = buffer.length > needed ? buffer.subarray(needed) : null;
        succeed(leftover);
      }
    };

    timer = setTimeout(() => {
      fail(Object.assign(new Error('SOCKS5 proxy handshake timeout'), { code: 'ETIMEDOUT' }));
    }, boundedTimeout);
    timer.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      socket = connect({ host: '127.0.0.1', port: proxyPort, family: 4 });
      socket.on('connect', onConnect);
      socket.on('data', onData);
      socket.on('error', onError);
      socket.on('close', onClose);
      socket.on('end', onEnd);
    } catch (error) {
      fail(error);
    }
  });
}

export async function probeSocks5Port(proxyPort, targetPort, { timeoutMs = 800, signal = null, connect = createConnection } = {}) {
  if (!validPort(proxyPort) || !validPort(targetPort) || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || signal?.aborted) {
    return false;
  }
  try {
    const socket = await connectSocks5({ proxyPort, targetHost: '127.0.0.1', targetPort, timeoutMs, signal, connect });
    socket.destroy();
    return true;
  } catch {
    return false;
  }
}

export class Socks5HttpAgent extends Agent {
  constructor(proxyPort, { timeoutMs = 5000, connect = createConnection } = {}) {
    if (!validPort(proxyPort)) {
      throw Object.assign(new Error('Invalid SOCKS5 proxy port'), { code: 'SOCKS5_INVALID_PORT' });
    }
    super({ keepAlive: false });
    this.proxyPort = proxyPort;
    this.timeoutMs = timeoutMs;
    this.connectImpl = connect;
  }

  createConnection(options, callback) {
    const targetPort = Number(options?.port);
    const targetHost = options?.host || options?.hostname || '127.0.0.1';
    connectSocks5({
      proxyPort: this.proxyPort,
      targetHost,
      targetPort,
      timeoutMs: this.timeoutMs,
      connect: this.connectImpl,
    }).then(
      socket => {
        try {
          callback(null, socket);
        } catch {
          socket.destroy();
        }
      },
      error => {
        callback(error);
      },
    );
  }
}

export function createSocks5Agent(proxyPort, options = {}) {
  return new Socks5HttpAgent(proxyPort, options);
}
