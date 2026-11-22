import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerUpdateNotice,shouldShowOwnerUpdateNotice} from '../public/update-notice.js';

const installer={platform:'windows',state:'installer_update_available',available:true,
  download_url:'https://github.com/tchouhanjsm/fortledger/actions/runs/123/artifacts/456'};
test('quiet update notice distinguishes installer releases, Git revisions and unavailable release checks',()=>{
  assert.equal(shouldShowOwnerUpdateNotice(installer),true);
  assert.equal(shouldShowOwnerUpdateNotice({platform:'windows',state:'new_revision',available:true}),true);
  for(const response of [null,{}, {platform:'mac',state:'new_revision',available:true},
    {platform:'windows',state:'installer_managed',available:false},
    {platform:'windows',state:'installer_check_unavailable',available:false},
    {platform:'windows',state:'up_to_date',available:false},
    {platform:'windows',state:'installer_update_available',available:false}])
    assert.equal(shouldShowOwnerUpdateNotice(response),false);
});
test('read-only notice is owner-only, local-only, throttled and never triggers install',async()=>{
  let t=100,calls=0,shows=0,hides=0;
  const updater=createOwnerUpdateNotice({
    check:async()=>{calls++;return installer;},
    show:()=>{shows++;},hide:()=>{hides++;},now:()=>t,minimumIntervalMs:1000
  });
  assert.equal(await updater.refresh({owner:false,local:true}),false);
  assert.equal(await updater.refresh({owner:true,local:false}),false);
  assert.equal(calls,0);
  assert.equal(await updater.refresh({owner:true,local:true}),true);
  assert.equal(calls,1);assert.equal(shows,1);
  assert.equal(await updater.refresh({owner:true,local:true}),false);
  t=1099;
  assert.equal(await updater.refresh({owner:true,local:true}),false);
  assert.equal(calls,1);
  t=1100;
  assert.equal(await updater.refresh({owner:true,local:true}),true);
  assert.equal(calls,2);
  updater.reset();assert.equal(hides>=3,true);
});
test('same-session concurrent notice checks share one request; offline errors fail closed',async()=>{
  let start=()=>{},calls=0,visible=false;
  const gate=new Promise(resolve=>start=resolve);
  const updater=createOwnerUpdateNotice({
    check:async()=>{calls++;await gate;return installer;},
    show:()=>{visible=true;},hide:()=>{visible=false;}
  });
  const a=updater.refresh({owner:true,local:true});
  const b=updater.refresh({owner:true,local:true,force:true});
  assert.equal(calls,1);
  start();
  assert.equal(await a,true);
  assert.equal(await b,true);
  assert.equal(visible,true);
  const broken=createOwnerUpdateNotice({
    check:async()=>{throw new Error('offline');},
    show:()=>{visible=true;},hide:()=>{visible=false;}
  });
  assert.equal(await broken.refresh({owner:true,local:true}),false);
  assert.equal(visible,false);
});
