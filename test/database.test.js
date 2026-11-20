import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, assertAvailability } from '../src/database.js';
const booking=(overrides={})=>({checkin:'2026-12-01',checkout:'2026-12-03',category:'Unassigned',rooms_count:2,room_id:null,...overrides});
test('seven physical rooms seeded; category holds respect capacity',()=>{
  const db=openDatabase(':memory:');
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM rooms').get().n,7);
    assertAvailability(db,booking());
    db.prepare("INSERT INTO bookings (guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise) VALUES ('A','2026-12-01','2026-12-03',6,'Unassigned',450000)").run();
    assert.throws(()=>assertAvailability(db,booking()),/availability/);
    assert.doesNotThrow(()=>assertAvailability(db,booking({checkin:'2026-12-03',checkout:'2026-12-04'})));
  }finally{db.close();}
});
test('specific room cannot be double assigned',()=>{
  const db=openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO bookings (guest_name,checkin,checkout,rooms_count,category,room_id,nightly_rate_paise) VALUES ('A','2026-12-01','2026-12-03',1,'Unassigned',1,450000)").run();
    assert.throws(()=>assertAvailability(db,booking({rooms_count:1,room_id:1})),/already assigned/);
  }finally{db.close();}
});
