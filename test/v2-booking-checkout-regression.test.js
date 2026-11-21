import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {importMenuCsv,listMenu} from '../src/restaurant.js';

test('booking-to-checkout regression keeps folio, bill replay, room readiness and next arrival consistent',async()=>{
  const db=openDatabase(':memory:');
  importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,150,5');
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const call=async(url,method='GET',body)=>{
    const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,value:await response.json()};
  };
  const booking=(checkin,checkout)=>({
    guest_name:'Synthetic Operator QA Guest',checkin,checkout,
    rooms_count:1,room_ids:[1],category:'Unassigned',meal_plan:'CP',
    nightly_rate:4500,amount_paid:0,request_id:randomUUID()
  });
  try{
    const first=await call('/api/bookings','POST',booking('2027-02-10','2027-02-11'));
    assert.equal(first.status,201);
    const second=await call('/api/bookings','POST',booking('2027-02-11','2027-02-12'));
    assert.equal(second.status,201);
    const id=first.value.id,nextId=second.value.id;
    assert.equal((await call('/api/bookings/'+id+'/status','PATCH',{status:'checked_in'})).status,200);
    const itemId=listMenu(db)[0].id;
    const body={request_id:randomUUID(),payment_method:'room',booking_id:id,
      items:[{menu_item_id:itemId,quantity:2}]};
    const bill=await call('/api/restaurant/bills','POST',body);
    assert.equal(bill.status,201);
    const replay=await call('/api/restaurant/bills','POST',body);
    assert.equal(replay.status,200);
    assert.equal(replay.value.id,bill.value.id);
    const folio=await call('/api/bookings/'+id+'/folio');
    assert.equal(folio.status,200);
    assert.equal(folio.value.restaurant_due_paise,30000);
    assert.ok(folio.value.accommodation.due_paise>0);
    const blocked=await call('/api/bookings/'+id+'/status','PATCH',{status:'checked_out'});
    assert.equal(blocked.status,400);
    assert.match(blocked.value.error,/Outstanding guest folio balance/);
    const settled=await call('/api/bookings/'+id+'/folio/settle-combined','POST',{method:'cash'});
    assert.equal(settled.status,201);
    assert.equal(settled.value.restaurant_bills_settled,1);
    assert.equal((await call('/api/bookings/'+id+'/folio')).value.combined_due_paise,0);
    const duplicate=await call('/api/bookings/'+id+'/folio/settle-combined','POST',{method:'cash'});
    assert.equal(duplicate.status,400);
    assert.match(duplicate.value.error,/No outstanding amount/);
    const checkout=await call('/api/bookings/'+id+'/status','PATCH',{status:'checked_out'});
    assert.equal(checkout.status,200);
    assert.equal((await call('/api/housekeeping')).value[0].status,'dirty');
    const nextBlocked=await call('/api/bookings/'+nextId+'/status','PATCH',{status:'checked_in'});
    assert.equal(nextBlocked.status,400);
    assert.match(nextBlocked.value.error,/not ready/);
    assert.equal((await call('/api/housekeeping/1','PATCH',{status:'cleaning'})).status,200);
    assert.equal((await call('/api/housekeeping/1','PATCH',{status:'ready'})).status,200);
    assert.equal((await call('/api/bookings/'+nextId+'/status','PATCH',{status:'checked_in'})).status,200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_settlements').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bill_requests').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM booking_create_requests').get().n,2);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
