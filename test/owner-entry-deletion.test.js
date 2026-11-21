import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {deleteUnusedBooking,deleteUnusedGuest} from '../src/entry-deletion.js';
import {may,requiredPermission} from '../src/access.js';
import {auditEvents} from '../src/financial-audit.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';

const owner={id:1,role:'owner',username:'owner'};
const manager={id:2,role:'manager',username:'manager'};
function make(db,{status='reserved',guest_id=null}={}){
  const r=db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,
    category,nightly_rate_paise,status,guest_id)
    VALUES('Synthetic deletion test','2027-04-01','2027-04-02',1,'Unassigned',420000,?,?)`)
    .run(status,guest_id);
  return Number(r.lastInsertRowid);
}
test('only owner receives deletion permission; manager may modify entries',()=>{
  assert.equal(may('owner','entries.delete'),true);
  for(const role of ['manager','frontdesk','cashier'])assert.equal(may(role,'entries.delete'),false);
  assert.equal(may('manager','bookings.write'),true);
  assert.equal(may('manager','guests.write'),true);
  assert.equal(requiredPermission('DELETE','/bookings/12'),'entries.delete');
  assert.equal(requiredPermission('DELETE','/guests/12'),'entries.delete');
  assert.equal(requiredPermission('PATCH','/bookings/12'),'bookings.write');
  assert.equal(requiredPermission('PATCH','/guests/12'),'guests.write');
});
test('owner removes unused reservation and immutable audit remains',()=>{
  const db=openDatabase(':memory:');
  try{
    const id=make(db);
    db.prepare('INSERT INTO booking_room_allocations(booking_id,room_id) VALUES(?,1)').run(id);
    assert.throws(()=>deleteUnusedBooking(db,id,manager),/Only owner/);
    assert.ok(db.prepare('SELECT 1 FROM bookings WHERE id=?').get(id));
    assert.equal(deleteUnusedBooking(db,id,owner).ok,true);
    assert.equal(db.prepare('SELECT 1 FROM bookings WHERE id=?').get(id),undefined);
    assert.equal(db.prepare('SELECT 1 FROM booking_room_allocations WHERE booking_id=?').get(id),undefined);
    assert.ok(auditEvents(db,{entityType:'booking',entityId:id}).some(x=>x.action==='booking.deleted'));
  }finally{db.close();}
});
test('payments, invoices, restaurant usage and occupied bookings are protected',()=>{
  const db=openDatabase(':memory:');
  try{
    const paid=make(db);
    db.prepare("INSERT INTO payments(booking_id,amount_paise,method) VALUES(?,50000,'cash')").run(paid);
    assert.throws(()=>deleteUnusedBooking(db,paid,owner),/financial or restaurant history/);
    const occupied=make(db,{status:'checked_in'});
    assert.throws(()=>deleteUnusedBooking(db,occupied,owner),/untouched reserved/);
    assert.ok(db.prepare('SELECT 1 FROM bookings WHERE id=?').get(occupied));
  }finally{db.close();}
});
test('owner deletes unused guest profile but never a linked guest stay',()=>{
  const db=openDatabase(':memory:');
  try{
    const id=Number(db.prepare("INSERT INTO guest_profiles(name) VALUES('Synthetic guest')").run().lastInsertRowid);
    assert.throws(()=>deleteUnusedGuest(db,id,manager),/Only owner/);
    const booking=make(db,{guest_id:id});
    assert.throws(()=>deleteUnusedGuest(db,id,owner),/linked stays/);
    assert.ok(db.prepare('SELECT 1 FROM guest_profiles WHERE id=?').get(id));
    db.prepare('UPDATE bookings SET guest_id=NULL WHERE id=?').run(booking);
    assert.equal(deleteUnusedGuest(db,id,owner).ok,true);
    assert.equal(db.prepare('SELECT 1 FROM guest_profiles WHERE id=?').get(id),undefined);
    assert.ok(auditEvents(db,{entityType:'guest',entityId:id}).some(x=>x.action==='guest.deleted'));
  }finally{db.close();}
});
test('deleted idempotent request remains blocked after reopen',()=>{
  const db=openDatabase(':memory:');
  try{
    const id=make(db);
    const request_id='deleted_unused_booking_2026';
    db.prepare(`INSERT INTO booking_create_requests(request_id,booking_id,fingerprint,response_json)
      VALUES(?,?,?,?)`).run(request_id,id,'synthetic','{}');
    deleteUnusedBooking(db,id,owner);
    assert.ok(db.prepare('SELECT 1 FROM deleted_booking_requests WHERE request_id=?').get(request_id));
    assert.equal(db.prepare('SELECT 1 FROM booking_create_requests WHERE request_id=?').get(request_id),undefined);
  }finally{db.close();}
});

test('HTTP permissions enforce owner-only DELETE while manager PATCH stays available',async()=>{
  const db=openDatabase(':memory:');
  createStaff(db,{username:'managerdelete',display_name:'Manager',role:'manager',password:'manager-pass-123456'});
  const server=createApp(db,{authRecord:createPasswordRecord('owner-pass-123456')}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const request=async(path,method='GET',body,cookie)=>{
    const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
      body:body===undefined?undefined:JSON.stringify(body)});
    return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
  };
  try{
    const ownerSession=await request('/api/auth/login','POST',{password:'owner-pass-123456'});
    const managerSession=await request('/api/auth/login','POST',{username:'managerdelete',password:'manager-pass-123456'});
    assert.equal(ownerSession.status,200);assert.equal(managerSession.status,200);
    const guest=await request('/api/guests','POST',{name:'Delete permission sample'},ownerSession.cookie);
    assert.equal(guest.status,201);
    const patched=await request('/api/guests/'+guest.data.id,'PATCH',{name:'Updated by manager'},managerSession.cookie);
    assert.equal(patched.status,200);
    assert.equal(patched.data.name,'Updated by manager');
    assert.equal((await request('/api/guests/'+guest.data.id,'DELETE',undefined,managerSession.cookie)).status,403);
    const bookingId=make(db);
    assert.equal((await request('/api/bookings/'+bookingId,'DELETE',undefined,managerSession.cookie)).status,403);
    assert.ok(db.prepare('SELECT 1 FROM bookings WHERE id=?').get(bookingId));
    assert.equal((await request('/api/bookings/'+bookingId,'DELETE',undefined,ownerSession.cookie)).status,200);
    assert.equal((await request('/api/guests/'+guest.data.id,'DELETE',undefined,ownerSession.cookie)).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
