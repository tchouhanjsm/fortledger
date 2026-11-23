import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {accountantReadiness} from '../src/accountant-readiness.js';
import {importExternalInvoiceOriginal} from '../src/external-invoice-originals.js';
import {recordHistoricalPdfIdentification} from '../src/historical-pdf-identifications.js';
import {importMenuCsv,createRestaurantBill} from '../src/restaurant.js';
import {submitRestaurantCorrectionCase} from '../src/restaurant-correction-cases.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {requiredPermission} from '../src/access.js';

const owner={id:0,role:'owner',username:'owner'};
const manager={id:3,role:'manager',username:'manager'};
const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n2 0 obj\n<</Type /Pages /Count 0 /Kids []>>\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF\n');
function seed(db){
  const first=importExternalInvoiceOriginal(db,pdf,'Old-Original.pdf',owner);
  const second=importExternalInvoiceOriginal(db,Buffer.concat([pdf,Buffer.from('\n')]),
    'Other-Original.pdf',owner);
  for(const id of [first.id,second.id])recordHistoricalPdfIdentification(db,id,{
    request_id:randomUUID(),invoice_number:'invoice-123',issue_date:'2026-11-12',
    note:'Synthetic printed number verified by fixture inspection'
  },owner);
  importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,80,5');
  const bill=createRestaurantBill(db,{request_id:randomUUID(),payment_method:'cash',
    items:[{menu_item_id:1,quantity:1}]});
  submitRestaurantCorrectionCase(db,bill.id,{
    request_id:randomUUID(),reason:'Guest asked to remove one unwanted tea',
    lines:[{line_index:0,quantity:1}]
  },manager);
}
test('readiness links unresolved evidence and does not modify any financial/source record',()=>{
  const db=openDatabase(':memory:');
  try{
    seed(db);
    const before=db.serialize();
    const summary=accountantReadiness(db);
    assert.equal(summary.status,'review_only');
    assert.equal(summary.statutory_issuance_enabled,false);
    assert.equal(summary.financial_totals_included,false);
    assert.equal(summary.counts.possible_historical_collisions,2);
    assert.equal(summary.counts.restaurant_corrections_pending,1);
    assert.ok(summary.issues.some(x=>x.source==='restaurant_correction'));
    assert.ok(summary.issues.some(x=>x.source==='historical_original'&&
      x.code==='possible_historical_number_collision'));
    assert.ok(summary.issues.some(x=>x.code==='dated_tax_policy_unapproved'));
    assert.ok(summary.issues.every(x=>x.statutory_invoice_issued===false));
    assert.deepEqual(db.serialize(),before);
    assert.throws(()=>accountantReadiness(db,{limit:0}),/Invalid/);
  }finally{db.close();}
});
test('accountant readiness API stays owner-only and read-only on direct requests',async()=>{
  assert.equal(requiredPermission('GET','/accountant/readiness'),'external.documents.read');
  assert.equal(requiredPermission('POST','/accountant/readiness'),null);
  const db=openDatabase(':memory:');seed(db);
  createStaff(db,{username:'accountant-manager',display_name:'Manager',role:'manager',
    password:'synthetic-accountant-manager-pass'});
  const server=createApp(db,{authRecord:createPasswordRecord('synthetic-accountant-owner-pass')}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  async function req(url,{cookie,method='GET',body}={}){
    return fetch(base+url,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
  }
  async function login(username,password){
    const res=await req('/api/auth/login',{method:'POST',body:{username,password}});
    assert.equal(res.status,200);
    return res.headers.get('set-cookie').split(';')[0];
  }
  try{
    const owned=await login('owner','synthetic-accountant-owner-pass');
    const staff=await login('accountant-manager','synthetic-accountant-manager-pass');
    assert.equal((await req('/api/accountant/readiness')).status,401);
    assert.equal((await req('/api/accountant/readiness',{cookie:staff})).status,403);
    const res=await req('/api/accountant/readiness',{cookie:owned});
    assert.equal(res.status,200);
    assert.equal((await res.json()).counts.possible_historical_collisions,2);
    assert.equal((await req('/api/accountant/readiness',{cookie:owned,method:'POST',body:{}})).status,403);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_correction_cases').get().n,1);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
