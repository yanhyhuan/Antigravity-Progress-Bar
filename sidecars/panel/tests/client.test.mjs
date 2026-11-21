import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import http from 'node:http';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AntigravityClient,sidecarEnvEndpoint} from '../client.mjs';
import {httpLogPorts,httpsLogPorts,readLogTail} from '../discovery.mjs';

// Synthetic RPC fixtures own every accepted socket. End them explicitly:
// HTTP keep-alive teardown must not hold the cross-platform test runner open.
const stopServer=server=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});

test('invalid projected JSON settles even when destroying a sent request emits no error',async t=>{
 const original=http.request;let destroyed=false;
 http.request=(_options,onResponse)=>{
  const req=new EventEmitter();req.setTimeout=()=>req;
  req.destroy=()=>{destroyed=true;req.emit('close');return req;};
  req.end=()=>queueMicrotask(()=>{
   const res=new EventEmitter();res.statusCode=200;res.setEncoding=()=>res;
   onResponse(res);res.emit('data','{broken');res.emit('end');
  });return req;
 };
 syncBuiltinESMExports();t.after(()=>{http.request=original;syncBuiltinESMExports();});
 const client=new AntigravityClient({now:()=>0});client.server={port:1234,csrf:'fixture',pid:42};
 let timer;
 try{await Promise.race([
  assert.rejects(client.call('GetCascadeTrajectory'),error=>error.message==='Antigravity 接口返回了无法解析的数据'),
  new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Invalid stream left the RPC pending')),1000);})
 ]);}finally{clearTimeout(timer);}
 assert.equal(destroyed,true);
});
async function fixture(t){
 const state={scans:0,now:100000,status:404,body:'{}',requests:0};
 const server=createServer((req,res)=>{state.requests++;req.resume();res.writeHead(state.status,{'Content-Type':'application/json'});res.end(state.body);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>stopServer(server));
 state.port=server.address().port;state.pid=42;
 const client=new AntigravityClient({now:()=>state.now,paths:()=>({log:'fixture'}),readLog:async()=>`listening on random port at ${state.port} for HTTP\n`,
  processes:async()=>{state.scans++;return [{ProcessId:state.pid,CommandLine:'language_server --standalone --csrf_token=fixture',Ports:[state.port]}];}});
 return {client,state,server};
}

test('unavailable history and malformed RPC replies never invalidate a healthy endpoint',async t=>{
 const {client,state}=await fixture(t);
 const rejects=async(method,body)=>{
  let timer;
  try{await Promise.race([assert.rejects(client.call(method,body)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`RPC fixture stalled: status=${state.status}, requests=${state.requests}, method=${method}`)),10000);})]);}
  finally{clearTimeout(timer);}
 };
 for(const status of [400,404,409,429,500,503]){
  state.status=status;
  for(let i=0;i<3;i++)await rejects('GetCascadeTrajectory',{cascadeId:'missing'});
 }
 state.status=200;state.body='{broken';await rejects('GetCascadeTrajectory');
 state.body='{}';assert.deepEqual(await client.call('GetUserStatus'),{});
 assert.equal(state.scans,1,'Conversation/protocol failures must not spawn another process scan');
 assert.equal(state.requests,20,'Application failures are not blindly retried');
 assert.ok(client.server);
});

test('ordinary RPC JSON errors never expose a private response fragment',async t=>{
 const {client,state}=await fixture(t);state.status=200;state.body='{"private":"DO_NOT_DISCLOSE" invalid}';
 await assert.rejects(client.call('GetUserStatus'),error=>error.message==='Antigravity 接口返回了无法解析的数据');
 state.body='{}';assert.deepEqual(await client.call('GetUserStatus'),{});assert.equal(state.scans,1);
});

