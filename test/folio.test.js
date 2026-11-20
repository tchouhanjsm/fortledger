import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {importMenuCsv,listMenu,createRestaurantBill} from '../src/restaurant.js';
import {getGuestFolio,settleRoomBill,settleCombined} from '../src/folio.js';

test('combined hotel and restaurant room charge settlement is atomic and idempotent',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,150,0\n');
    const id=Number(db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status)
      VALUES('Synthetic','2026-12-01','2026-12-02',2,'Unassigned',450000,'checked_in')`).run().lastInsertRowid);
    db.prepare('INSERT INTO payments(booking_id,amount_paise) VALUES(?,?)').run(id,450000);
    const tea=listMenu(db)[0];
    const food=createRestaurantBill(db,{payment_method:'room',booking_id:id,items:[{menu_item_id:tea.id,quantity:2}]});
    const before=getGuestFolio(db,id);
    assert.equal(before.accommodation.due_paise,450000);
    assert.equal(before.restaurant_due_paise,30000);
    assert.equal(before.combined_due_paise,480000);
    const combined=settleCombined(db,id,'upi');
    assert.equal(combined.total_paid_paise,480000);
    assert.equal(combined.restaurant_bills_settled,1);
    assert.equal(getGuestFolio(db,id).combined_due_paise,0);
    assert.equal(db.prepare('SELECT SUM(amount_paise) AS paid FROM payments WHERE booking_id=?').get(id).paid,900000);
    assert.equal(db.prepare('SELECT count(*) AS n FROM restaurant_settlements').get().n,1);
    assert.throws(()=>settleRoomBill(db,id,food.id,'cash'),/already settled/);
    assert.throws(()=>settleCombined(db,id,'upi'),/No outstanding/);
  }finally{db.close();}
});
test('individual food settlement reduces combined balance without modifying accommodation payment',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,100,0');
    const bookingId=Number(db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status)
      VALUES('Synthetic','2026-12-01','2026-12-02',1,'Unassigned',450000,'checked_in')`).run().lastInsertRowid);
    const itemId=listMenu(db)[0].id;
    const bill=createRestaurantBill(db,{payment_method:'room',booking_id:bookingId,items:[{menu_item_id:itemId,quantity:1}]});
    settleRoomBill(db,bookingId,bill.id,'card');
    assert.equal(getGuestFolio(db,bookingId).combined_due_paise,450000);
    assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get().n,0);
    assert.equal(settleCombined(db,bookingId,'cash').restaurant_bills_settled,0);
    assert.equal(getGuestFolio(db,bookingId).combined_due_paise,0);
  }finally{db.close();}
});
