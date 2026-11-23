import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';

const ownerPassword='synthetic-v5-strong-owner-password';
const staffPassword='synthetic-v5-strong-cashier-password';
async function harness(work){
  const db=openDatabase(':memory:');
  const staff=createStaff(db,{username:'cashierpin',display_name:'PIN Cashier',role:'cashier',password:staffPassword});
  const owner=createPasswordRecord(ownerPassword);
  const server=createApp(db,{authRecord:owner}).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  const call=async(path,{method='GET',body,cookie}={})=>{
    const res=await fetch(base+path,{method,headers:{
      'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})
    },body:body===undefined?undefined:JSON.stringify(body)});
    const text=await res.text();
    return {status:res.status,data:JSON.parse(text),cookie:res.headers.get('set-cookie')?.split(';')[0],
      setCookie:res.headers.get('set-cookie')};
  };
  const login=(username,password)=>call('/api/auth/login',{method:'POST',body:{username,password}});
  try{await work({db,staff,owner,call,login});}
  finally{await new Promise(r=>server.close(r));db.close();}
}
test('PIN sign-in is off by default and must be explicitly enabled with owner password',()=>harness(async({db,call,login})=>{
  const status=await call('/api/auth/pin/status');assert.deepEqual(status.data,{available:false});
  assert.equal((await call('/api/auth/pin',{method:'POST',body:{username:'cashierpin',pin:'123456'}})).status,403);
  const owner=await login('owner',ownerPassword);assert.equal(owner.status,200);
  assert.equal((await call('/api/system/staff-pin',{cookie:owner.cookie})).data.enabled,false);
  assert.equal((await call('/api/system/staff-pin',{method:'POST',cookie:owner.cookie,
    body:{enabled:true,current_password:'incorrect-strong-owner'}})).status,401);
  const enabled=await call('/api/system/staff-pin',{method:'POST',cookie:owner.cookie,
    body:{enabled:true,current_password:ownerPassword}});
  assert.equal(enabled.status,200);assert.equal(enabled.data.enabled,true);
  assert.deepEqual((await call('/api/auth/pin/status')).data,{available:true});
  assert.equal((await call('/api/me/quick-pin',{method:'POST',cookie:owner.cookie,
    body:{current_password:ownerPassword,pin:'123456',confirm_pin:'123456'}})).status,403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM staff_pin_credentials').get().n,0);
}));
test('six digits require both password enrollment and local device cookie; no SQLite plaintext',()=>harness(async({db,call,login})=>{
  const owner=await login('owner',ownerPassword);
  await call('/api/system/staff-pin',{method:'POST',cookie:owner.cookie,body:{enabled:true,current_password:ownerPassword}});
  const staff=await login('cashierpin',staffPassword);
  assert.equal(staff.status,200);
  assert.equal((await call('/api/me/quick-pin',{cookie:staff.cookie})).data.enrolled,false);
  assert.equal((await call('/api/me/quick-pin',{method:'POST',cookie:staff.cookie,
    body:{current_password:'wrong-pass',pin:'012345',confirm_pin:'012345'}})).status,401);
  const setup=await call('/api/me/quick-pin',{method:'POST',cookie:staff.cookie,
    body:{current_password:staffPassword,pin:'012345',confirm_pin:'012345'}});
  assert.equal(setup.status,200);
  assert.match(setup.cookie,/^fortledger_pin_device=[a-f0-9]{64}$/);
  assert.match(setup.setCookie,/HttpOnly/);
  assert.match(setup.setCookie,/SameSite=Strict/);
  const saved=db.prepare('SELECT salt,verifier,device_hash FROM staff_pin_credentials').get();
  assert.match(saved.verifier,/^[a-f0-9]{128}$/);
  assert.equal(JSON.stringify(saved).includes('012345'),false);
  assert.equal(JSON.stringify(saved).includes(setup.cookie.slice('fortledger_pin_device='.length)),false);
  const withoutDevice=await call('/api/auth/pin',{method:'POST',
    body:{username:'cashierpin',pin:'012345'}});
  assert.equal(withoutDevice.status,401);
  const wrongDevice=await call('/api/auth/pin',{method:'POST',
    cookie:'fortledger_pin_device='+'0'.repeat(64),body:{username:'cashierpin',pin:'012345'}});
  assert.equal(wrongDevice.status,401);
  const correct=await call('/api/auth/pin',{method:'POST',cookie:setup.cookie,
    body:{username:'cashierpin',pin:'012345'}});
  assert.equal(correct.status,200);
  const actor=await call('/api/me',{cookie:correct.cookie});
  assert.equal(actor.status,200);assert.equal(actor.data.login_method,'pin');
  assert.equal(actor.data.role,'cashier');
  assert.equal((await call('/api/settings/business',{cookie:correct.cookie})).status,403);
  assert.equal((await call('/api/me/quick-pin',{method:'POST',cookie:correct.cookie+'; '+setup.cookie,
    body:{current_password:staffPassword,pin:'111111',confirm_pin:'111111'}})).status,403);
  const disabled=await call('/api/system/staff-pin',{method:'POST',cookie:owner.cookie,
    body:{enabled:false,current_password:ownerPassword}});
  assert.equal(disabled.status,200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM staff_pin_credentials').get().n,0);
  assert.equal((await call('/api/me',{cookie:correct.cookie})).status,401);
  assert.equal((await login('cashierpin',staffPassword)).status,200);
}));
test('five wrong PIN attempts lock out across HTTP requests and server restarts; password fallback survives',()=>harness(async({db,call,login})=>{
  const owner=await login('owner',ownerPassword);
  await call('/api/system/staff-pin',{method:'POST',cookie:owner.cookie,body:{enabled:true,current_password:ownerPassword}});
  const staff=await login('cashierpin',staffPassword);
  const enrolled=await call('/api/me/quick-pin',{method:'POST',cookie:staff.cookie,
    body:{current_password:staffPassword,pin:'654321',confirm_pin:'654321'}});
  for(let i=0;i<5;i++){
    const bad=await call('/api/auth/pin',{method:'POST',cookie:enrolled.cookie,
      body:{username:'cashierpin',pin:'000000'}});
    assert.equal(bad.status,401);
  }
  const row=db.prepare('SELECT failures,blocked_until FROM staff_pin_failures').get();
  assert.equal(row.failures,5);assert.ok(row.blocked_until>Date.now());
  assert.equal((await call('/api/auth/pin',{method:'POST',cookie:enrolled.cookie,
    body:{username:'cashierpin',pin:'654321'}})).status,401);
  assert.equal((await login('cashierpin',staffPassword)).status,200);
  const fresh=await call('/api/me/quick-pin',{method:'POST',cookie:staff.cookie+'; '+enrolled.cookie,
    body:{current_password:staffPassword,pin:'123456',confirm_pin:'123456'}});
  assert.equal(fresh.status,200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM staff_pin_failures').get().n,0);
  assert.equal((await call('/api/auth/pin',{method:'POST',cookie:enrolled.cookie,
    body:{username:'cashierpin',pin:'123456'}})).status,200);
}));
test('staff role change, password reset and deactivation revoke the registered PIN and PIN session',()=>harness(async({db,staff,call,login})=>{
  const owner=await login('owner',ownerPassword);
  await call('/api/system/staff-pin',{method:'POST',cookie:owner.cookie,body:{enabled:true,current_password:ownerPassword}});
  const staffLogin=await login('cashierpin',staffPassword);
  const enrolled=await call('/api/me/quick-pin',{method:'POST',cookie:staffLogin.cookie,
    body:{current_password:staffPassword,pin:'887766',confirm_pin:'887766'}});
  const pinLogin=await call('/api/auth/pin',{method:'POST',cookie:enrolled.cookie,
    body:{username:'cashierpin',pin:'887766'}});
  assert.equal(pinLogin.status,200);
  const role=await call('/api/staff/'+staff.id,{method:'PATCH',cookie:owner.cookie,body:{role:'manager'}});
  assert.equal(role.status,200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM staff_pin_credentials').get().n,0);
  assert.equal((await call('/api/me',{cookie:pinLogin.cookie})).status,401);
  assert.equal((await call('/api/auth/pin',{method:'POST',cookie:enrolled.cookie,
    body:{username:'cashierpin',pin:'887766'}})).status,401);
}));
