import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {arrivalReadinessExceptions} from '../public/arrival-readiness.js';
import {shiftHandover} from '../public/shift-handover.js';

const today='2026-11-22';
const tomorrow='2026-11-23';
const booking=(id,checkin=today,roomIds=[1])=>({
  id,guest_name:'Synthetic Guest #'+id,status:'reserved',checkin,
  checkout:'2026-11-25',rooms_count:roomIds.length,room_ids:roomIds
});
const rooms=[
  {id:1,name:'Room One',active:1,housekeeping_status:'dirty',out_of_service_today:false},
  {id:2,name:'Room Two',active:1,housekeeping_status:'ready',out_of_service_today:false},
  {id:3,name:'Room Three',active:1,housekeeping_status:'cleaning',out_of_service_today:true}
];
const maintenance=[{id:8,room_id:2,blocks_room:true,status:'open',
  start_date:'2026-11-24',end_date:'2026-11-26'}];

test('assigned rooms near arrival have exact, non-mutating readiness reasons',()=>{
  const bookings=[booking(1),booking(2,tomorrow,[2]),booking(3,today,[3])];
  const before=structuredClone({bookings,rooms,maintenance});
  const results=arrivalReadinessExceptions({today,bookings,rooms,
    maintenanceIssues:maintenance,includeMaintenance:true});
  assert.deepEqual(results.map(x=>x.booking_id),[1,2,3]);
  assert.match(results[0].reason,/Room One: needs cleaning/);
  assert.equal(results[0].severity,'urgent');
  assert.match(results[1].reason,/maintenance overlaps booked stay/);
  assert.equal(results[1].severity,'normal');
  assert.match(results[2].reason,/cleaning in progress, out of service today/);
  assert.deepEqual({bookings,rooms,maintenance},before);
});
test('tomorrow is not marked out of service based on today's flag',()=>{
  const result=arrivalReadinessExceptions({today,bookings:[booking(3,tomorrow,[3])],
    rooms:[{...rooms[2],housekeeping_status:'ready'}]});
  assert.deepEqual(result,[]);
});
test('cancelled, checked-in, checkout-passed and distant bookings are never false arrival tasks',()=>{
  const a=booking(1);a.status='checked_in';
  const b=booking(2);b.status='cancelled';
  const c=booking(3,'2026-11-20');c.checkout=today;
  const d=booking(4,'2026-12-10');
  assert.deepEqual(arrivalReadinessExceptions({today,rooms,bookings:[a,b,c,d]}),[]);
});
test('duplicate allocation IDs, duplicate records and absent rooms stay deterministic',()=>{
  const repeated=booking(2,today,[1,1,99]);
  const results=arrivalReadinessExceptions({today,rooms,bookings:[repeated,repeated]});
  assert.equal(results.length,1);
  assert.equal(results[0].reason.match(/Room One/g).length,1);
  assert.match(results[0].reason,/Room #99 is missing/);
  assert.equal(results[0].first_room_id,1);
});
test('role boundaries and source navigation keep all money writes outside briefing',()=>{
  const data={today,bookings:[booking(1)],rooms,maintenanceIssues:maintenance};
  const cashier=shiftHandover({...data,access:{restaurant:true}});
  assert.deepEqual(cashier,[]);
  const owner=shiftHandover({...data,access:{
    bookings:true,rooms:true,maintenance:true,health:true
  }});
  assert.equal(owner.filter(x=>x.kind==='readiness'&&x.record_id===1).length,1);
  assert.ok(owner.some(x=>x.first_room_id===1));
  const frontend=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(frontend,/workspaceNavigator\.navigate\('rooms',room\?/);
  assert.match(frontend,/restaurant-bill-'\+entry\.record_id/);
  assert.match(frontend,/workspaceNavigator\.navigate\('profile','backup-center'\)/);
  assert.match(frontend,/article\.id='restaurant-bill-'\+bill\.id/);
});
test('backup alerts differentiate failure states but never present backup freshness as verified restore',()=>{
  for(const [state,fragment] of [
    ['unconfigured','not configured'],['stale','older than 36 hours'],
    ['missing','file was found'],['recent','same-PC emergency snapshot']
  ]){
    const alerts=shiftHandover({today,backupStatus:{state,needs_attention:true},
      access:{health:true}});
    assert.equal(alerts.length,1);
    assert.match(alerts[0].reason,new RegExp(fragment));
    assert.match(alerts[0].reason,/does not prove a successful isolated restore/);
  }
});
test('invalid hotel dates never silently pass a room warning',()=>{
  assert.throws(()=>arrivalReadinessExceptions({today:'2026-02-30'}),/business date/);
  assert.throws(()=>arrivalReadinessExceptions({today:'nope'}),/business date/);
});
