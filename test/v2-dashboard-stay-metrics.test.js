import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stayMetrics} from '../public/stay-metrics.js';

const today='2027-03-01';
const stay=(status,overrides={})=>({
  status,checkin:'2027-03-01',checkout:'2027-03-03',rooms_count:1,
  due_paise:10000,...overrides
});
test('dashboard separates reserved capacity from real checked-in occupancy',()=>{
  const records=[
    stay('reserved',{rooms_count:2,due_paise:20000}),
    stay('checked_in',{rooms_count:1,due_paise:10000}),
    stay('checked_out',{rooms_count:3,due_paise:0}),
    stay('cancelled',{rooms_count:1,due_paise:50000}),
    stay('checked_in',{checkin:'2027-02-26',checkout:today,rooms_count:1,due_paise:20000}),
    stay('reserved',{checkin:'2027-03-02',checkout:'2027-03-05',rooms_count:1,due_paise:7000})
  ];
  assert.deepEqual(stayMetrics(records,today),{
    booked_rooms_tonight:3,in_house_rooms:2,
    arrivals_pending:1,departures_pending:1,guest_outstanding_paise:57000
  });
});
test('booking alone never increases in-house count; checkout and cancelled stays do not',()=>{
  const booked=stayMetrics([stay('reserved',{rooms_count:7})],today);
  assert.equal(booked.booked_rooms_tonight,7);
  assert.equal(booked.in_house_rooms,0);
  assert.equal(stayMetrics([stay('checked_out')],today).booked_rooms_tonight,0);
  assert.equal(stayMetrics([stay('cancelled')],today).in_house_rooms,0);
  assert.throws(()=>stayMetrics([],'not-a-date'),/business date/);
});
test('dashboard uses common stay-state selector and never labels reserved rooms Occupied',()=>{
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(app,/stayMetrics\(bookings,today\)/);
  assert.match(app,/\['Booked tonight',stays\.booked_rooms_tonight/);
  assert.match(app,/\['In-house rooms',stays\.in_house_rooms/);
  assert.doesNotMatch(app,/\['Occupied tonight'/);
});
