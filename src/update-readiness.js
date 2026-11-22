import fs from 'node:fs';
import path from 'node:path';
import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {backupFreshness} from './backup-freshness.js';
import {dataDirectory} from './data-paths.js';
import {updateStatus} from './update-status.js';
import {approvedMainCommit} from './approved-update.js';

const execFile=promisify(execFileCallback);
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SHA=/^[a-f0-9]{40}$/i;
async function remoteSha(){
  const {stdout}=await execFile('git',['ls-remote','--exit-code','origin','refs/heads/main'],
    {cwd:ROOT,windowsHide:true,timeout:15000,maxBuffer:32768,env:{
      ...process.env,GIT_TERMINAL_PROMPT:'0'
    }});
  const row=String(stdout).trim();
  const match=/^([a-f0-9]{40})\s+refs\/heads\/main$/i.exec(row);
  if(!match)throw new Error('Untrusted main branch response');
  return match[1].toLowerCase();
}
function separateVolume(env,platform){
  if(platform!=='win32')return false;
  const folder=env.FORTLEDGER_BACKUP_DIR;
  if(typeof folder!=='string'||!path.win32.isAbsolute(folder))return false;
  const source=env.FORTLEDGER_DATA_DIR||path.join(env.LOCALAPPDATA||'','FortLedger','data');
  if(!path.win32.isAbsolute(source))return false;
  const backupRoot=path.win32.parse(folder).root.toLowerCase();
  const sourceRoot=path.win32.parse(source).root.toLowerCase();
  // Different drives/shares, not just a subfolder of the same disk.
  return Boolean(backupRoot&&sourceRoot&&backupRoot!==sourceRoot);
}

/** No Git fetch/merge or local writes: these are preconditions, not proof that
 * a backup is independently restorable on a replacement device. */
export async function inspectUpdateReadiness({
  platform=process.platform,env=process.env,
  supervised=Boolean(process.send&&process.env.FORTLEDGER_SUPERVISED==='1'),
  check=updateStatus,remote=remoteSha,ci=approvedMainCommit,
  freshness=backupFreshness
}={}){
  const state=await check({platform});
  const blockers=[];
  if(platform!=='win32')blockers.push('In-app installation is currently Windows-only. Use the Mac safe-update runbook.');
  if(!supervised)blockers.push('Start FortLedger using its supervised Windows launcher to enable owner updates.');
  if(state.state!=='new_revision')
    blockers.push(state.state==='up_to_date'?'No newer GitHub main commit is available.':
      state.message||'Git status must be checked first.');
  if(freshness({env}).state!=='recent')
    blockers.push('A recent configured encrypted backup is required before restarting.');
  if(!separateVolume(env,platform))
    blockers.push('The encrypted backup folder must be on a separate protected drive or share.');
  let target_sha=null,ci_run_url=null;
  if(state.state==='new_revision'&&platform==='win32'&&supervised){
    try{
      const candidate=await remote();
      if(!SHA.test(candidate)||candidate.slice(0,12).toLowerCase()!==state.remote?.toLowerCase())
        blockers.push('GitHub main changed during update inspection; check again.');
      else{
        target_sha=candidate.toLowerCase();
        const evidence=await ci(target_sha);
        if(evidence?.approved===true&&evidence.sha===target_sha)
          ci_run_url=evidence.run_url;
        else blockers.push(evidence?.reason||
          'This exact GitHub commit has not passed the required Linux, Windows and browser checks.');
      }
    }catch{
      blockers.push('Could not verify the exact GitHub main commit and its CI evidence.');
    }
  }
  return {platform:state.platform,state:state.state,
    installed:state.current,remote:state.remote,target_sha,
    ready:blockers.length===0,blockers,ci_run_url,
    note:'The updater will recheck GitHub and restore the encrypted backup after all client requests finish.'};
}

export function createSupervisedUpdateIpc(ipc=process){
  if(typeof ipc?.send!=='function')throw new Error('Separate supervisor IPC is required');
  let pending=null;
  const receive=message=>{
    if(!pending||message?.request_id!==pending.id)return;
    if(message.type==='fortledger.update.accepted'){
      const resolve=pending.resolve;clearTimeout(pending.timer);pending=null;resolve(true);
    }else if(message.type==='fortledger.update.denied'){
      const reject=pending.reject;clearTimeout(pending.timer);pending=null;
      reject(new Error('The local update supervisor refused the update; check its console.'));
    }
  };
  ipc.on('message',receive);
  return {
    request(target_sha){
      if(!SHA.test(target_sha))return Promise.reject(new Error('Invalid pinned update SHA'));
      if(pending)return Promise.reject(new Error('Update already requested'));
      return new Promise((resolve,reject)=>{
        const id=crypto.randomUUID();
        const timer=setTimeout(()=>{
          if(pending?.id===id){pending=null;reject(new Error('The update supervisor did not respond'));}
        },10000);
        pending={id,resolve,reject,timer};
        try{ipc.send({type:'fortledger.update.request',request_id:id,target_sha:target_sha.toLowerCase()});}
        catch(error){clearTimeout(timer);pending=null;reject(error);}
      });
    },
    dispose(){ipc.removeListener('message',receive);}
  };
}
