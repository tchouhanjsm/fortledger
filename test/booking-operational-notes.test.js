import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {createProforma} from '../src/invoices.js';
import {normalizeOperationalNotes,updateOperationalNotes} from '../src/booking-notes.js';
import {requiredPermission,may} from '../src/access.js';

const baseBooking={guest_name:'Synthetic Pickup Guest',company_name:'',
  checkin:'2027-01-06',checkout:'2027-01-07',rooms_count:1,
  room_ids:[],category:'Unassigned',meal_plan:'CP',nightly_rate:4500,
  amount_paid:0,pickup_notes:'Station pickup at 18:30',stay_notes:'Quiet arrival requested'};

test('operational note normalization accepts blanks, limits length, rejects bad types and control characters',()=>{
  assert.deepEqual(normalizeOperationalNotes({}),{pickup_notes:'',stay_notes:''});
  assert.deepEqual(normalizeOperationalNotes({pickup_notes:'  hello\r\nworld  ',stay_notes:'  x  '}),
    {pickup_notes:'hello\nworld',stay_notes:'x'});
  assert.throws(()=>normalizeOperationalNotes({pickup_notes:'x'.repeat(501)}),/500 characters/);
  assert.throws(()=>normalizeOperationalNotes({stay_notes:'x'.repeat(1001)}),/1000 characters/);
  assert.throws(()=>normalizeOperationalNotes({pickup_notes:3}),/must be text/);
  assert.throws(()=>normalizeOperationalNotes({stay_notes:'test\u0000another'}),/control characters/);
});
test('SQLite v11→v12 adds only optional note columns and preserves historic booking, invoice and payments',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-notes-migration-'));
  const file=path.join(root,'hotel.sqlite');let db;
  try{
    db=openDatabase(file);
    db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
      VALUES('Synthetic history','2027-02-01','2027-02-02',1,'Unassigned',550000)`).run();
    const bookingId=db.prepare('SELECT id FROM bookings LIMIT 1').get().id;
    db.prepare('INSERT INTO payments(booking_id,amount_paise,method) VALUES(?,?,?)')
      .run(bookingId,150000,'cash');
    createProforma(db,bookingId);
    const before=db.prepare('SELECT number,snapshot FROM invoices WHERE booking_id=?').get(bookingId);
    db.close();db=null;
    // Recreate an actual pre-migration column layout; no guest record is dropped.
    const legacy=new Database(file);
    legacy.exec('ALTER TABLE bookings DROP COLUMN pickup_notes');
    legacy.exec('ALTER TABLE bookings DROP COLUMN stay_notes');
    legacy.pragma('user_version = 11');
    legacy.close();
    db=openDatabase(file);
    assert.equal(db.pragma('user_version',{simple:true}),12);
    const booking=db.prepare('SELECT id,guest_name,nightly_rate_paise,pickup_notes,stay_notes FROM bookings WHERE id=?').get(bookingId);
    assert.deepEqual(booking,{id:bookingId,guest_name:'Synthetic history',nightly_rate_paise:550000,
      pickup_notes:'',stay_notes:''});
    assert.equal(db.prepare('SELECT amount_paise FROM payments WHERE booking_id=?').get(bookingId).amount_paise,150000);
    assert.deepEqual(db.prepare('SELECT number,snapshot FROM invoices WHERE booking_id=?').get(bookingId),before);
    assert.equal(db.pragma('foreign_key_check').length,0);
    db.close();db=openDatabase(file);
    assert.equal(db.pragma('user_version',{simple:true}),12);
  }finally{db?.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('create retry signs nonempty notes, but blank notes preserve old fingerprint compatibility',async()=>{
  const db=openDatabase(':memory:');
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const create=async body=>{
    const res=await fetch(url+'/api/bookings',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {status:res.status,body:await res.json()};
  };
  try{
    const key=randomUUID();
    const first=await create({...baseBooking,request_id:key});
    assert.equal(first.status,201);
    assert.equal((await create({...baseBooking,request_id:key})).status,200);
    const tamper=await create({...baseBooking,request_id:key,pickup_notes:'Changed pickup'});
    assert.equal(tamper.status,400);
    assert.match(tamper.body.error,/different details/);
    const stored=db.prepare('SELECT pickup_notes,stay_notes FROM bookings WHERE id=?').get(first.body.id);
    assert.deepEqual(stored,{pickup_notes:baseBooking.pickup_notes,stay_notes:baseBooking.stay_notes});
    const key2=randomUUID();
    const blank=await create({...baseBooking,request_id:key2,pickup_notes:'',stay_notes:''});
    assert.equal(blank.status,201);
    assert.equal((await create({...baseBooking,request_id:key2,pickup_notes:undefined,stay_notes:undefined})).status,200);
    assert.equal(db.prepare('SELECT count(*) n FROM bookings').get().n,2);
    assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n,0);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
test('issued proforma remains immutable when pickup and stay notes are changed',async()=>{
  const db=openDatabase(':memory:');
  createStaff(db,{username:'notesmanager',display_name:'Manager',role:'manager',password:'synthetic-notes-manager-password'});
  createStaff(db,{username:'notescashier',display_name:'Cashier',role:'cashier',password:'synthetic-notes-cashier-password'});
  const app=createApp(db,{authRecord:createPasswordRecord('synthetic-notes-owner-password')});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const login=async(user,pass)=>{
    const r=await fetch(url+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:user,password:pass})});
    assert.equal(r.status,200);
    return r.headers.get('set-cookie').split(';')[0];
  };
  try{
    assert.equal(requiredPermission('PATCH','/bookings/1/operational-notes'),'bookings.write');
    assert.equal(requiredPermission('GET','/bookings/1/operational-notes'),null);
    assert.equal(may('cashier','bookings.write'),false);
    const manager=await login('notesmanager','synthetic-notes-manager-password');
    const cashier=await login('notescashier','synthetic-notes-cashier-password');
    const request=(cookie,path,method='GET',body)=>fetch(url+path,{method,headers:{
      Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    const created=await request(manager,'/api/bookings','POST',{...baseBooking,request_id:randomUUID()});
    assert.equal(created.status,201);
    const id=(await created.json()).id;
    const proforma=createProforma(db,id),snapshot=proforma.snapshot;
    const prior=db.prepare('SELECT nightly_rate_paise,checkin,checkout FROM bookings WHERE id=?').get(id);
    assert.equal((await request(manager,'/api/bookings/'+id,'PATCH',{...baseBooking,nightly_rate:6000})).status,400,
      'Issued proforma locks contract edits');
    assert.equal((await request(cashier,'/api/bookings/'+id+'/operational-notes','PATCH',
      {pickup_notes:'No',stay_notes:'No'})).status,403);
    const change=await request(manager,'/api/bookings/'+id+'/operational-notes','PATCH',
      {pickup_notes:'Airport pickup at 20:15',stay_notes:'Extra pillow'});
    assert.equal(change.status,200);
    assert.equal((await change.json()).changed,true);
    const repeat=await request(manager,'/api/bookings/'+id+'/operational-notes','PATCH',
      {pickup_notes:'Airport pickup at 20:15',stay_notes:'Extra pillow'});
    assert.equal(repeat.status,200);
    assert.equal((await repeat.json()).changed,false);
    const rows=await request(manager,'/api/bookings').then(r=>r.json());
    assert.equal(rows.find(b=>b.id===id).pickup_notes,'Airport pickup at 20:15');
    assert.deepEqual(db.prepare('SELECT nightly_rate_paise,checkin,checkout FROM bookings WHERE id=?').get(id),prior);
    assert.deepEqual(JSON.parse(db.prepare('SELECT snapshot FROM invoices WHERE id=?').get(proforma.id).snapshot),snapshot);
    const audit=db.prepare("SELECT details FROM operation_audit WHERE action='booking.operational_notes.updated'").all();
    assert.equal(audit.length,1);
    assert.doesNotMatch(audit[0].details,/Airport|pillow|Synthetic Pickup Guest/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get().n,0);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
