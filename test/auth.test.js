import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord,verifyPassword,savePasswordRecord,loadPasswordRecord} from '../src/auth.js';

test('password hash uses salt and never stores plaintext',()=>{
  const password='strong test password 123!';
  const one=createPasswordRecord(password),two=createPasswordRecord(password);
  assert.notEqual(one.hash,two.hash);
  assert.equal(verifyPassword(password,one),true);
  assert.equal(verifyPassword('incorrect password',one),false);
  assert.throws(()=>createPasswordRecord('short'),/12/);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-auth-'));
  try{
    const file=path.join(dir,'admin-auth.json');
    savePasswordRecord(file,password);
    assert.equal(verifyPassword(password,loadPasswordRecord(file)),true);
    assert.equal(fs.readFileSync(file,'utf8').includes(password),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('API denies unauthenticated access including backup; login and logout manage session',async()=>{
  const db=openDatabase(':memory:');
  const server=createApp(db,{authRecord:createPasswordRecord('another good password 123')}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    assert.equal((await fetch(base+'/api/bookings')).status,401);
    assert.equal((await fetch(base+'/api/backup')).status,401);
    const bad=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'nope'})});
    assert.equal(bad.status,401);
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'another good password 123'})});
    assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    assert.match(login.headers.get('set-cookie'),/HttpOnly/);
    assert.equal((await fetch(base+'/api/bookings',{headers:{Cookie:cookie}})).status,200);
    assert.equal((await fetch(base+'/api/bookings',{method:'POST',headers:{Cookie:cookie,'Content-Type':'text/plain'},body:'{}'})).status,415);
    assert.equal((await fetch(base+'/api/bookings',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json',Origin:'http://bad.example'},body:'{}'})).status,403);
    const logout=await fetch(base+'/api/auth/logout',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'});
    assert.equal(logout.status,200);
    assert.equal((await fetch(base+'/api/bookings',{headers:{Cookie:cookie}})).status,401);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
