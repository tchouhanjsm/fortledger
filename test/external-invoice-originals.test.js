import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {importExternalInvoiceOriginal,listExternalInvoiceOriginals,
  lookupExternalInvoiceOriginal,getExternalInvoiceOriginal} from '../src/external-invoice-originals.js';
import {requiredPermission,may} from '../src/access.js';
import {createHash} from 'node:crypto';

const owner={id:0,role:'owner',username:'owner'};
const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n2 0 obj\n<</Type /Pages /Count 0 /Kids []>>\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF\n');
test('external PDF import is immutable, stable-hash idempotent, separate from statutory series and verifiable',()=>{
 const db=openDatabase(':memory:');
 try{
  const before=db.prepare('SELECT COUNT(*) n FROM invoices').get().n;
  const row=importExternalInvoiceOriginal(db,pdf,encodeURIComponent('Invoice-123.pdf'),owner);
  assert.equal(row.already_recorded,false);
  assert.equal(row.invoice_number_verified,false);
  assert.equal(row.legal_issuance_performed,false);
  assert.equal(row.sha256,createHash('sha256').update(pdf).digest('hex'));
  assert.equal(row.original_filename,'Invoice-123.pdf');
  const duplicate=importExternalInvoiceOriginal(db,pdf,encodeURIComponent('different.pdf'),owner);
  assert.equal(duplicate.id,row.id);
  assert.equal(duplicate.original_filename,'Invoice-123.pdf');
  assert.equal(duplicate.already_recorded,true);
  assert.deepEqual(getExternalInvoiceOriginal(db,row.id).bytes,pdf);
  assert.equal(listExternalInvoiceOriginals(db,{q:'123'}).total,1);
  assert.equal(listExternalInvoiceOriginals(db,{q:'not matched'}).total,0);
  assert.equal(lookupExternalInvoiceOriginal(db,row.sha256).item.id,row.id);
  assert.equal(lookupExternalInvoiceOriginal(db,'f'.repeat(64)).recorded,false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,before);
  assert.equal(db.pragma('user_version',{simple:true}),13);
  assert.throws(()=>db.prepare("UPDATE external_invoice_originals SET original_filename='bad.pdf' WHERE id=?").run(row.id),/cannot be updated/);
  assert.throws(()=>db.prepare('DELETE FROM external_invoice_originals WHERE id=?').run(row.id),/cannot be deleted/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM operation_audit WHERE action='external_invoice_pdf.imported'").get().n,1);
 }finally{db.close();}
});

test('PDF archive is included in normal SQLite backup and restored exactly',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'fortledger-external-pdf-'));
 const live=path.join(dir,'hotel.sqlite'),backup=path.join(dir,'recovered.sqlite');
 let db=null,restored=null;
 try{
  db=openDatabase(live);
  const record=importExternalInvoiceOriginal(db,pdf,'historic.pdf',owner);
  await db.backup(backup);db.close();db=null;
  restored=openDatabase(backup);
  assert.deepEqual(getExternalInvoiceOriginal(restored,record.id).bytes,pdf);
  assert.equal(listExternalInvoiceOriginals(restored).total,1);
  assert.equal(restored.pragma('integrity_check',{simple:true}),'ok');
 }finally{restored?.close();db?.close();rmSync(dir,{recursive:true,force:true});}
});

test('archive rejects unsafe files, actor, filenames and search abuse',()=>{
 const db=openDatabase(':memory:');
 try{
  assert.throws(()=>importExternalInvoiceOriginal(db,pdf,'file.pdf',{...owner,role:'manager'}),/Only the owner/);
  assert.throws(()=>importExternalInvoiceOriginal(db,pdf,'..%2Fbad.pdf',owner),/safe original filename/);
  assert.throws(()=>importExternalInvoiceOriginal(db,pdf,'bad.txt',owner),/safe original filename/);
  assert.throws(()=>importExternalInvoiceOriginal(db,Buffer.from('not pdf'.repeat(30)),'file.pdf',owner),/recognizable PDF/);
  assert.throws(()=>importExternalInvoiceOriginal(db,Buffer.alloc(8*1024*1024+1),'file.pdf',owner),/8 MiB/);
  assert.throws(()=>listExternalInvoiceOriginals(db,{limit:100}),/Invalid original-document search/);
 }finally{db.close();}
});

test('authenticated API: only owner may search, import, download or check uncertain digest',async()=>{
 assert.equal(requiredPermission('GET','/external-invoice-originals'),'external.documents.read');
 assert.equal(requiredPermission('POST','/external-invoice-originals/import'),'external.documents.import');
 assert.equal(requiredPermission('GET','/external-invoice-originals/2/original'),'external.documents.read');
 assert.equal(requiredPermission('DELETE','/external-invoice-originals/2/original'),null);
 assert.equal(may('manager','external.documents.read'),false);
 const db=openDatabase(':memory:');
 const password='synthetic-external-owner-password-2027';
 createStaff(db,{username:'historical-manager',display_name:'Manager',role:'manager',
  password:'synthetic-manager-password-2027'});
 const server=createApp(db,{authRecord:createPasswordRecord(password)}).listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 async function req(url,{cookie,method='GET',headers={},body}={}){
  return fetch(base+url,{method,headers:{...(cookie?{Cookie:cookie}:{}),...headers},body});
 }
 try{
  const ownerLogin=await req('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})});
  const ownerCookie=ownerLogin.headers.get('set-cookie')?.split(';')[0];
  const managerLogin=await req('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'historical-manager',password:'synthetic-manager-password-2027'})});
  const managerCookie=managerLogin.headers.get('set-cookie')?.split(';')[0];
  assert.ok(ownerCookie);assert.ok(managerCookie);
  assert.equal((await req('/api/external-invoice-originals')).status,401);
  assert.equal((await req('/api/external-invoice-originals',{cookie:managerCookie})).status,403);
  assert.equal((await req('/api/external-invoice-originals/import',{method:'POST',cookie:managerCookie,headers:{'Content-Type':'application/pdf','X-FL-Original-Filename':'old.pdf'},body:pdf})).status,403);
  const options={method:'POST',cookie:ownerCookie,
   headers:{'Content-Type':'application/pdf','X-FL-Original-Filename':encodeURIComponent('Old online invoice.pdf')},body:pdf};
  const imported=await req('/api/external-invoice-originals/import',options);
  assert.equal(imported.status,201);
  const result=await imported.json();
  assert.equal((await req('/api/external-invoice-originals/import',options)).status,200);
  const list=await req('/api/external-invoice-originals?q=online',{cookie:ownerCookie});
  assert.equal((await list.json()).total,1);
  const digest=await req('/api/external-invoice-originals/by-digest/'+result.sha256,{cookie:ownerCookie});
  assert.equal((await digest.json()).recorded,true);
  const forbidden=await req('/api/external-invoice-originals/'+result.id+'/original',{cookie:managerCookie});
  assert.equal(forbidden.status,403);
  const got=await req('/api/external-invoice-originals/'+result.id+'/original',{cookie:ownerCookie});
  assert.equal(got.status,200);
  assert.match(got.headers.get('content-disposition'),/attachment/);
  assert.equal(got.headers.get('content-type').includes('application/pdf'),true);
  assert.deepEqual(Buffer.from(await got.arrayBuffer()),pdf);
  assert.notEqual((await req('/api/external-invoice-originals/'+result.id+'/original',{cookie:ownerCookie,method:'DELETE'})).status,200,
    'No endpoint accepts deletion of saved PDF originals');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM external_invoice_originals').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);
 }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
