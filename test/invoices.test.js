import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';

async function fixture(work){
  const db=openDatabase(':memory:');
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  async function json(url,method='GET',body){
    const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    return {status:response.status,value:await response.json()};
  }
  try{await work({db,base,json});}
  finally{await new Promise(r=>server.close(r));db.close();}
}
const booking={guest_name:'Synthetic Awaita',company_name:'',checkin:'2026-12-01',
  checkout:'2026-12-02',rooms_count:2,category:'Unassigned',meal_plan:'CP',nightly_rate:4500,amount_paid:4500};
test('proforma snapshot and numbering are idempotent, immutable after payment',()=>fixture(async ({db,json})=>{
  const b=await json('/api/bookings','POST',booking);assert.equal(b.status,201);
  const id=b.value.id;
  const first=await json('/api/bookings/'+id+'/proforma','POST');
  assert.equal(first.status,201);
  assert.match(first.value.number,/^GH-\d{4}-001$/);
  assert.equal(first.value.snapshot.total_paise,900000);
  assert.equal(first.value.snapshot.taxable_paise,857143);
  assert.equal(first.value.snapshot.gst_paise,42857);
  assert.equal(first.value.snapshot.paid_paise,450000);
  assert.equal(first.value.snapshot.due_paise,450000);
  const repeated=await json('/api/bookings/'+id+'/proforma','POST');
  assert.equal(repeated.status,200);
  assert.equal(repeated.value.id,first.value.id);
  assert.equal(db.prepare('SELECT last_number FROM invoice_sequence WHERE id=1').get().last_number,1);
  const added=await json('/api/bookings/'+id+'/payments','POST',{amount:500});
  assert.equal(added.status,201);
  const after=await json('/api/invoices/'+first.value.id);
  assert.equal(after.value.snapshot.paid_paise,450000);
  assert.equal((await json('/api/invoices')).value.length,1);
}));
test('proforma is a downloadable PDF and cancelled booking cannot create one',()=>fixture(async ({base,json})=>{
  const b=await json('/api/bookings','POST',booking);
  const inv=await json('/api/bookings/'+b.value.id+'/proforma','POST');
  const response=await fetch(base+'/api/invoices/'+inv.value.id+'/pdf');
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/application\/pdf/);
  const bytes=await response.arrayBuffer();
  assert.equal(new TextDecoder().decode(bytes.slice(0,5)),'%PDF-');
  assert.ok(bytes.byteLength>1000);
  const b2=await json('/api/bookings','POST',{...booking,checkin:'2026-12-03',checkout:'2026-12-04'});
  await json('/api/bookings/'+b2.value.id+'/status','PATCH',{status:'cancelled'});
  assert.equal((await json('/api/bookings/'+b2.value.id+'/proforma','POST')).status,400);
}));
