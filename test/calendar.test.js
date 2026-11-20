import test from 'node:test';
import assert from 'node:assert/strict';
import {monthGrid,occupiedRoomCount} from '../public/calendar-utils.js';

test('monthly calendar shows Monday-start date-only grid spanning month correctly',()=>{
  const dates=monthGrid(2026,11);
  assert.equal(dates[0].date,'2026-11-30');
  assert.equal(dates.find(x=>x.date==='2026-12-01').inMonth,true);
  assert.equal(dates.length%7,0);
  assert.equal(dates.filter(x=>x.inMonth).length,31);
});
test('room occupancy counts unassigned category holds and excludes checkout and cancelled',()=>{
  const data=[
    {checkin:'2026-12-01',checkout:'2026-12-03',status:'reserved',rooms_count:2,room_id:null},
    {checkin:'2026-12-02',checkout:'2026-12-04',status:'checked_in',rooms_count:1,room_id:1},
    {checkin:'2026-12-01',checkout:'2026-12-06',status:'cancelled',rooms_count:5,room_id:null}
  ];
  assert.equal(occupiedRoomCount(data,'2026-12-01'),2);
  assert.equal(occupiedRoomCount(data,'2026-12-02'),3);
  assert.equal(occupiedRoomCount(data,'2026-12-03'),1);
  assert.equal(occupiedRoomCount(data,'2026-12-04'),0);
});
