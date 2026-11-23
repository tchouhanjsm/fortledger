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
import {importExternalInvoiceOriginal} from '../src/external-invoice-originals.js';
import {searchBillingDocuments} from '../src/billing-documents-register.js';
import {recordHistoricalPdfIdentification,historicalPdfIdentificationHistory,
  historicalPdfIdentificationRequest,latestHistoricalPdfIdentification
} from '../src/historical-pdf-identifications.js';
import {may,requiredPermission} from '../src/access.js';

const owner={id:0,username:'owner',role:'owner'};
function pdf(tag){
  return Buffer.from('%PDF-1.4\n1 0 obj\n<</Type /Catalog /Pages 2 0 R /T ('+tag+
    ')>>\nendobj\n2 0 obj\n<</Type /Pages /Count 0 /Kids []>>\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF\n');
}
function source(db,tag){
  return importExternalInvoiceOriginal(db,pdf(tag),'Synthetic-'+tag+'.pdf',owner);
}
function input(overrides={}){
  return {request_id:randomUUID(),invoice_number:'invoice-123',issue_date:'2026-11-14',
    booking_id:null,note:'Owner copied the number and date from the opened archived PDF',...overrides};
}
function syntheticBooking(db){
  return Number(db.prepare(`INSERT INTO bookings
   (guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status)
   VALUES('Synthetic Historic Guest','2026-11-10','2026-11-11',1,'Unassigned',450000,'checked_out')`)
   .run().lastInsertRowid);
}
test('historical identification is owner-entered, append-only, never a legal invoice or serial reservation',()=>{
  const db=openDatabase(':memory:');
  try{
    const a=source(db,'A'),book=syntheticBooking(db);
    const initial=input({booking_id:book});
    const result=recordHistoricalPdfIdentification(db,a.id,initial,owner);
    assert.equal(result.reported_invoice_number,'invoice-123');
    assert.equal(result.reported_financial_year,'2026-27');
    assert.equal(result.booking_candidate_id,book);
    assert.equal(result.legal_invoice_number_validated,false);
    assert.equal(result.source_pdf_text_verified,false);
    assert.equal(result.accountant_approved,false);
    assert.equal(result.statutory_issuance_enabled,false);
    assert.equal(result.possible_duplicate_count,0);
    assert.equal(result.already_recorded,false);
    assert.equal(recordHistoricalPdfIdentification(db,a.id,initial,owner).already_recorded,true);
    assert.equal(historicalPdfIdentificationRequest(db,initial.request_id).entry.id,result.id);
    assert.throws(()=>recordHistoricalPdfIdentification(db,a.id,{...initial,
      note:'Second different note cannot reuse the same request identity'},owner),/different/);
    assert.throws(()=>recordHistoricalPdfIdentification(db,a.id,input(),{...owner,role:'manager'}),/Owner/);
    const correction=input({invoice_number:'invoice-124',booking_id:null,
      note:'Second visual check corrected a mistyped historical serial'});
    const second=recordHistoricalPdfIdentification(db,a.id,correction,owner);
    assert.notEqual(second.id,result.id);
    const history=historicalPdfIdentificationHistory(db,a.id);
    assert.equal(history.history.length,2);
    assert.equal(history.history[0].reported_invoice_number,'invoice-124');
    assert.equal(history.history[1].reported_invoice_number,'invoice-123');
    assert.equal(history.latest.id,second.id);
    assert.equal(history.legal_invoice_issued,false);
    assert.throws(()=>db.prepare('DELETE FROM historical_pdf_identifications WHERE id=?').run(result.id),
      /cannot be deleted/);
    assert.throws(()=>db.prepare("UPDATE historical_pdf_identifications SET note='bad' WHERE id=?").run(result.id),
      /cannot be updated/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM operation_audit WHERE action='external_invoice_pdf.identified'").get().n,2);
    assert.equal(db.pragma('user_version',{simple:true}),13);
  }finally{db.close();}
});

test('same FY duplicate numbers warn; different FY allowed; latest correction resolves warning',()=>{
  const db=openDatabase(':memory:');
  try{
    const a=source(db,'CaseA'),other=source(db,'CaseB');
    recordHistoricalPdfIdentification(db,a.id,input({issue_date:'2027-03-31'}),owner);
    const same=recordHistoricalPdfIdentification(db,other.id,
      input({invoice_number:'INVOICE-123',issue_date:'2026-04-01'}),owner);
    assert.equal(same.reported_financial_year,'2026-27');
    assert.equal(same.possible_duplicate_count,1);
    assert.equal(latestHistoricalPdfIdentification(db,a.id).possible_duplicate_count,1);
    const corrected=recordHistoricalPdfIdentification(db,other.id,
      input({invoice_number:'invoice-123',issue_date:'2027-04-01',
        note:'Owner verified this PDF belongs to the following financial year'}),owner);
    assert.equal(corrected.reported_financial_year,'2027-28');
    assert.equal(corrected.possible_duplicate_count,0);
    assert.equal(latestHistoricalPdfIdentification(db,a.id).possible_duplicate_count,0);
    const older=historicalPdfIdentificationHistory(db,other.id).history[1];
    assert.equal(older.reported_financial_year,'2026-27');
    assert.equal(older.reported_invoice_number,'INVOICE-123');
    const ownerSearch=searchBillingDocuments(db,owner,{q:'invoice-123',kind:'historical_original'});
    assert.equal(ownerSearch.total,2);
    assert.equal(ownerSearch.items.every(x=>x.status==='unverified_external_pdf_original'),true);
    assert.equal(searchBillingDocuments(db,{role:'manager'},
      {q:'invoice-123',kind:'historical_original'}).total,0);
    assert.equal(searchBillingDocuments(db,{role:'frontdesk'},
      {q:'invoice-123',kind:'historical_original'}).total,0);
  }finally{db.close();}
});

test('invalid inputs fail without writes, long serials are flagged not secretly shortened',()=>{
  const db=openDatabase(':memory:');
  try{
    const a=source(db,'Validation');
    for(const bad of [
      {issue_date:'2026-02-30'},{issue_date:'2026-14-01'},
      {invoice_number:'<script>'},{invoice_number:'INV\n123'},
      {invoice_number:''},{invoice_number:'x'.repeat(65)},
      {booking_id:987654321},{booking_id:1.5},{note:'short'},
      {request_id:'bad'}
    ])assert.throws(()=>recordHistoricalPdfIdentification(db,a.id,input(bad),owner));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM historical_pdf_identifications').get().n,0);
    const long=recordHistoricalPdfIdentification(db,a.id,
      input({invoice_number:'INVOICE-2026-2027-12345'}),owner);
    assert.equal(long.length_over_16,true);
    assert.equal(long.legal_invoice_number_validated,false);
    const withSpaces=recordHistoricalPdfIdentification(db,a.id,
      input({invoice_number:'INV 123/26'}),owner);
    assert.equal(withSpaces.possible_unpermitted_characters,true);
  }finally{db.close();}
});

test('identification survives exact SQLite backup/restore without replacing the archived PDF',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'fortledger-pdf-metadata-'));
  const original=path.join(dir,'ledger.sqlite'),recovery=path.join(dir,'restored.sqlite');
  let db=null,reopened=null;
  try{
    db=openDatabase(original);
    const pdfOriginal=source(db,'Recover');
    const candidate=recordHistoricalPdfIdentification(db,pdfOriginal.id,input(),owner);
    await db.backup(recovery);db.close();db=null;
    reopened=openDatabase(recovery);
    assert.equal(historicalPdfIdentificationHistory(reopened,pdfOriginal.id).latest.id,candidate.id);
    assert.deepEqual(reopened.prepare('SELECT pdf_bytes FROM external_invoice_originals WHERE id=?').get(pdfOriginal.id).pdf_bytes,pdf('Recover'));
    assert.equal(reopened.pragma('integrity_check',{simple:true}),'ok');
  }finally{db?.close();reopened?.close();rmSync(dir,{force:true,recursive:true});}
});

