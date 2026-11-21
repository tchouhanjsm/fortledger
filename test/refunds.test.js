import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {recordRefund,paymentHistory} from '../src/payment-ledger.js';
import {getGuestFolio} from '../src/folio.js';

const booking={guest_name:'Synthetic guest',checkin:'2026-12-01',checkout:'2026-12-02',
  rooms_count:2,category:'Unassigned',meal_plan:'CP',nightly_rate:4500,amount_paid:4500};

test('refunds preserve original receipts, prevent over-refunds and idempotently replay',()=>{
  const db=openDatabase(':memory:');
  try{
    const id=Number(db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
      VALUES('Synthetic','2026-12-01','2026-12-02',2,'Unassigned',450000)`).run().lastInsertRowid);
    const pid=Number(db.prepare('INSERT INTO payments(booking_id,amount_paise) VALUES(?,?)').run(id,450000).lastInsertRowid);
    const event={amount:1000,method:'upi',reason:'Guest cancellation',request_id:randomUUID()};
    const first=recordRefund(db,id,pid,event);
    assert.equal(first.amount_paise,100000);
    assert.equal(recordRefund(db,id,pid,event).already_recorded,true);
    assert.equal(paymentHistory(db,id).net_paid_paise,350000);
    assert.equal(getGuestFolio(db,id).accommodation.paid_paise,350000);
    assert.throws(()=>recordRefund(db,id,pid,{...event,amount:2000}),/already used/);
    assert.throws(()=>recordRefund(db,id,pid,{...event,amount:4000,request_id:randomUUID()}),/exceeds/);
    assert.equal(db.prepare('SELECT amount_paise FROM payments WHERE id=?').get(pid).amount_paise,450000);
    db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(id);
    const second=recordRefund(db,id,pid,{amount:3500,method:'bank',reason:'Remaining advance return',request_id:randomUUID()});
    assert.equal(second.amount_paise,350000);
    assert.equal(getGuestFolio(db,id).accommodation.paid_paise,0);
    assert.equal(paymentHistory(db,id).refunds.length,2);
  }finally{db.close();}
});

test('new proforma uses net receipts but an already-issued PDF snapshot stays immutable',async()=>{
  const db=openDatabase(':memory:'),server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const json=async(path,method='GET',body)=>{
    const result=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    return {status:result.status,value:await result.json()};
  };
  try{
    const b=await json('/api/bookings','POST',booking);
    assert.equal(b.status,201);
    const id=b.value.id;
    const issue=await json('/api/bookings/'+id+'/proforma','POST');
    assert.equal(issue.status,201);
    assert.equal(issue.value.snapshot.paid_paise,450000);
    const payments=await json('/api/bookings/'+id+'/payments');
    assert.equal(payments.value.length,1);
    const refund=await json('/api/bookings/'+id+'/payments/'+payments.value[0].id+'/refunds','POST',
      {amount:1000,method:'upi',reason:'Partial refund',request_id:randomUUID()});
    assert.equal(refund.status,201);
    const same=await json('/api/bookings/'+id+'/payments/'+payments.value[0].id+'/refunds','POST',
      {amount:1000,method:'upi',reason:'Partial refund',request_id:refund.value.request_id});
    assert.equal(same.status,200);
    const list=await json('/api/bookings');
    assert.equal(list.value[0].paid_paise,350000);
    assert.equal(list.value[0].due_paise,550000);
    const stored=await json('/api/invoices/'+issue.value.id);
    assert.equal(stored.value.snapshot.paid_paise,450000);
    assert.equal((await json('/api/bookings/'+id+'/refunds')).value.length,1);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
