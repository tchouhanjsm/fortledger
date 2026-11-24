import test from 'node:test';
import assert from 'node:assert/strict';
import {checkApprovedSourceUpdate} from '../src/approved-source-feed.js';
const old='a'.repeat(40),head='b'.repeat(40);
const installed={sha:old,build_number:37};
const branch={name:'main',commit:{sha:head}};
const compare={status:'ahead',ahead_by:3,behind_by:0};
const read=async url=>url.endsWith('/branches/main')?branch:compare;
const approve=async sha=>({approved:true,sha,run_url:'https://github.com/tchouhanjsm/fortledger/actions/runs/123'});
test('exact main source CI suffices without a Windows EXE artifact',async()=>{
 const result=await checkApprovedSourceUpdate({installed,read,approve});
 assert.equal(result.state,'source_update_available');
 assert.equal(result.available,true);
 assert.equal(result.target_sha,head);
 assert.equal(result.download_url,null);
 assert.equal(result.run_number,37);
 assert.match(result.ci_run_url,/runs\/123$/);
});
test('reject backward/diverged/unapproved/PR-only/offline source updates',async()=>{
 for(const history of [
  {status:'diverged',ahead_by:1,behind_by:2},
  {status:'behind',ahead_by:0,behind_by:2},
  {status:'identical',ahead_by:0,behind_by:0}
 ]){
  assert.equal((await checkApprovedSourceUpdate({installed,
   read:async url=>url.endsWith('/branches/main')?branch:history,approve})).available,false);
 }
 assert.equal((await checkApprovedSourceUpdate({installed,read,approve:async()=>({approved:false})})).available,false);
 assert.equal((await checkApprovedSourceUpdate({installed,read:async()=>{throw Error('offline')},approve})).available,false);
 assert.equal((await checkApprovedSourceUpdate({installed:null,read,approve})).available,false);
 assert.equal((await checkApprovedSourceUpdate({installed:{sha:head,build_number:37},read,approve})).state,'source_up_to_date');
 assert.equal((await checkApprovedSourceUpdate({installed,
  read:async url=>url.endsWith('/branches/main')?{name:'feature',commit:{sha:head}}:compare,
  approve})).available,false);
});
