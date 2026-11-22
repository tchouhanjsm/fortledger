import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {importMenuCsv,listMenu} from '../src/restaurant.js';

test('complete hotel guest journey preserves idempotency, restaurant folio and room turnover',async()=>{
  const db=openDatabase(':memory:');
  importMenuCsv(db,'name,category,price,tax_rate\nDinner,Food,250,0\n');
  const dinner=listMenu(db).find(item=>item.name==='Dinner');
  let day='2027-01-10';
  const server=createApp(db,{businessDate:()=>day}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  async function api(route,method='GET',body){
    const result=await fetch(base+route,{method,headers:{'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body)});
    return {status:result.status,data:await result.json()};
  }
  const details={
    guest_name:'Synthetic stay A',checkin:'2027-01-10',checkout:'2027-01-11',
    rooms_count:1,room_ids:[1],category:'Unassigned',meal_plan:'CP',
    nightly_rate:4500,amount_paid:1500,advance_method:'cash',request_id:randomUUID()
  };
  try{
    const created=await api('/api/bookings','POST',details);
    assert.equal(created.status,201);
    assert.equal(created.data.due_paise,300000);
    const bookingId=created.data.id;
    assert.equal((await api('/api/bookings','POST',details)).status,200);
    assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n,1);
    const next=await api('/api/bookings','POST',{
      ...details,guest_name:'Synthetic stay B',
      checkin:'2027-01-11',checkout:'2027-01-12',amount_paid:0,request_id:randomUUID()
    });
    assert.equal(next.status,201);
    assert.equal((await api('/api/bookings/'+bookingId+'/status','PATCH',{status:'checked_in'})).status,200);
    const bill=await api('/api/restaurant/bills','POST',{
      payment_method:'room',booking_id:bookingId,
      items:[{menu_item_id:dinner.id,quantity:2}]
    });
    assert.equal(bill.status,201);
    const folio=await api('/api/bookings/'+bookingId+'/folio');
    assert.equal(folio.data.accommodation.due_paise,300000);
    assert.equal(folio.data.restaurant_due_paise,50000);
    assert.equal(folio.data.combined_due_paise,350000);
    const settled=await api('/api/bookings/'+bookingId+'/folio/settle-combined','POST',{method:'upi'});
    assert.equal(settled.status,201);
    assert.equal(settled.data.total_paid_paise,350000);
    const after=await api('/api/bookings/'+bookingId+'/folio');
    assert.equal(after.data.combined_due_paise,0);
    assert.equal((await api('/api/bookings/'+bookingId+'/status','PATCH',{status:'checked_out',date_override:true,reason:'Guest voluntarily departed early after review'})).status,200);
    assert.equal((await api('/api/housekeeping')).data[0].status,'dirty');
    day='2027-01-11';
    const blocked=await api('/api/bookings/'+next.data.id+'/status','PATCH',{status:'checked_in'});
    assert.equal(blocked.status,400);
    assert.match(blocked.data.error,/not ready/i);
    assert.equal((await api('/api/housekeeping/1','PATCH',{status:'cleaning'})).status,200);
    assert.equal((await api('/api/housekeeping/1','PATCH',{status:'ready'})).status,200);
    assert.equal((await api('/api/bookings/'+next.data.id+'/status','PATCH',{status:'checked_in'})).status,200);
    assert.equal(db.prepare('SELECT count(*) AS n FROM booking_create_requests').get().n,2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM restaurant_settlements').get().n,1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM payments WHERE booking_id=?').get(bookingId).n,2);
  }finally{
    await new Promise(resolve=>server.close(resolve));db.close();
  }
});
