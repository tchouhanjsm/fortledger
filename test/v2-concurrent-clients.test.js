import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {importMenuCsv,listMenu} from '../src/restaurant.js';

test('simultaneous staff clients cannot duplicate a booking, restaurant charge, or folio settlement',async()=>{
  const db=openDatabase(':memory:');
  importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,150,5');
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const post=async(url,method,body)=>{
    const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  try{
    const booking={
      guest_name:'Concurrent Synthetic Guest',checkin:'2027-04-10',
      checkout:'2027-04-11',rooms_count:1,room_ids:[1],category:'Unassigned',
      meal_plan:'CP',nightly_rate:2500,amount_paid:0,request_id:randomUUID()
    };
    const created=await Promise.all(Array.from({length:6},()=>
      post('/api/bookings','POST',booking)));
    assert.equal(created.filter(result=>result.status===201).length,1);
    assert.equal(created.filter(result=>result.status===200).length,5);
    const bookingId=created[0].body.id;
    assert.ok(created.every(result=>result.body.id===bookingId));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM booking_create_requests').get().n,1);

    const competing={...booking,guest_name:'Competing Synthetic Guest',request_id:randomUUID()};
    const denied=await post('/api/bookings','POST',competing);
    assert.equal(denied.status,409,'Different guest must not acquire same allocated room');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,1);

    assert.equal((await post('/api/bookings/'+bookingId+'/status','PATCH',{status:'checked_in'})).status,200);
    const body={request_id:randomUUID(),payment_method:'room',booking_id:bookingId,
      items:[{menu_item_id:listMenu(db)[0].id,quantity:2}]};
    const bills=await Promise.all(Array.from({length:6},()=>
      post('/api/restaurant/bills','POST',body)));
    assert.equal(bills.filter(result=>result.status===201).length,1);
    assert.equal(bills.filter(result=>result.status===200).length,5);
    assert.ok(bills.every(result=>result.body.id===bills[0].body.id));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bill_requests').get().n,1);

    const settled=await Promise.all(Array.from({length:2},()=>
      post('/api/bookings/'+bookingId+'/folio/settle-combined','POST',{method:'cash'})));
    assert.equal(settled.filter(result=>result.status===201).length,1);
    assert.equal(settled.filter(result=>result.status===400).length,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_settlements').get().n,1);
    assert.equal((await (await fetch(base+'/api/bookings/'+bookingId+'/folio')).json()).combined_due_paise,0);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
