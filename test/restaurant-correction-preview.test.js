import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {importMenuCsv,createRestaurantBill,listMenu} from '../src/restaurant.js';
import {previewRestaurantCorrection} from '../src/restaurant-correction-preview.js';
import {may,requiredPermission} from '../src/access.js';

function fixture(){
  const db=openDatabase(':memory:');
  importMenuCsv(db,'name,category,price,tax_rate\\nTea,Drinks,80,5\\nPaneer,Food,280,5'.replaceAll('\\n','\n'));
  const bill=createRestaurantBill(db,{request_id:randomUUID(),payment_method:'cash',
    items:[{menu_item_id:1,quantity:2},{menu_item_id:2,quantity:1}]});
  return {db,bill};
}

test('correction preview is strictly read only, uses saved tax, never reserves credit numbers',()=>{
  const {db,bill}=fixture();
  try{
    const rowsBefore=db.prepare('SELECT * FROM restaurant_bills').all();
    const sequenceBefore=db.prepare('SELECT last_number FROM invoice_sequence WHERE id=1').get();
    const review=previewRestaurantCorrection(db,bill.id,{reason:'Guest did not order this item',
      lines:[{line_index:0,quantity:1},{line_index:1,quantity:1}]});
    assert.equal(review.kind,'restaurant_correction_review');
    assert.equal(review.proposed_gross_paise,36000);
    assert.equal(review.proposed_tax_paise,review.lines[0].tax_paise+review.lines[1].tax_paise);
    assert.equal(review.lines[1].tax_paise,bill.items[1].tax_paise);
    assert.equal(review.gst_credit_note_issued,false);
    assert.equal(review.refund_sent,false);
    assert.equal(review.saved_bill_changed,false);
    assert.equal(review.remaining_gross_paise,8000);
    importMenuCsv(db,'name,category,price,tax_rate\\nTea,Drinks,200,18\\nPaneer,Food,300,18'.replaceAll('\\n','\n'));
    const repeated=previewRestaurantCorrection(db,bill.id,{reason:'Guest did not order this item',
      lines:[{line_index:0,quantity:1},{line_index:1,quantity:1}]});
    assert.equal(repeated.proposed_gross_paise,36000);
    assert.equal(repeated.proposed_tax_paise,review.proposed_tax_paise);
    assert.deepEqual(db.prepare('SELECT * FROM restaurant_bills').all(),rowsBefore);
    assert.deepEqual(db.prepare('SELECT last_number FROM invoice_sequence WHERE id=1').get(),sequenceBefore);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='tax_credit_notes'").get().n,0);
  }finally{db.close();}
});

test('correction preview rejects duplicates, over-credit, corrupted snapshots and missing reason',()=>{
  const {db,bill}=fixture();
  try{
    const reason='Wrong item charged on bill';
    assert.throws(()=>previewRestaurantCorrection(db,bill.id,{reason,lines:[
      {line_index:0,quantity:2},{line_index:0,quantity:1}]}),/exactly once/);
    assert.throws(()=>previewRestaurantCorrection(db,bill.id,{reason,lines:[
      {line_index:0,quantity:3}]}),/quantity exceeds/);
    assert.throws(()=>previewRestaurantCorrection(db,bill.id,{reason,lines:[
      {line_index:5,quantity:1}]}),/exactly once/);
    assert.throws(()=>previewRestaurantCorrection(db,bill.id,{reason:'short',
      lines:[{line_index:0,quantity:1}]}),/reason/);
    assert.throws(()=>previewRestaurantCorrection(db,999,{reason,
      lines:[{line_index:0,quantity:1}]}),/not found/);
    db.prepare('UPDATE restaurant_bills SET tax_paise=tax_paise+1 WHERE id=?').run(bill.id);
    assert.throws(()=>previewRestaurantCorrection(db,bill.id,{reason,
      lines:[{line_index:0,quantity:1}]}),/snapshot and ledger differ/);
  }finally{db.close();}
});

test('only owner and manager can view correction estimates on authenticated HTTP',async()=>{
  assert.equal(may('manager','restaurant.correction.preview'),true);
  assert.equal(may('cashier','restaurant.correction.preview'),false);
  assert.equal(requiredPermission('POST','/restaurant/bills/1/correction-preview'),
    'restaurant.correction.preview');
  assert.equal(requiredPermission('GET','/restaurant/bills/1/correction-preview'),null);
  const db=openDatabase(':memory:');
  const ownerPass='owner-test-correction-password-123';
  createStaff(db,{username:'manager-credit',display_name:'Manager',role:'manager',
    password:'manager-test-correction-password-123'});
  createStaff(db,{username:'cashier-credit',display_name:'Cashier',role:'cashier',
    password:'cashier-test-correction-password-123'});
  importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,80,5');
  const menu=listMenu(db)[0];
  const server=createApp(db,{authRecord:createPasswordRecord(ownerPass)}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  async function post(path,body,cookie=''){
    return fetch(base+path,{method:'POST',
      headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
      body:JSON.stringify(body)});
  }
  async function login(body){
    const r=await post('/api/auth/login',body);
    assert.equal(r.status,200);
    return r.headers.get('set-cookie').split(';')[0];
  }
  try{
    const owner=await login({password:ownerPass});
    const manager=await login({username:'manager-credit',password:'manager-test-correction-password-123'});
    const cashier=await login({username:'cashier-credit',password:'cashier-test-correction-password-123'});
    const billResp=await post('/api/restaurant/bills',{request_id:randomUUID(),
      payment_method:'upi',items:[{menu_item_id:menu.id,quantity:2,
        unit_price_paise:menu.price_paise,tax_rate:menu.tax_rate}]},cashier);
    assert.equal(billResp.status,201);
    const bill=await billResp.json();
    const previewPath='/api/restaurant/bills/'+bill.id+'/correction-preview';
    const body={reason:'Guest reported extra quantity',lines:[{line_index:0,quantity:1}]};
    assert.equal((await post(previewPath,body)).status,401);
    assert.equal((await post(previewPath,body,cashier)).status,403);
    const m=await post(previewPath,body,manager);assert.equal(m.status,200);
    const result=await m.json();
    assert.equal(result.proposed_gross_paise,8000);
    assert.equal(result.requires_payment_reconciliation,true);
    assert.equal((await post(previewPath,body,owner)).status,200);
    assert.equal(db.prepare('SELECT count(*) AS n FROM restaurant_bills').get().n,1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM operation_audit WHERE action LIKE ?').get('restaurant_bill.correction%').n,0);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
