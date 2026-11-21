import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {createMaintenanceIssue,resolveMaintenanceIssue,blockedRoomIds} from '../src/maintenance.js';

const actor={id:0,username:'owner',role:'owner'};
const booking=(from='2026-12-01',to='2026-12-03',count=1,ids=[])=>({
  guest_name:'Synthetic guest',company_name:'',checkin:from,checkout:to,
  rooms_count:count,room_ids:ids,category:'Unassigned',meal_plan:'CP',
  nightly_rate:4500,amount_paid:0
});
async function fixture(fn){
  const db=openDatabase(':memory:');
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const api=async(route,method='GET',body)=>{
    const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  };
  try{await fn({db,api});}
  finally{await new Promise(resolve=>server.close(resolve));db.close();}
}

test('maintenance block reduces seven-room capacity on affected nights, then release restores it',()=>fixture(async({db,api})=>{
  const issue=await api('/api/maintenance','POST',{room_id:1,title:'Leak',
    priority:'urgent',blocks_room:true,start_date:'2026-12-01',end_date:'2026-12-03'});
  assert.equal(issue.status,201);
  assert.equal(issue.data.status,'open');
  assert.equal(blockedRoomIds(db,'2026-12-01').has(1),true);
  assert.equal(blockedRoomIds(db,'2026-12-03').has(1),false);
  assert.equal((await api('/api/bookings','POST',booking('2026-12-01','2026-12-02',1,[1]))).status,409);
  assert.equal((await api('/api/bookings','POST',booking('2026-12-02','2026-12-03',6))).status,201);
  assert.equal((await api('/api/bookings','POST',booking('2026-12-02','2026-12-03',1))).status,409);
  assert.equal((await api('/api/bookings','POST',booking('2026-12-03','2026-12-04',7))).status,201);
  const release=await api('/api/maintenance/'+issue.data.id+'/resolve','PATCH',{resolution_note:'Fixed and verified'});
  assert.equal(release.status,200);
  assert.equal(release.data.status,'resolved');
  assert.equal(blockedRoomIds(db,'2026-12-02').has(1),false);
  const repeated=await api('/api/maintenance/'+issue.data.id+'/resolve','PATCH',{resolution_note:'Fixed and verified'});
  assert.equal(repeated.data.already_resolved,true);
  const events=(await api('/api/audit/maintenance/'+issue.data.id)).data;
  assert.deepEqual(events.map(x=>x.action),['maintenance.resolved','maintenance.created']);
  assert.equal((await api('/api/maintenance?status=all')).data.length,1);
}));
test('cannot silently displace assigned or unassigned future guests with outage',()=>fixture(async({db,api})=>{
  const reserved=await api('/api/bookings','POST',booking('2026-12-01','2026-12-03',1,[1]));
  assert.equal(reserved.status,201);
  const attempt=await api('/api/maintenance','POST',{
    room_id:1,title:'Air con',blocks_room:true,start_date:'2026-12-02',end_date:'2026-12-04'});
  assert.equal(attempt.status,400);
  assert.match(attempt.data.error,/Existing room assignment conflicts/);
  assert.equal((await api('/api/maintenance')).data.length,0);
  const reportOnly=await api('/api/maintenance','POST',{room_id:1,title:'Air con intermittent',
    priority:'normal',blocks_room:false});
  assert.equal(reportOnly.status,201);
  assert.equal(reportOnly.data.blocks_room,0);
  // Category-only commitment to all seven rooms must also prevent a new outage.
  const full=await api('/api/bookings','POST',booking('2026-12-04','2026-12-05',7));
  assert.equal(full.status,201);
  const blocked=await api('/api/maintenance','POST',{room_id:2,title:'Painting',
    blocks_room:true,start_date:'2026-12-04',end_date:'2026-12-05'});
  assert.equal(blocked.status,400);
  assert.match(blocked.data.error,/category reservations exceed capacity/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM maintenance_issues WHERE blocks_room=1").get().n,0);
}));
test('no double booking after maintenance: allocated checkin is still guarded',()=>fixture(async({db,api})=>{
  const a=await api('/api/bookings','POST',booking('2026-12-01','2026-12-02',1,[1]));
  assert.equal(a.status,201);
  const issue=await api('/api/maintenance','POST',{room_id:1,title:'Scheduled repair',
    blocks_room:true,start_date:'2026-12-02',end_date:'2026-12-04'});
  assert.equal(issue.status,201);
  // Existing booking can check in; maintenance starts after checkout.
  assert.equal((await api('/api/bookings/'+a.data.id+'/status','PATCH',{status:'checked_in'})).status,200);
  assert.equal((await api('/api/bookings/'+a.data.id+'/status','PATCH',{
    status:'checked_out',acknowledge_balance:true
  })).status,200);
  assert.equal((await api('/api/bookings','POST',booking('2026-12-02','2026-12-03',1,[1]))).status,409);
}));
test('invalid dates, priorities and room identifiers cannot create outage',()=>{
  const db=openDatabase(':memory:');
  try{
    const fail=input=>assert.throws(()=>createMaintenanceIssue(db,{
      room_id:1,title:'Synthetic issue',priority:'normal',...input
    },actor));
    fail({priority:'untrusted'});
    fail({blocks_room:true,start_date:'2026-02-30',end_date:'2026-03-02'});
    fail({blocks_room:true,start_date:'2026-12-05',end_date:'2026-12-05'});
    fail({blocks_room:true,start_date:'2026-12-05',end_date:'2027-12-07'});
    fail({room_id:999});
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM maintenance_issues').get().n,0);
    assert.throws(()=>resolveMaintenanceIssue(db,1,{id:2,username:'cashier',role:'cashier'}),/Only owner or manager/);
  }finally{db.close();}
});
test('front desk can report but cannot block or release rooms; cashier is denied',async()=>{
  const db=openDatabase(':memory:');
  createStaff(db,{username:'deskmaint',display_name:'Desk',role:'frontdesk',password:'synthetic-desk-password-123'});
  createStaff(db,{username:'cashmaint',display_name:'Cashier',role:'cashier',password:'synthetic-cashier-password-123'});
  createStaff(db,{username:'managermaint',display_name:'Manager',role:'manager',password:'synthetic-manager-password-123'});
  const server=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-password-123')}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const login=async(username,password)=>{
    const response=await fetch(base+'/api/auth/login',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    assert.equal(response.status,200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const api=async(route,cookie,method='GET',body)=>{
    const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie},
      body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  };
  try{
    const desk=await login('deskmaint','synthetic-desk-password-123');
    const cashier=await login('cashmaint','synthetic-cashier-password-123');
    const manager=await login('managermaint','synthetic-manager-password-123');
    assert.equal((await api('/api/maintenance',cashier)).status,403);
    assert.equal((await api('/api/maintenance',cashier,'POST',{room_id:1,title:'Problem'})).status,403);
    const reported=await api('/api/maintenance',desk,'POST',{room_id:1,title:'Loose fitting'});
    assert.equal(reported.status,201);
    assert.equal((await api('/api/maintenance',desk)).status,200);
    const blocked=await api('/api/maintenance',desk,'POST',{room_id:2,title:'Repair',blocks_room:true,
      start_date:'2026-12-01',end_date:'2026-12-02'});
    assert.equal(blocked.status,400);
    assert.equal((await api('/api/maintenance/'+reported.data.id+'/resolve',desk,'PATCH',{})).status,403);
    const resolved=await api('/api/maintenance/'+reported.data.id+'/resolve',manager,'PATCH',{resolution_note:'Repaired'});
    assert.equal(resolved.status,200);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
