import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
test('checkout automatically marks room dirty; next arrival requires staff-confirmed readiness',async()=>{
  const db=openDatabase(':memory:'),server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const json=async(route,method='GET',body)=>{
    const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  };
  const booking=(checkin,checkout)=>({
    guest_name:'Synthetic',checkin,checkout,rooms_count:1,room_ids:[1],
    category:'Unassigned',meal_plan:'CP',nightly_rate:4500,amount_paid:0
  });
  try{
    const housekeeping=await json('/api/housekeeping');
    assert.equal(housekeeping.data.length,7);
    assert.equal(housekeeping.data[0].status,'ready');
    const a=await json('/api/bookings','POST',booking('2026-12-01','2026-12-02'));
    const b=await json('/api/bookings','POST',booking('2026-12-02','2026-12-03'));
    assert.equal(a.status,201);assert.equal(b.status,201);
    assert.equal((await json('/api/bookings/'+a.data.id+'/status','PATCH',{status:'checked_in'})).status,200);
    assert.equal((await json('/api/bookings/'+b.data.id+'/status','PATCH',{status:'checked_in'})).status,400);
    const out=await json('/api/bookings/'+a.data.id+'/status','PATCH',{
      status:'checked_out',acknowledge_balance:true
    });
    assert.equal(out.status,200);
    assert.equal((await json('/api/housekeeping')).data[0].status,'dirty');
    const blocked=await json('/api/bookings/'+b.data.id+'/status','PATCH',{status:'checked_in'});
    assert.equal(blocked.status,400);
    assert.match(blocked.data.error,/not ready/);
    assert.equal((await json('/api/housekeeping/1','PATCH',{status:'cleaning'})).status,200);
    assert.equal((await json('/api/housekeeping/1','PATCH',{status:'ready'})).status,200);
    assert.equal((await json('/api/bookings/'+b.data.id+'/status','PATCH',{status:'checked_in'})).status,200);
    const events=(await json('/api/audit/housekeeping/1')).data;
    assert.ok(events.some(x=>x.action==='housekeeping.checkout_dirty'));
    assert.ok(events.some(x=>x.details.to==='ready'));
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
test('cashier cannot modify housekeeping, front desk can',async()=>{
  const db=openDatabase(':memory:');
  createStaff(db,{username:'cashier33',display_name:'Cashier',role:'cashier',password:'synthetic-cashier-pass-123'});
  createStaff(db,{username:'frontdesk33',display_name:'Reception',role:'frontdesk',password:'synthetic-desk-pass-123'});
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
    const cashier=await login('cashier33','synthetic-cashier-pass-123');
    const frontdesk=await login('frontdesk33','synthetic-desk-pass-123');
    const change=cookie=>fetch(base+'/api/housekeeping/1',{method:'PATCH',
      headers:{'Content-Type':'application/json',Cookie:cookie},
      body:JSON.stringify({status:'dirty'})});
    assert.equal((await change(cashier)).status,403);
    assert.equal((await fetch(base+'/api/housekeeping',{headers:{Cookie:cashier}})).status,403);
    assert.equal((await change(frontdesk)).status,200);
    assert.equal((await fetch(base+'/api/housekeeping',{headers:{Cookie:frontdesk}})).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
