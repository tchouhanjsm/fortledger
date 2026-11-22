import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {importMenuCsv,listMenu,createRestaurantBill} from '../src/restaurant.js';
import {dailyCollections} from '../src/daily-collections.js';
import {restaurantReconciliation} from '../src/restaurant-reconciliation.js';
import {requiredPermission,may} from '../src/access.js';

test('IST restaurant CSV exports event chronology without counting unpaid room charges as money received',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,'name,category,price,tax_rate\nSynthetic Chai,Drinks,120,5');
    const item=listMenu(db)[0];
    const create=(method,quantity)=>createRestaurantBill(db,{
      payment_method:method,
      ...(method==='room'?{manual_room:'Room-1',manual_guest:'=HYPERLINK("private")'}:{}),
      items:[{menu_item_id:item.id,quantity}]
    });
    const direct=create('cash',1);
    const oldRoom=create('room',2);
    const newRoom=create('room',3);
    db.prepare('UPDATE restaurant_bills SET created_at=? WHERE id=?')
      .run('2026-11-21 18:40:00',direct.id);
    db.prepare('UPDATE restaurant_bills SET created_at=? WHERE id=?')
      .run('2026-11-21 18:20:00',oldRoom.id); // 21 Nov, 23:50 IST
    db.prepare('UPDATE restaurant_bills SET created_at=? WHERE id=?')
      .run('2026-11-22 18:29:00',newRoom.id); // 22 Nov, 23:59 IST
    db.prepare('INSERT INTO restaurant_settlements(restaurant_bill_id,method,settlement_group,created_at) VALUES(?,?,?,?)')
      .run(oldRoom.id,'upi','synthetic-settlement-1','2026-11-22 18:25:00');
    db.prepare('INSERT INTO restaurant_settlements(restaurant_bill_id,method,settlement_group,created_at) VALUES(?,?,?,?)')
      .run(newRoom.id,'card','synthetic-settlement-2','2026-11-22 18:30:00');
    const before=db.prepare('SELECT COUNT(*) n FROM restaurant_bills').get().n;
    const result=restaurantReconciliation(db,'2026-11-22');
    assert.equal(result.business_date,'2026-11-22');
    assert.equal(result.filename,'fortledger-restaurant-2026-11-22.csv');
    assert.equal(result.records.length,3);
    assert.deepEqual(result.records.map(row=>row.kind).sort(),
      ['direct_bill_received','room_bill_settled','room_charge_created'].sort());
    assert.equal(result.totals.direct_received_paise,12000);
    assert.equal(result.totals.room_settled_paise,24000);
    assert.equal(result.totals.room_charges_created_paise,36000);
    assert.equal(result.totals.recorded_received_paise,36000);
    assert.deepEqual(result.totals.by_method,{cash:12000,upi:24000,card:0});
    assert.equal(result.totals.recorded_received_paise,
      dailyCollections(db,'2026-11-22').restaurant_received_paise);
    const roomCreated=result.records.find(row=>row.kind==='room_charge_created');
    assert.equal(roomCreated.occurred_at_ist,'2026-11-22 23:59:00');
    assert.equal(roomCreated.received_paise,0);
    assert.equal(roomCreated.room_charge_paise,36000);
    const settled=result.records.find(row=>row.kind==='room_bill_settled');
    assert.equal(settled.occurred_at_ist,'2026-11-22 23:55:00');
    assert.equal(settled.received_paise,24000);
    assert.equal(result.csv.charCodeAt(0),0xfeff);
    assert.match(result.csv,/recorded_received_inr/);
    assert.match(result.csv,/room_receivable_not_payment/);
    assert.match(result.csv,/reference_bill_total_inr_not_to_sum/);
    assert.doesNotMatch(result.csv,/HYPERLINK|private|guest_name/i);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bills').get().n,before);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM operation_audit').get().n,0);
    const tomorrow=restaurantReconciliation(db,'2026-11-23');
    assert.equal(tomorrow.totals.room_settled_paise,36000);
    assert.equal(tomorrow.totals.direct_received_paise,0);
    assert.equal(tomorrow.totals.room_charges_created_paise,0);
    assert.equal(restaurantReconciliation(db,'2026-11-20').records.length,0);
    assert.throws(()=>restaurantReconciliation(db,'2026-02-30'),/valid YYYY-MM-DD/);
    assert.throws(()=>restaurantReconciliation(db,'2026-11-22\r\nInjected: 1'),/valid YYYY-MM-DD/);
  }finally{db.close();}
});

test('restaurant CSV endpoint is protected by finance.read, not cashier bill access',async()=>{
  assert.equal(requiredPermission('GET','/finance/restaurant/reconciliation.csv'),'finance.read');
  assert.equal(may('cashier','finance.read'),false);
  assert.equal(may('frontdesk','finance.read'),false);
  assert.equal(may('manager','finance.read'),true);
  const db=openDatabase(':memory:');
  createStaff(db,{username:'managerqa',display_name:'Manager QA',role:'manager',password:'synthetic-manager-password-123'});
  createStaff(db,{username:'cashierqa',display_name:'Cashier QA',role:'cashier',password:'synthetic-cashier-password-123'});
  createStaff(db,{username:'deskqa',display_name:'Desk QA',role:'frontdesk',password:'synthetic-desk-password-123'});
  const app=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-password-123')});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const login=async(username,password)=>{
    const response=await fetch(base+'/api/auth/login',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    assert.equal(response.status,200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  try{
    const uri='/api/finance/restaurant/reconciliation.csv?date=2026-11-22';
    assert.equal((await fetch(base+uri)).status,401);
    const manager=await login('managerqa','synthetic-manager-password-123');
    const cashier=await login('cashierqa','synthetic-cashier-password-123');
    const frontdesk=await login('deskqa','synthetic-desk-password-123');
    assert.equal((await fetch(base+uri,{headers:{Cookie:cashier}})).status,403);
    assert.equal((await fetch(base+uri,{headers:{Cookie:frontdesk}})).status,403);
    const response=await fetch(base+uri,{headers:{Cookie:manager}});
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/text\/csv/);
    assert.match(response.headers.get('content-disposition'),/attachment; filename="fortledger-restaurant-2026-11-22.csv"/);
    assert.equal(response.headers.get('cache-control'),'no-store');
    const csv=await response.text();
    assert.match(csv,/business_date/);
    assert.doesNotMatch(csv,/guest_name/);
    const invalid=await fetch(base+'/api/finance/restaurant/reconciliation.csv?date=bad',
      {headers:{Cookie:manager}});
    assert.equal(invalid.status,400);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bills').get().n,0);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});

test('restaurant reconciliation UI only shown to finance readers and indicates unverified receipts',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/id="restaurant-reconciliation-section"[^>]*hidden/);
  assert.match(html,/amounts are not bank-verified/i);
  assert.match(html,/id="restaurant-reconciliation-date" type="date"/);
  assert.match(js,/\$\('#restaurant-reconciliation-section'\)\.hidden=!can\('finance.read'\)/);
  assert.match(js,/if\(!can\('finance.read'\)\)return/);
  assert.match(js,/api\/finance\/restaurant\/reconciliation\.csv\?date=/);
  assert.match(js,/operator-recorded receipts against actual cash and bank/i);
});
