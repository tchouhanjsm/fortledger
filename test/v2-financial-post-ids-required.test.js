import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {importMenuCsv,listMenu} from '../src/restaurant.js';

test('public booking/payment/restaurant POSTs require stable client IDs and replay unchanged intents exactly once',async()=>{
  const db=openDatabase(':memory:');
  importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,150,5');
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const root='http://127.0.0.1:'+server.address().port;
  const post=async(path,body)=>{
    const res=await fetch(root+path,{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {status:res.status,payload:await res.json()};
  };
  try{
    const booking={guest_name:'Mandatory Key Guest',checkin:'2027-09-01',
      checkout:'2027-09-02',rooms_count:1,category:'Unassigned',
      meal_plan:'CP',nightly_rate:4500,amount_paid:0};
    const noBooking=await post('/api/bookings',booking);
    assert.equal(noBooking.status,400);
    assert.match(noBooking.payload.error,/request_id/);
    const request_id=randomUUID();
    const created=await post('/api/bookings',{...booking,request_id});
    assert.equal(created.status,201);
    const replay=await post('/api/bookings',{...booking,request_id});
    assert.equal(replay.status,200);
    assert.equal(replay.payload.id,created.payload.id);
    assert.equal((await post('/api/bookings',{...booking,guest_name:'Other Guest',request_id})).status,400);
    const payPath='/api/bookings/'+created.payload.id+'/payments';
    assert.equal((await post(payPath,{amount:100,method:'upi'})).status,400);
    const payment={request_id:randomUUID(),amount:100,method:'upi'};
    assert.equal((await post(payPath,payment)).status,201);
    assert.equal((await post(payPath,payment)).status,200);
    const bill={payment_method:'cash',items:[{menu_item_id:listMenu(db)[0].id,quantity:1}]};
    assert.equal((await post('/api/restaurant/bills',bill)).status,400);
    const billRequest={...bill,request_id:randomUUID()};
    assert.equal((await post('/api/restaurant/bills',billRequest)).status,201);
    assert.equal((await post('/api/restaurant/bills',billRequest)).status,200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payments').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,1);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