test('conversation-list RPC keeps delegation metadata while discarding embedded messages',async t=>{
 const {client,state}=await fixture(t);state.status=200;
 const root='11111111-1111-1111-1111-111111111111',child='22222222-2222-2222-2222-222222222222';
 state.body=JSON.stringify({trajectorySummaries:{[root]:{stepCount:4,status:'IDLE'},[child]:{
  stepCount:2,hasActiveChildren:true,trajectoryMetadata:{parentConversationId:root,rootConversationId:root,subagentSpec:{initialPrompt:'PRIVATE_PROMPT'}},
  latestNotifyUserStep:{message:'PRIVATE_REPLY'},waitingSteps:[{response:'PRIVATE_TOOL'}],
 }}});
 const result=await client.call('GetAllCascadeTrajectories',{excludeSubtrajectories:false});
 assert.equal(result.trajectorySummaries[child].trajectoryMetadata.parentConversationId,root);
 assert.equal(result.trajectorySummaries[child].hasActiveChildren,true);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|subagentSpec|waitingSteps|latestNotifyUserStep/);
});

test('cold-start discovery failures coalesce and back off while the backend starts',async()=>{
 let now=0,scans=0,ready=false;
 const client=new AntigravityClient({now:()=>now,paths:()=>({log:'fixture'}),readLog:async()=> 'listening on random port at 1234 for HTTP\n',
  processes:async()=>{scans++;return ready?[{ProcessId:42,CommandLine:'language_server --standalone --csrf_token=fixture',Ports:[1234]}]:[];}});
 await Promise.allSettled(Array.from({length:20},()=>client.discover()));assert.equal(scans,1);
 for(let i=0;i<20;i++)await assert.rejects(client.discover());assert.equal(scans,1);
 now=3000;await assert.rejects(client.discover());assert.equal(scans,2);
 now=4000;ready=true;await assert.rejects(client.discover());assert.equal(scans,2);
 now=9000;assert.equal((await client.discover()).pid,42);assert.equal(scans,3);
});

test('authorization failures have a cooldown, then rediscover without disabling the plugin',async t=>{
 const {client,state}=await fixture(t);state.status=401;
 for(let i=0;i<10;i++)await assert.rejects(client.call('GetUserStatus'));
 assert.equal(state.scans,1);assert.equal(state.requests,1);
 state.now+=3000;state.status=200;
 assert.deepEqual(await client.call('GetUserStatus'),{});assert.equal(state.scans,2);
});

test('a refused old port rediscovers a restarted backend once, without toggling the plugin',async t=>{
 const {client,state,server}=await fixture(t);state.status=200;
 await client.call('GetUserStatus');assert.equal(state.scans,1);
 await stopServer(server);
 const replacement=createServer((req,res)=>{req.resume();res.end('{}');});
 await new Promise(r=>replacement.listen(0,'127.0.0.1',r));t.after(()=>stopServer(replacement));
 state.port=replacement.address().port;state.pid=43;state.now+=3000;
 assert.deepEqual(await client.call('GetUserStatus'),{});
 assert.equal(client.server.pid,43);assert.equal(state.scans,2);
});

test('healthy HTTP 200 RPCs renew discovery lease past 15s while auth or socket errors still rediscover',async t=>{
 const {client,state,server}=await fixture(t);state.status=200;state.now=0;
 await client.call('GetUserStatus');assert.equal(state.scans,1);
 state.now=10000;await client.call('GetUserStatus');assert.equal(state.scans,1);
 state.now=20000;await client.call('GetUserStatus');assert.equal(state.scans,1,'Healthy call at 10s extended lease past 15s');
 state.now=30000;await client.call('GetUserStatus');assert.equal(state.scans,1);
 state.status=401;state.now=34000;
 await assert.rejects(client.call('GetUserStatus'));
 assert.equal(state.scans,2,'401 invalidates endpoint and triggers rediscovery');
 state.status=200;state.now=38000;
 await client.call('GetUserStatus');assert.equal(state.scans,3);
 await stopServer(server);
 const replacement=createServer((req,res)=>{req.resume();res.end('{}');});
 await new Promise(r=>replacement.listen(0,'127.0.0.1',r));t.after(()=>stopServer(replacement));
 state.port=replacement.address().port;state.pid=43;state.now=42000;
 assert.deepEqual(await client.call('GetUserStatus'),{});
 assert.equal(state.scans,4);assert.equal(client.server.pid,43);
});

