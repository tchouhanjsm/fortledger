import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';

test('hotel receipt retries return the same payment without duplicate money or audit events',async()=>{
  const db=openDatabase(':memory:'),server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const json=async(route,method='GET',body)=>{
    const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  };
  try{
    const booking=await json('/api/bookings','POST',{
      guest_name:'Synthetic Guest',checkin:'2026-12-01',checkout:'2026-12-02',rooms_count:1,
      category:'Unassigned',nightly_rate:4500,meal_plan:'CP',amount_paid:0
    });
    assert.equal(booking.status,201);
    const id=booking.data.id,key=randomUUID(),body={amount:1500,method:'upi',note:'Advance installment',request_id:key};
    const first=await json('/api/bookings/'+id+'/payments','POST',body);
    const retry=await json('/api/bookings/'+id+'/payments','POST',body);
    assert.equal(first.status,201);
    assert.equal(first.data.already_recorded,false);
    assert.equal(retry.status,200);
    assert.equal(retry.data.already_recorded,true);
    assert.equal(retry.data.id,first.data.id);
    const payment=(await json('/api/bookings/'+id+'/payments')).data;
    assert.equal(payment.length,1);
    assert.equal(payment[0].amount_paise,150000);
    assert.equal(payment[0].method,'upi');
    const ledger=(await json('/api/bookings')).data[0];
    assert.equal(ledger.paid_paise,150000);
    assert.equal(ledger.due_paise,300000);
    const audit=(await json('/api/audit/payment/'+first.data.id)).data;
    assert.equal(audit.filter(a=>a.action==='payment.recorded').length,1);
    const mismatch=await json('/api/bookings/'+id+'/payments','POST',{...body,amount:2000});
    assert.equal(mismatch.status,400);
    assert.match(mismatch.data.error,/different details/);
    assert.equal((await json('/api/bookings/'+id+'/payments')).data.length,1);
    assert.equal((await json('/api/bookings/'+id+'/payments','POST',{
      amount:900,method:'cash',request_id:'short'
    })).status,400);
    assert.equal((await json('/api/bookings/'+id+'/payments')).data.length,1);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
test('unique receipt index and nullable legacy keys do not change historical money',()=>{
  const db=openDatabase(':memory:');
  try{
    const id=Number(db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
      VALUES('Synthetic','2026-12-01','2026-12-02',1,'Unassigned',450000)`).run().lastInsertRowid);
    db.prepare("INSERT INTO payments(booking_id,amount_paise,method) VALUES(?,100000,'unrecorded')").run(id);
    db.prepare("INSERT INTO payments(booking_id,amount_paise,method) VALUES(?,20000,'unrecorded')").run(id);
    assert.equal(db.prepare('SELECT SUM(amount_paise) AS n FROM payments').get().n,120000);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payments WHERE request_id IS NULL').get().n,2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name='idx_payments_request_id'").get().n,1);
  }finally{db.close();}
});
