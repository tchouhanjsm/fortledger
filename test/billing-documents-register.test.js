import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createProforma} from '../src/invoices.js';
import {createRestaurantBill,importMenuCsv} from '../src/restaurant.js';
import {transitionBooking} from '../src/booking-transitions.js';
import {importExternalInvoiceOriginal} from '../src/external-invoice-originals.js';
import {searchBillingDocuments} from '../src/billing-documents-register.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {requiredPermission} from '../src/access.js';
import {hotelBusinessDate} from '../src/hotel-clock.js';

const actor={id:0,role:'owner',username:'owner'};
const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n2 0 obj\n<</Type /Pages /Count 0 /Kids []>>\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF\n');
function fixture(db){
 const id=Number(db.prepare(`INSERT INTO bookings
  (guest_name,company_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status)
  VALUES('Synthetic Register Guest','Sample Inc','2027-04-02','2027-04-03',1,'Unassigned',420000,'checked_in')`).run().lastInsertRowid);
 db.prepare('INSERT INTO booking_room_allocations(booking_id,room_id) VALUES(?,1)').run(id);
 const inv=createProforma(db,id,{});
 importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,80,5');
 const bill=createRestaurantBill(db,{payment_method:'room',booking_id:id,
  items:[{menu_item_id:1,quantity:1}]});
 transitionBooking(db,id,'checked_out',{actor,acknowledge_balance:true,businessDate:'2027-04-03'});
 const external=importExternalInvoiceOriginal(db,pdf,'Historical-001.pdf',actor);
 return {id,inv,bill,external};
}
test('unified document search is read-only, distinguishes statuses and enforces source visibility',()=>{
 const db=openDatabase(':memory:');
 try{
  const {id,inv,bill}=fixture(db);
  const before=db.serialize();
  const owner=searchBillingDocuments(db,{role:'owner'});
  assert.equal(owner.total,4);
  assert.deepEqual(new Set(owner.items.map(x=>x.kind)),
   new Set(['proforma','checkout_case','historical_original','restaurant_receipt']));
  assert.equal(owner.items.find(x=>x.kind==='proforma').title,inv.number);
  assert.equal(owner.items.find(x=>x.kind==='restaurant_receipt').source_id,bill.id);
  assert.equal(owner.items.every(x=>x.legally_issued_by_fortledger===false),true);
  assert.equal(owner.items.every(x=>x.bank_verified===false),true);
  const manager=searchBillingDocuments(db,{role:'manager'});
  assert.equal(manager.total,3);
  assert.equal(manager.items.some(x=>x.kind==='historical_original'),false);
  const frontdesk=searchBillingDocuments(db,{role:'frontdesk'});
  assert.equal(frontdesk.total,2);
  assert.deepEqual(new Set(frontdesk.items.map(x=>x.kind)),new Set(['proforma','checkout_case']));
  assert.equal(searchBillingDocuments(db,{role:'frontdesk',q:'historical'}).total,0);
  assert.equal(searchBillingDocuments(db,{role:'manager',kind:'historical_original'}).total,0);
  assert.equal(searchBillingDocuments(db,{role:'owner',q:'HISTORICAL-001'}).total,1);
  assert.equal(searchBillingDocuments(db,{role:'owner',q:'Sample Inc'}).total,3);
  assert.equal(searchBillingDocuments(db,{role:'frontdesk',q:String(id)}).total,2);
  assert.equal(searchBillingDocuments(db,{role:'owner',kind:'proforma'}).total,1);
  const page=searchBillingDocuments(db,{role:'owner',limit:2});
  assert.equal(page.items.length,2);
  const second=searchBillingDocuments(db,{role:'owner',offset:2,limit:2});
  assert.equal(second.items.length,2);
  assert.equal(new Set([...page.items,...second.items].map(x=>x.kind+':'+x.source_id)).size,4);
  const today=hotelBusinessDate();
  assert.equal(searchBillingDocuments(db,{role:'owner',from:today,to:today}).total,4);
  assert.equal(searchBillingDocuments(db,{role:'owner',from:'2027-01-01'}).total,0);
  assert.throws(()=>searchBillingDocuments(db,{role:'cashier'}),/restricted/);
  assert.throws(()=>searchBillingDocuments(db,{role:'owner'},{kind:'final_tax_invoice'}),/Invalid billing/);
  assert.throws(()=>searchBillingDocuments(db,{role:'owner'},{from:'2026-02-30'}),/Invalid register/);
  assert.deepEqual(db.serialize(),before,'Register search must not modify the source database');
 }finally{db.close();}
});

test('authenticated document-register API is permission filtered even for direct URL requests',async()=>{
 assert.equal(requiredPermission('GET','/documents/register'),'invoices.read');
 assert.equal(requiredPermission('POST','/documents/register'),null);
 const db=openDatabase(':memory:');fixture(db);
 createStaff(db,{username:'register-manager',display_name:'Manager',role:'manager',password:'synthetic-register-manager-2027'});
 createStaff(db,{username:'register-frontdesk',display_name:'Front Desk',role:'frontdesk',password:'synthetic-register-frontdesk-2027'});
 createStaff(db,{username:'register-cashier',display_name:'Cashier',role:'cashier',password:'synthetic-register-cashier-2027'});
 const server=createApp(db,{authRecord:createPasswordRecord('synthetic-register-owner-2027')}).listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 async function request(url,{cookie,method='GET',body}={}){
  return fetch(base+url,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
   ...(body?{body:JSON.stringify(body)}:{})});
 }
 async function login(username,password){
  const res=await request('/api/auth/login',{method:'POST',body:{username,password}});
  assert.equal(res.status,200);
  return res.headers.get('set-cookie')?.split(';')[0];
 }
 try{
  const owner=await login('owner','synthetic-register-owner-2027');
  const manager=await login('register-manager','synthetic-register-manager-2027');
  const frontdesk=await login('register-frontdesk','synthetic-register-frontdesk-2027');
  const cashier=await login('register-cashier','synthetic-register-cashier-2027');
  assert.equal((await request('/api/documents/register')).status,401);
  assert.equal((await request('/api/documents/register',{cookie:cashier})).status,403);
  const own=await request('/api/documents/register',{cookie:owner});
  assert.equal((await own.json()).total,4);
  assert.equal((await (await request('/api/documents/register',{cookie:manager})).json()).total,3);
  assert.equal((await (await request('/api/documents/register',{cookie:frontdesk})).json()).total,2);
  const forbidden=await request('/api/documents/register?kind=historical_original',{cookie:manager});
  assert.equal((await forbidden.json()).total,0);
  assert.equal((await request('/api/documents/register',{cookie:manager,method:'POST',body:{}})).status,403);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,1);
 }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
