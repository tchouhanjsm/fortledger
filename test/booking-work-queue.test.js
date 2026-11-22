import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {matchesWorkQueue,bookingNextActionCue} from '../public/booking-work-queue.js';

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

test('in-house queue represents actual checked-in status, including an overdue departure',()=>{
  assert.equal(matchesWorkQueue({...base,status:'checked_in'},'in_house',today),true);
  assert.equal(matchesWorkQueue({...base,status:'checked_in',checkout:'2026-11-19'},'in_house',today),true,
    'Overdue guests must not silently disappear from physical in-house work');
  assert.equal(matchesWorkQueue({...base,status:'reserved'},'in_house',today),false);
  assert.equal(matchesWorkQueue({...base,status:'checked_out'},'in_house',today),false);
  assert.equal(matchesWorkQueue({...base,status:'cancelled'},'in_house',today),false);
});
test('operator prompts do not mistake a reserved room for checked-in or automatically ready',()=>{
  assert.match(bookingNextActionCue({...base,room_ids:[]},today),/assign all booked rooms/);
  assert.match(bookingNextActionCue({...base,room_ids:[1,2]},today),/confirm room readiness/);
  assert.match(bookingNextActionCue({...base,status:'checked_in',checkout:'2026-11-19'},today),/Departure overdue/);
  assert.match(bookingNextActionCue({...base,status:'checked_in',checkout:today},today),/Departure due today/);
  assert.match(bookingNextActionCue({...base,status:'checked_in'},today),/Guest in-house/);
  assert.match(bookingNextActionCue({...base,status:'cancelled'},today),/refund any advance separately/);
  assert.match(bookingNextActionCue({...base,status:'checked_out'},today),/housekeeping/);
});
test('primary receptionist workflow tabs match arrivals, in-house, departures and all bookings',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const src=html.slice(html.indexOf('id="booking-quick-queues"'),html.indexOf('</div><div class="booking-filters">'));
  const ordered=['arrivals','in_house','departures','all'];
  for(let i=1;i<ordered.length;i++)
    assert.ok(src.indexOf('data-booking-queue="'+ordered[i-1]+'"')<
      src.indexOf('data-booking-queue="'+ordered[i]+'"'));
  assert.match(html,/<option value="in_house">/);
  assert.match(js,/bookingNextActionCue\(b,today\)/);
  assert.match(js,/workspaceNavigator\.navigate\('bookings','bookings'\)/);
});
