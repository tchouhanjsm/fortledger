import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {createDailyClose,getDailyClose} from '../src/daily-close.js';
import {recordExpense} from '../src/expenses.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';

test('daily close requires cash discrepancy acknowledgment and detects later ledger changes',()=>{
  const db=openDatabase(':memory:');
  const actor={id:0,role:'owner',username:'owner'};
  try{
    const id=Number(db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
      VALUES('Synthetic','2026-12-01','2026-12-02',1,'Unassigned',450000)`).run().lastInsertRowid);
    db.prepare(`INSERT INTO payments(booking_id,amount_paise,method,created_at)
      VALUES(?,50000,'cash','2026-12-02 10:00:00')`).run(id);
    recordExpense(db,{business_date:'2026-12-02',category:'supplies',amount:200,method:'cash',
      request_id:randomUUID()},actor);
    const input={business_date:'2026-12-02',opening_cash:1000,counted_cash:1290,
      request_id:randomUUID(),note:'Synthetic count'};
    assert.throws(()=>createDailyClose(db,input,actor),/discrepancy requires explicit/);
    const close=createDailyClose(db,{...input,acknowledge_discrepancy:true},actor);
    assert.equal(close.expected_cash_paise,130000);
    assert.equal(close.counted_cash_paise,129000);
    assert.equal(close.discrepancy_paise,-1000);
    assert.equal(close.snapshot.net_collections_paise,50000);
    assert.equal(close.snapshot.expenses_paid_paise,20000);
    assert.equal(close.stale,false);
    const retry=createDailyClose(db,{...input,acknowledge_discrepancy:true},actor);
    assert.equal(retry.already_recorded,true);
    assert.equal(retry.id,close.id);
    assert.throws(()=>createDailyClose(db,{...input,request_id:randomUUID(),acknowledge_discrepancy:true},actor),/already exists/);
    db.prepare(`INSERT INTO payments(booking_id,amount_paise,method,created_at)
      VALUES(?,5000,'cash','2026-12-02 12:00:00')`).run(id);
    assert.equal(getDailyClose(db,'2026-12-02').stale,true);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM daily_closes').get().n,1);
  }finally{db.close();}
});
test('unknown legacy hotel methods must be acknowledged by day closing staff',()=>{
  const db=openDatabase(':memory:'),actor={id:0,role:'owner',username:'owner'};
  try{
    const id=Number(db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
      VALUES('Synthetic','2026-12-01','2026-12-02',1,'Unassigned',450000)`).run().lastInsertRowid);
    db.prepare(`INSERT INTO payments(booking_id,amount_paise,method,created_at)
      VALUES(?,10000,'unrecorded','2026-12-02 10:00:00')`).run(id);
    const input={business_date:'2026-12-02',opening_cash:1000,counted_cash:1000,request_id:randomUUID()};
    assert.throws(()=>createDailyClose(db,input,actor),/Unrecorded legacy/);
    const close=createDailyClose(db,{...input,acknowledge_unrecorded:true},actor);
    assert.equal(close.discrepancy_paise,0);
    assert.equal(close.snapshot.unrecorded_method_paise,10000);
  }finally{db.close();}
});
test('front desk and cashier cannot close financial day; manager can',async()=>{
  const db=openDatabase(':memory:');
  createStaff(db,{username:'cashier44',display_name:'Cashier',role:'cashier',password:'synthetic-cashier-pass-123'});
  createStaff(db,{username:'frontdesk44',display_name:'Frontdesk',role:'frontdesk',password:'synthetic-desk-pass-123'});
  createStaff(db,{username:'manager44',display_name:'Manager',role:'manager',password:'synthetic-manager-pass-123'});
  const server=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-pass-123')}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const login=async(username,password)=>{
    const response=await fetch(base+'/api/auth/login',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    assert.equal(response.status,200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  try{
    const cashier=await login('cashier44','synthetic-cashier-pass-123');
    const desk=await login('frontdesk44','synthetic-desk-pass-123');
    const manager=await login('manager44','synthetic-manager-pass-123');
    const input={business_date:'2026-12-02',opening_cash:100,counted_cash:100,request_id:randomUUID()};
    const post=cookie=>fetch(base+'/api/finance/closing',{method:'POST',
      headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(input)});
    assert.equal((await post(cashier)).status,403);
    assert.equal((await post(desk)).status,403);
    const saved=await post(manager);
    assert.equal(saved.status,201);
    const result=await saved.json();
    assert.equal(result.expected_cash_paise,10000);
    assert.equal(result.actor_username,'manager44');
    assert.equal((await fetch(base+'/api/finance/closing?date=2026-12-02',{headers:{Cookie:manager}})).status,200);
    assert.equal((await fetch(base+'/api/finance/closing?date=2026-12-02',{headers:{Cookie:cashier}})).status,403);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
