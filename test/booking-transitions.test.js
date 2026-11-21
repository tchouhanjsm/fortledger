import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';

async function fixture(work){
  const db=openDatabase(':memory:');
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const json=async(route,method='GET',body)=>{
    const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,value:await response.json()};
  };
  try{await work({db,json});}
  finally{await new Promise(resolve=>server.close(resolve));db.close();}
}
const booking={guest_name:'Synthetic guest',checkin:'2026-12-01',checkout:'2026-12-02',
  rooms_count:2,category:'Unassigned',meal_plan:'CP',nightly_rate:4500,amount_paid:4500};

test('category-only hold cannot check in before physical rooms are assigned',()=>fixture(async({db,json})=>{
  const created=await json('/api/bookings','POST',booking);
  const id=created.value.id;
  const denied=await json('/api/bookings/'+id+'/status','PATCH',{status:'checked_in'});
  assert.equal(denied.status,400);
  assert.match(denied.value.error,/Assign all 2 physical rooms/);
  assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(id).status,'reserved');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM operation_audit WHERE action='booking.status_changed'").get().n,0);
  const assigned=await json('/api/bookings/'+id,'PATCH',{...booking,room_ids:[1,2]});
  assert.equal(assigned.status,200);
  const accepted=await json('/api/bookings/'+id+'/status','PATCH',{status:'checked_in'});
  assert.equal(accepted.status,200);
  assert.equal(accepted.value.from,'reserved');
  assert.equal(accepted.value.to,'checked_in');
  const directCancel=await json('/api/bookings/'+id+'/status','PATCH',{status:'cancelled'});
  assert.equal(directCancel.status,400);
  const backwards=await json('/api/bookings/'+id+'/status','PATCH',{status:'reserved'});
  assert.equal(backwards.status,400);
}));
test('checkout requires human acknowledgment of balance and retains overdue folio',()=>fixture(async({db,json})=>{
  const created=await json('/api/bookings','POST',{...booking,room_ids:[1,2]});
  const id=created.value.id;
  await json('/api/bookings/'+id+'/status','PATCH',{status:'checked_in'});
  const blocked=await json('/api/bookings/'+id+'/status','PATCH',{status:'checked_out'});
  assert.equal(blocked.status,400);
  assert.match(blocked.value.error,/balance must be acknowledged/);
  const checkout=await json('/api/bookings/'+id+'/status','PATCH',{status:'checked_out',acknowledge_balance:true});
  assert.equal(checkout.status,200);
  assert.ok(checkout.value.warnings.length);
  assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(id).status,'checked_out');
  assert.equal((await json('/api/bookings/'+id+'/status','PATCH',{status:'checked_in'})).status,400);
  assert.equal((await json('/api/bookings/'+id,'PATCH',{...booking,room_ids:[1,2]})).status,400);
  const audit=(await json('/api/audit/booking/'+id)).value;
  const event=audit.find(x=>x.action==='booking.status_changed'&&x.details.to==='checked_out');
  assert.equal(event.details.acknowledged_balance,true);
}));
test('issued proforma prevents silent financial amendment, but payments remain allowed',()=>fixture(async({json})=>{
  const created=await json('/api/bookings','POST',{...booking,room_ids:[1,2]});
  const id=created.value.id;
  assert.equal((await json('/api/bookings/'+id+'/proforma','POST',{})).status,201);
  const edit=await json('/api/bookings/'+id,'PATCH',{...booking,room_ids:[1,2],nightly_rate:5000});
  assert.equal(edit.status,400);
  assert.match(edit.value.error,/Proforma already issued/);
  assert.equal((await json('/api/bookings/'+id+'/payments','POST',{amount:500,method:'upi'})).status,201);
}));
test('cancelled booking with deposit is audited and explicitly flags refund follow-up',()=>fixture(async({db,json})=>{
  const created=await json('/api/bookings','POST',booking);
  const result=await json('/api/bookings/'+created.value.id+'/status','PATCH',{status:'cancelled',reason:'Travel change'});
  assert.equal(result.status,200);
  assert.match(result.value.warnings[0],/refund or credit/i);
  const repeated=await json('/api/bookings/'+created.value.id+'/status','PATCH',{status:'cancelled'});
  assert.equal(repeated.status,200);
  assert.equal(repeated.value.unchanged,true);
  const audit=(await json('/api/audit/booking/'+created.value.id)).value;
  assert.equal(audit.filter(x=>x.action==='booking.status_changed').length,1);
}));
