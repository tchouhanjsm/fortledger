import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {importMenuCsv,createRestaurantBill} from '../src/restaurant.js';
import {createProforma} from '../src/invoices.js';
import {getGuestFolio} from '../src/folio.js';
import {checkoutInvoicePreflight} from '../src/checkout-invoice-preflight.js';
import {may,requiredPermission} from '../src/access.js';

function seed(db){
  const bookingId=Number(db.prepare(`INSERT INTO bookings
    (guest_name,company_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status)
    VALUES('Synthetic Guest','Sample Company','2027-01-11','2027-01-13',1,'Unassigned',500000,'checked_in')`).run().lastInsertRowid);
  importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,80,5');
  const bill=createRestaurantBill(db,{request_id:randomUUID(),payment_method:'room',
    booking_id:bookingId,items:[{menu_item_id:1,quantity:2}]});
  return {bookingId,bill};
}
test('checkout preflight is read only, reconciliation by source; external invoice PDF and GST remain blocked',()=>{
  const db=openDatabase(':memory:');
  try{
    const {bookingId,bill}=seed(db);
    const before=db.serialize(),folio=getGuestFolio(db,bookingId);
    const result=checkoutInvoicePreflight(db,bookingId);
    assert.equal(result.billing_recipient.type_candidate,'company');
    assert.equal(result.billing_recipient.confirmed,false);
    assert.equal(result.accommodation.current_charge_paise,1000000);
    assert.equal(result.totals.restaurant_room_charges_paise,16000);
    assert.equal(result.totals.charges_paise,1016000);
    assert.equal(result.totals.due_paise,1016000);
    assert.equal(result.restaurant_room_charges[0].bill_id,bill.id);
    assert.equal(result.restaurant_room_charges[0].payment_state,'room_receivable');
    assert.deepEqual(result.blockers.map(x=>x.code).filter(x=>x.includes('external')),
      ['external_invoice_history_unreconciled']);
    assert.equal(result.historic_pdf_archive.last_confirmed_number,null);
    assert.equal(result.gst.legal_invoice_enabled,false);
    assert.equal(result.number_reserved,false);
    assert.equal(result.pdf_issued,false);
    assert.equal(result.financial_entries_written,false);
    assert.deepEqual(getGuestFolio(db,bookingId),folio);
    assert.deepEqual(db.serialize(),before,'Even a preflight must not write to the database');
    const proforma=createProforma(db,bookingId,{});
    const next=checkoutInvoicePreflight(db,bookingId);
    assert.equal(next.original_proforma.number,proforma.number);
    assert.equal(next.original_proforma.original_contract_matches,true);
    assert.equal(next.warnings.some(x=>x.code==='proforma_missing'),false);
    db.prepare('UPDATE bookings SET nightly_rate_paise=550000 WHERE id=?').run(bookingId);
    const mismatch=checkoutInvoicePreflight(db,bookingId);
    assert.equal(mismatch.blockers.some(x=>x.code==='proforma_contract_mismatch'),true);
    assert.equal(mismatch.original_proforma.original_contract_matches,false);
  }finally{db.close();}
});

test('accommodation overpayment is not misapplied to unsettled food receivable',()=>{
  const db=openDatabase(':memory:');
  try{
    const {bookingId}=seed(db);
    db.prepare(`INSERT INTO payments(booking_id,amount_paise,method,note)
      VALUES(?,?,?,?)`).run(bookingId,1100000,'upi','Synthetic overpayment');
    const result=checkoutInvoicePreflight(db,bookingId);
    assert.equal(result.totals.operator_recorded_paise,1100000);
    assert.equal(result.accommodation.credit_paise,100000);
    assert.equal(result.totals.due_paise,16000);
    assert.equal(result.warnings.some(x=>x.code==='accommodation_overpaid'),true);
  }finally{db.close();}
});

test('preflight GET role-gated: front desk and manager yes, cashier forbidden; POST forbidden',async()=>{
  assert.equal(requiredPermission('GET','/bookings/15/checkout-invoice-preflight'),'invoices.read');
  assert.equal(requiredPermission('POST','/bookings/15/checkout-invoice-preflight'),null);
  assert.equal(may('frontdesk','invoices.read'),true);
  assert.equal(may('cashier','invoices.read'),false);
  const db=openDatabase(':memory:');
  const {bookingId}=seed(db);
  createStaff(db,{username:'synthetic-cashier-preflight',display_name:'Cashier',
    role:'cashier',password:'synthetic-cashier-password-2027'});
  createStaff(db,{username:'synthetic-frontdesk-preflight',display_name:'Front desk',
    role:'frontdesk',password:'synthetic-frontdesk-password-2027'});
  const server=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-password-2027')})
    .listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  async function req(url,method='GET',body,cookie=''){
    const response=await fetch(base+url,{method,
      headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
      body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json(),
      cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  try{
    const cashier=(await req('/api/auth/login','POST',{
      username:'synthetic-cashier-preflight',password:'synthetic-cashier-password-2027'})).cookie;
    const frontdesk=(await req('/api/auth/login','POST',{
      username:'synthetic-frontdesk-preflight',password:'synthetic-frontdesk-password-2027'})).cookie;
    const url='/api/bookings/'+bookingId+'/checkout-invoice-preflight';
    assert.equal((await req(url)).status,401);
    assert.equal((await req(url,'GET',undefined,cashier)).status,403);
    const p=await req(url,'GET',undefined,frontdesk);
    assert.equal(p.status,200);
    assert.equal(p.data.ready_for_legal_issuance,false);
    assert.equal((await req(url,'POST',{},frontdesk)).status,403);
    assert.equal((await req('/api/bookings/99999/checkout-invoice-preflight','GET',undefined,frontdesk)).status,400);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
