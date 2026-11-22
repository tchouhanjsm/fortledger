import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';

async function fixture(fn){
  const db=openDatabase(':memory:'),server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const api=async(url,method='GET',body)=>{
    const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  };
  try{await fn({db,api});}finally{await new Promise(resolve=>server.close(resolve));db.close();}
}
const booking={guest_name:'A group stay',company_name:'Company A',checkin:'2026-12-01',
  checkout:'2026-12-02',rooms_count:1,category:'Unassigned',nightly_rate:4500,meal_plan:'CP',amount_paid:0};

test('returning-guest search and explicit booking links preserve booking terms and profile history',()=>fixture(async({db,api})=>{
  const old=await api('/api/bookings','POST',{...booking,guest_name:'Same display name'});
  assert.equal(old.status,201);
  const guest=await api('/api/guests','POST',{name:'Same display name',phone:'+91 98765 43210',
    email:'Guest@Example.com',company_name:'Travel A',preferences:'Prefers quiet room'});
  assert.equal(guest.status,201);
  assert.equal(guest.data.email,'guest@example.com');
  const id=guest.data.id;
  assert.equal((await api('/api/guests?q=98765')).data.length,1);
  assert.equal((await api('/api/guests?q=travel')).data.length,1);
  const unlinked=(await api('/api/guests/'+id+'/stays')).data;
  assert.equal(unlinked.stays.length,0); // same name does NOT imply same person
  const linked=await api('/api/bookings','POST',{...booking,guest_name:'A group stay',
    guest_id:id,checkin:'2026-12-02',checkout:'2026-12-03'});
  assert.equal(linked.status,201);
  assert.equal((await api('/api/guests/'+id+'/stays')).data.stays.length,1);
  const changed=await api('/api/guests/'+id,'PATCH',{name:'Updated Name',phone:'98765 43210',
    email:'guest@example.com',company_name:'Travel B',preferences:'Avoids stairs'});
  assert.equal(changed.status,200);
  assert.equal((await api('/api/bookings?q=A%20group')).data.length,1);
  const stays=(await api('/api/guests/'+id+'/stays')).data.stays;
  assert.equal(stays[0].guest_name,'A group stay');
  assert.equal(stays[0].nightly_rate_paise,450000);
  assert.equal(db.prepare('SELECT guest_id FROM bookings WHERE id=?').get(old.data.id).guest_id,null);
  assert.equal(db.prepare('SELECT guest_id FROM bookings WHERE id=?').get(linked.data.id).guest_id,id);
  const audits=(await api('/api/audit/guest/'+id)).data;
  assert.deepEqual(audits.map(x=>x.action),['guest.updated','guest.created']);
  assert.ok(!JSON.stringify(audits).includes('98765')); // private contact never in audit metadata
}));
test('existing booking can link explicitly; older clients preserve its guest ID on edit',()=>fixture(async({db,api})=>{
  const guest=(await api('/api/guests','POST',{name:'Returning'})).data;
  const saved=(await api('/api/bookings','POST',booking)).data;
  assert.equal((await api('/api/bookings/'+saved.id,'PATCH',{...booking,guest_id:guest.id})).status,200);
  assert.equal(db.prepare('SELECT guest_id FROM bookings WHERE id=?').get(saved.id).guest_id,guest.id);
  assert.equal((await api('/api/bookings/'+saved.id,'PATCH',{...booking,company_name:'B'})).status,200);
  assert.equal(db.prepare('SELECT guest_id FROM bookings WHERE id=?').get(saved.id).guest_id,guest.id);
  assert.equal((await api('/api/bookings/'+saved.id,'PATCH',{...booking,guest_id:null})).status,200);
  assert.equal(db.prepare('SELECT guest_id FROM bookings WHERE id=?').get(saved.id).guest_id,null);
  assert.equal((await api('/api/bookings','POST',{...booking,guest_id:999999})).status,400);
  assert.equal((await api('/api/bookings','POST',{...booking,guest_id:0})).status,400);
}));
test('CRM input validation prevents inappropriate or malformed contact records',()=>fixture(async({api})=>{
  assert.equal((await api('/api/guests','POST',{name:''})).status,400);
  assert.equal((await api('/api/guests','POST',{name:'A',email:'bad-address'})).status,400);
  assert.equal((await api('/api/guests','POST',{name:'A',preferences:'x'.repeat(501)})).status,400);
  assert.equal((await api('/api/guests?q='+'a'.repeat(120))).status,400);
}));
test('cashier cannot read or write guests; front desk can',async()=>{
  const db=openDatabase(':memory:');
  createStaff(db,{username:'frontguest',display_name:'Reception',role:'frontdesk',password:'synthetic-front-password-123'});
  createStaff(db,{username:'cashguest',display_name:'Cashier',role:'cashier',password:'synthetic-cash-password-123'});
  const server=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-password-123')}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const login=async(username,password)=>{
    const response=await fetch(base+'/api/auth/login',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    assert.equal(response.status,200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  try{
    const desk=await login('frontguest','synthetic-front-password-123');
    const cashier=await login('cashguest','synthetic-cash-password-123');
    const call=(cookie,method='GET',body)=>fetch(base+'/api/guests',{method,
      headers:{Cookie:cookie,'Content-Type':'application/json'},
      body:body?JSON.stringify(body):undefined});
    assert.equal((await call(cashier)).status,403);
    assert.equal((await call(cashier,'POST',{name:'Should not save'})).status,403);
    assert.equal((await call(desk,'POST',{name:'Returning'})).status,201);
    assert.equal((await call(desk)).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
test('v5 to v6 upgrade preserves historic reservations, payments and no false guest matches',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-crm-'));
  const file=path.join(dir,'legacy.sqlite');
  try{
    let db=openDatabase(file);
    const id=Number(db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
      VALUES('Historic guest','2026-12-01','2026-12-02',1,'Unassigned',450000)`).run().lastInsertRowid);
    db.prepare("INSERT INTO payments(booking_id,amount_paise,method) VALUES(?,150000,'upi')").run(id);
    // Recreate v5 structure in a disposable fixture without rewriting bookings.
    db.exec('DROP INDEX idx_bookings_guest_profile');
    db.exec('ALTER TABLE bookings DROP COLUMN guest_id');
    db.exec('DROP TABLE guest_profiles');
    db.pragma('user_version = 5');
    db.close();
    const reopened=openDatabase(file);
    assert.equal(reopened.pragma('user_version',{simple:true}),8);
    assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM guest_profiles').get().n,0);
    assert.equal(reopened.prepare('SELECT guest_id FROM bookings WHERE id=?').get(id).guest_id,null);
    assert.equal(reopened.prepare('SELECT SUM(amount_paise) AS n FROM payments').get().n,150000);
    reopened.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