test('readLogTail extracts newest HTTP port from >1 MiB logs both at tail and behind >512 KiB of noise',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ag-log-tail-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const tailFile=join(dir,'tail.log');
 await writeFile(tailFile,'listening on random port at 1111 for HTTP\n'+'x'.repeat(1100*1024)+'\nlistening on random port at 2222 for HTTP\n');
 assert.equal(httpLogPorts(await readLogTail(tailFile,'utf8'))[0],2222);
 const headFile=join(dir,'head.log');
 await writeFile(headFile,'listening on random port at 3333 for HTTP\n'+'y'.repeat(700*1024)+'\n');
 assert.deepEqual(httpLogPorts(await readLogTail(headFile,'utf8')),[3333]);
 const v234File=join(dir,'v234.log');
 await writeFile(v234File,
  'Language server listening on random port at 4444 for HTTPS (gRPC)\n'+
  'Language server listening on loopback port at 5555 for local HTTP (SDK/gRPC)\n'+
  'z'.repeat(700*1024)+'\n');
 const v234Tail=await readLogTail(v234File,'utf8');
 assert.deepEqual(httpLogPorts(v234Tail),[5555]);
 assert.deepEqual(httpsLogPorts(v234Tail),[4444]);
});

test('sidecarEnvEndpoint accepts official 2.34.0 loopback Sidecar SDK variables and rejects non-loopback targets',()=>{
 assert.deepEqual(sidecarEnvEndpoint({ANTIGRAVITY_LS_ADDRESS:'127.0.0.1:51234',ANTIGRAVITY_CSRF_TOKEN:'tok-1'},{pid:900}),
  {port:51234,csrf:'tok-1',pid:900,protocol:'http',source:'sidecar-env'});
 assert.deepEqual(sidecarEnvEndpoint({ANTIGRAVITY_LS_ADDRESS:'localhost:51235',ANTIGRAVITY_CSRF_TOKEN:'tok-2'},{pid:901}),
  {port:51235,csrf:'tok-2',pid:901,protocol:'http',source:'sidecar-env'});
 assert.deepEqual(sidecarEnvEndpoint({ANTIGRAVITY_LS_ADDRESS:'[::1]:51236',ANTIGRAVITY_CSRF_TOKEN:'tok-3'},{pid:902}),
  {port:51236,csrf:'tok-3',pid:902,protocol:'http',source:'sidecar-env'});
 assert.deepEqual(sidecarEnvEndpoint({ANTIGRAVITY_LS_ADDRESS:'https://127.0.0.1:51237',ANTIGRAVITY_CSRF_TOKEN:'tok-4'},{pid:903}),
  {port:51237,csrf:'tok-4',pid:903,protocol:'https',source:'sidecar-env'});
 for(const bad of [
  {},
  {ANTIGRAVITY_LS_ADDRESS:'127.0.0.1:51234',ANTIGRAVITY_CSRF_TOKEN:'   '},
  {ANTIGRAVITY_LS_ADDRESS:'0.0.0.0:51234',ANTIGRAVITY_CSRF_TOKEN:'tok'},
  {ANTIGRAVITY_LS_ADDRESS:'192.168.1.2:51234',ANTIGRAVITY_CSRF_TOKEN:'tok'},
  {ANTIGRAVITY_LS_ADDRESS:'example.com:51234',ANTIGRAVITY_CSRF_TOKEN:'tok'},
  {ANTIGRAVITY_LS_ADDRESS:'127.0.0.1:0',ANTIGRAVITY_CSRF_TOKEN:'tok'},
  {ANTIGRAVITY_LS_ADDRESS:'127.0.0.1:65536',ANTIGRAVITY_CSRF_TOKEN:'tok'},
  {ANTIGRAVITY_LS_ADDRESS:'ws://127.0.0.1:51234',ANTIGRAVITY_CSRF_TOKEN:'tok'},
 ])assert.equal(sidecarEnvEndpoint(bad,{pid:900}),null);
});

