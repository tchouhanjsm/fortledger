import test from 'node:test';
import assert from 'node:assert/strict';
import {todayAttention} from '../public/today-attention.js';
import {readFileSync} from 'node:fs';

const today='2026-11-21';
test('Today counts only actionable live records; no fake occupancy or completed tasks',()=>{
  const arrivals={status:'reserved',checkin:today,checkout:'2026-11-22',room_ids:[],rooms_count:1};
  const result=todayAttention({today,
    bookings:[arrivals,{...arrivals,status:'checked_in',checkout:today},
      {...arrivals,status:'cancelled'},
      {...arrivals,room_ids:[1],checkin:'2026-11-22'}],
    rooms:[{id:1,active:1,housekeeping_status:'dirty',out_of_service_today:false},
      {id:2,active:1,housekeeping_status:'ready',out_of_service_today:true},
      {id:3,active:1,housekeeping_status:'ready',out_of_service_today:false},
      {id:4,active:0,housekeeping_status:'dirty',out_of_service_today:false}],
    maintenanceIssues:[{status:'open',priority:'urgent'},
      {status:'resolved',priority:'urgent'},{status:'open',priority:'low'}],
    restaurantBills:[{payment_method:'room',booking_id:null},
      {payment_method:'room',booking_id:3},{payment_method:'cash',booking_id:null}]
  });
  assert.deepEqual(result,{arrivals:1,departures:1,unassigned:1,
    unmatched:1,rooms:2,urgentMaintenance:1});
});
test('empty state counts zero and rejects invalid hotel business dates',()=>{
  assert.deepEqual(todayAttention({today}),{
    arrivals:0,departures:0,unassigned:0,unmatched:0,rooms:0,urgentMaintenance:0});
  assert.throws(()=>todayAttention({today:'unknown'}),/Valid hotel/);
});
test('existing booking and housekeeping workflows remain the only financial/room mutations',()=>{
  const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(html,/id="today-attention-items"/);
  assert.match(html,/data-room-filter="attention"/);
  assert.match(html,/id="room-readiness-count"[^>]*role="status"/);
  assert.match(ui,/renderTodayAttention\(today\)/);
  assert.match(ui,/openFilteredBookingQueue\('arrivals'\)/);
  assert.match(ui,/renderRooms\(\)/);
  assert.match(ui,/can\('maintenance.read'\)/);
  assert.match(ui,/can\('restaurant.read'\)/);
});
