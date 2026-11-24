import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readInstalledDesktopBuild} from './installer-update-feed.js';
import {checkApprovedSourceUpdate} from './approved-source-feed.js';
import {backupFreshness} from './backup-freshness.js';
import {verifyLocalBackupHealth} from './backup-health.js';
import {isSeparateBackupVolume} from './upgrade-backup.js';
import {databasePath} from './data-paths.js';

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
      return {supported:false,reason:'This release changes the desktop launcher, backup controls or native dependencies. Use the verified full Windows installer once for this release.',changes:[]};
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
    return {supported:false,reason:'This update is larger than the safe source-only limit. Use the verified full Windows installer.',changes:[]};
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
function checkBackup({env,platform,freshness=backupFreshness,
  backupHealth=verifyLocalBackupHealth}={}){
  if(platform!=='win32')throw new Error('Desktop code updates are Windows-only');
  const data=databasePath(env);
  if(typeof env.FORTLEDGER_BACKUP_DIR!=='string'||!path.win32.isAbsolute(env.FORTLEDGER_BACKUP_DIR)||
     !isSeparateBackupVolume(env.FORTLEDGER_BACKUP_DIR,data,'win32'))
    throw new Error('Configure a protected encrypted backup on a different drive before updating');
  if(freshness({env}).state!=='recent')
    throw new Error('The encrypted backup must be recent; prepare a fresh protected backup first');
  const health=backupHealth({env});
  if(health?.restorable!==true||health?.owner_auth_present!==true||
     health?.owner_credential_recoverable!==true||health?.independent_drive!==true)
    throw new Error('The external encrypted hotel and original owner credentials must pass restore verification');
}
export async function inspectDesktopCodeUpdate({
  root=ROOT,env=process.env,platform=process.platform,
  installed=readInstalledDesktopBuild(path.join(root,'installer-build.json')),
  feed=checkApprovedSourceUpdate,trees=readGitTree,
  freshness=backupFreshness,backupHealth=verifyLocalBackupHealth
}={}){
  const blockers=[],info=await feed({installed});
  let target_sha=null,run_number=null,changes=0;
  if(platform!=='win32'||env.FORTLEDGER_DESKTOP_UPDATE_HOST!=='1')
    blockers.push('This installation does not have the dedicated Windows desktop update supervisor. A one-time bootstrap installer is required.');
  if(!installed)blockers.push('This desktop installation has no trustworthy installed build identity.');
  if(info.state!=='source_update_available'||!info.available||
    !SHA.test(info.target_sha)||!Number.isSafeInteger(info.run_number))
    blockers.push('No fully tested newer GitHub main build is available.');
  if(!blockers.length){
    target_sha=info.target_sha.toLowerCase();run_number=info.run_number;
    try{
      const plan=planCodeChanges(await trees(installed.sha),await trees(target_sha));
      if(!plan.supported)blockers.push(plan.reason);
      else changes=plan.changes.length;
      if(!changes)blockers.push('There are no app code or UI changes to apply; a full installer may be needed for this release.');
    }catch{blockers.push('Could not verify the complete old and new GitHub file trees.');}
  }
  if(!blockers.length){
    try{checkBackup({env,platform,freshness,backupHealth});}
    catch(error){blockers.push(error.message);}
  }
  return {platform:'windows',state:info.state,ready:blockers.length===0,
    installed:installed?.sha.slice(0,12)||null,remote:info.remote||null,
    target_sha,run_number,change_count:changes,blockers,
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
  checkBackup({env,platform,freshness,backupHealth});
  const plan=planCodeChanges(await trees(installed.sha),await trees(target_sha));
  if(!plan.supported)throw new Error(plan.reason);
  if(!plan.changes.length)throw new Error('No code-only update needed');
  if(!path.isAbsolute(workRoot)||path.resolve(workRoot)===path.resolve(root)||
     path.resolve(workRoot).startsWith(path.resolve(root)+path.sep))
    throw new Error('Update staging must be outside the installed application');
  const stage=path.join(workRoot,'stage-'+randomUUID());
  const oldStamp=fs.readFileSync(path.join(root,'installer-build.json'));
  const completed=[],newFiles=new Map(),backups=new Map();
  let applying=false;
  try{
    fs.mkdirSync(stage,{recursive:true,mode:0o700});
    for(const change of plan.changes){
      const current=ensureLocalFile(root,change.path,change.old_sha);
      if(current)backups.set(change.path,fs.readFileSync(current));
      if(!change.new_sha)continue;
      const bytes=await downloadPinnedFile(target_sha,change.path,{fetchFile});
      if(bytes.length!==change.size||gitBlobSha(bytes)!==change.new_sha)
        throw new Error('Downloaded source failed the pinned Git blob integrity check');
      const copy=destination(stage,change.path);
      fs.mkdirSync(path.dirname(copy),{recursive:true,mode:0o700});
      fs.writeFileSync(copy,bytes,{flag:'wx',mode:0o600});
      newFiles.set(change.path,copy);
    }
    journal(workRoot,'staged',target_sha);
    applying=true;
    for(const change of plan.changes){
      const file=destination(root,change.path);
      fs.mkdirSync(path.dirname(file),{recursive:true});
      const temp=file+'.fortledger-updating-'+randomUUID();
      if(change.new_sha){
        fs.copyFileSync(newFiles.get(change.path),temp,fs.constants.COPYFILE_EXCL);
        fs.renameSync(temp,file);
      }else fs.unlinkSync(file);
      completed.push(change.path);
    }
    const stamp={sha:target_sha.toLowerCase(),build_number:installed.build_number,
      version:'code-update',update_method:'verified_source_only'};
    const stampTemp=path.join(root,'installer-build.json.tmp-'+randomUUID());
    fs.writeFileSync(stampTemp,JSON.stringify(stamp)+'\n',{flag:'wx'});
    fs.renameSync(stampTemp,path.join(root,'installer-build.json'));
    journal(workRoot,'source_applied',target_sha);
    return {updated:true,changed:completed.length,target_sha};
  }catch(error){
    if(applying){
      let rollbackError=null;
      for(const name of completed.reverse()){
        try{
          const file=destination(root,name),old=backups.get(name);
          if(old)fs.writeFileSync(file,old);
          else if(fs.existsSync(file))fs.unlinkSync(file);
        }catch(e){rollbackError=e;}
      }
      try{fs.writeFileSync(path.join(root,'installer-build.json'),oldStamp);}
      catch(e){rollbackError=e;}
      if(rollbackError){
        journal(workRoot,'rollback_unconfirmed',target_sha);
        const critical=new Error('Application source rollback could not be verified. Keep FortLedger stopped and recover from reviewed program files; never reset hotel data.');
        critical.code='CODE_UNCERTAIN';
        throw critical;
      }
      journal(workRoot,'rolled_back',target_sha);
    }
    throw error;
  }finally{
    fs.rmSync(stage,{recursive:true,force:true});
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