test('owner-only HTTP identification and replay: denied manager and cashier, safe no-op GET',async()=>{
  assert.equal(requiredPermission('GET','/external-invoice-originals/12/identifications'),'external.documents.read');
  assert.equal(requiredPermission('POST','/external-invoice-originals/12/identifications'),'external.documents.import');
  assert.equal(requiredPermission('GET','/external-invoice-originals/identifications/request/'+randomUUID()),'external.documents.read');
  assert.equal(requiredPermission('DELETE','/external-invoice-originals/12/identifications'),null);
  assert.equal(may('manager','external.documents.import'),false);
  const db=openDatabase(':memory:');
  const archived=source(db,'HTTP');
  createStaff(db,{username:'pdf-manager',display_name:'PDF Manager',role:'manager',
    password:'synthetic-manager-pdf-password'});
  createStaff(db,{username:'pdf-cashier',display_name:'PDF Cashier',role:'cashier',
    password:'synthetic-cashier-pdf-password'});
  const app=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-pdf-password')});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const req=async(url,{cookie='',method='GET',body}={})=>{
    const res=await fetch(base+url,{method,
      headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
      body:body===undefined?undefined:JSON.stringify(body)});
    let data;try{data=await res.json();}catch{}
    return {status:res.status,data,cookie:res.headers.get('set-cookie')?.split(';')[0]};
  };
  try{
    const ownerCookie=(await req('/api/auth/login',{method:'POST',body:{
      username:'owner',password:'synthetic-owner-pdf-password'}})).cookie;
    const managerCookie=(await req('/api/auth/login',{method:'POST',body:{
      username:'pdf-manager',password:'synthetic-manager-pdf-password'}})).cookie;
    const cashierCookie=(await req('/api/auth/login',{method:'POST',body:{
      username:'pdf-cashier',password:'synthetic-cashier-pdf-password'}})).cookie;
    assert.ok(ownerCookie&&managerCookie&&cashierCookie);
    const endpoint='/api/external-invoice-originals/'+archived.id+'/identifications';
    const proposed=input();
    assert.equal((await req(endpoint,{method:'POST',body:proposed})).status,401);
    assert.equal((await req(endpoint,{method:'POST',body:proposed,cookie:managerCookie})).status,403);
    assert.equal((await req(endpoint,{method:'POST',body:proposed,cookie:cashierCookie})).status,403);
    assert.equal((await req(endpoint,{cookie:managerCookie})).status,403);
    const saved=await req(endpoint,{method:'POST',body:proposed,cookie:ownerCookie});
    assert.equal(saved.status,201);
    const retry=await req(endpoint,{method:'POST',body:proposed,cookie:ownerCookie});
    assert.equal(retry.status,200);
    assert.equal(retry.data.id,saved.data.id);
    const status=await req('/api/external-invoice-originals/identifications/request/'+proposed.request_id,{cookie:ownerCookie});
    assert.equal(status.data.recorded,true);
    assert.equal(status.data.entry.id,saved.data.id);
    const list=await req('/api/external-invoice-originals',{cookie:ownerCookie});
    assert.equal(list.data.items[0].identification.latest.reported_invoice_number,'invoice-123');
    assert.equal((await req('/api/external-invoice-originals',{cookie:managerCookie})).status,403);
    assert.equal((await req('/api/documents/register?kind=historical_original&q=invoice-123',
      {cookie:ownerCookie})).data.total,1);
    assert.equal((await req('/api/documents/register?kind=historical_original&q=invoice-123',
      {cookie:managerCookie})).data.total,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM historical_pdf_identifications').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n,0);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
