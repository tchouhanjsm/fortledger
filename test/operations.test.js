import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';

async function withServer(fn) {
  const db=openDatabase(':memory:');
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const base='http://127.0.0.1:'+server.address().port;
  async function api(path,options={}){
    const response=await fetch(base+path,{headers:{'Content-Type':'application/json'},...options});
    return { status:response.status,data:await response.json() };
  }
  try {await fn({db,base,api});}
  finally {await new Promise(r=>server.close(r));db.close();}
}
const booking={guest_name:'Synthetic guest',company_name:'Travel Company',checkin:'2026-12-01',
  checkout:'2026-12-02',rooms_count:2,category:'Unassigned',meal_plan:'CP',nightly_rate:4500,amount_paid:4500};
test('booking creation, search, payment ledger, edit and status',()=>withServer(async ({api})=>{
  const created=await api('/api/bookings',{method:'POST',body:JSON.stringify(booking)});
  assert.equal(created.status,201);
  assert.equal(created.data.total_paise,900000);
  assert.equal(created.data.due_paise,450000);
  const id=created.data.id;
  const found=await api('/api/bookings?q=Synthetic');
  assert.equal(found.data.length,1);
  const payments=await api('/api/bookings/'+id+'/payments');
  assert.equal(payments.data.length,1);
  assert.equal(payments.data[0].amount_paise,450000);
  const edited=await api('/api/bookings/'+id,{method:'PATCH',body:JSON.stringify({...booking,guest_name:'Edited guest',nightly_rate:5000})});
  assert.equal(edited.status,200);
  const after=await api('/api/bookings?q=Edited');
  assert.equal(after.data[0].total_paise,1000000);
  assert.equal(after.data[0].paid_paise,450000);
  const extra=await api('/api/bookings/'+id+'/payments',{method:'POST',body:JSON.stringify({amount:500})});
  assert.equal(extra.status,201);
  const final=await api('/api/bookings?q=Edited');
  assert.equal(final.data[0].due_paise,500000);
  const cancelled=await api('/api/bookings/'+id+'/status',{method:'PATCH',body:JSON.stringify({status:'cancelled'})});
  assert.equal(cancelled.status,200);
  assert.equal((await api('/api/bookings/'+id,{method:'PATCH',body:JSON.stringify(booking)})).status,400);
}));
test('overlapping category bookings fail; checkout day permits new arrival',()=>withServer(async ({api})=>{
  const save=b=>api('/api/bookings',{method:'POST',body:JSON.stringify(b)});
  assert.equal((await save({...booking,rooms_count:7,amount_paid:0})).status,201);
  assert.equal((await save({...booking,rooms_count:1,amount_paid:0})).status,409);
  assert.equal((await save({...booking,checkin:'2026-12-02',checkout:'2026-12-03',rooms_count:1,amount_paid:0})).status,201);
}));
test('online SQLite backup downloads a genuine database file',()=>withServer(async ({base,api})=>{
  assert.equal((await api('/api/bookings',{method:'POST',body:JSON.stringify(booking)})).status,201);
  const response=await fetch(base+'/api/backup');
  assert.equal(response.status,200);
  const bytes=new Uint8Array(await response.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0,15)),'SQLite format 3');
  assert.ok(bytes.byteLength>1024);
}));
