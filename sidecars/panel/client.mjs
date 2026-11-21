import { stat } from 'node:fs/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import {setImmediate as yieldStream} from 'node:timers/promises';
import { platformPaths } from '../../compat/platform.mjs';
import { discoverProcesses,httpLogPorts,httpsLogPorts,readLogTail,probeLoopbackPort,isProcessAlive } from './discovery.mjs';
import { TrajectoryJson } from './trajectory-json.mjs';
import { TrajectoryReader } from './trajectory-reader.mjs';

const SERVICE = '/exa.language_server_pb.LanguageServerService/';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function sidecarEnvEndpoint(env = process.env, { pid = null } = {}) {
  const rawAddr = typeof env?.ANTIGRAVITY_LS_ADDRESS === 'string' ? env.ANTIGRAVITY_LS_ADDRESS.trim() : '';
  const csrf = typeof env?.ANTIGRAVITY_CSRF_TOKEN === 'string' ? env.ANTIGRAVITY_CSRF_TOKEN.trim() : '';
  if (!rawAddr || !csrf || /[\s\x00-\x1f\x7f]/.test(csrf)) return null;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(rawAddr) ? rawAddr : `http://${rawAddr}`);
  } catch {
    return null;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username || url.password
    || (url.pathname && url.pathname !== '/')
    || url.search || url.hash
    || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const resolvedPid = Number.isSafeInteger(pid) && pid > 0
    ? pid
    : (Number.isSafeInteger(process.ppid) && process.ppid > 0 ? process.ppid : process.pid);
  return { port, csrf, protocol: url.protocol === 'https:' ? 'https' : 'http', pid: resolvedPid, source: 'sidecar-env' };
}

function serverFromPorts(logPorts, processes, { httpsPorts = [], fallbackCsrf = null } = {}) {
  const rows = (Array.isArray(processes) ? processes : [processes]).filter(p => /--standalone\b/.test(p.CommandLine || ''));
  if (rows.length !== 1) throw new Error(rows.length ? '检测到多个 Antigravity 实例，请保留一个' : '未找到 Antigravity 桌面后台');
  const ports = new Set([rows[0].Ports].flat().map(Number));
  const httpPort = logPorts.find(p=>ports.has(p));
  const httpsPort = !httpPort ? httpsPorts.find(p=>ports.has(p)) : undefined;
  const port = httpPort || httpsPort;
  if (!port) throw new Error('等待 Antigravity 本地接口启动');
  const csrf = rows[0].CommandLine.match(/--csrf_token(?:=|\s+)"?([^\s"]+)/)?.[1] || fallbackCsrf;
  if (!csrf) throw new Error('当前版本未提供可用的本地检测凭据');
  return { port, csrf, ...(httpsPort ? { protocol: 'https' } : {}), pid: rows[0].ProcessId };
}
export function serverFromDiscovery(log, processes, options) {
  return serverFromPorts(httpLogPorts(log), processes, { httpsPorts: httpsLogPorts(log), ...options });
}
export class AntigravityClient {
  constructor(options = {}) {
    const {paths=platformPaths,readLog=readLogTail,logStat=stat,processes=discoverProcesses,probe=probeLoopbackPort,pidAlive=isProcessAlive,parentPid=null,now=Date.now,onRpc=null}=options;
    const hasDiscoveryOverrides=Boolean(options.paths||options.readLog||options.processes);
    this.paths=paths;this.readLog=readLog;this.logStat=logStat;this.processes=processes;this.probe=probe;this.pidAlive=pidAlive;this.parentPid=parentPid;this.now=now;this.onRpc=onRpc;
    this.env=Object.hasOwn(options,'env')?options.env:(hasDiscoveryOverrides?null:process.env);
    this.reader=new TrajectoryReader(this);
  }
  server = null;
  discoveredAt = 0;
  discovering = null;
  lastScanAt = -Infinity;
  retryAt = 0;
  discoveryFailures = 0;
  discoveryError = null;
  envRejected = false;

