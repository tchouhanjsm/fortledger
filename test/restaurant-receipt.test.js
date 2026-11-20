import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {importMenuCsv,listMenu,createRestaurantBill} from '../src/restaurant.js';
import {renderRestaurantReceipt} from '../src/restaurant-receipt.js';
import {settleRoomBill} from '../src/folio.js';

test('80mm restaurant receipt uses saved bill totals and escapes dangerous menu text',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,'name,category,price,tax_rate\n"<script>alert(1)</script>",Food,105,5\n');
    const item=listMenu(db)[0];
    const bill=createRestaurantBill(db,{payment_method:'cash',items:[{menu_item_id:item.id,quantity:2}]});
    const html=renderRestaurantReceipt(db,bill.id);
    assert.match(html,/80mm/);
    assert.match(html,/Not a tax invoice/);
    assert.match(html,/₹210\.00/);
    assert.match(html,/₹10\.00/);
    assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/);
    assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.equal(renderRestaurantReceipt(db,999),null);
  }finally{db.close();}
});
test('room charge receipt reports current settlement state',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,100,0');
    const booking=Number(db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status)
      VALUES ('Synthetic','2026-12-01','2026-12-02',1,'Unassigned',450000,'checked_in')`).run().lastInsertRowid);
    const item=listMenu(db)[0];
    const bill=createRestaurantBill(db,{payment_method:'room',booking_id:booking,items:[{menu_item_id:item.id,quantity:1}]});
    assert.match(renderRestaurantReceipt(db,bill.id),/awaiting settlement/);
    settleRoomBill(db,booking,bill.id,'card');
    assert.match(renderRestaurantReceipt(db,bill.id),/settled via card/);
  }finally{db.close();}
});
