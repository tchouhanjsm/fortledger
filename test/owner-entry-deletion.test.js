import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {deleteUnusedBooking,deleteUnusedGuest} from '../src/entry-deletion.js';
import {createBookingSafely} from '../src/booking-create.js';
import {may,requiredPermission} from '../src/access.js';
import {auditEvents} from '../src/financial-audit.js';

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
