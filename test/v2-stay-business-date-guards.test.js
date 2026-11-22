import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {transitionBooking} from '../src/booking-transitions.js';
import {auditEvents} from '../src/financial-audit.js';
const owner={id:0,username:'owner',role:'owner'};
const cashier={id:17,username:'cashier',role:'cashier'};
const guest=db=>{
  const id=Number(db.prepare(`INSERT INTO bookings
    (guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
    VALUES('Synthetic Future Guest','2027-06-10','2027-06-12',1,'Unassigned',450000)`).run().lastInsertRowid);
  db.prepare('INSERT INTO booking_room_allocations(booking_id,room_id) VALUES(?,1)').run(id);
  return id;
};
test('future check-in cannot become occupied before hotel arrival date, except audited manager exception',()=>{
  const db=openDatabase(':memory:');
  try{
    const id=guest(db);
    assert.throws(()=>transitionBooking(db,id,'checked_in',{actor:owner,businessDate:'2027-06-01'}),
      /outside booked stay dates/);
    assert.throws(()=>transitionBooking(db,id,'checked_in',{actor:cashier,businessDate:'2027-06-01',
      override:true,reason:'Verified special guest arrival'}),/owner\/manager/);
    assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(id).status,'reserved');
    assert.equal(auditEvents(db,{entityType:'booking',entityId:id}).length,0);
    const approved=transitionBooking(db,id,'checked_in',{actor:owner,businessDate:'2027-06-01',
      override:true,reason:'Guest presented identification and physically arrived'});
    assert.equal(approved.to,'checked_in');
    const logged=auditEvents(db,{entityType:'booking',entityId:id})[0];
    assert.equal(logged.details.hotel_business_date,'2027-06-01');
    assert.equal(logged.details.date_override,true);
    assert.match(logged.details.reason,/identification/);
  }finally{db.close();}
});
test('early checkout requires reviewed reason; normal departure day needs no override',()=>{
  const db=openDatabase(':memory:');
  try{
    const id=guest(db);
    transitionBooking(db,id,'checked_in',{actor:owner,businessDate:'2027-06-10'});
    assert.throws(()=>transitionBooking(db,id,'checked_out',{actor:owner,businessDate:'2027-06-10',
      acknowledge_balance:true}),/Early checkout/);
    assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(id).status,'checked_in');
    const out=transitionBooking(db,id,'checked_out',{actor:owner,businessDate:'2027-06-10',
      override:true,reason:'Guest physically checked out one night early',acknowledge_balance:true});
    assert.equal(out.to,'checked_out');
    assert.equal(auditEvents(db,{entityType:'booking',entityId:id})[0].details.date_override,true);
  }finally{db.close();}
});
test('real HTTP future checkin denies without exception and permits authorized audited correction',async()=>{
  const db=openDatabase(':memory:'),id=guest(db);
  const server=createApp(db,{businessDate:()=> '2027-06-01'}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try{
    const url='http://127.0.0.1:'+server.address().port+'/api/bookings/'+id+'/status';
    const post=async body=>{
      const response=await fetch(url,{method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body)});
      return {status:response.status,body:await response.json()};
    };
    const denied=await post({status:'checked_in'});
    assert.equal(denied.status,400);
    assert.match(denied.body.error,/outside booked stay dates/);
    const accepted=await post({status:'checked_in',date_override:true,
      reason:'Front desk verified physical early arrival'});
    assert.equal(accepted.status,200);
    assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(id).status,'checked_in');
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
