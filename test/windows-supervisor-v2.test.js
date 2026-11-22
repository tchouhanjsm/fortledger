import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createWindowsSupervisor} from '../scripts/windows-supervisor.mjs';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {requiredPermission} from '../src/access.js';

const approved='b'.repeat(40),old='a'.repeat(40);
class Child extends EventEmitter{
  constructor(){super();this.sent=[];}
  send(message){this.sent.push(message);}
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,25));
async function until(predicate){
  for(let n=0;n<60;n++){
    if(predicate())return;
    await tick();
  }
  throw new Error('Synthetic update workflow did not reach expected state');
}
function fixture({failed=false,advanced=false}={}){
  const children=[],events=[],installs=[];
  let current=old;
  const service=createWindowsSupervisor({
    launch:()=>{const child=new Child();children.push(child);return child;},
    head:async()=>current,
    approve:async sha=>({approved:sha===approved,sha,run_id:10}),
    install:async sha=>{
      installs.push(sha);
      if(advanced)current=approved;
      if(failed)throw Error('synthetic installer failure');
      current=sha;
    },
    health:async()=>true,
    journal:(kind,data)=>events.push({kind,...data}),
    logger:{log:()=>{},error:()=>{}}
  });
  service.start();
  return {service,children,events,installs,get current(){return current;}};
}
function request(h){
  const child=h.children[0];
  const request_id='12345678-1234-1234-1234-123456789abc';
  child.emit('message',{type:'fortledger.update.request',request_id,target_sha:approved});
  assert.deepEqual(child.sent,[{type:'fortledger.update.accepted',request_id}]);
  return child;
}
test('supervisor NEVER installs until separate server emits a clean drain and exits zero',async()=>{
  const h=fixture(),child=request(h);
  assert.equal(h.installs.length,0);
  child.emit('message',{type:'fortledger.update.drained'});
  assert.equal(h.installs.length,0,'Must wait until all active HTTP requests exit');
  child.emit('exit',0,null);
  await until(()=>h.events.some(e=>e.kind==='healthy'));
  assert.deepEqual(h.installs,[approved]);
  assert.equal(h.current,approved);
  assert.equal(h.children.length,2);
  assert.deepEqual(h.events.map(e=>e.kind),
    ['owner_requested','http_drained','install_started','tests_passed','healthy']);
});
test('unconfirmed/abnormal shutdown never launches installer',async()=>{
  const h=fixture(),child=request(h);
  child.emit('exit',1,null);
  await until(()=>h.events.some(e=>e.kind==='unsafe_shutdown'));
  assert.equal(h.installs.length,0);
  assert.equal(h.children.length,1);
});
test('failed install only restarts old version when its installed revision is unchanged',async()=>{
  const h=fixture({failed:true}),child=request(h);
  child.emit('message',{type:'fortledger.update.drained'});
  child.emit('exit',0,null);
  await until(()=>h.events.some(e=>e.kind==='update_failed'));
  assert.equal(h.current,old);
  assert.equal(h.children.length,2,'Can restart unchanged code after a failed pre-merge update');
});
test('changed code with failed installation refuses automatic rollback/startup',async()=>{
  const h=fixture({failed:true,advanced:true}),child=request(h);
  child.emit('message',{type:'fortledger.update.drained'});
  child.emit('exit',0,null);
  await until(()=>h.events.some(e=>e.kind==='update_failed'));
  assert.equal(h.current,approved);
  assert.equal(h.children.length,1,'Never boot untested changed code or undo a possible migration');
});

test('only a local owner can request install; accepted handoff blocks subsequent writes',async()=>{
  assert.equal(requiredPermission('GET','/system/updates/readiness'),'system.update');
  assert.equal(requiredPermission('POST','/system/updates/install'),'system.update');
  const db=openDatabase(':memory:');
  createStaff(db,{username:'managerupdate',display_name:'Manager',role:'manager',password:'synthetic-manager-password-123'});
  let requested=0,drained=0;
  const app=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-password-123'),
    updateService:{
      inspect:async()=>({ready:true,target_sha:approved,blockers:[]}),
      request:async()=>{requested++;return true;}
    }});
  app.locals.stopForUpdate=()=>{drained++;};
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const login=async(name,password)=>{
    const response=await fetch(url+'/api/auth/login',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({username:name,password})});
    assert.equal(response.status,200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const request=(route,method='GET',body,cookie)=>fetch(url+route,{
    method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  try{
    assert.equal((await request('/api/system/updates/readiness')).status,401);
    const owner=await login('owner','synthetic-owner-password-123');
    const manager=await login('managerupdate','synthetic-manager-password-123');
    assert.equal((await request('/api/system/updates/readiness','GET',undefined,manager)).status,403);
    assert.equal((await request('/api/system/updates/install','POST',
      {target_sha:approved,confirmation:'stop_after_current_requests'},manager)).status,403);
    assert.equal(requested,0);
    assert.equal((await request('/api/system/updates/install','POST',
      {target_sha:'bad',confirmation:'stop_after_current_requests'},owner)).status,400);
    const readiness=await request('/api/system/updates/readiness','GET',undefined,owner);
    assert.equal(readiness.status,200);
    assert.equal((await readiness.json()).ready,true);
    const accepted=await request('/api/system/updates/install','POST',
      {target_sha:approved,confirmation:'stop_after_current_requests'},owner);
    assert.equal(accepted.status,202);
    assert.equal((await accepted.json()).accepted,true);
    await until(()=>drained===1);
    assert.equal(requested,1);
    const blocked=await request('/api/bookings','POST',{
      guest_name:'Should be blocked',checkin:'2027-04-01',checkout:'2027-04-02',
      rooms_count:1,nightly_rate:5000,category:'Unassigned'
    },owner);
    assert.equal(blocked.status,503);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM bookings').get().n,0);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
test('Windows scripts have pinned commit and supervisor paths, with real PowerShell parser checks',()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const read=p=>readFileSync(path.join(root,p),'utf8');
  const update=read('scripts/windows-update.ps1');
  const quick=read('scripts/windows-quick-update.ps1');
  const start=read('scripts/windows-start.ps1');
  const parent=read('scripts/windows-supervisor.mjs');
  for(const code of [update,quick])assert.match(code,/ExpectedCommit/);
  assert.match(update,/GitHub main changed since owner approval/);
  assert.match(quick,/SkipRestart/);
  assert.match(start,/windows-supervisor\.mjs/);
  assert.match(parent,/fortledger\.update\.drained/);
  assert.doesNotMatch(update+'\n'+quick+'\n'+parent, /git reset --hard|git clean -fd|Stop-Process|taskkill|closeAllConnections\(/i);
  if(process.platform==='win32'){
    const ps=`$problems=@(); foreach($file in @('scripts/windows-start.ps1','scripts/windows-update.ps1','scripts/windows-quick-update.ps1')){[System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) $file),[ref]$null,[ref]$problems)|Out-Null}; if($problems.Count){$problems|ForEach-Object {Write-Error $_};exit 1}`;
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{
      cwd:root,timeout:25000});
  }
});
