import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {dailyCollections} from '../src/daily-collections.js';

test('collections group source and method by India business day without double-counting room bills',()=>{
  const db=openDatabase(':memory:');
  try{
    const id=Number(db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status)
      VALUES('Synthetic','2026-12-01','2026-12-03',1,'Unassigned',450000,'checked_in')`).run().lastInsertRowid);
    db.prepare("INSERT INTO payments(booking_id,amount_paise,method,created_at) VALUES(?,100000,'cash','2026-12-01 20:00:00')").run(id);
    db.prepare("INSERT INTO payments(booking_id,amount_paise,method,created_at) VALUES(?,1000,'unrecorded','2026-12-02 01:00:00')").run(id);
    const paid=db.prepare("SELECT id FROM payments WHERE method='cash'").get().id;
    db.prepare(`INSERT INTO payment_refunds(booking_id,payment_id,amount_paise,method,reason,request_id,created_at)
      VALUES(?,?,5000,'cash','Partial refund','fixed-unique-refund-00001','2026-12-02 03:00:00')`).run(id,paid);
    db.prepare(`INSERT INTO restaurant_bills(payment_method,items_snapshot,total_paise,tax_paise,created_at)
      VALUES('upi','[]',25000,0,'2026-12-02 06:00:00')`).run();
    const settled=Number(db.prepare(`INSERT INTO restaurant_bills(payment_method,booking_id,items_snapshot,total_paise,tax_paise,created_at)
      VALUES('room',?,'[]',30000,0,'2026-12-01 12:00:00')`).run(id).lastInsertRowid);
    db.prepare(`INSERT INTO restaurant_settlements(restaurant_bill_id,method,settlement_group,created_at)
      VALUES(?,'card','group-test-1','2026-12-02 08:00:00')`).run(settled);
    db.prepare(`INSERT INTO restaurant_bills(payment_method,booking_id,items_snapshot,total_paise,tax_paise)
      VALUES('room',?,'[]',40000,0)`).run(id);
    const report=dailyCollections(db,'2026-12-02');
    assert.equal(report.business_date,'2026-12-02');
    assert.equal(report.timezone,'Asia/Kolkata');
    assert.equal(report.hotel_received_paise,101000);
    assert.equal(report.restaurant_received_paise,55000);
    assert.equal(report.refunds_recorded_paise,5000);
    assert.equal(report.net_collections_paise,151000);
    assert.equal(report.unrecorded_method_paise,1000);
    assert.equal(report.by_method.cash.net_collected_paise,95000);
    assert.equal(report.by_method.card.net_collected_paise,30000);
    assert.equal(report.current_unpaid_room_charges.amount_paise,40000);
    assert.equal(dailyCollections(db,'2026-12-01').net_collections_paise,0);
    assert.throws(()=>dailyCollections(db,'2026-13-99'),/valid YYYY-MM-DD/);
  }finally{db.close();}
});
test('only owner or manager can see financial reconciliation',async()=>{
  const db=openDatabase(':memory:');
  const password='synthetic-owner-pass-123';
  createStaff(db,{username:'cashier1',display_name:'Cashier',role:'cashier',password:'synthetic-cashier-pass-123'});
  createStaff(db,{username:'manager1',display_name:'Manager',role:'manager',password:'synthetic-manager-pass-123'});
  const server=createApp(db,{authRecord:createPasswordRecord(password)}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const login=async(username,pass)=>{
    const result=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username,password:pass})});
    assert.equal(result.status,200);
    return result.headers.get('set-cookie').split(';')[0];
  };
  try{
    const endpoint=base+'/api/finance/daily?date=2026-12-02';
    assert.equal((await fetch(endpoint)).status,401);
    const cashier=await login('cashier1','synthetic-cashier-pass-123');
    assert.equal((await fetch(endpoint,{headers:{Cookie:cashier}})).status,403);
    const manager=await login('manager1','synthetic-manager-pass-123');
    assert.equal((await fetch(endpoint,{headers:{Cookie:manager}})).status,200);
    const owner=await login('owner',password);
    assert.equal((await fetch(endpoint,{headers:{Cookie:owner}})).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
