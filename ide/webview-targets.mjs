// IDE 2.6 hosts its Agent in a native Webview containing a Jetski iframe.
// Discovery observes host-owned structure only. It never installs a binding or
// copies conversation contents, and does not authorize other extension views.
import {CdpConnection} from '../compat/runtime-ui.mjs';
import {decodeWebviewRemoteAuthority,parseSshRemoteAuthority} from '../sidecars/panel/ssh-remote.mjs';

const GUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOPBACK=new Set(['127.0.0.1','localhost','[::1]']);
const WORKBENCH='/out/vs/code/electron-browser/workbench/workbench.html';
const REMOTE_BRIDGE_PATH=/^\/(?:[^/\0\\]+\/)+?\.antigravity-ide-server\/(?:bin\/[a-z0-9._-]+|cli\/servers\/[a-z0-9._-]+\/server)\/extensions\/agy\/bridge\.js$/i;
const MAX_TARGETS=128,MAX_WORKBENCHES=4,MAX_WRAPPERS=4,MAX_CONTEXTS=16,MAX_FRAMES=64;
const EXPECTED_PARAMS={extensionView:'true',extensionVariant:'vs-code',useWebSocket:'true',platform:'electron'};
const origin=u=>u.protocol+'//'+u.host;
function validWorkspaceUri(value){
  if(typeof value!=='string'||!value||value.length>2048||/[\0\r\n]/.test(value))return null;
  try{
    const u=new URL(value);
    if(u.protocol==='vscode-remote:')return parseSshRemoteAuthority(u.host)?value:null;
    if(u.protocol==='file:')return value;
    return null;
  }catch{return null;}
}
function transport(target,port){
  try{const u=new URL(target.webSocketDebuggerUrl);return u.protocol==='ws:'&&LOOPBACK.has(u.hostname)&&Number(u.port)===port&&!u.username&&!u.password&&u.pathname==='/devtools/page/'+target.id&&!u.search&&!u.hash;}catch{return false;}
}
function workbenchRoot(target,port){
  try{const u=new URL(target.url);return target.type==='page'&&transport(target,port)&&u.protocol==='vscode-file:'&&u.hostname==='vscode-app'&&u.pathname.endsWith(WORKBENCH)&&!u.search&&!u.hash?decodeURIComponent(u.pathname.slice(0,-WORKBENCH.length)):null;}catch{return null;}
}
function wrapperUrl(value){
  try{
    if(typeof value!=='string'||value.length>8192)return null;
    const u=new URL(value),id=u.searchParams.get('id');
    return u.protocol==='vscode-webview:'&&/^[a-z0-9-]+$/i.test(u.hostname)&&u.pathname==='/index.html'&&!u.username&&!u.password&&!u.port&&!u.hash&&GUID.test(id||'')&&u.searchParams.get('platform')==='electron'&&u.searchParams.get('purpose')==='webviewView'&&u.searchParams.get('parentOrigin')==='vscode-file://vscode-app'&&u.searchParams.get('extensionId')===''?u:null;
  }catch{return null;}
}
function backendUrl(value){
  try{
    if(typeof value!=='string'||value.length>8192)return null;
    const u=new URL(value);
    if(!['http:','https:'].includes(u.protocol)||!LOOPBACK.has(u.hostname)||!u.port||u.username||u.password||u.hash)return null;
    if(u.pathname!=='/'&&!/^\/c\/[0-9a-f-]+\/?$/i.test(u.pathname))return null;
    if(u.pathname!=='/'&&!GUID.test(u.pathname.split('/')[2]||''))return null;
    for(const [key,value]of Object.entries(EXPECTED_PARAMS))if(u.searchParams.getAll(key).length!==1||u.searchParams.get(key)!==value)return null;
    return u;
  }catch{return null;}
}
function inspectOfficialBridge(value,root){
  try{
    const u=new URL(value),path=decodeURIComponent(u.pathname);
    if(u.protocol!=='https:'||u.port||u.username||u.password||u.search||u.hash||/[\\\0]/.test(path)||path.split('/').some(p=>p==='.'||p==='..'))return null;
    if(u.hostname==='file+.vscode-resource.vscode-cdn.net'){
      const expected=root+'/extensions/agy/bridge.js';
      const ok=/^\/[a-z]:\//i.test(root)?path.toLowerCase()===expected.toLowerCase():path===expected;
      return ok?{remoteAuthority:null,destination:null}:null;
    }
    const remote=decodeWebviewRemoteAuthority(u.hostname);
    if(!remote)return null;
    return REMOTE_BRIDGE_PATH.test(path)?{remoteAuthority:remote.remoteAuthority,destination:remote.destination}:null;
  }catch{return null;}
}
function flattenFrames(tree){
  const pending=[{tree,parent:null,depth:0}],result=[];
  while(pending.length){
    const {tree:node,parent,depth}=pending.pop();
    if(!node?.frame||depth>8||result.length>=MAX_FRAMES)return null;
    const frame=node.frame;result.push({...frame,parentId:frame.parentId||parent});
    if(node.childFrames?.length>MAX_FRAMES)return null;
    for(const child of node.childFrames||[])pending.push({tree:child,parent:frame.id,depth:depth+1});
  }
  return result;
}

