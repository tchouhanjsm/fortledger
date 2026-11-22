import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {approvedMainCommit} from '../src/approved-update.js';
import {inspectUpdateReadiness,createSupervisedUpdateIpc} from '../src/update-readiness.js';

const sha='b'.repeat(40),installed='a'.repeat(40);
function evidence({events='push',branch='main',head=sha,conclusion='success',jobs=null}={}){
  const calls=[];
  const read=async url=>{
    calls.push(url);
    if(url.includes('/actions/runs?')){
      return {workflow_runs:[{id:123,head_sha:head,head_branch:branch,event:events,
        status:'completed',conclusion}]};
    }
    return {jobs:jobs??['browser','test (ubuntu-latest)','test (windows-latest)']
      .map(name=>({name,status:'completed',conclusion:'success'}))};
  };
  return {read,calls};
}
test('CI gate requires success on exact main push commit and all three jobs',async()=>{
  const good=evidence();
  const result=await approvedMainCommit(sha,{read:good.read});
  assert.deepEqual(result,{approved:true,sha,run_id:123,
    run_url:'https://github.com/tchouhanjsm/fortledger/actions/runs/123'});
  assert.match(good.calls[0],new RegExp('head_sha='+sha));
  for(const bad of [
    {events:'pull_request'}, {branch:'feature'}, {head:installed},
    {conclusion:'failure'},{jobs:[{name:'browser',status:'completed',conclusion:'success'}]},
    {jobs:[{name:'test (ubuntu-latest)',status:'in_progress',conclusion:null}]}
  ])assert.equal((await approvedMainCommit(sha,{read:evidence(bad).read})).approved,false,
    'Reject CI that is not the exact green main commit');
  await assert.rejects(()=>approvedMainCommit('not-a-sha',{read:good.read}),/Invalid/);
});
function inspected(overrides={}){
  return inspectUpdateReadiness({
    platform:'win32',supervised:true,
    env:{FORTLEDGER_DATA_DIR:'C:\\Users\\Synthetic\\AppData\\Local\\FortLedger\\data',
      FORTLEDGER_BACKUP_DIR:'E:\\EncryptedBackup',
      FORTLEDGER_BACKUP_PASSPHRASE:'synthetic-very-long-passphrase'},
    check:async()=>({state:'new_revision',current:installed.slice(0,12),
      remote:sha.slice(0,12),platform:'windows'}),
    remote:async()=>sha,
    ci:async()=>({approved:true,sha,run_url:'https://github.com/tchouhanjsm/fortledger/actions/runs/123'}),
    freshness:()=>({state:'recent'}),...overrides
  });
}
test('readiness is a preliminary fail-closed gate on supervisor, same-volume and CI',async()=>{
  const ready=await inspected();
  assert.equal(ready.ready,true);
  assert.equal(ready.target_sha,sha);
  assert.equal(ready.blockers.length,0);
  const noSupervisor=await inspected({supervised:false});
  assert.equal(noSupervisor.ready,false);
  assert.match(noSupervisor.blockers.join(' '),/supervised Windows launcher/);
  const sameDrive=await inspected({env:{FORTLEDGER_DATA_DIR:'C:\\FortLedgerData',
    FORTLEDGER_BACKUP_DIR:'C:\\AnotherFolder'},freshness:()=>({state:'recent'})});
  assert.equal(sameDrive.ready,false);
  assert.match(sameDrive.blockers.join(' '),/separate protected drive/);
  const brokenBackup=await inspected({freshness:()=>({state:'stale'})});
  assert.equal(brokenBackup.ready,false);
  const failedCI=await inspected({ci:async()=>({approved:false,sha})});
  assert.equal(failedCI.ready,false);
  const moved=await inspected({remote:async()=>installed});
  assert.equal(moved.ready,false);
  assert.match(moved.blockers.join(' '),/changed during update inspection/);
  const mac=await inspected({platform:'darwin'});
  assert.equal(mac.ready,false);
  assert.match(mac.blockers.join(' '),/Windows-only/);
});
test('child IPC handoff has no update side effects and rejects concurrent requests',async()=>{
  class FakeIpc extends EventEmitter{
    constructor(){super();this.sent=[];}
    send(message){this.sent.push(message);}
  }
  const ipc=new FakeIpc(),updates=createSupervisedUpdateIpc(ipc);
  try{
    const promise=updates.request(sha);
    assert.equal(ipc.sent.length,1);
    assert.equal(ipc.sent[0].type,'fortledger.update.request');
    assert.equal(ipc.sent[0].target_sha,sha);
    await assert.rejects(updates.request(sha),/already requested/);
    ipc.emit('message',{type:'fortledger.update.accepted',request_id:ipc.sent[0].request_id});
    assert.equal(await promise,true);
    await assert.rejects(updates.request('unsafe-sha'),/Invalid pinned/);
    const denied=updates.request(sha);
    ipc.emit('message',{type:'fortledger.update.denied',request_id:ipc.sent[1].request_id});
    await assert.rejects(denied,/refused/);
  }finally{updates.dispose();}
});
