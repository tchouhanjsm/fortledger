import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fork,spawn,execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';
import {approvedMainCommit} from '../src/approved-update.js';

const execFile=promisify(execFileCallback);
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SHA=/^[a-f0-9]{40}$/i;
const REQUEST=/^[0-9a-f-]{36}$/i;

async function gitHead(){
  const {stdout}=await execFile('git',['rev-parse','--verify','HEAD'],
    {cwd:ROOT,timeout:10000,windowsHide:true});
  const sha=stdout.trim().toLowerCase();
  if(!SHA.test(sha))throw new Error('Invalid current Git revision');
  return sha;
}
async function installPinnedUpdate(sha){
  if(!SHA.test(sha))throw new Error('Invalid pinned commit');
  await new Promise((resolve,reject)=>{
    const ps=spawn('powershell.exe',[
      '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
      '-File',path.join(ROOT,'scripts','windows-quick-update.ps1'),
      '-ExpectedCommit',sha,'-SkipRestart'
    ],{cwd:ROOT,env:process.env,windowsHide:false,stdio:'inherit'});
    ps.once('error',reject);
    ps.once('close',code=>code===0?resolve():reject(
      new Error('Windows update verification/installation exited without success ('+code+')')));
  });
}
function recordEvent(kind,data={}){
  const base=process.env.LOCALAPPDATA;
  if(!base)throw new Error('Windows local application data directory unavailable');
  const dir=path.join(base,'FortLedger');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  fs.appendFileSync(path.join(dir,'update-journal.jsonl'),
    JSON.stringify({at:new Date().toISOString(),kind,...data})+'\n',{mode:0o600});
}
function startServer(){
  return fork(path.join(ROOT,'src','server.js'),[],{cwd:ROOT,
    env:{...process.env,FORTLEDGER_SUPERVISED:'1'},
    stdio:['inherit','inherit','inherit','ipc']});
}
async function healthCheck(){
  for(let n=0;n<40;n++){
    try{
      const res=await fetch('http://127.0.0.1:3000/api/auth/status',
        {signal:AbortSignal.timeout(1500),cache:'no-store'});
      if(res.ok)return true;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  return false;
}

/** All Git/npm/PowerShell runs here: a separate parent process, never in the
 * authenticated HTTP child. Do not force kill the child or restore over live WAL. */
export function createWindowsSupervisor({
  launch=startServer,install=installPinnedUpdate,head=gitHead,
  approve=approvedMainCommit,health=healthCheck,journal=recordEvent,
  logger=console
}={}){
  let child=null,pending=null,updating=false;
  function send(proc,message){
    try{proc.send?.(message);}catch(error){logger.error('Supervisor IPC unavailable:',error.message);}
  }
  function start(){
    if(child||updating)throw new Error('Supervised server already running');
    child=launch();
    const launched=child;
    launched.on('message',message=>onMessage(launched,message));
    launched.once('exit',(code,signal)=>void onExit(launched,code,signal).catch(error=>{
      logger.error('Supervisor could not complete update:',error.message);
      try{journal('supervisor_error',{message:'Update aborted; inspect local Windows console and backups'});}catch{}
    }));
    return launched;
  }
  function onMessage(proc,message){
    if(proc!==child||!message||typeof message!=='object')return;
    if(message.type==='fortledger.update.request'){
      const sha=String(message.target_sha||'').toLowerCase();
      const id=message.request_id;
      if(!SHA.test(sha)||!REQUEST.test(id)||pending||updating){
        send(proc,{type:'fortledger.update.denied',request_id:id});
        return;
      }
      pending={sha,id,proc,drained:false};
      journal('owner_requested',{target:sha});
      send(proc,{type:'fortledger.update.accepted',request_id:id});
    }else if(message.type==='fortledger.update.drained'&&pending?.proc===proc){
      pending.drained=true;
      journal('http_drained',{target:pending.sha});
    }
  }
  async function onExit(proc,code,signal){
    if(proc!==child)return;
    child=null;
    const task=pending;
    pending=null;
    if(!task){
      logger.log('FortLedger server exited. Restart with the normal Windows launcher when ready.');
      return;
    }
    // Abnormal exit or no positive drain receipt is NOT proof of completed
    // bookings and bills; never install over an unknown in-flight write.
    if(!task.drained||code!==0||signal){
      journal('unsafe_shutdown',{target:task.sha});
      logger.error('Update cancelled: clean server drain was not confirmed. Do not delete or reset hotel data.');
      return;
    }
    updating=true;
    let previous=null;
    try{
      previous=await head();
      const evidence=await approve(task.sha);
      if(!evidence?.approved||evidence.sha!==task.sha)
        throw new Error('Pinned GitHub main commit does not have verified CI');
      journal('install_started',{previous,target:task.sha,run_id:evidence.run_id});
      await install(task.sha);
      if(await head()!==task.sha)
        throw new Error('Git checkout does not match the approved pinned commit');
      journal('tests_passed',{previous,target:task.sha});
      updating=false;
      start();
      if(!await health()){
        journal('restart_unconfirmed',{target:task.sha});
        logger.error('New version did not confirm localhost health; inspect the server console before using it.');
      }else{
        journal('healthy',{target:task.sha});
        logger.log('FortLedger update complete. Reopen the local browser and sign in.');
      }
    }catch(error){
      const current=await head().catch(()=>null);
      journal('update_failed',{previous,target:task.sha,
        code_advanced:current!==previous});
      logger.error('Supervised update stopped:',error.message);
      if(previous&&current===previous){
        logger.log('Code was unchanged; restarting the existing tested version.');
        updating=false;
        start();
      }else{
        logger.error('Code may have changed. Automatic rollback is unsafe after database migrations; leave stopped and use the protected backup/recovery procedure.');
      }
    }finally{updating=false;}
  }
  return {start,onMessage,get state(){return {
    child_running:Boolean(child),pending:Boolean(pending),updating
  };}};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.platform!=='win32'){
    console.error('The supervised installer targets Windows only; use the Mac release preflight.');
    process.exitCode=1;
  }else{
    try{
      if(!process.env.FORTLEDGER_DATA_DIR||!path.win32.isAbsolute(process.env.FORTLEDGER_DATA_DIR))
        throw new Error('Use the Windows launcher with its persistent FortLedger data directory');
      console.log('FortLedger local Windows supervisor: only localhost and authenticated owner updates.');
      console.log('Ctrl+C stops the app; no cloud updater or subscription is running.');
      createWindowsSupervisor().start();
    }catch(error){console.error(error.message);process.exitCode=1;}
  }
}
