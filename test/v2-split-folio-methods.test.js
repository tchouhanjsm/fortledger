import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {importMenuCsv,listMenu,createRestaurantBill} from '../src/restaurant.js';
import {settleCombined,getGuestFolio} from '../src/folio.js';
import {dailyCollections} from '../src/daily-collections.js';

function fixture(){
  const db=openDatabase(':memory:');
  importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,100,0');
  const bookingId=Number(db.prepare(`INSERT INTO bookings
    (guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status)
    VALUES('Bank Synthetic Guest','2027-01-02','2027-01-03',1,'Unassigned',450000,'checked_in')`)
    .run().lastInsertRowid);
  createRestaurantBill(db,{payment_method:'room',booking_id:bookingId,
    items:[{menu_item_id:listMenu(db)[0].id,quantity:2}]});
  return {db,bookingId};
}
test('accommodation bank and food UPI settle atomically with separated ledger methods',()=>{
  const {db,bookingId}=fixture();
  try{
    assert.throws(()=>settleCombined(db,bookingId,'upi',null,{
      accommodation_method:'bank',bank_reference:''}),/reference/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payments').get().n,0);
    const done=settleCombined(db,bookingId,'upi',null,{
      accommodation_method:'bank',bank_reference:'UTR-ABC-123456'});
    assert.equal(done.accommodation_method,'bank');
    assert.equal(done.method,'upi');
    assert.equal(done.accommodation_paid_paise,450000);
    assert.equal(done.restaurant_paid_paise,20000);
    const payment=db.prepare('SELECT method,note,amount_paise FROM payments').get();
    assert.equal(payment.method,'bank');
    assert.match(payment.note,/UTR-ABC-123456/);
    assert.equal(payment.amount_paise,450000);
    assert.deepEqual(db.prepare('SELECT method FROM restaurant_settlements').all().map(x=>x.method),['upi']);
    assert.equal(getGuestFolio(db,bookingId).combined_due_paise,0);
    assert.throws(()=>settleCombined(db,bookingId,'upi',null,{
      accommodation_method:'bank',bank_reference:'UTR-ABC-123456'}),/No outstanding/);
  }finally{db.close();}
});
test('HTTP combined settlement exposes split-method configuration but not bank restaurant settlement',async()=>{
  const {db,bookingId}=fixture(),server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try{
    const base='http://127.0.0.1:'+server.address().port;
    const post=async body=>{
      const res=await fetch(base+'/api/bookings/'+bookingId+'/folio/settle-combined',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      return {status:res.status,data:await res.json()};
    };
    const denied=await post({method:'bank',accommodation_method:'bank',bank_reference:'UTR-123456'});
    assert.equal(denied.status,400);
    const paid=await post({method:'card',accommodation_method:'bank',bank_reference:'UTR-123456'});
    assert.equal(paid.status,201);
    assert.equal(paid.data.accommodation_method,'bank');
    assert.equal(paid.data.method,'card');
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
