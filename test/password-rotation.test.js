import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {savePasswordRecord,loadPasswordRecord,verifyPassword} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
test('owner rotates password atomically and old sessions and password stop working',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-password-'));
  const auth=path.join(dir,'admin-auth.json'),old='synthetic-owner-secret-123',next='synthetic-owner-new-secret-567';
  savePasswordRecord(auth,old);
  const db=openDatabase(':memory:');
  const server=createApp(db,{authRecord:loadPasswordRecord(auth),authFile:auth}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const login=async(password)=>{
    const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:'owner',password})});
    return {status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  try{
    const first=await login(old);
    assert.equal(first.status,200);
    const before=await fetch(base+'/api/me/password',{method:'POST',
      headers:{Cookie:first.cookie,'Content-Type':'application/json'},
      body:JSON.stringify({current_password:'wrong',new_password:next})});
    assert.equal(before.status,401);
    assert.equal(verifyPassword(old,loadPasswordRecord(auth)),true);
    const changed=await fetch(base+'/api/me/password',{method:'POST',
      headers:{Cookie:first.cookie,'Content-Type':'application/json'},
      body:JSON.stringify({current_password:old,new_password:next})});
    assert.equal(changed.status,200);
    assert.equal((await fetch(base+'/api/me',{headers:{Cookie:first.cookie}})).status,401);
    assert.equal((await login(old)).status,401);
    assert.equal((await login(next)).status,200);
    assert.equal(verifyPassword(next,loadPasswordRecord(auth)),true);
    assert.equal(fs.readFileSync(auth,'utf8').includes(next),false);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('staff self-change and owner reset revoke all active sessions immediately',async()=>{
  const db=openDatabase(':memory:');
  const owner='synthetic-owner-password-321';
  const account=createStaff(db,{username:'frontdesk1',display_name:'Frontdesk',role:'frontdesk',
    password:'synthetic-staff-password-123'});
  const server=createApp(db,{authRecord:(await import('../src/auth.js')).createPasswordRecord(owner)}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const login=async(username,password)=>{
    const response=await fetch(base+'/api/auth/login',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    return {status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  const patch=async(url,body,cookie,method='POST')=>fetch(base+url,{method,headers:{
    'Content-Type':'application/json',Cookie:cookie
  },body:JSON.stringify(body)});
  try{
    const staff=await login('frontdesk1','synthetic-staff-password-123');
    const other=await login('frontdesk1','synthetic-staff-password-123');
    assert.equal(staff.status,200);
    assert.equal(other.status,200);
    const changed=await patch('/api/me/password',{
      current_password:'synthetic-staff-password-123',new_password:'synthetic-staff-password-456'
    },staff.cookie);
    assert.equal(changed.status,200);
    assert.equal((await fetch(base+'/api/me',{headers:{Cookie:other.cookie}})).status,401);
    assert.equal((await login('frontdesk1','synthetic-staff-password-123')).status,401);
    const fresh=await login('frontdesk1','synthetic-staff-password-456');
    assert.equal(fresh.status,200);
    const ownerSession=await login('owner',owner);
    assert.equal(ownerSession.status,200);
    const reset=await patch('/api/staff/'+account.id,{
      password:'synthetic-reset-password-789'
    },ownerSession.cookie,'PATCH');
    assert.equal(reset.status,200);
    assert.equal((await fetch(base+'/api/me',{headers:{Cookie:fresh.cookie}})).status,401);
    assert.equal((await login('frontdesk1','synthetic-staff-password-456')).status,401);
    assert.equal((await login('frontdesk1','synthetic-reset-password-789')).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
