import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {roomPerformance} from '../src/room-performance.js';
import {createMaintenanceIssue} from '../src/maintenance.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';

const actor={id:0,username:'owner',role:'owner'};
function addStay(db,{checkin,checkout,rooms_count=1,nightly_rate_paise=450000,status='reserved'}){
  return Number(db.prepare(`INSERT INTO bookings
    (guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status)
    VALUES('Synthetic',?,?,?,?,?,?)`).run(checkin,checkout,rooms_count,
    'Unassigned',nightly_rate_paise,status).lastInsertRowid);
}
test('room-night report allocates GST-inclusive booking values to each stay night, not payment day',()=>{
  const db=openDatabase(':memory:');
  try{
    const id=addStay(db,{checkin:'2026-12-01',checkout:'2026-12-04',rooms_count:2,
      nightly_rate_paise:450000,status:'checked_out'});
    db.prepare("INSERT INTO payments(booking_id,amount_paise,method) VALUES(?,900000,'upi')").run(id);
    addStay(db,{checkin:'2026-12-02',checkout:'2026-12-03',nightly_rate_paise:250000,status:'cancelled'});
    addStay(db,{checkin:'2026-12-03',checkout:'2026-12-05',nightly_rate_paise:500000,status:'reserved'});
    const report=roomPerformance(db,'2026-12-02','2026-12-04');
    assert.equal(report.available_room_nights,14);
    assert.equal(report.booked_room_nights,5);
    assert.equal(report.gross_booked_accommodation_paise,2300000); // 2 nights * 2 * 450000 + 1 night * 500000
    assert.equal(report.gross_adr_paise,460000);
    assert.equal(report.gross_revpar_paise,164286);
    assert.equal(report.booking_occupancy_percent,35.71);
    assert.deepEqual(report.daily.map(x=>x.booked_room_nights),[2,3]);
    assert.equal(report.daily[0].gross_booked_paise,900000);
    assert.match(report.definitions.revenue,/NOT cash received/);
  }finally{db.close();}
});
test('active room maintenance removes only unique blocked room-nights; checkout boundary is exclusive',()=>{
  const db=openDatabase(':memory:');
  try{
    createMaintenanceIssue(db,{room_id:1,title:'Scheduled plumbing',blocks_room:true,
      start_date:'2026-12-02',end_date:'2026-12-04'},actor);
    createMaintenanceIssue(db,{room_id:1,title:'Same room second issue',blocks_room:true,
      start_date:'2026-12-03',end_date:'2026-12-05'},actor);
    const a=roomPerformance(db,'2026-12-01','2026-12-06');
    assert.equal(a.blocked_room_nights,3);
    assert.equal(a.available_room_nights,32);
    assert.equal(a.booked_room_nights,0);
    assert.equal(a.gross_adr_paise,null);
    assert.equal(a.gross_revpar_paise,0);
    assert.equal(a.booking_occupancy_percent,0);
    assert.equal(a.daily[0].available_room_nights,7);
    assert.equal(a.daily[1].available_room_nights,6);
    assert.equal(a.daily[4].available_room_nights,7);
  }finally{db.close();}
});
test('invalid periods and mismatched bookings are detected rather than showing false occupancy',()=>{
  const db=openDatabase(':memory:');
  try{
    assert.throws(()=>roomPerformance(db,'2026-02-30','2026-03-02'),/valid YYYY-MM-DD/);
    assert.throws(()=>roomPerformance(db,'2026-12-02','2026-12-02'),/Checkout must be after/);
    assert.throws(()=>roomPerformance(db,'2026-01-01','2027-02-01'),/366 nights/);
    addStay(db,{checkin:'2026-12-01',checkout:'2026-12-02',rooms_count:7});
    addStay(db,{checkin:'2026-12-01',checkout:'2026-12-02',rooms_count:1});
    assert.throws(()=>roomPerformance(db,'2026-12-01','2026-12-02'),/Overcommitted inventory/);
  }finally{db.close();}
});
test('only manager and owner may view financial room performance',async()=>{
  const db=openDatabase(':memory:');
  createStaff(db,{username:'cashrooms',display_name:'Cashier',role:'cashier',password:'synthetic-cash-password-123'});
  createStaff(db,{username:'deskrooms',display_name:'Desk',role:'frontdesk',password:'synthetic-desk-password-123'});
  createStaff(db,{username:'managerrooms',display_name:'Manager',role:'manager',password:'synthetic-manager-password-123'});
  const server=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-password-123')}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const login=async(username,password)=>{
    const response=await fetch(base+'/api/auth/login',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    assert.equal(response.status,200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  try{
    const url=base+'/api/analytics/rooms?start=2026-12-01&end=2026-12-02';
    assert.equal((await fetch(url)).status,401);
    for(const [username,password] of [
      ['cashrooms','synthetic-cash-password-123'],
      ['deskrooms','synthetic-desk-password-123']
    ]){
      const cookie=await login(username,password);
      assert.equal((await fetch(url,{headers:{Cookie:cookie}})).status,403);
    }
    for(const [username,password] of [
      ['managerrooms','synthetic-manager-password-123'],
      ['owner','synthetic-owner-password-123']
    ]){
      const cookie=await login(username,password);
      const response=await fetch(url,{headers:{Cookie:cookie}});
      assert.equal(response.status,200);
      assert.equal((await response.json()).available_room_nights,7);
    }
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
