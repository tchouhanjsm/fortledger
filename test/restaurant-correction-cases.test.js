import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {importMenuCsv,createRestaurantBill} from '../src/restaurant.js';
import {getGuestFolio} from '../src/folio.js';
import {dailyCollections} from '../src/daily-collections.js';
import {may,requiredPermission} from '../src/access.js';
import {submitRestaurantCorrectionCase,reviewRestaurantCorrectionCase,
  restaurantCorrectionRequest,listRestaurantCorrectionCases} from '../src/restaurant-correction-cases.js';

const manager={id:3,username:'synthetic-manager',role:'manager'};
const owner={id:0,username:'owner',role:'owner'};
function setup(db,payment_method='cash'){
  importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,80,5\nCoffee,Drinks,120,5');
  const booking=Number(db.prepare(`INSERT INTO bookings
    (guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status)
    VALUES('Synthetic Guest','2027-02-02','2027-02-03',1,'Unassigned',450000,'checked_in')`).run().lastInsertRowid);
  const bill=createRestaurantBill(db,{request_id:randomUUID(),payment_method,
    ...(payment_method==='room'?{booking_id:booking}:{}),
    items:[{menu_item_id:1,quantity:2},{menu_item_id:2,quantity:1}]});
  return {booking,bill};
}
test('case queue persists, is append-only, cannot double-post and leaves every financial source unchanged',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'fortledger-correction-'));
  const file=path.join(dir,'ledger.sqlite');
  let db;
  try{
    db=openDatabase(file);
    const {booking,bill}=setup(db,'room');
    const snapshot=db.prepare('SELECT * FROM restaurant_bills WHERE id=?').get(bill.id);
    const folio=getGuestFolio(db,booking);
    const collections=dailyCollections(db,'2027-02-02');
    const req={request_id:randomUUID(),reason:'Guest did not order the second tea',
      lines:[{line_index:0,quantity:1}]};
    const created=submitRestaurantCorrectionCase(db,bill.id,req,manager);
    assert.equal(created.status,'awaiting_owner');
    assert.equal(created.already_recorded,false);
    assert.equal(created.proposal.proposed_gross_paise,8000);
    assert.equal(created.proposal.requires_room_folio_review,true);
    assert.equal(created.financial_adjustment_posted,false);
    assert.deepEqual(submitRestaurantCorrectionCase(db,bill.id,req,manager),
      {...created,already_recorded:true});
    assert.throws(()=>submitRestaurantCorrectionCase(db,bill.id,{...req,reason:'Another separate reason for correction'},manager),
      /different details/);
    assert.equal(restaurantCorrectionRequest(db,req.request_id).recorded,true);
    assert.equal(listRestaurantCorrectionCases(db,bill.id).length,1);
    assert.deepEqual(db.prepare('SELECT * FROM restaurant_bills WHERE id=?').get(bill.id),snapshot);
    assert.deepEqual(getGuestFolio(db,booking),folio);
    assert.deepEqual(dailyCollections(db,'2027-02-02'),collections);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_correction_case_reviews').get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM operation_audit WHERE action='restaurant_bill.correction_requested'").get().n,1);
    db.close();db=null;
    db=openDatabase(file);
    assert.equal(db.pragma('user_version',{simple:true}),13,'No rollback-blocking schema version bump');
    assert.equal(listRestaurantCorrectionCases(db,bill.id)[0].id,created.id);
    assert.equal(submitRestaurantCorrectionCase(db,bill.id,req,manager).already_recorded,true);
    assert.deepEqual(db.prepare('SELECT * FROM restaurant_bills WHERE id=?').get(bill.id),snapshot);
  }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});

test('owner decisions are one-time audited flags, not credits, refunds or guest folio edits',()=>{
  const db=openDatabase(':memory:');
  try{
    const {bill}=setup(db);
    const req={request_id:randomUUID(),reason:'Remove guest extra tea charge',
      lines:[{line_index:0,quantity:1}]};
    const created=submitRestaurantCorrectionCase(db,bill.id,req,manager);
    assert.throws(()=>submitRestaurantCorrectionCase(db,bill.id,req,{...manager,role:'cashier'}),/authorized/);
    const review={request_id:randomUUID(),disposition:'needs_accountant',
      note:'Escalate tax and refund handling to accountant'};
    assert.throws(()=>reviewRestaurantCorrectionCase(db,created.id,review,manager),/authorized/);
    const decided=reviewRestaurantCorrectionCase(db,created.id,review,owner);
    assert.equal(decided.status,'needs_accountant');
    assert.equal(decided.review.actor_username,'owner');
    assert.equal(decided.gst_credit_note_issued,false);
    assert.equal(decided.refund_sent,false);
    assert.equal(reviewRestaurantCorrectionCase(db,created.id,review,owner).already_recorded,true);
    assert.throws(()=>reviewRestaurantCorrectionCase(db,created.id,{...review,note:'Different review note'},owner),/different details/);
    assert.throws(()=>reviewRestaurantCorrectionCase(db,created.id,{...review,request_id:randomUUID(),disposition:'dismissed'},owner),/already reviewed/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_correction_case_reviews').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_settlements').get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='tax_credit_notes'").get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM operation_audit WHERE action='restaurant_bill.correction_reviewed'").get().n,1);
    assert.throws(()=>reviewRestaurantCorrectionCase(db,created.id,{...review,request_id:randomUUID(),disposition:'approved'},owner),/needs_accountant/);
  }finally{db.close();}
});

