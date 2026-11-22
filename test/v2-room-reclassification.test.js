import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {updateRoomDefinition} from '../src/room-definition.js';
import {auditEvents} from '../src/financial-audit.js';

const owner={id:0,username:'owner',role:'owner'};
const cashier={id:3,username:'cashier3',role:'cashier'};
const day='2027-01-01';
const booking=(db,{checkin='2027-05-01',checkout='2027-05-02',rooms_count=1,status='reserved',room_id=null}={})=>
  Number(db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,
    room_id,category,nightly_rate_paise,status)
    VALUES('Synthetic Historical Guest',?,?,?,?,?,?,?)`)
    .run(checkin,checkout,rooms_count,room_id,'Unassigned',400000,status).lastInsertRowid);

test('historical stay remains unchanged when uncommitted room can be reclassified',()=>{
  const db=openDatabase(':memory:');
  try{
    const historic=booking(db,{checkin:'2026-01-01',checkout:'2026-01-02',status:'checked_out'});
    const oldBooking=db.prepare('SELECT category FROM bookings WHERE id=?').get(historic).category;
    const result=updateRoomDefinition(db,1,{name:'Premium Room',category:'Premium'},owner,{businessDate:day});
    assert.equal(result.ok,true);
    assert.equal(db.prepare('SELECT category FROM bookings WHERE id=?').get(historic).category,oldBooking);
    assert.equal(db.prepare('SELECT category FROM rooms WHERE id=1').get().category,'Premium');
    const audit=auditEvents(db,{entityType:'room',entityId:1});
    assert.equal(audit.length,1);
    assert.equal(audit[0].action,'room.updated');
    assert.equal(audit[0].actor_username,'owner');
  }finally{db.close();}
});
test('future allocated room and maximum unassigned room holds block reclassification transactionally',()=>{
  const db=openDatabase(':memory:');
  try{
    const id=booking(db,{room_id:1});
    assert.throws(()=>updateRoomDefinition(db,1,{name:'New Suite',category:'Suite'},owner,{businessDate:day}),/future or in-house allocation/);
    assert.equal(db.prepare('SELECT category FROM rooms WHERE id=1').get().category,'Unassigned');
    db.prepare('DELETE FROM bookings WHERE id=?').run(id);
    const hold=booking(db,{rooms_count:7});
    assert.throws(()=>updateRoomDefinition(db,1,{name:'New Suite',category:'Suite'},owner,{businessDate:day}),/availability|Not enough|capacity/);
    assert.equal(db.prepare('SELECT name,category FROM rooms WHERE id=1').get().name,'Room 1');
    assert.equal(auditEvents(db,{entityType:'room',entityId:1}).length,0);
    assert.throws(()=>updateRoomDefinition(db,1,{name:'Suite',category:'Suite'},cashier,{businessDate:day}),/Only owner or manager/);
  }finally{db.close();}
});

test('real HTTP room-category change is audited even after historic bookings',async()=>{
  const db=openDatabase(':memory:');
  booking(db,{checkin:'2026-01-01',checkout:'2026-01-02',status:'checked_out'});
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try{
    const res=await fetch('http://127.0.0.1:'+server.address().port+'/api/rooms/1',{
      method:'PATCH',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:'Fort Premium',category:'Premium'})});
    assert.equal(res.status,200);
    assert.equal(auditEvents(db,{entityType:'room',entityId:1})[0].details.after.category,'Premium');
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
