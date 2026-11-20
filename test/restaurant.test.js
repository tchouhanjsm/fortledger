import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {importMenuCsv,listMenu,createRestaurantBill,listRestaurantBills} from '../src/restaurant.js';

test('CSV import handles quoted fields and remains transactional on validation failures',()=>{
  const db=openDatabase(':memory:');
  try{
    assert.deepEqual(importMenuCsv(db,'name,category,price,tax_rate\n"Tea, Masala",Drinks,120,5\nCoffee,Drinks,150,0\n'),{imported:2});
    assert.equal(listMenu(db)[1].name,'Tea, Masala');
    assert.throws(()=>importMenuCsv(db,'name,category,price,tax_rate\nValid,Drinks,100,5\nBroken,Drinks,-1,5\n'),/non-negative/);
    assert.equal(listMenu(db).length,2);
    assert.throws(()=>importMenuCsv(db,'name,category,price,tax_rate\nInvalid,Food,100,45'),/tax rate/);
  }finally{db.close();}
});
test('restaurant bill snapshots gross and tax; menu price edits never alter old bills',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,105,5\n');
    const item=listMenu(db)[0];
    const bill=createRestaurantBill(db,{payment_method:'cash',items:[{menu_item_id:item.id,quantity:2}]});
    assert.equal(bill.total_paise,21000);
    assert.equal(bill.tax_paise,1000);
    importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,150,5');
    assert.equal(listRestaurantBills(db)[0].items[0].unit_price_paise,10500);
    assert.equal(listRestaurantBills(db)[0].total_paise,21000);
    assert.throws(()=>createRestaurantBill(db,{payment_method:'cash',items:[{menu_item_id:item.id,quantity:0}]}),/quantity/);
  }finally{db.close();}
});
test('room charge requires a checked-in booking and remains separate from hotel payments',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,100,0');
    const id=listMenu(db)[0].id;
    const booking=Number(db.prepare("INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise) VALUES ('Synthetic','2026-12-01','2026-12-02',1,'Unassigned',450000)").run().lastInsertRowid);
    assert.throws(()=>createRestaurantBill(db,{payment_method:'room',booking_id:booking,items:[{menu_item_id:id,quantity:1}]}),/checked-in/);
    db.prepare("UPDATE bookings SET status='checked_in' WHERE id=?").run(booking);
    const bill=createRestaurantBill(db,{payment_method:'room',booking_id:booking,items:[{menu_item_id:id,quantity:1}]});
    assert.equal(bill.booking_id,booking);
    assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get().n,0);
  }finally{db.close();}
});
