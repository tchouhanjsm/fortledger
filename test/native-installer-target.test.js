import test from 'node:test';
import assert from 'node:assert/strict';
import {checkInstallerUpdate} from '../src/installer-update-feed.js';

test('exact native installer target never falls back to a different SHA',async()=>{
 const target='b'.repeat(40),other='c'.repeat(40),installed={sha:'a'.repeat(40),build_number:1};
 const run=(sha,id)=>({head_sha:sha,head_branch:'main',event:'push',status:'completed',
  conclusion:'success',name:'Windows Installer (unsigned alpha)',id,run_number:id});
 const approved=[],seen=[];
 const opts={installed,requiredTarget:target,approve:async sha=>{approved.push(sha);return {approved:true,sha};},
  read:async url=>{
   seen.push(url);
   if(url.includes('workflows/'))return {workflow_runs:[run(other,3),run(target,2)]};
   return {artifacts:[{name:'FortLedger-Windows-Setup-alpha',expired:false,id:5,size_in_bytes:2000000}]};
  }};
 const result=await checkInstallerUpdate(opts);
 assert.equal(result.target_sha,target);
 assert.deepEqual(approved,[target]);
 assert.ok(seen.some(url=>url.includes('/runs/2/artifacts')));
 assert.equal(seen.some(url=>url.includes('/runs/3/artifacts')),false);
 const missing=await checkInstallerUpdate({...opts,read:async()=>({workflow_runs:[run(other,3)]})});
 assert.equal(missing.available,false);
});