test('Antigravity 2.34.0 Sidecar env credentials connect without CLI --csrf_token, renew idle leases, and fall back on 401',async t=>{
 let now=0,scans=0,envStatus=200;
 const envServer=createServer((req,res)=>{
  assert.equal(req.headers['x-codeium-csrf-token'],'env-csrf-234');
  req.resume();res.writeHead(envStatus,{'Content-Type':'application/json'});res.end('{"userStatus":{}}');
 });
 await new Promise(r=>envServer.listen(0,'127.0.0.1',r));t.after(()=>stopServer(envServer));
 const fallbackServer=createServer((req,res)=>{
  assert.equal(req.headers['x-codeium-csrf-token'],'fallback-csrf');
  req.resume();res.writeHead(200,{'Content-Type':'application/json'});res.end('{"fallback":true}');
 });
 await new Promise(r=>fallbackServer.listen(0,'127.0.0.1',r));t.after(()=>stopServer(fallbackServer));
 const envPort=envServer.address().port,fallbackPort=fallbackServer.address().port;
 const client=new AntigravityClient({
  now:()=>now,
  parentPid:777,
  pidAlive:pid=>pid===777||pid===888,
  env:{ANTIGRAVITY_LS_ADDRESS:`127.0.0.1:${envPort}`,ANTIGRAVITY_CSRF_TOKEN:'env-csrf-234'},
  paths:()=>({log:'fixture'}),
  readLog:async()=>`Language server listening on loopback port at ${fallbackPort} for local HTTP (SDK/gRPC)\n`,
  processes:async()=>{scans++;return [{ProcessId:888,CommandLine:'language_server.exe --standalone --csrf_token=fallback-csrf',Ports:[fallbackPort]}];},
 });
 // 1. Initial discovery uses Sidecar SDK env without spawning process scans
 assert.deepEqual(await client.call('GetUserStatus'),{userStatus:{}});
 assert.equal(scans,0);
 assert.equal(client.server.source,'sidecar-env');
 // 2. Idle >15s renews lease via fast PID + loopback check without spawning process scans
 now=25000;
 assert.deepEqual(await client.discover(),{port:envPort,csrf:'env-csrf-234',pid:777,protocol:'http',source:'sidecar-env'});
 assert.equal(scans,0);
 // 3. 401 after >3s immediately rejects stale env token and falls back in one seamless call
 envStatus=401;now=30000;
 assert.deepEqual(await client.call('GetUserStatus'),{fallback:true});
 assert.equal(client.server.port,fallbackPort);
 assert.equal(scans,1);
 // 4. 401 within <3s of initial scan honors auth cooldown before falling back
 const cooldownClient=new AntigravityClient({
  now:()=>now,
  parentPid:777,
  pidAlive:()=>true,
  env:{ANTIGRAVITY_LS_ADDRESS:`127.0.0.1:${envPort}`,ANTIGRAVITY_CSRF_TOKEN:'env-csrf-234'},
  paths:()=>({log:'fixture'}),
  readLog:async()=>`Language server listening on loopback port at ${fallbackPort} for local HTTP (SDK/gRPC)\n`,
  processes:async()=>{scans++;return [{ProcessId:888,CommandLine:'language_server.exe --standalone --csrf_token=fallback-csrf',Ports:[fallbackPort]}];},
 });
 now=34000;
 await assert.rejects(cooldownClient.call('GetUserStatus'),/返回 401/);
 assert.equal(scans,1);
 now=38000;
 assert.deepEqual(await cooldownClient.call('GetUserStatus'),{fallback:true});
 assert.equal(cooldownClient.server.port,fallbackPort);
 assert.equal(scans,2);
});
