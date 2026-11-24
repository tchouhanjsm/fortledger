import {approvedMainCommit} from './approved-update.js';
import {readInstalledDesktopBuild} from './installer-update-feed.js';

const API='https://api.github.com/repos/tchouhanjsm/fortledger';
const SHA=/^[a-f0-9]{40}$/i;
async function requestJson(url){
  const response=await fetch(url,{headers:{Accept:'application/vnd.github+json',
    'User-Agent':'FortLedger-reviewed-source-update'},
    signal:AbortSignal.timeout(12000),cache:'no-store'});
  if(!response.ok)throw new Error('Cannot verify reviewed GitHub main source');
  return response.json();
}
/** Source-only updates need exact-main CI, not a Windows EXE artifact.
 * The independent updater verifies the complete Git trees and all old/new blobs. */
export async function checkApprovedSourceUpdate({
  installed=readInstalledDesktopBuild(),read=requestJson,approve=approvedMainCommit
}={}){
  const base={platform:'windows',state:'source_check_unavailable',
    available:false,download_url:null,current:installed?.sha?.slice(0,12)||null,
    remote:null,target_sha:null,build_number:installed?.build_number??null,
    message:'Source update check unavailable. No application or hotel data changed.'};
  if(!installed||!SHA.test(installed.sha))return {...base,
    message:'Installed Windows build identity is unknown; manual review required.'};
  try{
    const result=await read(API+'/branches/main');
    const target=result?.commit?.sha?.toLowerCase();
    if(!SHA.test(target)||result.name!=='main')throw new Error('Main branch identity invalid');
    if(target===installed.sha)return {...base,state:'source_up_to_date',
      remote:target.slice(0,12),message:'Installed source already matches GitHub main.'};
    const history=await read(API+'/compare/'+installed.sha+'...'+target);
    if(history?.status!=='ahead'||!Number.isSafeInteger(history.ahead_by)||
       history.ahead_by<1||history.behind_by!==0)
      return {...base,state:'source_history_blocked',remote:target.slice(0,12),
        message:'Installed build is not an ancestor of main; no code replacement allowed.'};
    const evidence=await approve(target);
    if(evidence?.approved!==true||evidence.sha!==target||
       !/^https:\/\/github\.com\/tchouhanjsm\/fortledger\/actions\/runs\/[0-9]+$/.test(evidence.run_url||''))
      return {...base,state:'source_ci_pending',remote:target.slice(0,12),
        message:'Main needs successful Linux, Windows and Chromium tests before updating.'};
    return {...base,state:'source_update_available',available:true,
      remote:target.slice(0,12),target_sha:target,run_number:installed.build_number,
      ci_run_url:evidence.run_url,
      message:'Approved source update available through local updater; no installer download.'};
  }catch{return base;}
}
