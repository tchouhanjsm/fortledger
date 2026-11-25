import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readInstalledDesktopBuild,checkInstallerUpdate} from './installer-update-feed.js';
import {checkApprovedSourceUpdate} from './approved-source-feed.js';
import {backupFreshness} from './backup-freshness.js';
import {verifyLocalBackupHealth} from './backup-health.js';
import {verifyRoutineUpdateBackup} from './routine-update-recovery.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const GH='https://api.github.com/repos/tchouhanjsm/fortledger';
const RAW='https://raw.githubusercontent.com/tchouhanjsm/fortledger/';
const SHA=/^[a-f0-9]{40}$/i;
const NAME=/^(?:src|public)\/[a-zA-Z0-9._/-]+$/;
const CRITICAL=[
  'package.json','package-lock.json','scripts/windows-desktop-launcher.cs',
  'scripts/windows-backup-settings.ps1','scripts/windows-configure-backups.ps1',
  'scripts/windows-configure-staff-lan.ps1'
];
const MAX_FILES=400,MAX_BYTES=20*1024*1024,MAX_FILE=4*1024*1024;

async function getJson(url){
  const response=await fetch(url,{headers:{Accept:'application/vnd.github+json',
    'User-Agent':'FortLedger-desktop-patch'},signal:AbortSignal.timeout(15000),
    cache:'no-store'});
  if(!response.ok)throw new Error('Cannot verify the pinned GitHub revision');
  return response.json();
}
export async function readGitTree(commit,{read=getJson}={}){
  if(!SHA.test(commit))throw new Error('Invalid pinned commit');
  const detail=await read(GH+'/git/commits/'+commit.toLowerCase());
  if(detail?.sha?.toLowerCase()!==commit.toLowerCase()||!SHA.test(detail?.tree?.sha))
    throw new Error('GitHub commit tree did not match the pinned update');
  const response=await read(GH+'/git/trees/'+detail.tree.sha+'?recursive=1');
  if(response?.truncated!==false||!Array.isArray(response?.tree))
    throw new Error('GitHub returned an incomplete file tree');
  const files=new Map();
  for(const item of response.tree){
    if(item.type!=='blob')continue;
    if(typeof item.path!=='string'||!SHA.test(item.sha)||files.has(item.path.toLowerCase()))
      throw new Error('Repository contains ambiguous file paths');
    files.set(item.path.toLowerCase(),{path:item.path,sha:item.sha.toLowerCase(),
      mode:item.mode,size:item.size});
  }
  return files;
}
function allowedFile(name){
  return NAME.test(name)&&!name.includes('//')&&
    name.split('/').every(component=>component!=='.'&&component!=='..')&&
    !name.includes('\\');
}
export function planCodeChanges(previous,target){
  for(const critical of CRITICAL){
    if(previous.get(critical)?.sha!==target.get(critical)?.sha)
      return {supported:false,requiresInstaller:true,reason:'This release changes the desktop launcher, backup controls or native dependencies. Use the verified full Windows installer once for this release.',changes:[]};
  }
  const changes=[];
  for(const name of new Set([...previous.keys(),...target.keys()])){
    if(!name.startsWith('src/')&&!name.startsWith('public/'))continue;
    const old=previous.get(name),next=target.get(name);
    if(old?.sha===next?.sha)continue;
    const selected=next||old;
    if(!allowedFile(selected.path)||old&&(!['100644','100755'].includes(old.mode))||
      next&&(!['100644','100755'].includes(next.mode)))
      return {supported:false,reason:'This revision contains a path or symlink that cannot be safely updated in place.',changes:[]};
    if(next&&(!Number.isSafeInteger(next.size)||next.size<0||next.size>MAX_FILE))
      return {supported:false,reason:'This update contains an oversized application file.',changes:[]};
    changes.push({path:selected.path,old_sha:old?.sha||null,
      new_sha:next?.sha||null,size:next?.size||0});
  }
  if(changes.length>MAX_FILES||changes.reduce((n,x)=>n+x.size,0)>MAX_BYTES)
    return {supported:false,requiresInstaller:true,reason:'This update is larger than the safe source-only limit. Use the verified full Windows installer.',changes:[]};
  return {supported:true,changes};
}
export function gitBlobSha(data){
  const bytes=Buffer.isBuffer(data)?data:Buffer.from(data);
  return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
}
function destination(root,filename){
  if(!allowedFile(filename))throw new Error('Unsafe patch path');
  const base=path.resolve(root);
  const absolute=path.resolve(base,...filename.split('/'));
  if(!absolute.startsWith(base+path.sep))
    throw new Error('Patch path escaped the installed application');
  // Reject symlinked ancestors: a malicious/replaced local subdirectory
  // must never redirect an update into the hotel profile or elsewhere.
  let cursor=base;
  for(const piece of filename.split('/').slice(0,-1)){
    if(fs.existsSync(cursor)){
      const stat=fs.lstatSync(cursor);
      if(!stat.isDirectory()||stat.isSymbolicLink())
        throw new Error('Application update path is not a trusted directory');
    }
    cursor=path.join(cursor,piece);
  }
  if(fs.existsSync(cursor)){
    const stat=fs.lstatSync(cursor);
    if(!stat.isDirectory()||stat.isSymbolicLink())
      throw new Error('Application update path is not a trusted directory');
  }
  return absolute;
}
// Database/schema and recovery machinery never migrate using only same-PC
// protection. Ordinary non-migration source/UI fixes may use a verified local
// emergency snapshot, with disaster recovery still explicitly pending.
const SOURCE_MIGRATION_FILES=new Set([
  'src/database.js','src/data-paths.js','src/restore.js',
  'src/encrypted-backups.js','src/upgrade-backup.js',
  'src/desktop-first-run.js'
]);
function ensureRoutineSourceScope(policy,plan){
  if(policy.scope==='local_checkpoint'&&
     plan.changes.some(x=>SOURCE_MIGRATION_FILES.has(x.path)))
    throw new Error('Schema, restore and credential-storage code changes require independent recovery; ordinary source and UI patches do not');
}
function checkBackup({env,platform,freshness=backupFreshness,
  backupHealth=verifyLocalBackupHealth}={}){
  return verifyRoutineUpdateBackup({env,platform,freshness,health:backupHealth});
}
export async function inspectDesktopCodeUpdate({
  root=ROOT,env=process.env,platform=process.platform,
  installed=readInstalledDesktopBuild(path.join(root,'installer-build.json')),
  feed=checkApprovedSourceUpdate,trees=readGitTree,installerFeed=checkInstallerUpdate,
  freshness=backupFreshness,backupHealth=verifyLocalBackupHealth
}={}){
  const blockers=[],info=await feed({installed});
  let target_sha=null,run_number=null,changes=0,plan=null,recovery_scope=null;
  let installer_required=false,installer_download_url=null;
  if(platform!=='win32'||env.FORTLEDGER_DESKTOP_UPDATE_HOST!=='1')
    blockers.push('This installation does not have the dedicated Windows desktop update supervisor. A one-time bootstrap installer is required.');
  if(!installed)blockers.push('This desktop installation has no trustworthy installed build identity.');
  if(info.state!=='source_update_available'||!info.available||
    !SHA.test(info.target_sha)||!Number.isSafeInteger(info.run_number))
    blockers.push('No fully tested newer GitHub main build is available.');
  if(!blockers.length){
    target_sha=info.target_sha.toLowerCase();run_number=info.run_number;
    try{
      plan=planCodeChanges(await trees(installed.sha),await trees(target_sha));
      if(!plan.supported){blockers.push(plan.reason);installer_required=plan.requiresInstaller===true;}
      else{
        changes=plan.changes.length;
        if(!changes)blockers.push('No application code or UI changes in this revision. No reinstall needed.');
      }
    }catch{blockers.push('Could not verify the complete old and new GitHub file trees.');}
  }
  if(!blockers.length){
    try{
      const policy=checkBackup({env,platform,freshness,backupHealth});
      ensureRoutineSourceScope(policy,plan);
      recovery_scope=policy.scope;
    }catch(error){blockers.push(error.message);}
  }
  if(installer_required){
    try{
      const artifact=await installerFeed({installed,requiredTarget:target_sha});
      if(artifact.state==='installer_update_available'&&artifact.available===true&&
        artifact.target_sha===target_sha&&/^https:\/\/github\.com\/tchouhanjsm\/fortledger\/actions\/runs\/[0-9]+\/artifacts\/[0-9]+$/.test(artifact.download_url||''))
        installer_download_url=artifact.download_url;
    }catch{} // absence of verified packaging is not permission to install
  }
  return {platform:'windows',state:info.state,ready:blockers.length===0,
    installed:installed?.sha.slice(0,12)||null,remote:info.remote||null,
    target_sha,run_number,change_count:changes,blockers,recovery_scope,
    installer_required,installer_download_url,
    ci_run_url:info.ci_run_url||null,
    update_mode:'code_only',
    note:'Owner-approved source-only update. Database, staff, invoices, native runtime and installed desktop launcher are never replaced.'};
}
async function downloadPinnedFile(sha,name,{fetchFile}={}){
  const url=RAW+sha+'/'+name.split('/').map(encodeURIComponent).join('/');
  if(fetchFile)return fetchFile(sha,name);
  const res=await fetch(url,{signal:AbortSignal.timeout(30000),cache:'no-store'});
  if(!res.ok||!res.url.startsWith(RAW))throw new Error('Pinned GitHub source file unavailable');
  const bytes=Buffer.from(await res.arrayBuffer());
  if(bytes.length>MAX_FILE)throw new Error('Pinned source file exceeds size limit');
  return bytes;
}
// A persistent interruption marker is also checked by the Windows launcher
// BEFORE starting any application code. Never silently clear it on startup.
const PENDING_PATCH='source-update-pending.json';
function markerExists(file){
  try{fs.lstatSync(file);return true;}
  catch(error){if(error.code==='ENOENT')return false;throw error;}
}
function uncertainUpdate(message){
  const error=new Error(message);error.code='CODE_UNCERTAIN';return error;
}
function journal(workRoot,kind,sha){
  fs.mkdirSync(workRoot,{recursive:true,mode:0o700});
  fs.appendFileSync(path.join(workRoot,'code-update-journal.jsonl'),
    JSON.stringify({at:new Date().toISOString(),kind,sha})+'\n',{mode:0o600});
}
function ensureLocalFile(root,name,sha){
  const file=destination(root,name);
  if(!sha){
    if(fs.existsSync(file))throw new Error('An unexpected existing application path would be overwritten');
    return null;
  }
  if(!fs.existsSync(file)||!fs.lstatSync(file).isFile()||
     gitBlobSha(fs.readFileSync(file))!==sha)
    throw new Error('Installed application files differ from the recorded build; update stopped');
  return file;
}
/** Called ONLY from the tray parent after a clean server drain and exit 0.
 * Copy/download/stage before replacing anything. On any write failure, restore
 * original app source; never open, rewrite, downgrade or delete SQLite.
 */
