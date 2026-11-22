import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {approvedMainCommit} from './approved-update.js';

const API='https://api.github.com/repos/tchouhanjsm/fortledger';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SHA=/^[a-f0-9]{40}$/i;
const NAME='FortLedger-Windows-Setup-alpha';
const MIN_ARTIFACT_BYTES=1000000;

async function requestJson(url){
  const response=await fetch(url,{
    headers:{'Accept':'application/vnd.github+json','User-Agent':'FortLedger-Windows-desktop-update'},
    signal:AbortSignal.timeout(12000),cache:'no-store'});
  if(!response.ok)throw new Error('GitHub release check is unavailable');
  return response.json();
}

export function readInstalledDesktopBuild(file=path.join(ROOT,'installer-build.json')){
  try{
    const record=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!SHA.test(record?.sha)||!Number.isSafeInteger(record?.build_number)||
       record.build_number<1)throw new Error('Invalid installed build');
    return {sha:record.sha.toLowerCase(),build_number:record.build_number};
  }catch{return null;}
}

/** Read-only feed for bundled EXE deployments. A Git push or green PR alone
 * is never an installable update. Only an exact main push with complete
 * CI, a successful installer workflow and a nonexpired official artifact.
 * Never use this endpoint to execute downloaded code. */
export async function checkInstallerUpdate({
  installed=readInstalledDesktopBuild(),read=requestJson,approve=approvedMainCommit
}={}){
  const base={platform:'windows',state:'installer_managed',available:false,
    current:installed?.sha?.slice(0,12)??null,remote:null,
    download_url:null,build_number:installed?.build_number??null,
    message:'This Windows installation uses verified installer packages, not Git. No hotel data was changed.'};
  try{
    const response=await read(API+'/actions/workflows/windows-installer.yml/runs?branch=main&event=push&status=success&per_page=20');
    const runs=(Array.isArray(response?.workflow_runs)?response.workflow_runs:[])
      .filter(run=>SHA.test(run?.head_sha)&&run.head_branch==='main'&&
        run.event==='push'&&run.status==='completed'&&run.conclusion==='success'&&
        run.name==='Windows Installer (unsigned alpha)'&&
        Number.isSafeInteger(run.id)&&run.id>0&&
        Number.isSafeInteger(run.run_number)&&run.run_number>0)
      .sort((a,b)=>b.run_number-a.run_number);
    for(const run of runs){
      // If installed revision is already current, older artifacts are not updates.
      if(installed&&run.run_number<=installed.build_number)continue;
      if(installed&&run.head_sha.toLowerCase()===installed.sha)continue;
      const evidence=await approve(run.head_sha.toLowerCase());
      if(evidence?.approved!==true||evidence.sha!==run.head_sha.toLowerCase())continue;
      const artifacts=await read(API+'/actions/runs/'+run.id+'/artifacts?per_page=100');
      const official=(Array.isArray(artifacts?.artifacts)?artifacts.artifacts:[])
        .find(a=>a.name===NAME&&a.expired===false&&
          Number.isSafeInteger(a.id)&&a.id>0&&
          Number.isFinite(a.size_in_bytes)&&a.size_in_bytes>=MIN_ARTIFACT_BYTES);
      if(!official)continue;
      return {...base,state:'installer_update_available',available:true,
        remote:run.head_sha.slice(0,12),run_number:run.run_number,
        download_url:'https://github.com/tchouhanjsm/fortledger/actions/runs/'+
          run.id+'/artifacts/'+official.id,
        message:installed?
          'A tested Windows installer is ready. Owner: verify the protected backup, finish all bills, close FortLedger from the tray, then install the downloaded setup.':
          'A tested installer is available, but this older installation has no recorded build ID. Owner: verify the protected backup before installing.'};
    }
    return {...base,message:installed?
      'No newer fully-tested installer artifact is currently available.':
      'Current installed build cannot be identified; check official Windows builds as owner.'};
  }catch{
    return {...base,state:'installer_check_unavailable',
      message:'Could not verify a current Windows release. FortLedger remains available offline. No changes were made.'};
  }
}
