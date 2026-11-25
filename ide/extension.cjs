const vscode=require('vscode');
const {spawn}=require('node:child_process');
const {join,resolve}=require('node:path');
const {readFileSync}=require('node:fs');
const {pathToFileURL}=require('node:url');
const supportedIde=require('./host.cjs');
let child,output,startSeq=0,lastDiagnostic=null,promptedThisSession=false;
exports.activate=function(context){
  output=vscode.window.createOutputChannel('Antigrative Dashboard IDE');
  if(!supportedIde(vscode.env)){
    output.appendLine('This adapter supports the standalone Antigravity IDE only.');
    context.subscriptions.push(output);return;
  }
  const profile=resolve(context.globalStorageUri.fsPath,'../../..');
  const dataDir=context.globalStorageUri.fsPath;
  const appResources=vscode.env.appRoot?resolve(vscode.env.appRoot,'..'):null;
  let selfHealModule=null;
  const loadSelfHeal=()=>selfHealModule||(selfHealModule=import(pathToFileURL(join(context.extensionPath,'ide','launch-self-heal.mjs')).href));
  const uiCallbacks=(allowNotifications=true)=>({
    log:msg=>output.appendLine(msg),
    showOutput:()=>output.show(true),
    showInfo:(msg,...actions)=>allowNotifications?vscode.window.showInformationMessage(msg,...actions):Promise.resolve(undefined),
    showWarning:(msg,...actions)=>allowNotifications?vscode.window.showWarningMessage(msg,...actions):Promise.resolve(undefined),
    saveAutoMode:mode=>vscode.workspace.getConfiguration('antigrativeDashboard.ide').update('autoConfigureLaunch',mode,vscode.ConfigurationTarget.Global),
  });
  function stop(){
    startSeq++;
    if(child){
      const prior=child;child=null;
      try{prior.send({type:'stop'});}catch{prior.kill();}
      const deadline=setTimeout(()=>prior.kill(),2000);deadline.unref();
      prior.once('exit',()=>clearTimeout(deadline));
    }
  }
  async function start({allowPrompt=true}={}){
    stop();
    const seq=startSeq;
    const config=vscode.workspace.getConfiguration('antigrativeDashboard.ide');
    if(!config.get('enabled',true)){lastDiagnostic='Dashboard IDE integration is disabled.';return;}
    const launchMode=config.get('autoConfigureLaunch','prompt');
    const remoteSsh=config.get('remoteSsh',true);
    let readyResult;
    try{
      const helper=await loadSelfHeal();
      if(seq!==startSeq)return;
      const shouldNotify=allowPrompt&&!promptedThisSession;
      readyResult=await helper.ensureIdeRendererReady({
        profile,appResources,dataDir,mode:launchMode,
        ui:uiCallbacks(shouldNotify),
      });
      if(seq!==startSeq)return;
      if(!readyResult.ready){
        promptedThisSession=true;
        lastDiagnostic=readyResult.message||'Renderer connection unavailable.';
        return;
      }
      lastDiagnostic=null;
      void helper.maybeRepairLaunchInBackground({profile,appResources,dataDir,mode:launchMode,ui:uiCallbacks(false)}).catch(()=>{});
    }catch{
      if(seq!==startSeq)return;
      lastDiagnostic='Renderer connection check failed.';
      output.appendLine('Renderer connection check failed. Fully quit the IDE, then start with --remote-debugging-port=0 --remote-debugging-address=127.0.0.1.');
      return;
    }
    child=spawn(process.execPath,[join(context.extensionPath,'ide','main.mjs')],{
      windowsHide:true,
      stdio:['ignore','pipe','pipe','ipc'],
      env:{
        ...process.env,
        ELECTRON_RUN_AS_NODE:'1',
        AG_PULSE_IDE_PROFILE:profile,
        AG_PULSE_IDE_DATA:dataDir,
        AG_PULSE_IDE_REMOTE_SSH:remoteSsh?'1':'0',
      },
    });
    const launched=child;
    // Never echo API responses, command lines or credentials into IDE logs.
    child.stdout.resume();child.stderr.resume();
    child.once('error',()=>output.appendLine('IDE collector could not start.'));
    child.once('exit',code=>{output.appendLine(`IDE collector stopped (${code??'signal'}).`);if(child===launched)child=null;});
    output.appendLine('IDE collector started.');
  }
  context.subscriptions.push(
    output,
    {dispose:stop},
    vscode.commands.registerCommand('antigrativeDashboard.ide.openHealth',()=>{
      let status=lastDiagnostic||'Waiting for a fresh IDE renderer connection';
      if(!lastDiagnostic){
        try{
          const value=JSON.parse(readFileSync(join(dataDir,'integration-state.json'),'utf8'));
          const age=Date.now()-Date.parse(value.checkedAt);
          if(age>=0&&age<15000)status=value.state==='mounted'?'Dashboard attached to the Agent composer':value.state;
        }catch{}
      }
      output.appendLine(status);output.show(true);
    }),
    vscode.commands.registerCommand('antigrativeDashboard.ide.repairLaunchConfig',async()=>{
      try{
        const helper=await loadSelfHeal();
        await helper.runManualLaunchRepair({profile,appResources,dataDir,ui:uiCallbacks(true)});
      }catch{
        output.appendLine('Could not repair IDE launch flags. Start with --remote-debugging-port=0 --remote-debugging-address=127.0.0.1.');
        output.show(true);
      }
    }),
    vscode.workspace.onDidChangeConfiguration(e=>{
      if(e.affectsConfiguration('antigrativeDashboard.ide.enabled')||e.affectsConfiguration('antigrativeDashboard.ide.remoteSsh')){
        void start({allowPrompt:false});
      }else if(e.affectsConfiguration('antigrativeDashboard.ide.autoConfigureLaunch')&&!child){
        promptedThisSession=false;
        void start({allowPrompt:true});
      }
    }),
  );
  void start({allowPrompt:true});
  exports.deactivate=stop;
};
