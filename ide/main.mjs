import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SidecarOwner} from '../compat/sidecar-owner.mjs';
import {RuntimeUi,makeRendererSource} from '../compat/runtime-ui.mjs';
import {PreferencesStore} from '../compat/preferences.mjs';
import {readHostTheme} from '../compat/host-theme.mjs';
import {MetricsStore} from '../sidecars/panel/store.mjs';
import {SessionHistory} from '../sidecars/panel/history.mjs';
import {TranscriptReader,transcriptBrainRoot} from '../sidecars/panel/transcript.mjs';
import {DesktopUsage as LocalUsage,UsageLedger} from '../sidecars/panel/usage.mjs';
import {IdeClient} from './client.mjs';
import {RemoteIdeClient} from './remote-client.mjs';
import {ideTargets} from './runtime.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const profile=process.env.AG_PULSE_IDE_PROFILE;
if(!profile)throw Error('IDE profile is required');
const data=process.env.AG_PULSE_IDE_DATA||join(profile,'User','globalStorage','you-should-know-me.antigrative-dashboard-ide');
let debugPort=0;
const client=new IdeClient({profile,debugPort:()=>debugPort});
const ownership=new SidecarOwner(data);
const sharedLedger=new UsageLedger(join(data,'usage-v1'),{source:'ide-local'});
const store=new MetricsStore(client,{history:new SessionHistory(join(data,'history-v1')),transcripts:new TranscriptReader({root:transcriptBrainRoot('ide')}),owns:()=>ownership.owns()});
const usage=new LocalUsage(store,sharedLedger,{host:'ide',owns:()=>ownership.owns(),pricing:true});
store.onTrajectory=async(scope,id,raw,options={})=>{
  const {isCurrent=()=>true}=options;
  if(isCurrent()!==true)return;
  if(await ownership.isOwner()&&isCurrent()===true)return usage.ingestLive(scope,id,raw,{...options,isCurrent});
};
store.onBackgroundResult=(scope,id,file,options)=>usage.ingestDisk(scope,id,file,options);
const localContext={key:'local',client,store,usage,remote:false,lastUsedAt:Date.now()};
const remoteContexts=new Map();
const MAX_REMOTE_CONTEXTS=16;
const REMOTE_IDLE_EVICT_MS=60000;
const disposeRemoteContext=key=>{
  const ctx=remoteContexts.get(key);if(!ctx)return;
  remoteContexts.delete(key);
  try{ctx.usage.dispose();}catch{}
  try{ctx.store.dispose();}catch{}
};
const pruneRemoteContexts=targets=>{
  const active=new Set();
  for(const target of Array.isArray(targets)?targets:[]){
    if(target?.remoteAuthority&&Number.isInteger(target?.backendPort))active.add(`${target.remoteAuthority}:${target.backendPort}`);
  }
  const now=Date.now();
  for(const [key,ctx] of remoteContexts){
    if(!active.has(key)&&now-ctx.lastUsedAt>=REMOTE_IDLE_EVICT_MS)disposeRemoteContext(key);
  }
};
const resolveIdeContext=targetContext=>{
  if(process.env.AG_PULSE_IDE_REMOTE_SSH==='0')return localContext;
  const remoteAuthority=targetContext?.remoteAuthority;
  const backendPort=targetContext?.backendPort;
  if(!remoteAuthority||!Number.isInteger(backendPort)||backendPort<1||backendPort>65535)return localContext;
  const key=`${remoteAuthority}:${backendPort}`;
  let ctx=remoteContexts.get(key);
  if(ctx){ctx.lastUsedAt=Date.now();return ctx;}
  while(remoteContexts.size>=MAX_REMOTE_CONTEXTS){
    let oldestKey=null,oldestAt=Infinity;
    for(const [k,item] of remoteContexts)if(item.lastUsedAt<oldestAt){oldestAt=item.lastUsedAt;oldestKey=k;}
    if(oldestKey===null)break;
    disposeRemoteContext(oldestKey);
  }
  let remoteClient;
  try{remoteClient=new RemoteIdeClient({remoteAuthority,backendPort,workspaceUri:targetContext.workspaceUri||null});}
  catch{return localContext;}
  // Remote IDE contexts stay isolated from local disk transcripts and archives.
  const remoteStore=new MetricsStore(remoteClient,{history:new SessionHistory(join(data,'history-v1')),transcripts:null,owns:()=>ownership.owns()});
  const remoteUsage=new LocalUsage(remoteStore,sharedLedger,{host:null,discoverLocal:async()=>({conversations:[],errors:0}),owns:()=>ownership.owns(),disposeLedger:false,pricing:usage.pricing});
  remoteStore.onTrajectory=async(scope,id,raw,options={})=>{
    const {isCurrent=()=>true}=options;
    if(isCurrent()!==true)return;
    if(await ownership.isOwner()&&isCurrent()===true)return remoteUsage.ingestLive(scope,id,raw,{...options,isCurrent});
  };
  remoteStore.onBackgroundResult=(scope,id,file,options)=>remoteUsage.ingestDisk(scope,id,file,options);
  ctx={key,client:remoteClient,store:remoteStore,usage:remoteUsage,remote:true,lastUsedAt:Date.now()};
  remoteContexts.set(key,ctx);
  return ctx;
};
const preferences=new PreferencesStore({file:join(data,'preferences.json')});
const files=await Promise.all(['compat/i18n.cjs','compat/inline-widget.cjs','compat/theme.cjs','ide/surface.cjs','compat/usage-ui.cjs','compat/pricing.cjs'].map(f=>readFile(join(root,f),'utf8')));
const extract=s=>s.slice(s.indexOf('module.exports = ')+17).trim().replace(/;$/,'');
if(!await ownership.claim())process.exit(0);
const usageSource=`window.__agPulsePricingFactory=(${extract(files[5])});window.__agPulseUsageFactory=(${extract(files[4])});`;
const owner=ownership.token;
const adapter=`window.__agPulseSurface=(${extract(files[3])})();`;
const source=makeRendererSource(...files.slice(0,3),owner,ownership.startedAt,adapter+usageSource);
const webviewAdapter=`window.__agPulseSurface=(${extract(files[3])})({webview:true});`;
const webviewSource=makeRendererSource(...files.slice(0,3),owner,ownership.startedAt,webviewAdapter+usageSource,{allowNested:true});
// Each workbench has its own bridge request ID and DOM conversation ID. Empty
// composers request account quota only; no most-recent-conversation fallback.
const snapshot=async(input,targetContext=null)=>{
  if(!await ownership.isOwner())throw Error('Sidecar ownership changed');
  const ctx=resolveIdeContext(targetContext);
  const {client:activeClient,store:activeStore,usage:activeUsage}=ctx;
  const prefs=await preferences.snapshot();
  const hostTheme=await readHostTheme(),liveTheme=ui.rendererTheme;
  const theme=(liveTheme?.fontFamily||liveTheme?.monoFontFamily)?{...liveTheme,...hostTheme}:hostTheme;
  if(input?.usageOnly===true){
    if(!activeStore.serverPid&&!activeStore.identity){
      try{
        const server=await activeClient.discover();
        if(server.pid!==activeStore.serverPid){activeStore.epoch++;activeStore.background?.reset();activeStore.delegated.reset();activeStore.transcripts?.reset();activeStore.identity=null;activeStore.quota=null;activeStore.quotaAt=0;activeStore.sessions.clear();activeStore.clearUsagePersistenceErrors();activeStore.serverPid=server.pid;}
        await activeStore.refreshQuota(false);
      }catch{}
    }
    const requestedScope=(input.usageScope==='local'||input.usageScope==='account')?input.usageScope:(prefs?.usageScope||'local');
    return {connection:activeStore.quota?'live':'stale',speed:null,groups:activeStore.quota||[],usage:await activeUsage.snapshot({sync:false,scope:requestedScope,groups:activeStore.quota}),enabled:true,preferences:prefs,theme};
  }
  let value;
  if(input.conversationId)value=await activeStore.snapshot(input);
  else{
    try{
      const server=await activeClient.discover();
      if(server.pid!==activeStore.serverPid){activeStore.epoch++;activeStore.background?.reset();activeStore.delegated.reset();activeStore.transcripts?.reset();activeStore.identity=null;activeStore.quota=null;activeStore.quotaAt=0;activeStore.sessions.clear();activeStore.clearUsagePersistenceErrors();activeStore.serverPid=server.pid;}
      await activeStore.refreshQuota(input.force);
      value={connection:'live',speed:null,groups:activeStore.quota||[],quotaUpdatedAt:new Date(activeStore.quotaAt).toISOString()};
    }catch{value={connection:'offline',speed:null,groups:[],error:ctx.remote?'IDE remote API unavailable':'IDE local API unavailable'};}
  }
  if(input.usageSync===true)void activeUsage.sync(true);
  return {...value,usage:await activeUsage.snapshot({sync:input.usageSync===true,scope:prefs?.usageScope||'local',groups:value.groups,maxWaitMs:input.usageSync===true?0:350}).catch(()=>null),enabled:true,preferences:prefs,theme};
};
const ui=new RuntimeUi({profile,source,sourceForTarget:target=>target.ideWebview?webviewSource:source,owner,owns:()=>ownership.isOwner(),preferences,snapshot,dataDir:data,targetOrigin:target=>target.ideWebview?new URL(target.url).origin:'vscode-file://vscode-app',
  onTargets:targets=>pruneRemoteContexts(targets),
  discover:async()=>{const result=await ideTargets(profile);debugPort=result.port;return result.targets;}});
await mkdir(data,{recursive:true});
await writeFile(join(data,'runtime.json'),JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),mode:'ide'}));
ui.start();
const keepAlive=setInterval(()=>{},60000);
async function stop(){for(const key of [...remoteContexts.keys()])disposeRemoteContext(key);usage.dispose();store.dispose();clearInterval(keepAlive);await ui.stop();ownership.stop();process.exit(0);}
ownership.watch(stop);
process.on('message',message=>{if(message?.type==='stop')void stop();});
if(process.connected)process.once('disconnect',()=>{void stop();});
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{void stop();});
