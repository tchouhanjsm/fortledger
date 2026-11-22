import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeReleaseReadiness} from '../src/release-status-summary.js';
import {PHYSICAL_RELEASE_GATES} from '../src/release-readiness.js';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';

function syntheticReport(){
  return {
    verdict:'NOT RELEASED',production_ready:false,
    automated:{passed:7,failed:1,warnings:3},
    evidence:{attested:1,total:6,valid:true,
      private_key:'SECRET PRIVATE AUTH'},
    physical_gates:PHYSICAL_RELEASE_GATES.map((gate,i)=>({...gate,
      status:i===0?'OPERATOR ATTESTED — NOT INDEPENDENTLY VERIFIED':'PENDING HUMAN VERIFICATION',
      performed_by:'Private Operator Name',reviewed_by:'Private Reviewer',
      reference:'file:///private/staff/acceptance.pdf'})),
    blocking_items:[{name:'Encrypted backups',status:'warn',
      detail:'/private/drive/backup and auth password'}]
  };
}
test('public release status never reveals private proof references, locations or implies live readiness',()=>{
  const r=summarizeReleaseReadiness(syntheticReport()),serialized=JSON.stringify(r);
  assert.equal(r.verdict,'NOT RELEASED');
  assert.equal(r.production_ready,false);
  assert.equal(r.full_machine_diagnostics_performed,false);
  assert.equal(r.evidence.attested,1);
  assert.equal(r.gates.length,6);
  assert.equal(r.blocking_checks.length,1);
  for(const secret of ['Private Operator Name','Private Reviewer','file:///private','SECRET PRIVATE AUTH',
    '/private/drive/backup','auth password'])
    assert.equal(serialized.includes(secret),false);
  assert.match(r.notice,/independent on-site proof/);
});
test('invalid or purported released status fails closed',()=>{
  for(const data of [null,{}, {...syntheticReport(),verdict:'RELEASED'},
    {...syntheticReport(),production_ready:true}])
    assert.throws(()=>summarizeReleaseReadiness(data),/Release status unavailable/);
});
test('authenticated local owner can read redacted gates, managers/cashiers cannot and no ledger writes occur',async()=>{
  const db=openDatabase(':memory:');
  createStaff(db,{username:'syntheticmanager',display_name:'Manager',
    role:'manager',password:'synthetic-manager-pass-long'});
  createStaff(db,{username:'syntheticcashier',display_name:'Cashier',
    role:'cashier',password:'synthetic-cashier-pass-long'});
  let calls=0;
  const app=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-pass-long'),
    getReleaseReadiness:()=>{calls++;return syntheticReport();}});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const login=async(username,password)=>{
    const response=await fetch(base+'/api/auth/login',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username,password})
    });
    assert.equal(response.status,200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  try{
    assert.equal((await fetch(base+'/api/system/release-readiness')).status,401);
    const manager=await login('syntheticmanager','synthetic-manager-pass-long');
    const cashier=await login('syntheticcashier','synthetic-cashier-pass-long');
    for(const cookie of [manager,cashier]){
      assert.equal((await fetch(base+'/api/system/release-readiness',{headers:{Cookie:cookie}})).status,403);
    }
    assert.equal(calls,0,'Staff requests cannot reach the local diagnostic inspector');
    const owner=await login('owner','synthetic-owner-pass-long');
    const response=await fetch(base+'/api/system/release-readiness',{headers:{Cookie:owner}});
    assert.equal(response.status,200);
    const status=await response.json();
    assert.equal(status.production_ready,false);
    assert.equal(status.gates.length,6);
    assert.equal(calls,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM operation_audit').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,0);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
test('UI is owner-only, opt-in, and never attests evidence through a browser',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/id="release-status-panel"/);
  assert.match(html,/id="release-status-check"/);
  assert.match(ui,/\$\('#release-status-panel'\)\.hidden=currentUser\.role!=='owner'/);
  assert.match(ui,/\$\('#release-status-check'\)\.onclick=async\(\)=>/);
  assert.match(ui,/api\('\/api\/system\/release-readiness'\)/);
  assert.match(readFileSync(new URL('../src/server.js',import.meta.url),'utf8'),/getReleaseReadiness=lightweightReleaseReadiness/);
  assert.doesNotMatch(html,/mark production ready|self-certify/);
});