function agentOverlayProbe(){
  const visible=e=>e?.isConnected&&e.getClientRects().length>0&&!e.closest('[hidden],[inert]')&&getComputedStyle(e).visibility!=='hidden';
  const containers=[...document.querySelectorAll('[id="antigravity.agentViewContainerId"]')].filter(visible);
  if(containers.length!==1)return [];
  const bodies=[...containers[0].querySelectorAll('.pane-body')].filter(visible);
  if(bodies.length!==1)return [];
  const body=bodies[0].getBoundingClientRect();if(body.width<80||body.height<60)return [];
  const frames=document.querySelectorAll('iframe.webview');if(frames.length>32)return [];
  let remoteAuthority=null,workspaceUri=null;
  try{
    const cfg=window.vscode?.context?.configuration?.();
    if(typeof cfg?.remoteAuthority==='string'&&cfg.remoteAuthority.startsWith('ssh-remote+')&&cfg.remoteAuthority.length<=1024){
      remoteAuthority=cfg.remoteAuthority;
    }
    const rawWs=cfg?.workspace?.folderUri||cfg?.workspace?.configPath||cfg?.folderUri;
    if(typeof rawWs==='string'&&rawWs.length<=2048)workspaceUri=rawWs;
    else if(rawWs&&typeof rawWs==='object'&&typeof rawWs.scheme==='string'&&typeof rawWs.path==='string'){
      const auth=typeof rawWs.authority==='string'?rawWs.authority:'';
      workspaceUri=rawWs.scheme+'://'+auth+rawWs.path;
    }
  }catch{}
  const matches=[];
  for(const frame of frames){
    if(!visible(frame))continue;
    const r=frame.getBoundingClientRect();
    if(['left','top','width','height'].some(k=>Math.abs(r[k]-body[k])>3))continue;
    try{const url=new URL(frame.src);if(frame.parentElement?.id!==url.searchParams.get('id'))continue;matches.push({url:url.href,id:frame.parentElement.id,...(remoteAuthority?{remoteAuthority}:{}),...(workspaceUri?{workspaceUri}:{})});}catch{}
  }
  return matches.length===1?matches:[];
}
function agentContentProbe(){
  if(document.documentElement?.dataset.host!=='antigravity')return null;
  const frames=document.querySelectorAll('iframe[id="jetski-frame"]');
  if(frames.length!==1||document.scripts.length>32)return null;
  return {host:'antigravity',url:frames[0].src,scripts:[...document.scripts].filter(s=>s.src).map(s=>s.src)};
}
const OVERLAY_PROBE='('+agentOverlayProbe.toString()+')()';
const CONTENT_PROBE='('+agentContentProbe.toString()+')()';

