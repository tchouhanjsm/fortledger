import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';

const baseBooking={guest_name:'Synthetic group',company_name:'',checkin:'2026-12-01',checkout:'2026-12-02',
  rooms_count:2,room_ids:[1,2],category:'Unassigned',meal_plan:'CP',nightly_rate:4500,amount_paid:0};

test('two-room reservation allocates two distinct physical rooms and prevents conflicts',async()=>{
  const db=openDatabase(':memory:');
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const json=async(url,method='GET',body)=>{
    const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json()};
  };
  try{
    const created=await json('/api/bookings','POST',baseBooking);assert.equal(created.status,201);
    const id=created.data.id;
    const list=await json('/api/bookings');
    assert.deepEqual(list.data[0].room_ids,[1,2]);
    assert.match(list.data[0].assigned_room,/Room 1, Room 2/);
    assert.equal((await json('/api/bookings?q=Room%202')).data.length,1);
    const conflict=await json('/api/bookings','POST',{...baseBooking,guest_name:'Other',rooms_count:1,room_ids:[1]});
    assert.equal(conflict.status,409);
    assert.equal((await json('/api/bookings','POST',{...baseBooking,guest_name:'Category group',rooms_count:5,room_ids:[]})).status,201);
    const over=await json('/api/bookings','POST',{...baseBooking,guest_name:'Other',rooms_count:1,room_ids:[]});
    assert.equal(over.status,409);
    const edit=await json('/api/bookings/'+id,'PATCH',{...baseBooking,room_ids:[3,4]});
    assert.equal(edit.status,200);
    const updated=(await json('/api/bookings?q=Synthetic')).data[0];
    assert.deepEqual(updated.room_ids,[3,4]);
    assert.equal(updated.total_paise,900000);
    const bad=await json('/api/bookings/'+id,'PATCH',{...baseBooking,room_ids:[4,4]});
    assert.equal(bad.status,400);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});

test('older single-room assignments are backfilled on database reopen',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-alloc-test-'));
  try{
    const file=path.join(dir,'bookings.sqlite');
    const db=openDatabase(file);
    const id=Number(db.prepare(`INSERT INTO bookings (guest_name,checkin,checkout,rooms_count,room_id,category,nightly_rate_paise)
      VALUES ('Legacy synthetic','2026-12-01','2026-12-02',1,1,'Unassigned',450000)`).run().lastInsertRowid);
    db.close();
    const reopened=openDatabase(file);
    const row=reopened.prepare('SELECT room_id FROM booking_room_allocations WHERE booking_id=?').get(id);
    assert.equal(row.room_id,1);
    reopened.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
