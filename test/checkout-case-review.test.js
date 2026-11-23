import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/database.js';
import {transitionBooking} from '../src/booking-transitions.js';
import {getCheckoutDocumentCase} from '../src/checkout-document-case.js';
import {listCheckoutCaseReviewEvents,recordCheckoutCaseReview} from '../src/checkout-case-review.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {requiredPermission,may} from '../src/access.js';
const owner={id:0,role:'owner',username:'owner'};
const manager={id:3,role:'manager',username:'manager'};
function caseFixture(db){
 const id=Number(db.prepare("INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status) VALUES('Review Guest','2027-04-02','2027-04-03',1,'Unassigned',400000,'checked_in')").run().lastInsertRowid);
 db.prepare('INSERT INTO booking_room_allocations(booking_id,room_id) VALUES(?,1)').run(id);
 const saved=transitionBooking(db,id,'checked_out',{actor:owner,
   businessDate:'2027-04-03',acknowledge_balance:true});
 return {bookingId:id,caseId:saved.checkout_document_case_id};
}
const input=(status,confirmed=false)=>({
 request_id:randomUUID(),status,source_evidence_checked:confirmed,
 note:'Inspected source evidence and recorded the next operator action'
});
test('append-only checkout review history preserves frozen case and is retry/restart safe',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'checkout-review-')),file=path.join(dir,'ledger.sqlite');
 let db;
 try{
  db=openDatabase(file);
  const {bookingId,caseId}=caseFixture(db);
  const snapshot=getCheckoutDocumentCase(db,bookingId).snapshot;
  const request=input('needs_source_review');
  const first=recordCheckoutCaseReview(db,caseId,request,manager);
  assert.equal(first.review_status,'needs_source_review');
  assert.equal(first.already_recorded,false);
  assert.equal(recordCheckoutCaseReview(db,caseId,request,manager).already_recorded,true);
  assert.throws(()=>recordCheckoutCaseReview(db,caseId,{...request,note:'A different set of source evidence'},manager),/different details/);
  assert.throws(()=>recordCheckoutCaseReview(db,caseId,input('needs_source_review'),manager),/already has that review status/);
  assert.throws(()=>recordCheckoutCaseReview(db,caseId,input('reviewed_for_accountant'),manager),/Inspect original source/);
  const second=recordCheckoutCaseReview(db,caseId,input('reviewed_for_accountant',true),owner);
  assert.equal(second.review_status,'reviewed_for_accountant');
  assert.equal(second.legally_approved,false);
  assert.equal(getCheckoutDocumentCase(db,bookingId).state,'held_for_review');
  assert.equal(getCheckoutDocumentCase(db,bookingId).review_status,'reviewed_for_accountant');
  assert.deepEqual(getCheckoutDocumentCase(db,bookingId).snapshot,snapshot);
  assert.equal(listCheckoutCaseReviewEvents(db,caseId).history.length,2);
  assert.throws(()=>db.prepare("UPDATE checkout_case_review_events SET status='needs_source_review' WHERE case_id=?").run(caseId),/cannot be updated/);
  assert.throws(()=>db.prepare('DELETE FROM checkout_case_review_events WHERE case_id=?').run(caseId),/cannot be deleted/);
  db.close();db=null;db=openDatabase(file);
  assert.equal(getCheckoutDocumentCase(db,bookingId).review_status,'reviewed_for_accountant');
  assert.equal(db.pragma('user_version',{simple:true}),13);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM checkout_document_cases').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});
test('authenticated checkout review writes restricted to owner and manager',async()=>{
 assert.equal(requiredPermission('GET','/checkout-document-cases/2/reviews'),'invoices.read');
 assert.equal(requiredPermission('POST','/checkout-document-cases/2/reviews'),'checkout.review');
 assert.equal(may('manager','checkout.review'),true);
 assert.equal(may('frontdesk','checkout.review'),false);
 const db=openDatabase(':memory:');
 const {caseId}=caseFixture(db);
 for(const role of ['manager','frontdesk','cashier'])
  createStaff(db,{username:'review-'+role,display_name:role,role,
   password:'synthetic-review-'+role+'-password'});
 const server=createApp(db,{authRecord:createPasswordRecord('synthetic-review-owner-password')}).listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const req=(path,{cookie,method='GET',body}={})=>fetch(base+path,{method,
   headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
   ...(body?{body:JSON.stringify(body)}:{})});
 const login=async(username,password)=>{
   const res=await req('/api/auth/login',{method:'POST',body:{username,password}});
   assert.equal(res.status,200);return res.headers.get('set-cookie').split(';')[0];
 };
 try{
  const cookies={};
  cookies.owner=await login('owner','synthetic-review-owner-password');
  for(const role of ['manager','frontdesk','cashier'])
   cookies[role]=await login('review-'+role,'synthetic-review-'+role+'-password');
  const route='/api/checkout-document-cases/'+caseId+'/reviews';
  assert.equal((await req(route,{method:'POST',body:input('needs_source_review')})).status,401);
  assert.equal((await req(route,{cookie:cookies.cashier,method:'POST',body:input('needs_source_review')})).status,403);
  assert.equal((await req(route,{cookie:cookies.frontdesk,method:'POST',body:input('needs_source_review')})).status,403);
  assert.equal((await req(route,{cookie:cookies.manager,method:'POST',body:input('needs_source_review')})).status,201);
  assert.equal((await req(route,{cookie:cookies.frontdesk})).status,200);
  assert.equal((await req(route,{cookie:cookies.cashier})).status,403);
  assert.equal((await req(route,{cookie:cookies.owner,method:'POST',body:input('reviewed_for_accountant',true)})).status,201);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM checkout_case_review_events').get().n,2);
 }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