  async verifyCachedServer(server) {
    if (!server || (server.source !== 'sidecar-env' && !this.pidAlive(server.pid))) return false;
    return await this.probe(server.port, { timeoutMs: 400 }).catch(() => false);
  }

  async discover(force = false) {
    if (!force && this.server && this.now() - this.discoveredAt < 15000) return this.server;
    if (this.discovering) return this.discovering;
    if (!force && this.discoveryError && this.now() < this.retryAt) throw this.discoveryError;
    const cached = !force ? this.server : null;
    this.discovering = (async () => {
      if (cached && await this.verifyCachedServer(cached) && this.server === cached) {
        this.discoveredAt = this.now();
        return cached;
      }
      this.lastScanAt = this.now();
      const server = await this.discoverNow();
      this.discoveredAt = this.now();
      this.discoveryFailures = 0;
      this.discoveryError = null;
      this.retryAt = 0;
      return server;
    })().catch(error=>{
      this.discoveryError=error;this.discoveryFailures++;
      this.retryAt=this.now()+Math.min(30000,3000*2**Math.min(4,this.discoveryFailures-1));throw error;
    }).finally(() => { this.discovering = null; });
    return this.discovering;
  }

  async discoverNow() {
    this.server=null;
    // Antigravity 2.34+ removes --csrf_token from CLI argv and injects the
    // official SidecarApp credentials (ANTIGRAVITY_LS_ADDRESS + ANTIGRAVITY_CSRF_TOKEN)
    // directly into sidecar child processes. Verify loopback reachability before
    // adopting them, and fall back to log/process discovery if absent or rejected.
    const envServer = !this.envRejected ? sidecarEnvEndpoint(this.env, { pid: this.parentPid }) : null;
    if (envServer && await this.probe(envServer.port, { timeoutMs: 400 }).catch(() => false)) {
      this.server = envServer;
      this.discoveredAt = this.now();
      return this.server;
    }
    const paths=this.paths(),logs=[],files=[...new Set(paths.logCandidates||[paths.log])];
    for(const file of files){
      try {
        let modifiedAt=null;
        if(files.length>1){try{const info=await this.logStat(file);if(Number.isFinite(info?.mtimeMs))modifiedAt=info.mtimeMs;}catch{}}
        const text=await this.readLog(file,'utf8');
        logs.push({ports:httpLogPorts(text),httpsPorts:httpsLogPorts(text),modifiedAt});
      }
      catch(error) { logs.push({error}); }
    }
    if(logs.every(entry=>entry.error||Number.isFinite(entry.modifiedAt))){
      logs.sort((a,b)=>{
        const first=a.modifiedAt??-Infinity,second=b.modifiedAt??-Infinity;
        return first===second?0:second-first;
      });
    }
    const expectedPorts=[...new Set(logs.flatMap(log=>[...(log.ports||[]),...(log.httpsPorts||[])]))];
    const parsed = await this.processes({expectedPorts});
    if (!parsed || Array.isArray(parsed) && !parsed.length) throw new Error('请先打开 Antigravity');
    // Credentials stay in process memory. They are never logged, persisted, or
    // returned to a browser; all calls go exclusively to 127.0.0.1.
    let foundLog=false,lastError=null;
    const fallbackCsrf = envServer && !this.envRejected ? envServer.csrf : null;
    for(const entry of logs) {
      try {
        if(entry.error)throw entry.error;
        foundLog=true;
        this.server=serverFromPorts(entry.ports,parsed,{httpsPorts:entry.httpsPorts||[],fallbackCsrf});break;
      } catch(error) {
        if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')lastError=error;
      }
    }
    if(!this.server)throw lastError||new Error(foundLog||envServer?'等待 Antigravity 本地接口启动':'未找到 Antigravity 语言服务日志，请检查日志路径');
    this.discoveredAt = this.now();
    return this.server;
  }

