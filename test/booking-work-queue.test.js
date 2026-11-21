import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {matchesWorkQueue} from '../public/booking-work-queue.js';

const today='2026-11-21';
const base={status:'reserved',checkin:today,checkout:'2026-11-23',room_ids:[],rooms_count:2,due_paise:1000};

test('reception arrivals distinguish scheduled stays from checked-in guests',()=>{
  assert.equal(matchesWorkQueue(base,'arrivals',today),true);
  assert.equal(matchesWorkQueue({...base,status:'checked_in'},'arrivals',today),false);
  assert.equal(matchesWorkQueue({...base,checkin:'2026-11-22'},'arrivals',today),false);
});

test('departures include overdue checked-in bookings, not completed stays',()=>{
  assert.equal(matchesWorkQueue({...base,status:'checked_in',checkout:today},'departures',today),true);
  assert.equal(matchesWorkQueue({...base,status:'checked_in',checkout:'2026-11-20'},'departures',today),true);
  assert.equal(matchesWorkQueue({...base,status:'checked_out',checkout:today},'departures',today),false);
});

test('unallocated queue checks physical assignment count and excludes cancellation',()=>{
  assert.equal(matchesWorkQueue(base,'unassigned',today),true);
  assert.equal(matchesWorkQueue({...base,room_ids:[1]},'unassigned',today),true);
  assert.equal(matchesWorkQueue({...base,room_ids:[1,2]},'unassigned',today),false);
  assert.equal(matchesWorkQueue({...base,status:'cancelled'},'unassigned',today),false);
});

test('outstanding queue excludes cancelled records',()=>{
  assert.equal(matchesWorkQueue(base,'outstanding',today),true);
  assert.equal(matchesWorkQueue({...base,due_paise:0},'outstanding',today),false);
  assert.equal(matchesWorkQueue({...base,status:'cancelled'},'outstanding',today),false);
  assert.equal(matchesWorkQueue(base,'all',today),true);
});

test('work queue controls are present and wired to the existing local booking ledger',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/id="booking-work-filter"/);
  assert.match(html,/id="booking-clear-filters"/);
  assert.match(html,/id="booking-results-count"[^>]*role="status"/);
  assert.match(js,/matchesWorkQueue\(b,workFilter,today\)/);
  assert.match(js,/const today=hotelToday\(\)/);
  assert.match(js,/\$\('#booking-work-filter'\)\.onchange=renderBookings/);
});
