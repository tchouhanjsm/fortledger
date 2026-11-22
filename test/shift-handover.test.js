import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {shiftHandover} from '../public/shift-handover.js';

const day='2026-11-22';
const arrivals=[
  {id:1,guest_name:'Synthetic Arrival',status:'reserved',checkin:day,checkout:'2026-11-24',
    rooms_count:1,room_ids:[],pickup_notes:'Airport pickup',stay_notes:''},
  {id:2,guest_name:'Synthetic Departure',status:'checked_in',checkin:'2026-11-19',
    checkout:'2026-11-21',rooms_count:1,room_ids:[1]},
  {id:3,guest_name:'Synthetic Cancelled',status:'cancelled',checkin:day,
    checkout:'2026-11-24',rooms_count:1,room_ids:[]},
  {id:4,guest_name:'Synthetic Future',status:'reserved',checkin:'2026-12-10',
    checkout:'2026-12-12',rooms_count:1,room_ids:[]}
];
const rooms=[
  {id:1,name:'Room 1',active:1,housekeeping_status:'dirty'},
  {id:2,name:'Room 2',active:1,housekeeping_status:'ready',out_of_service_today:true},
  {id:3,name:'Room 3',active:0,housekeeping_status:'dirty'}
];
const restaurantBills=[
  {id:7,payment_method:'room',booking_id:null},
  {id:8,payment_method:'room',booking_id:2},
  {id:9,payment_method:'cash',booking_id:null}
];
const maintenanceIssues=[{id:5,room_id:2,status:'open',priority:'urgent'},
  {id:6,room_id:3,status:'resolved',priority:'urgent'}];
const base={today:day,bookings:arrivals,rooms,restaurantBills,maintenanceIssues,
  closeAttention:[{business_date:'2026-11-21'}],
  backupStatus:{needs_attention:true}};
const full={bookings:true,rooms:true,restaurant:true,maintenance:true,finance:true,health:true};

test('handover shows actionable source-level links, not duplicated alerts or financial effects',()=>{
  const before=structuredClone(base);
  const alerts=shiftHandover({...base,access:full});
  assert.deepEqual(alerts.map(x=>x.key).sort(),[
    'allocation:1','arrival:1','backup:latest','closing:2026-11-21',
    'departure:2','maintenance:5','notes:1','restaurant:7','room:1','room:2'
  ].sort());
  assert.equal(alerts[0].severity,'urgent');
  assert.match(alerts.find(x=>x.key==='departure:2').reason,/overdue/);
  assert.match(alerts.find(x=>x.key==='notes:1').reason,/Pickup details/);
  assert.deepEqual(base,before,'Read-only derivation must not mutate source records');
  const duplicates=shiftHandover({...base,bookings:[...arrivals,arrivals[0]],access:full});
  assert.equal(duplicates.filter(x=>x.key==='arrival:1').length,1);
});

test('permission-scoped handover never leaks guest or financial entries to cashier',()=>{
  const alerts=shiftHandover({...base,access:{restaurant:true}});
  assert.deepEqual(alerts.map(x=>x.key),['restaurant:7']);
  assert.ok(alerts.every(x=>!x.title.includes('Synthetic Arrival')));
  assert.deepEqual(shiftHandover({...base,access:{}}),[]);
});

test('events automatically disappear after underlying state changes, without a secondary task table',()=>{
  const changed=arrivals.map(x=>x.id===1?{...x,status:'checked_in',room_ids:[1],
    pickup_notes:'',stay_notes:''}:x);
  const alerts=shiftHandover({...base,bookings:changed,access:full});
  assert.ok(!alerts.some(x=>['arrival:1','allocation:1','notes:1'].includes(x.key)));
  assert.ok(alerts.some(x=>x.key==='departure:2'));
});

test('IST hotel day is explicit, including month/year boundary and invalid dates',()=>{
  const b={id:42,guest_name:'Synthetic',status:'reserved',rooms_count:1,room_ids:[],
    checkin:'2026-12-31',checkout:'2027-01-02'};
  const alerts=shiftHandover({today:'2026-12-31',bookings:[b],access:{bookings:true}});
  assert.deepEqual(alerts.map(x=>x.key).sort(),['allocation:42','arrival:42']);
  assert.throws(()=>shiftHandover({today:'2026-02-30'}),/Valid hotel business date/);
});

test('handover UI is rendered inside existing dashboard, with controlled source navigation',()=>{
  const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(ui,/renderShiftHandover\(today\)/);
  assert.match(ui,/can\('bookings.read'\)/);
  assert.match(ui,/openBookingNotes\(booking\)/);
  assert.match(html,/id="shift-handover"/);
  assert.match(html,/id="shift-handover-items"/);
});