export async function installDesktopCodeUpdate(target_sha,{
  root=ROOT,env=process.env,platform=process.platform,
  installed=readInstalledDesktopBuild(path.join(root,'installer-build.json')),
  feed=checkApprovedSourceUpdate,trees=readGitTree,
  fetchFile=null,freshness=backupFreshness,backupHealth=verifyLocalBackupHealth,
  workRoot=path.join(env.LOCALAPPDATA||'', 'FortLedger','code-updates')
}={}){
  if(!SHA.test(target_sha)||platform!=='win32'||!installed||
    env.FORTLEDGER_DESKTOP_UPDATE_HOST!=='1')
    throw new Error('Only a recognized Windows desktop build can apply a pinned update');
  const info=await feed({installed});
  if(info.available!==true||info.state!=='source_update_available'||
    info.target_sha?.toLowerCase()!==target_sha.toLowerCase()||
    !Number.isSafeInteger(info.run_number)||info.run_number!==installed.build_number)
    throw new Error('Pinned update is not the newest fully tested Windows build; review updates again');
  const recovery=checkBackup({env,platform,freshness,backupHealth});
  const plan=planCodeChanges(await trees(installed.sha),await trees(target_sha));
  if(!plan.supported)throw new Error(plan.reason);
  ensureRoutineSourceScope(recovery,plan);
  if(!plan.changes.length)throw new Error('No code-only update needed');
  if(!path.isAbsolute(workRoot)||path.resolve(workRoot)===path.resolve(root)||
     path.resolve(workRoot).startsWith(path.resolve(root)+path.sep))
    throw new Error('Update staging must be outside the installed application');
  const marker=path.join(workRoot,PENDING_PATCH);
  if(markerExists(marker))throw uncertainUpdate('An interrupted source update needs reviewed program-file recovery. Keep the hotel ledger intact.');
  const stage=path.join(workRoot,'stage-'+randomUUID());
  const rollbackRoot=path.join(stage,'rollback');
  const oldStamp=fs.readFileSync(path.join(root,'installer-build.json'));
  const completed=[],newFiles=new Map(),backups=new Map();
  let applying=false;
  try{
    fs.mkdirSync(stage,{recursive:true,mode:0o700});
    for(const change of plan.changes){
      const current=ensureLocalFile(root,change.path,change.old_sha);
      if(current){
        const bytes=fs.readFileSync(current);
        backups.set(change.path,bytes);
        const copy=destination(rollbackRoot,change.path);
        fs.mkdirSync(path.dirname(copy),{recursive:true,mode:0o700});
        fs.writeFileSync(copy,bytes,{flag:'wx',mode:0o600,flush:true});
      }
      if(!change.new_sha)continue;
      const bytes=await downloadPinnedFile(target_sha,change.path,{fetchFile});
      if(bytes.length!==change.size||gitBlobSha(bytes)!==change.new_sha)
        throw new Error('Downloaded source failed the pinned Git blob integrity check');
      const copy=destination(stage,change.path);
      fs.mkdirSync(path.dirname(copy),{recursive:true,mode:0o700});
      fs.writeFileSync(copy,bytes,{flag:'wx',mode:0o600,flush:true});
      newFiles.set(change.path,copy);
    }
    fs.mkdirSync(rollbackRoot,{recursive:true,mode:0o700});
    fs.writeFileSync(path.join(rollbackRoot,'installer-build.json'),oldStamp,{flag:'wx',mode:0o600,flush:true});
    fs.writeFileSync(path.join(stage,'plan.json'),JSON.stringify({from:installed.sha,to:target_sha,changes:plan.changes})+'\n',{flag:'wx',mode:0o600,flush:true});
    journal(workRoot,'staged',target_sha);
    // Exclusive, durable marker BEFORE any program file is replaced. A
    // crashed/power-interrupted helper leaves a guarded recovery bundle.
    fs.writeFileSync(marker,JSON.stringify({from:installed.sha,to:target_sha,stage:path.basename(stage)})+'\n',
      {flag:'wx',mode:0o600,flush:true});
    applying=true;
    for(const change of plan.changes){
      const file=destination(root,change.path);
      fs.mkdirSync(path.dirname(file),{recursive:true});
      const temp=file+'.fortledger-updating-'+randomUUID();
      if(change.new_sha){
        fs.writeFileSync(temp,fs.readFileSync(newFiles.get(change.path)),{flag:'wx',flush:true});
        fs.renameSync(temp,file);
      }else fs.unlinkSync(file);
      completed.push(change.path);
    }
    const stamp={sha:target_sha.toLowerCase(),build_number:installed.build_number,
      version:'code-update',update_method:'verified_source_only'};
    const stampTemp=path.join(root,'installer-build.json.tmp-'+randomUUID());
    fs.writeFileSync(stampTemp,JSON.stringify(stamp)+'\n',{flag:'wx',flush:true});
    fs.renameSync(stampTemp,path.join(root,'installer-build.json'));
    for(const change of plan.changes)ensureLocalFile(root,change.path,change.new_sha);
    if(!fs.readFileSync(path.join(root,'installer-build.json')).equals(Buffer.from(JSON.stringify(stamp)+'\n')))
      throw new Error('Installed source build identity could not be verified');
    journal(workRoot,'source_applied',target_sha);
    fs.unlinkSync(marker);
    return {updated:true,changed:completed.length,target_sha};
  }catch(error){
    if(applying){
      let rollbackError=null;
      for(const name of completed.reverse()){
        try{
          const file=destination(root,name),old=backups.get(name);
          if(old)fs.writeFileSync(file,old,{flush:true});
          else if(fs.existsSync(file))fs.unlinkSync(file);
        }catch(e){rollbackError=e;}
      }
      try{
        fs.writeFileSync(path.join(root,'installer-build.json'),oldStamp,{flush:true});
        for(const change of plan.changes)ensureLocalFile(root,change.path,change.old_sha);
        if(!fs.readFileSync(path.join(root,'installer-build.json')).equals(oldStamp))throw new Error('Original build identity differs');
        if(!rollbackError){journal(workRoot,'rolled_back',target_sha);fs.unlinkSync(marker);}
      }catch(e){rollbackError=e;}
      if(rollbackError){
        try{journal(workRoot,'rollback_unconfirmed',target_sha);}catch{}
        throw uncertainUpdate('Application source rollback could not be verified. Keep FortLedger stopped and recover from reviewed program files; never reset hotel data.');
      }
    }
    if(markerExists(marker))throw uncertainUpdate('Source update interruption marker remains; preserve recovery bundle and keep FortLedger stopped.');
    throw error;
  }finally{
    // Never remove the recovery bundle while an interruption marker remains.
    if(!markerExists(marker)){
      try{fs.rmSync(stage,{recursive:true,force:true});}catch{} // harmless staging cleanup
    }
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const result=await installDesktopCodeUpdate(process.argv[2]);
    console.log('Verified code update applied: '+result.changed+' application files. Original hotel data and credentials untouched.');
  }catch(error){
    console.error('DESKTOP CODE UPDATE REFUSED: '+error.message);
    process.exitCode=error.code==='CODE_UNCERTAIN'?3:1;
  }
}
