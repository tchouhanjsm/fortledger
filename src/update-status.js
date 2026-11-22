import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const execFile=promisify(execFileCallback);
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ORIGIN=/^(?:https:\/\/github\.com\/|git@github\.com:)tchouhanjsm\/fortledger(?:\.git)?$/i;
const SHA=/^[a-f0-9]{40}$/i;

/** Read-only UI inspection. Never fetch/merge files, run npm, or open a live database.
 * A differing remote SHA is only a candidate; the updater still has to prove
 * a fast-forward, backup integrity and an idle server before making changes. */
export async function updateStatus({cwd=ROOT,platform=process.platform,
  run=async args=>(await execFile('git',args,{cwd,timeout:15000,
    maxBuffer:64*1024,windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}})).stdout.trim()}={}){
  const result={platform:platform==='win32'?'windows':platform==='darwin'?'mac':'other',
    state:'unavailable',current:null,remote:null,available:false,
    message:'Cannot check GitHub updates on this computer'};
  const command=async(...args)=>String(await run(args)).trim();
  try{
    const current=await command('rev-parse','--verify','HEAD');
    if(!SHA.test(current))throw new Error('Invalid installed Git revision');
    result.current=current.slice(0,12);
    const branch=await command('branch','--show-current');
    if(branch!=='main'){
      result.state='blocked';
      result.message='Update checks require the main branch. Existing working branch was not changed.';
      return result;
    }
    const origin=await command('remote','get-url','origin');
    if(!ORIGIN.test(origin)){
      result.state='blocked';
      result.message='Git origin is not the official FortLedger repository; review the installation first.';
      return result;
    }
    // Include untracked files, which could conflict with a later tracked lockfile.
    const dirty=await command('status','--porcelain=v1','--untracked-files=all');
    if(dirty){
      result.state='blocked';
      result.message='Local app files need review before updating. Nothing has been modified.';
      return result;
    }
    const line=await command('ls-remote','--exit-code','origin','refs/heads/main');
    const sha=line.split(/\s+/)[0];
    if(!SHA.test(sha)||!line.endsWith('refs/heads/main'))
      throw new Error('Unexpected main branch response');
    result.remote=sha.slice(0,12);
    result.available=sha!==current;
    result.state=result.available?'new_revision':'up_to_date';
    result.message=result.available?
      'New GitHub revision detected. Installation still requires a safe fast-forward, backup and restart.':
      'This installation matches the current GitHub main revision.';
    return result;
  }catch{
    result.state='unavailable';
    result.message='Could not verify GitHub main (offline, Git missing or remote unavailable). Local data was not changed.';
    return result;
  }
}
