import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {accountantReadiness,} from '../src/accountant-readiness.js';
import {accountantReadinessCsv,accountantCsvCell} from '../src/accountant-readiness-csv.js';
import {transitionBooking} from '../src/booking-transitions.js';
import {recordCheckoutCaseReview} from '../src/checkout-case-review.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {requiredPermission} from '../src/access.js';
const owner={id:0,role:'owner',username:'owner'};
function make(db){
  const id=Number(db.prepare("INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status) VALUES('CSV Guest','2027-04-02','2027-04-03',1,'Unassigned',400000,'checked_in')").run().lastInsertRowid);
  db.prepare('INSERT INTO booking_room_allocations(booking_id,room_id) VALUES(?,1)').run(id);
  const caseId=transitionBooking(db,id,'checked_out',{actor:owner,
    businessDate:'2027-04-03',acknowledge_balance:true}).checkout_document_case_id;
  recordCheckoutCaseReview(db,caseId,{
    request_id:randomUUID(),status:'reviewed_for_accountant',
    note:'Owner reviewed actual stay and source evidence',source_evidence_checked:true
  },owner);
  return caseId;
}
test('source-linked worksheet differentiates date meaning and staff review from GST approval',()=>{
 const db=openDatabase(':memory:');
 try{
  const id=make(db);
  const before=db.serialize();
  const summary=accountantReadiness(db);
  assert.equal(summary.counts.checkout_staff_reviewed_cases,1);
  assert.equal(summary.issues.find(x=>x.source==='checkout_case').code,'checkout_accountant_signoff_pending');
  const csv=accountantReadinessCsv(db);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv,/hotel_business_date_not_invoice_issue_date/);
  assert.match(csv,/checkout_accountant_signoff_pending/);
  assert.match(csv,/OWNER REVIEW ONLY - NOT GST APPROVED/);
  assert.doesNotMatch(csv,/CSV Guest/);
  assert.doesNotMatch(csv,/400000/);
  assert.equal(id>0,true);
  assert.deepEqual(db.serialize(),before,'Export must not write to the ledger');
 }finally{db.close();}
});
test('CSV output neutralizes spreadsheet formulas without touching immutable sources',()=>{
  for(const cell of ['=SUM(1,2)','+1+2','-1+2','@MIN(1,2)','\\t=1+2']){
    const raw=cell.startsWith('\\t')?'\t=1+2':cell;
    assert.equal(accountantCsvCell(raw),'"'+"'"+raw.replace(/"/g,'""')+'"');
  }
  assert.equal(accountantCsvCell('ordinary'),'"ordinary"');
  assert.equal(accountantCsvCell('a"b'),'"a""b"');
});
test('export route excludes manager, frontdesk and cashier even if URL is requested directly',async()=>{
 assert.equal(requiredPermission('GET','/accountant/readiness.csv'),'external.documents.read');
 assert.equal(requiredPermission('POST','/accountant/readiness.csv'),null);
 const db=openDatabase(':memory:');make(db);
 for(const role of ['manager','frontdesk','cashier'])
  createStaff(db,{username:'csv-'+role,display_name:role,role,
    password:'synthetic-csv-'+role+'-password'});
 const server=createApp(db,{authRecord:createPasswordRecord('synthetic-csv-owner-password')}).listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const request=(url,{cookie,method='GET'}={})=>fetch(base+url,{method,
   headers:cookie?{Cookie:cookie}:{}});
 const login=async(user,password)=>{
  const res=await fetch(base+'/api/auth/login',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user,password})});
  assert.equal(res.status,200);return res.headers.get('set-cookie').split(';')[0];
 };
 try{
  const owned=await login('owner','synthetic-csv-owner-password');
  const users={};
  for(const role of ['manager','frontdesk','cashier'])
    users[role]=await login('csv-'+role,'synthetic-csv-'+role+'-password');
  assert.equal((await request('/api/accountant/readiness.csv')).status,401);
  for(const cookie of Object.values(users))
    assert.equal((await request('/api/accountant/readiness.csv',{cookie})).status,403);
  const own=await request('/api/accountant/readiness.csv',{cookie:owned});
  assert.equal(own.status,200);
  assert.match(own.headers.get('content-disposition'),/attachment/);
  assert.match(await own.text(),/checkout_accountant_signoff_pending/);
  assert.notEqual((await request('/api/accountant/readiness.csv',{cookie:owned,method:'POST'})).status,200);
 }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
