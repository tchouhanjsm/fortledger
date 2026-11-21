import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';

const booking={guest_name:'Synthetic Group',company_name:'Corporate Account',
  checkin:'2027-01-10',checkout:'2027-01-12',rooms_count:2,
  category:'Unassigned',meal_plan:'CP',nightly_rate:4500,
  amount_paid:2500,advance_method:'upi',room_ids:[2,1]};
async function withApp(db,run){
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const post=async input=>{
    const response=await fetch(base+'/api/bookings',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    return {status:response.status,data:await response.json()};
  };
  try{await run({db,post});}
  finally{await new Promise(resolve=>server.close(resolve));}
}
test('identical booking create retry records one booking, one initial advance and one audit event each',async()=>{
  const db=openDatabase(':memory:');
  try{
    await withApp(db,async({post})=>{
      const request_id=randomUUID(),input={...booking,request_id};
      const first=await post(input);
      assert.equal(first.status,201);assert.equal(first.data.already_recorded,false);
      const retry=await post({...input,room_ids:[1,2],amount_paid:'2500.00'});
      assert.equal(retry.status,200);assert.equal(retry.data.already_recorded,true);
      assert.equal(retry.data.id,first.data.id);
      assert.equal(retry.data.total_paise,first.data.total_paise);
      assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n,1);
      assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get().n,1);
      assert.equal(db.prepare('SELECT sum(amount_paise) AS n FROM payments').get().n,250000);
      assert.equal(db.prepare("SELECT count(*) AS n FROM operation_audit WHERE action='booking.created'").get().n,1);
      assert.equal(db.prepare("SELECT count(*) AS n FROM operation_audit WHERE action='payment.recorded'").get().n,1);
      assert.equal(db.prepare('SELECT count(*) AS n FROM booking_room_allocations').get().n,2);
    });
  }finally{db.close();}
});
test('changed payload cannot reuse booking request ID and does not mutate ledger',async()=>{
  const db=openDatabase(':memory:');
  try{await withApp(db,async({post})=>{
    const request_id=randomUUID();
    assert.equal((await post({...booking,request_id})).status,201);
    for(const change of [{amount_paid:2600},{guest_name:'Different group'},{nightly_rate:4700},{room_ids:[2]}]){
      const response=await post({...booking,...change,request_id});
      assert.equal(response.status,400);
      assert.match(response.data.error,/different details/);
    }
    assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n,1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get().n,1);
  });}finally{db.close();}
});
test('invalid request IDs fail before booking is created; legacy callers remain supported',async()=>{
  const db=openDatabase(':memory:');
  try{await withApp(db,async({post})=>{
    const invalid=await post({...booking,request_id:'short'});
    assert.equal(invalid.status,400);
    assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n,0);
    const oldClient=await post({...booking,request_id:undefined,amount_paid:0});
    assert.equal(oldClient.status,201);
    assert.equal(db.prepare('SELECT count(*) AS n FROM booking_create_requests').get().n,0);
  });}finally{db.close();}
});
test('failed availability request leaves no ID marker and can retry after changing inventory',async()=>{
  const db=openDatabase(':memory:');
  try{await withApp(db,async({post})=>{
    const request_id=randomUUID();
    assert.equal((await post({...booking,request_id,rooms_count:8,room_ids:[]})).status,400);
    assert.equal(db.prepare('SELECT count(*) AS n FROM booking_create_requests').get().n,0);
    assert.equal((await post({...booking,request_id})).status,201);
    assert.equal(db.prepare('SELECT count(*) AS n FROM booking_create_requests').get().n,1);
  });}finally{db.close();}
});
test('request ledger survives close/reopen and preserves original totals even if booking is later amended',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-create-replay-'));
  const filename=path.join(dir,'hotel.sqlite');let db;
  try{
    db=openDatabase(filename);const request_id=randomUUID();
    let original;
    await withApp(db,async({post})=>{
      original=await post({...booking,request_id});
      assert.equal(original.status,201);
    });
    db.close();db=openDatabase(filename);
    await withApp(db,async({post})=>{
      db.prepare('UPDATE bookings SET nightly_rate_paise=500000 WHERE id=?').run(original.data.id);
      const retry=await post({...booking,request_id});
      assert.equal(retry.status,200);
      assert.equal(retry.data.id,original.data.id);
      assert.equal(retry.data.total_paise,original.data.total_paise);
      assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n,1);
    });
  }finally{if(db?.open)db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