  async call(method, body = {}, retry = true) {
    const server = await this.discover();
    try {
      return await new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const projection=['GetCascadeTrajectory','GetCascadeTrajectorySteps','GetCascadeTrajectoryGeneratorMetadata','GetAllCascadeTrajectories'].includes(method);
        const started=this.now();
        const isHttps=server.protocol==='https';
        // Loopback-only self-signed TLS matches Antigravity's own setupLocalCertTrust / mendelFlagSync.
        const req = (isHttps?https.request:http.request)({ hostname: '127.0.0.1', port: server.port, method: 'POST', path: SERVICE + method, ...(isHttps?{rejectUnauthorized:false,agent:false}:projection?{agent:false}:{}),
          headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', 'x-codeium-csrf-token': server.csrf, 'Content-Length': Buffer.byteLength(data) } }, res => {
          const projected=projection?new TrajectoryJson():null;
          let text = '',bytes=0,failed=false;
          // Parsing can fail after the request has finished sending. Destroying
          // that request does not always emit another request error, and the
          // response's error/end handlers deliberately ignore failed streams.
          // Settle here before closing transport so malformed replies never hang.
          const fail=error=>{if(failed)return;failed=true;reject(error);req.destroy(error);};
          res.setEncoding('utf8');
          res.on('error',error=>{if(!failed)reject(error);});
          res.on('data', chunk => {
            if(failed)return;bytes+=Buffer.byteLength(chunk);
            // Projected streams have no whole-response byte ceiling. The
            // retained statistics budget, parser depth and time bound work.
            if(!(projected&&res.statusCode===200)&&bytes>32*1024*1024){fail(new Error('接口响应超过采集上限'));return;}
            try { if(projected&&res.statusCode===200)projected.write(chunk);else text+=chunk; }
            catch(error){fail(error);}
          });
          res.on('end', () => {
            if(failed)return;
            if (res.statusCode !== 200) return reject(Object.assign(new Error(`Antigravity 接口 ${method} 返回 ${res.statusCode}`),{status:res.statusCode}));
            try {
              const value=projected?projected.end():JSON.parse(text);
              if(this.server===server)this.discoveredAt=this.now();
              try{this.onRpc?.({method,bytes,retainedBytes:projected?.retained??Buffer.byteLength(text),ms:this.now()-started});}catch{}
              resolve(value);
            }
            catch(error) { reject(projected?error:new Error('Antigravity 接口返回了无法解析的数据')); }
          });
        });
        req.on('error', reject);
        req.setTimeout(12000, () => req.destroy(new Error('Antigravity 本地接口超时')));
        // Bound wall time as well as idle time for slow large streams.
        const deadline=setTimeout(()=>req.destroy(new Error('Antigravity 本地接口超时')),30000);deadline.unref();
        req.once('close',()=>clearTimeout(deadline));
        req.end(data);
      });
    } catch (error) {
      // A missing historical cascade, busy API or malformed response does not
      // prove the process/credential changed. Do not launch CIM scans for it.
      const authRejected=[401,403].includes(error.status);
      const endpointLost=authRejected||['ECONNREFUSED','ECONNRESET','EPIPE','ENOTCONN'].includes(error.code);
      if(!endpointLost)throw error;
      if(authRejected&&server.source==='sidecar-env')this.envRejected=true;
      // A late failure from an old endpoint cannot invalidate a newer one.
      if(this.server===server){
        this.server=null;this.discoveryError=error;
        this.retryAt=Math.max(this.retryAt,this.lastScanAt+3000);
      }
      if(retry){await this.discover();return this.call(method,body,false);}
      throw error;
    }
  }

  // Background-only record stream. No complete page array is materialized and
  // asynchronous consumers apply backpressure before the next record is parsed.
  async streamTrajectoryPage(method,body,{onRecord,isCurrent=()=>true,wallMs=30000}={}) {
    if(!['GetCascadeTrajectorySteps','GetCascadeTrajectoryGeneratorMetadata'].includes(method)||typeof onRecord!=='function')throw Error('Unsupported statistics stream');
    if(!Number.isSafeInteger(wallMs)||wallMs<30000||wallMs>300000)throw Error('Invalid statistics stream deadline');
    let streamError=null,rejectAbort;
    const aborted=new Promise((_,reject)=>{rejectAbort=reject;});aborted.catch(()=>{});
    const assertCurrent=()=>{if(streamError)throw streamError;if(isCurrent()!==true)throw Error('Statistics stream cancelled');};
    assertCurrent();const server=await this.discover();assertCurrent();
    const input=JSON.stringify(method==='GetCascadeTrajectoryGeneratorMetadata'?{...body,includeMessages:false}:body);
    let pending=null;
    const parser=new TrajectoryJson({onRecord:(kind,index,value)=>{if(pending)throw Error('Statistics stream consumer overflow');pending={kind,index,value};}});
    const started=this.now();let bytes=0,peakRetained=0,req,res,deadline,watch;
    const timeout=()=>Error('Antigravity 本地接口超时');
    const abort=error=>{streamError||=error;rejectAbort(streamError);res?.destroy();req?.destroy(streamError);};
    const isHttps=server.protocol==='https';
    try {
      res=await new Promise((resolve,reject)=>{
        req=(isHttps?https.request:http.request)({hostname:'127.0.0.1',port:server.port,method:'POST',path:SERVICE+method,agent:false,...(isHttps?{rejectUnauthorized:false}:{}),
          headers:{'Content-Type':'application/json','Connect-Protocol-Version':'1','x-codeium-csrf-token':server.csrf,'Content-Length':Buffer.byteLength(input)}},resolve);
        req.on('error',error=>{streamError||=error;rejectAbort(streamError);reject(error);});req.setTimeout(12000,()=>abort(timeout()));
        deadline=setTimeout(()=>abort(timeout()),wallMs);deadline.unref();
        watch=setInterval(()=>{if(isCurrent()!==true)abort(Error('Statistics stream cancelled'));},250);watch.unref();req.end(input);
      });
      if(res.statusCode!==200)throw Object.assign(Error('Statistics stream HTTP '+res.statusCode),{status:res.statusCode});
      if(this.server===server)this.discoveredAt=this.now();
      res.setEncoding('utf8');
      for await(const chunk of res){
        assertCurrent();bytes+=Buffer.byteLength(chunk);
        // Even a huge text-only value yields regularly; retained text is skipped.
        for(let offset=0;offset<chunk.length;){
          assertCurrent();const slice=chunk.slice(offset,offset+8192);
          const consumed=parser.write(slice,{stopAfterRecord:true});offset+=consumed;
          peakRetained=Math.max(peakRetained,parser.retained);
          if(pending){const item=pending;pending=null;await Promise.race([onRecord(item.kind,item.index,item.value),aborted]);assertCurrent();}
          await yieldStream();
        }
      }
      assertCurrent();const result=parser.end();
      if(pending){const item=pending;pending=null;await Promise.race([onRecord(item.kind,item.index,item.value),aborted]);assertCurrent();}
      if(this.server===server)this.discoveredAt=this.now();
      try{this.onRpc?.({method,bytes,retainedBytes:peakRetained,ms:this.now()-started,streamed:true});}catch{}
      return result;
    } catch(error) {
      const authRejected=[401,403].includes(error?.status);
      const endpointLost=authRejected||['ECONNREFUSED','ECONNRESET','EPIPE','ENOTCONN'].includes(error?.code);
      if(authRejected&&server.source==='sidecar-env')this.envRejected=true;
      if(endpointLost&&this.server===server){
        this.server=null;this.discoveryError=error;
        this.retryAt=Math.max(this.retryAt,this.lastScanAt+3000);
      }
      throw error;
    } finally {clearTimeout(deadline);clearInterval(watch);res?.destroy();req?.destroy();}
  }

  resetTrajectories(){this.reader.reset();}
  trajectory(id,options){return this.reader.read(id,options);}
}
