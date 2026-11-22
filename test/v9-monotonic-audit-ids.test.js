import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {openDatabase} from '../src/database.js';
import {createBookingSafely} from '../src/booking-create.js';
import {deleteUnusedBooking,deleteUnusedGuest} from '../src/entry-deletion.js';
import {saveGuest,validateGuestLink} from '../src/guests.js';
import {auditEvents} from '../src/financial-audit.js';
const owner={id:0,username:'owner',role:'owner'};
const booking=()=>({guest_name:'Synthetic Test',company_name:'',checkin:'2027-07-01',
  checkout:'2027-07-02',rooms_count:1,room_id:null,category:'Unassigned',
  meal_plan:'CP',nightly_rate_paise:400000,guest_id:null,room_ids:[]});
const create=db=>createBookingSafely(db,{booking:booking(),initialPaise:0,
  method:null,requestId:undefined,actor:owner,validateGuestLink});

test('delete the last booking: new booking gets a different ID and cannot inherit deletion audit',()=>{
  const db=openDatabase(':memory:');
  try{
    assert.equal(db.pragma('user_version',{simple:true}),9);
    const first=create(db);
    deleteUnusedBooking(db,first.id,owner);
    const second=create(db);
    assert.ok(second.id>first.id);
    assert.ok(auditEvents(db,{entityType:'booking',entityId:first.id})
      .some(x=>x.action==='booking.deleted'));
    assert.equal(auditEvents(db,{entityType:'booking',entityId:second.id})
      .some(x=>x.action==='booking.deleted'),false);
    assert.throws(()=>db.prepare(`INSERT INTO bookings
      (id,guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
      VALUES(?,?,?,?,?,?,?)`).run(first.id,'Reused','2027-07-01','2027-07-02',1,'Unassigned',450000),
      /prior audit history/);
  }finally{db.close();}
});
test('delete last guest: next guest ID is monotonic with isolated original audit',()=>{
  const db=openDatabase(':memory:');
  try{
    const first=saveGuest(db,{name:'Original Synthetic'},owner);
    deleteUnusedGuest(db,first.id,owner);
    const second=saveGuest(db,{name:'New Synthetic'},owner);
    assert.ok(second.id>first.id);
    assert.ok(auditEvents(db,{entityType:'guest',entityId:first.id})
      .some(x=>x.action==='guest.deleted'));
    assert.equal(auditEvents(db,{entityType:'guest',entityId:second.id})
      .some(x=>x.action==='guest.deleted'),false);
  }finally{db.close();}
});
test('upgrade v8 ledger with deleted last booking and guest allocates above historical audit IDs',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-sequence-'));
  const filename=path.join(dir,'hotel.sqlite');
  let db;
  try{
    db=openDatabase(filename);
    const oldBooking=create(db),oldGuest=saveGuest(db,{name:'Old Guest'},owner);
    deleteUnusedBooking(db,oldBooking.id,owner);
    deleteUnusedGuest(db,oldGuest.id,owner);
    db.exec('DROP TRIGGER trg_booking_id_audit_guard; DROP TRIGGER trg_guest_id_audit_guard; DROP TABLE entity_id_counters');
    db.pragma('user_version = 8');
    db.close();db=null;
    db=openDatabase(filename);
    assert.equal(db.pragma('user_version',{simple:true}),9);
    assert.ok(create(db).id>oldBooking.id);
    assert.ok(saveGuest(db,{name:'Later Guest'},owner).id>oldGuest.id);
    assert.equal(db.pragma('foreign_key_check').length,0);
  }finally{db?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('malformed missing v9 counters prevent startup without resetting hotel audit history',()=>{
  const db=openDatabase(':memory:');
  try{
    db.exec("DELETE FROM entity_id_counters WHERE entity_type='booking'");
    assert.throws(()=>create(db),/sequence not initialized/);
  }finally{db.close();}
});
