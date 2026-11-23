import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {importExternalInvoiceOriginal} from '../src/external-invoice-originals.js';
import {recordHistoricalPdfIdentification} from '../src/historical-pdf-identifications.js';
import {historicalPdfInventory,historicalPdfInventoryCsv} from '../src/historical-pdf-inventory.js';
import {requiredPermission,may} from '../src/access.js';
const owner={id:0,username:'owner',role:'owner'};
function pdf(tag){
 return Buffer.from('%PDF-1.4\n1 0 obj\n<</Type /Catalog /T ('+tag+
 ')>>\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF\n');
}
function importPdf(db,tag,name){
 return importExternalInvoiceOriginal(db,pdf(tag),encodeURIComponent(name),owner);
}
function mark(db,id,number,date){
 return recordHistoricalPdfIdentification(db,id,{
   request_id:randomUUID(),invoice_number:number,issue_date:date,
   note:'Owner visually inspected the externally generated original PDF'
 },owner);
}
function seed(db){
 const a=importPdf(db,'A','=SUM(1,2).pdf');
 const b=importPdf(db,'B','External Invoice B.pdf');
 const c=importPdf(db,'C','Unrecorded.pdf');
 mark(db,a.id,'invoice-123','2026-11-10');
 mark(db,b.id,'INVOICE-123','2027-03-30');
 return {a,b,c};
}
test('accountant worksheet flags incomplete/duplicate external PDF records, cannot certify GST',()=>{
 const db=openDatabase(':memory:');
 try{
  seed(db);
  const before=db.serialize();
  const result=historicalPdfInventory(db);
  assert.equal(result.total_imported_originals,3);
  assert.equal(result.transcribed_originals,2);
  assert.equal(result.missing_number_or_date,1);
  assert.equal(result.potential_duplicate_originals,2);
  assert.equal(result.possible_format_issues,0);
  assert.equal(result.inventory_complete,false);
  assert.equal(result.external_folder_scanned,false);
  assert.equal(result.accountant_approved,false);
  assert.equal(result.statutory_issuance_enabled,false);
  const csv=historicalPdfInventoryCsv(db);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv,/Owner-reported invoice number \(UNVERIFIED\)/);
  assert.match(csv,/OWNER_REPORTED_UNVERIFIED_NOT_TAX_ISSUED/);
  assert.ok(csv.includes('\"\'=SUM(1,2).pdf'), 'Formula-looking filename should be neutralized');
  assert.equal(csv.split('\r\n').filter(Boolean).length,4);
  assert.deepEqual(db.serialize(),before,'Export must never mutate the hotel DB');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);
 }finally{db.close();}
});

test('latest correction changes duplicate count but preserves prior transcription',()=>{
 const db=openDatabase(':memory:');
 try{
  const {a,b}=seed(db);
  mark(db,b.id,'invoice-124','2026-11-12');
  const summary=historicalPdfInventory(db);
  assert.equal(summary.potential_duplicate_originals,0);
  assert.equal(summary.transcribed_originals,2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM historical_pdf_identifications').get().n,3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM external_invoice_originals').get().n,3);
 }finally{db.close();}
});

test('no copy of original PDF is included in CSV, source format review remains a warning',()=>{
 const db=openDatabase(':memory:');
 try{
  const item=importPdf(db,'Secret-Binary-PDF-Bytes','Evidence.pdf');
  mark(db,item.id,'VERY-LONG-INVOICE-NUMBER-2026','2026-04-01');
  const summary=historicalPdfInventory(db);
  assert.equal(summary.possible_format_issues,1);
  const csv=historicalPdfInventoryCsv(db);
  assert.match(csv,/format_review/);
  assert.doesNotMatch(csv,/Secret-Binary-PDF-Bytes/);
  assert.doesNotMatch(csv,/%PDF-1/);
 }finally{db.close();}
});

test('accountant handoff routes owner-only; direct requests never leak to manager or cashier',async()=>{
 assert.equal(requiredPermission('GET','/external-invoice-originals/inventory'),'external.documents.read');
 assert.equal(requiredPermission('GET','/external-invoice-originals/inventory.csv'),'external.documents.read');
 assert.equal(requiredPermission('POST','/external-invoice-originals/inventory'),null);
 assert.equal(may('manager','external.documents.read'),false);
 const db=openDatabase(':memory:');seed(db);
 createStaff(db,{username:'inventory-manager',display_name:'Manager',role:'manager',password:'synthetic-manager-inventory-pass'});
 createStaff(db,{username:'inventory-cashier',display_name:'Cashier',role:'cashier',password:'synthetic-cashier-inventory-pass'});
 const server=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-inventory-pass')}).listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const req=(url,{method='GET',body,cookie=''}={})=>fetch(base+url,{method,
   headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
 const login=async(username,password)=>{
   const res=await req('/api/auth/login',{method:'POST',body:{username,password}});
   assert.equal(res.status,200);
   return res.headers.get('set-cookie')?.split(';')[0];
 };
 try{
  const ownerCookie=await login('owner','synthetic-owner-inventory-pass');
  const managerCookie=await login('inventory-manager','synthetic-manager-inventory-pass');
  const cashierCookie=await login('inventory-cashier','synthetic-cashier-inventory-pass');
  for(const endpoint of ['/api/external-invoice-originals/inventory','/api/external-invoice-originals/inventory.csv']){
    assert.equal((await req(endpoint)).status,401);
    assert.equal((await req(endpoint,{cookie:managerCookie})).status,403);
    assert.equal((await req(endpoint,{cookie:cashierCookie})).status,403);
  }
  const summary=await req('/api/external-invoice-originals/inventory',{cookie:ownerCookie});
  assert.equal(summary.status,200);
  assert.equal((await summary.json()).potential_duplicate_originals,2);
  const download=await req('/api/external-invoice-originals/inventory.csv',{cookie:ownerCookie});
  assert.equal(download.status,200);
  assert.match(download.headers.get('content-disposition'),/attachment/);
  assert.match(download.headers.get('content-type'),/text\/csv/);
  assert.match(await download.text(),/Owner-reported invoice number/);
  assert.equal((await req('/api/external-invoice-originals/inventory',{cookie:ownerCookie,method:'POST',body:{}})).status,403);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);
 }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
