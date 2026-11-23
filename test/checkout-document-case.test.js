import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/database.js';
import {transitionBooking} from '../src/booking-transitions.js';
import {checkoutInvoicePreflight} from '../src/checkout-invoice-preflight.js';
import {getCheckoutDocumentCase,listCheckoutDocumentCases} from '../src/checkout-document-case.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {may,requiredPermission} from '../src/access.js';

const actor={id:0,role:'owner',username:'owner'};
function booking(db){
 const id=Number(db.prepare(`INSERT INTO bookings
  (guest_name,company_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status)
  VALUES('Synthetic Checkout Guest','Synthetic Company','2027-04-02','2027-04-03',1,'Unassigned',460000,'checked_in')`).run().lastInsertRowid);
 db.prepare('INSERT INTO booking_room_allocations(booking_id,room_id) VALUES(?,1)').run(id);
 return id;
}
test('authoritative checkout saves exactly one immutable held document case with the status transition',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'fortledger-checkout-case-')),file=path.join(dir,'ledger.sqlite');
 let db=null;
 try{
  db=openDatabase(file);
  const id=booking(db);
  const oldInvoiceCount=db.prepare('SELECT COUNT(*) n FROM invoices').get().n;
  const response=transitionBooking(db,id,'checked_out',{
    actor,acknowledge_balance:true,businessDate:'2027-04-03'
  });
  assert.equal(response.ok,true);
  assert.equal(response.invoice_issued,false);
  assert.ok(Number.isSafeInteger(response.checkout_document_case_id));
  let record=getCheckoutDocumentCase(db,id);
  assert.equal(record.version,1);
  assert.equal(record.state,'held_for_review');
  assert.equal(record.hotel_business_date,'2027-04-03');
  assert.equal(record.snapshot.trigger,'booking_checked_out');
  assert.equal(record.snapshot.ready_for_legal_issuance,false);
  assert.equal(record.snapshot.final_tax_invoice_issued,false);
  assert.equal(record.snapshot.preflight.totals.charges_paise,460000);
  assert.equal(record.snapshot.preflight.totals.operator_recorded_paise,0);
  assert.equal(record.snapshot.preflight.totals.due_paise,460000);
  assert.equal(record.document_pdf_created,false);
  assert.equal(record.statutory_number_reserved,false);
  assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(id).status,'checked_out');
  assert.equal(db.prepare('SELECT status FROM room_housekeeping WHERE room_id=1').get().status,'dirty');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,oldInvoiceCount);
  const again=transitionBooking(db,id,'checked_out',{actor,businessDate:'2027-04-03'});
  assert.equal(again.unchanged,true);
  assert.equal(listCheckoutDocumentCases(db).total,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM operation_audit WHERE action='checkout_document_case.created'").get().n,1);
  assert.throws(()=>db.prepare('DELETE FROM checkout_document_cases WHERE booking_id=?').run(id),/cannot be deleted/);
  assert.throws(()=>db.prepare("UPDATE checkout_document_cases SET state='held_for_review' WHERE booking_id=?").run(id),/cannot be modified/);
  db.prepare("INSERT INTO payments(booking_id,amount_paise,method,note) VALUES(?,?,?,?)")
    .run(id,10000,'cash','Late synthetic settlement');
  assert.equal(checkoutInvoicePreflight(db,id).totals.operator_recorded_paise,10000);
  assert.equal(getCheckoutDocumentCase(db,id).snapshot.preflight.totals.operator_recorded_paise,0,
    'Historical checkout work case never re-renders after subsequent money writes');
  db.close();db=null;db=openDatabase(file);
  record=getCheckoutDocumentCase(db,id);
  assert.equal(record.id,response.checkout_document_case_id);
  assert.equal(record.snapshot.preflight.totals.due_paise,460000);
  assert.equal(db.pragma('user_version',{simple:true}),13);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});

test('blocked GST source preflight is never silently lost after a successful physical checkout',()=>{
 const db=openDatabase(':memory:');
 try{
  const id=booking(db);
  db.prepare("UPDATE business_settings SET value='bad json' WHERE id=1").run();
  const result=transitionBooking(db,id,'checked_out',{actor,acknowledge_balance:true,businessDate:'2027-04-03'});
  assert.equal(result.ok,true);
  const caseRecord=getCheckoutDocumentCase(db,id);
  assert.equal(caseRecord.snapshot.preflight,null);
  assert.equal(caseRecord.snapshot.exception.code,'source_preflight_unavailable');
  assert.equal(caseRecord.snapshot.ready_for_legal_issuance,false);
  assert.equal(caseRecord.state,'held_for_review');
 }finally{db.close();}
});

test('broken checkout case storage rolls back booking status and housekeeping together',()=>{
 const db=openDatabase(':memory:');
 try{
  const id=booking(db);
  const before=db.prepare('SELECT status FROM room_housekeeping WHERE room_id=1').get().status;
  db.exec('DROP TABLE checkout_document_cases');
  assert.throws(()=>transitionBooking(db,id,'checked_out',
    {actor,acknowledge_balance:true,businessDate:'2027-04-03'}),/checkout_document_cases/);
  assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(id).status,'checked_in');
  assert.equal(db.prepare('SELECT status FROM room_housekeeping WHERE room_id=1').get().status,before);
 }finally{db.close();}
});

test('checkout case APIs are read-only: front desk/owner allowed, cashier denied',async()=>{
 assert.equal(requiredPermission('GET','/checkout-document-cases'),'invoices.read');
 assert.equal(requiredPermission('GET','/bookings/1/checkout-document-case'),'invoices.read');
 assert.equal(requiredPermission('POST','/checkout-document-cases'),null);
 assert.equal(may('frontdesk','invoices.read'),true);
 assert.equal(may('cashier','invoices.read'),false);
 const db=openDatabase(':memory:');const id=booking(db);
 transitionBooking(db,id,'checked_out',{actor,acknowledge_balance:true,businessDate:'2027-04-03'});
 createStaff(db,{username:'synthetic-case-frontdesk',display_name:'Front Desk',role:'frontdesk',password:'synthetic-frontdesk-pass-2027'});
 createStaff(db,{username:'synthetic-case-cashier',display_name:'Cashier',role:'cashier',password:'synthetic-cashier-pass-2027'});
 const server=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-pass-2027')}).listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 async function request(endpoint,{method='GET',cookie='',body}={}){
  return fetch(base+endpoint,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
 }
 try{
  async function login(username,password){
   const x=await request('/api/auth/login',{method:'POST',body:{username,password}});
   return x.headers.get('set-cookie')?.split(';')[0];
  }
  const frontdesk=await login('synthetic-case-frontdesk','synthetic-frontdesk-pass-2027');
  const cashier=await login('synthetic-case-cashier','synthetic-cashier-pass-2027');
  assert.equal((await request('/api/checkout-document-cases')).status,401);
  assert.equal((await request('/api/checkout-document-cases',{cookie:cashier})).status,403);
  assert.equal((await request('/api/bookings/'+id+'/checkout-document-case',{cookie:cashier})).status,403);
  const list=await request('/api/checkout-document-cases',{cookie:frontdesk});
  assert.equal(list.status,200);
  assert.equal((await list.json()).total,1);
  const details=await request('/api/bookings/'+id+'/checkout-document-case',{cookie:frontdesk});
  assert.equal((await details.json()).case.snapshot.final_tax_invoice_issued,false);
  assert.equal((await request('/api/checkout-document-cases',{method:'POST',body:{},cookie:frontdesk})).status,403);
 }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
