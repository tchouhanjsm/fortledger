import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createRestaurantBill,importMenuCsv,listMenu} from '../src/restaurant.js';
import {settleCombined,settleRoomBill,getGuestFolio} from '../src/folio.js';
const actor={id:0,role:'owner',username:'owner'};

function fixture(db,{advance=0}={}){
  importMenuCsv(db,'name,category,price,tax_rate\nSynthetic Tea,Drinks,100,0');
  const bookingId=Number(db.prepare(`INSERT INTO bookings
    (guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status)
    VALUES('Synthetic Settlement Guest','2027-06-01','2027-06-02',1,'Unassigned',450000,'checked_in')`)
    .run().lastInsertRowid);
  if(advance)db.prepare('INSERT INTO payments(booking_id,amount_paise,method) VALUES(?,?,?)')
    .run(bookingId,advance,'cash');
  const bill=createRestaurantBill(db,{payment_method:'room',booking_id:bookingId,
    items:[{menu_item_id:listMenu(db)[0].id,quantity:2}]});
  return {bookingId,bill};
}
test('combined lost response replays original settlement even though folio is now paid',()=>{
  const db=openDatabase(':memory:');
  try{
    const {bookingId}=fixture(db),request_id=randomUUID();
    const options={request_id,accommodation_method:'bank',bank_reference:'UTR-441299'};
    const initial=settleCombined(db,bookingId,'upi',actor,options);
    const originalCount=db.prepare('SELECT COUNT(*) n FROM payments').get().n;
    const replay=settleCombined(db,bookingId,'upi',actor,options);
    assert.equal(initial.already_recorded,false);
    assert.equal(replay.already_recorded,true);
    assert.equal(initial.settlement_group,replay.settlement_group);
    assert.equal(replay.total_paid_paise,470000);
    assert.equal(getGuestFolio(db,bookingId).combined_due_paise,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get().n,originalCount);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_settlements').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM folio_settlement_requests').get().n,1);
    assert.throws(()=>settleCombined(db,bookingId,'cash',actor,options),/different details/);
    assert.throws(()=>settleCombined(db,bookingId,'upi',actor,{...options,bank_reference:'UTR-NEW'}),/different details/);
    assert.throws(()=>settleCombined(db,bookingId,'upi',actor,{...options,request_id:randomUUID()}),/No outstanding/);
  }finally{db.close();}
});
test('separate food payment replays once, including after the booking is checked out',()=>{
  const db=openDatabase(':memory:');
  try{
    const {bookingId,bill}=fixture(db),request_id=randomUUID();
    const first=settleRoomBill(db,bookingId,bill.id,'card',actor,{request_id});
    db.prepare("UPDATE bookings SET status='checked_out' WHERE id=?").run(bookingId);
    const second=settleRoomBill(db,bookingId,bill.id,'card',actor,{request_id});
    assert.equal(second.already_recorded,true);
    assert.equal(second.settlement_group,first.settlement_group);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_settlements').get().n,1);
    assert.throws(()=>settleRoomBill(db,bookingId,bill.id,'upi',actor,{request_id}),/different details/);
    assert.throws(()=>settleRoomBill(db,bookingId,bill.id,'card',actor,{request_id:randomUUID()}),/already settled/);
  }finally{db.close();}
});
test('food-only combined settlement and accommodation-only settlement both replay without double posting',()=>{
  for(const advance of [450000,0]){
    const db=openDatabase(':memory:');
    try{
      const {bookingId,bill}=fixture(db,{advance});
      if(!advance)settleRoomBill(db,bookingId,bill.id,'upi',actor,{request_id:randomUUID()});
      const request_id=randomUUID(),options={request_id};
      const first=settleCombined(db,bookingId,'cash',actor,options);
      const replay=settleCombined(db,bookingId,'cash',actor,options);
      assert.equal(replay.already_recorded,true);
      assert.equal(replay.total_paid_paise,first.total_paid_paise);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM folio_settlement_requests').get().n,advance?1:2);
    }finally{db.close();}
  }
});
test('v9 disk backup upgrades transactionally and preserves all historical folio settlements',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-v10-'));
  const file=path.join(dir,'data.sqlite');let db;
  try{
    db=openDatabase(file);
    const {bookingId}=fixture(db);
    settleCombined(db,bookingId,'cash',actor);
    const oldPayments=db.prepare('SELECT COUNT(*) n FROM payments').get().n;
    db.exec('DROP TABLE folio_settlement_requests');
    db.pragma('user_version = 9');
    db.close();db=null;
    db=openDatabase(file);
    assert.equal(db.pragma('user_version',{simple:true}),13);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get().n,oldPayments);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_settlements').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM folio_settlement_requests').get().n,0);
    assert.equal(db.pragma('foreign_key_check').length,0);
    db.exec('DROP TABLE folio_settlement_requests');db.close();db=null;
    assert.throws(()=>openDatabase(file),/Folio settlement request ledger is missing/);
    const inspect=new Database(file,{readonly:true});
    assert.equal(inspect.prepare('SELECT COUNT(*) n FROM payments').get().n,oldPayments);
    inspect.close();
  }finally{db?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('authenticated API requires request ID and returns 200 replay response without a second payment',async()=>{
  const db=openDatabase(':memory:');
  const {bookingId,bill}=fixture(db);
  const server=createApp(db,{authRecord:createPasswordRecord('synthetic-folio-strong-owner-password')}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const login=await fetch(base+'/api/auth/login',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({
        username:'owner',password:'synthetic-folio-strong-owner-password'})});
    assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const post=async(path,body)=>{
      const r=await fetch(base+path,{method:'POST',
        headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
      return {status:r.status,value:await r.json()};
    };
    const route='/api/bookings/'+bookingId+'/folio/room-bills/'+bill.id+'/settle';
    assert.equal((await post(route,{method:'card'})).status,400);
    const food={method:'card',request_id:randomUUID()};
    assert.equal((await post(route,food)).status,201);
    assert.equal((await post(route,food)).status,200);
    const combined='/api/bookings/'+bookingId+'/folio/settle-combined';
    assert.equal((await post(combined,{method:'cash'})).status,400);
    const input={method:'cash',request_id:randomUUID()};
    const first=await post(combined,input),second=await post(combined,input);
    assert.equal(first.status,201);
    assert.equal(second.status,200);
    assert.equal(second.value.already_recorded,true);
    assert.equal(second.value.settlement_group,first.value.settlement_group);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_settlements').get().n,1);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
test('UI preserves one settlement key after uncertain failure and never silently sends a fresh request',()=>{
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(app,/pendingFolioSettlements=new Map/);
  assert.match(app,/previous\.serialized!==serialized/);
  assert.match(app,/result\.already_recorded/);
  assert.match(app,/Payment outcome not confirmed/);
});