test('authenticated HTTP: manager submits cases, owner reviews, cashier and front desk denied',async()=>{
  assert.equal(may('manager','restaurant.correction.request'),true);
  assert.equal(may('manager','restaurant.correction.review'),false);
  assert.equal(may('cashier','restaurant.correction.request'),false);
  assert.equal(requiredPermission('GET','/restaurant/bills/3/correction-cases'),'restaurant.correction.preview');
  assert.equal(requiredPermission('POST','/restaurant/bills/3/correction-cases'),'restaurant.correction.request');
  assert.equal(requiredPermission('POST','/restaurant/correction-cases/2/review'),'restaurant.correction.review');
  assert.equal(requiredPermission('POST','/restaurant/correction-cases/2/other-action'),null);
  const db=openDatabase(':memory:');
  const bill=setup(db).bill;
  const ownerPassword='synthetic-owner-password-2027';
  for(const role of ['manager','cashier','frontdesk']){
    createStaff(db,{username:'case-'+role,display_name:'Case '+role,role,
      password:'synthetic-'+role+'-password-2027'});
  }
  const server=createApp(db,{authRecord:createPasswordRecord(ownerPassword)}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  async function api(route,{method='GET',body,cookie}={}){
    const res=await fetch(base+route,{method,headers:{
      'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})
    },body:body===undefined?undefined:JSON.stringify(body)});
    let data;try{data=await res.json();}catch{}
    return {status:res.status,data,cookie:res.headers.get('set-cookie')?.split(';')[0]};
  }
  try{
    const ownerCookie=(await api('/api/auth/login',{method:'POST',
      body:{username:'owner',password:ownerPassword}})).cookie;
    const users={};
    for(const role of ['manager','cashier','frontdesk'])
      users[role]=(await api('/api/auth/login',{method:'POST',
        body:{username:'case-'+role,password:'synthetic-'+role+'-password-2027'}})).cookie;
    const route='/api/restaurant/bills/'+bill.id+'/correction-cases';
    const input={request_id:randomUUID(),reason:'Wrong quantity for guest order',lines:[{line_index:0,quantity:1}]};
    assert.equal((await api(route,{method:'POST',body:input})).status,401);
    assert.equal((await api(route,{method:'POST',body:input,cookie:users.cashier})).status,403);
    assert.equal((await api(route,{method:'POST',body:input,cookie:users.frontdesk})).status,403);
    const created=await api(route,{method:'POST',body:input,cookie:users.manager});
    assert.equal(created.status,201);
    assert.equal((await api(route,{method:'POST',body:input,cookie:users.manager})).status,200);
    assert.equal((await api(route,{cookie:users.cashier})).status,403,
      'Cashier can read ordinary saved receipts but not manager correction cases');
    assert.equal((await api(route,{cookie:users.frontdesk})).status,403);
    const lookup='/api/restaurant/correction-cases/request/'+input.request_id;
    assert.equal((await api(lookup,{cookie:users.manager})).data.case.id,created.data.id);
    assert.equal((await api(lookup,{cookie:users.cashier})).status,403);
    const reviewRoute='/api/restaurant/correction-cases/'+created.data.id+'/review';
    const review={request_id:randomUUID(),disposition:'needs_accountant',
      note:'Requires external GST and payment review'};
    assert.equal((await api(reviewRoute,{method:'POST',body:review,cookie:users.manager})).status,403);
    assert.equal((await api(reviewRoute,{method:'POST',body:review,cookie:users.cashier})).status,403);
    assert.equal((await api(reviewRoute,{method:'POST',body:review,cookie:ownerCookie})).status,201);
    assert.equal((await api(reviewRoute,{method:'POST',body:review,cookie:ownerCookie})).status,200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_correction_cases').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_correction_case_reviews').get().n,1);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