export async function discoverIdeWebviews({targets,workbenches,port,connect=(url,options)=>new CdpConnection(url,options)}={}){
  if(!Array.isArray(targets)||targets.length>MAX_TARGETS||!Array.isArray(workbenches)||!Number.isInteger(port)||port<1||port>65535)return [];
  const deadline=Date.now()+2500,proofs=[],results=[];
  const remaining=()=>{const left=deadline-Date.now();if(left<=0)throw Error('IDE discovery budget exceeded');return Math.min(750,left);};
  const rawById=new Map();
  for(const target of targets){if(typeof target?.id!=='string')continue;rawById.set(target.id,rawById.has(target.id)?null:target);}
  for(const workbench of workbenches.slice(0,MAX_WORKBENCHES)){
    const root=workbenchRoot(workbench,port);if(!root)continue;
    let connection;
    try{
      connection=connect(workbench.webSocketDebuggerUrl,{timeout:remaining()});await connection.open();remaining();
      const observed=await connection.command('Runtime.evaluate',{expression:OVERLAY_PROBE,returnByValue:true});
      const overlays=observed.result?.value;if(observed.exceptionDetails||!Array.isArray(overlays)||overlays.length!==1)continue;
      const overlay=overlays[0],url=wrapperUrl(overlay.url);if(!url||overlay.id!==url.searchParams.get('id'))continue;
      const workbenchRemote=overlay.remoteAuthority?parseSshRemoteAuthority(overlay.remoteAuthority):null;
      if(overlay.remoteAuthority&&!workbenchRemote)continue;
      const workbenchWorkspaceUri=validWorkspaceUri(overlay.workspaceUri);
      const matches=targets.filter(t=>t?.type==='iframe'&&t.url===url.href&&transport(t,port)&&rawById.get(t.id)===t);
      if(matches.length===1)proofs.push({wrapper:matches[0],workbench,root,url,workbenchRemote,workbenchWorkspaceUri});
    }catch{/* A legacy, loading or unavailable workbench is not a failure. */}
    finally{try{connection?.close();}catch{/* A stale socket must not break native IDE discovery. */}}
    if(Date.now()>=deadline)break;
  }
  for(const proof of proofs.slice(0,MAX_WRAPPERS)){
    if(proofs.filter(p=>p.wrapper.id===proof.wrapper.id).length!==1)continue;
    let connection;const contexts=new Map();let contextsOverflow=false;
    try{
      connection=connect(proof.wrapper.webSocketDebuggerUrl,{timeout:remaining(),onEvent:event=>{
        if(event.method==='Runtime.executionContextCreated'){
          const c=event.params?.context;
          if(!c?.auxData?.isDefault||c.origin!==origin(proof.url))return;
          if(contexts.size>=MAX_CONTEXTS&&!contexts.has(c.id)){contextsOverflow=true;return;}
          contexts.set(c.id,c);
        }else if(event.method==='Runtime.executionContextDestroyed')contexts.delete(event.params?.executionContextId);
        else if(event.method==='Runtime.executionContextsCleared')contexts.clear();
      }});
      await connection.open();remaining();await connection.command('Runtime.enable');
      if(contextsOverflow)continue;
      remaining();const frames=flattenFrames((await connection.command('Page.getFrameTree')).frameTree);
      if(!frames||frames[0].id!==proof.wrapper.id)continue;
      const candidates=[];
      for(const context of contexts.values()){
        if(!frames.some(f=>f.id===context.auxData.frameId))continue;
        remaining();const observed=await connection.command('Runtime.evaluate',{expression:CONTENT_PROBE,contextId:context.id,returnByValue:true});
        const content=observed.result?.value,source=backendUrl(content?.url);
        if(observed.exceptionDetails||content?.host!=='antigravity'||!source||!Array.isArray(content.scripts)||content.scripts.length>32)continue;
        const bridgeProof=content.scripts.map(src=>inspectOfficialBridge(src,proof.root)).find(Boolean);
        if(!bridgeProof)continue;
        if(proof.workbenchRemote&&bridgeProof.destination&&bridgeProof.destination.toLowerCase()!==proof.workbenchRemote.destination.toLowerCase())continue;
        const remoteAuthority=proof.workbenchRemote?.remoteAuthority||bridgeProof.remoteAuthority||null;
        const workspaceUri=validWorkspaceUri(source.searchParams.get('workspaceUri')||source.searchParams.get('workspace'))||proof.workbenchWorkspaceUri||null;
        const backendPort=Number(source.port);
        // Chromium omits OOPIF descendants from the parent's Page frame tree.
        // Prove the child's parent on its own session, then independently ask
        // the wrapper which exact DOM iframe owns that frame. URL matching alone
        // would also accept another extension embedding the same local backend.
        const children=targets.filter(raw=>raw?.type==='iframe'&&rawById.get(raw.id)===raw&&transport(raw,port)&&backendUrl(raw.url)&&new URL(raw.url).origin===source.origin);
        if(children.length>4)continue;
        for(const raw of children){
          let childConnection;
          try{
            childConnection=connect(raw.webSocketDebuggerUrl,{timeout:remaining()});await childConnection.open();remaining();
            const child=(await childConnection.command('Page.getFrameTree')).frameTree?.frame;
            if(child?.id!==raw.id||child.parentId!==context.auxData.frameId||child.url!==raw.url)continue;
            remaining();const owner=await connection.command('DOM.getFrameOwner',{frameId:child.id});
            if(!Number.isSafeInteger(owner.backendNodeId)||owner.backendNodeId<1)continue;
            remaining();const element=(await connection.command('DOM.describeNode',{backendNodeId:owner.backendNodeId,depth:0})).node;
            if(element?.localName!=='iframe'||!Array.isArray(element.attributes)||element.attributes.length>64)continue;
            const attrs=new Map();for(let i=0;i<element.attributes.length;i+=2)attrs.set(element.attributes[i],element.attributes[i+1]);
            if(attrs.get('id')!=='jetski-frame'||attrs.get('src')!==content.url)continue;
            candidates.push({
              ...raw,
              ideWebview:true,
              expectedFrameId:child.id,
              expectedParentId:context.auxData.frameId,
              expectedUrl:child.url,
              workbenchId:proof.workbench.id,
              ...(remoteAuthority?{remoteAuthority,backendPort}:{}),
              ...(workspaceUri?{workspaceUri}:{}),
            });
          }catch{/* A navigation during proof construction leaves this candidate unauthorized. */}
          finally{try{childConnection?.close();}catch{}}
        }
      }
      if(candidates.length===1&&!contextsOverflow)results.push(candidates[0]);
    }catch{/* Do not log URLs or exception payloads from embedded content. */}
    finally{try{connection?.close();}catch{/* A stale socket must not break native IDE discovery. */}}
    if(Date.now()>=deadline)break;
  }
  return results.filter(result=>results.filter(other=>other.id===result.id).length===1);
}
