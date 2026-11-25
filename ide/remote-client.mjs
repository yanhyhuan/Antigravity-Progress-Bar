// Remote-SSH Antigravity IDE client.
// Reads remote daemon/{hub,ls}_*.json via non-interactive `ssh -o BatchMode=yes`
// and pairs candidate credentials against the IDE's locally forwarded loopback port.
import { request as httpRequest } from 'node:http';
import { AntigravityClient } from '../sidecars/panel/client.mjs';
import { probeLoopbackPort } from '../sidecars/panel/discovery.mjs';
import {
  matchRemoteIdeCandidates,
  parseSshRemoteAuthority,
  probeRemoteSshHost,
} from '../sidecars/panel/ssh-remote.mjs';

const SERVICE = '/exa.language_server_pb.LanguageServerService/';
const MAX_CANDIDATE_PROBES = 8;
const AUTH_BACKOFF_MS = 60000;
const validPort = value => Number.isInteger(value) && value >= 1 && value <= 65535;

export function verifyForwardedIdeEndpoint({ port, csrf, timeoutMs = 3000, requestImpl = httpRequest } = {}) {
  if (!validPort(port) || typeof csrf !== 'string' || !csrf.trim()) return Promise.resolve(false);
  return new Promise(resolve => {
    const payload = '{}';
    let settled = false;
    const done = ok => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const req = requestImpl({
      hostname: '127.0.0.1',
      port,
      method: 'POST',
      path: `${SERVICE}GetUserStatus`,
      agent: false,
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'x-codeium-csrf-token': csrf.trim(),
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      res.resume();
      res.once('end', () => done(res.statusCode === 200));
      res.once('error', () => done(false));
    });
    req.once('error', () => done(false));
    const timer = setTimeout(() => {
      req.destroy();
      done(false);
    }, Math.min(timeoutMs, 10000));
    timer.unref?.();
    req.end(payload);
  });
}

export class RemoteIdeClient extends AntigravityClient {
  constructor({
    remoteAuthority,
    backendPort,
    workspaceUri = null,
    probeHost = probeRemoteSshHost,
    probe = probeLoopbackPort,
    verifyEndpoint = verifyForwardedIdeEndpoint,
    now = Date.now,
    onRpc = null,
  } = {}) {
    super({ probe, now, onRpc });
    const parsed = parseSshRemoteAuthority(remoteAuthority);
    if (!parsed) throw new Error('Invalid SSH remote authority');
    if (!validPort(backendPort)) throw new Error('Invalid remote IDE backend port');
    this.remoteAuthority = parsed.remoteAuthority;
    this.parsedAuthority = parsed;
    this.backendPort = backendPort;
    this.workspaceUri = typeof workspaceUri === 'string' ? workspaceUri : null;
    this.probeHost = probeHost;
    this.verifyEndpoint = verifyEndpoint;
    this.authBlockedUntil = 0;
  }

  async discoverNow() {
    this.server = null;
    this.verifiedServer = null;
    if (this.authBlockedUntil && this.now() < this.authBlockedUntil) {
      throw new Error('SSH remote authentication unavailable');
    }
    const listening = await this.probe(this.backendPort, { timeoutMs: 400 }).catch(() => false);
    if (!listening) {
      throw new Error('Waiting for forwarded remote IDE API port');
    }

    let discovery;
    try {
      discovery = await this.probeHost({
        destination: this.parsedAuthority.destination,
        user: this.parsedAuthority.user,
        port: this.parsedAuthority.port,
      });
    } catch (error) {
      if (error?.code === 'SSH_AUTH_UNAVAILABLE') {
        this.authBlockedUntil = this.now() + AUTH_BACKOFF_MS;
      }
      throw error;
    }

    const candidates = matchRemoteIdeCandidates(discovery, {
      backendPort: this.backendPort,
      workspaceUri: this.workspaceUri,
    }).slice(0, MAX_CANDIDATE_PROBES);

    for (const candidate of candidates) {
      const ok = await this.verifyEndpoint({ port: this.backendPort, csrf: candidate.csrf }).catch(() => false);
      if (!ok) continue;
      const server = { port: this.backendPort, csrf: candidate.csrf, pid: candidate.pid };
      Object.defineProperty(server, 'credentialSource', { value: candidate.credentialSource || 'remote-daemon-file', enumerable: false });
      Object.defineProperty(server, 'remote', { value: true, enumerable: false });
      Object.defineProperty(server, 'remoteAuthority', { value: this.remoteAuthority, enumerable: false });
      Object.defineProperty(server, 'destination', { value: this.parsedAuthority.destination, enumerable: false });
      this.server = server;
      this.verifiedServer = server;
      this.discoveredAt = this.now();
      return this.server;
    }
    throw new Error('Remote IDE API credential unavailable');
  }
}
