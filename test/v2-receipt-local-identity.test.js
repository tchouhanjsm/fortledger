import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {buildReceipt,receiptLocalTime,printSavedBill} from '../src/printer.js';
import {renderRestaurantReceipt} from '../src/restaurant-receipt.js';
import {updateBusinessSettings} from '../src/business-settings.js';
import {importMenuCsv,listMenu,createRestaurantBill} from '../src/restaurant.js';

test('saved UTC timestamp displays unambiguous local hotel time, not device timezone',()=>{
  assert.equal(receiptLocalTime('2026-12-31 18:30:00'),'2027-01-01 00:00 IST');
  assert.equal(receiptLocalTime('2026-12-31 18:29:59'),'2026-12-31 23:59 IST');
  assert.throws(()=>receiptLocalTime('not a date'),/Invalid saved/);
});
test('ESC/POS and browser receipt use configured identity without altering original bill snapshot',async()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,100,5');
    const bill=createRestaurantBill(db,{payment_method:'cash',items:[{menu_item_id:listMenu(db)[0].id,quantity:1}]});
    const stored=db.prepare('SELECT * FROM restaurant_bills WHERE id=?').get(bill.id);
    updateBusinessSettings(db,{hotel_name:'Fort View Retreat'});
    const bytes=buildReceipt(stored,32,{hotel_name:'Fort View Retreat'}).toString('ascii');
    assert.match(bytes,/Fort View Retreat/);
    assert.match(bytes,/IST/);
    assert.match(bytes,/NOT A TAX INVOICE/);
    assert.doesNotMatch(bytes,/GARH JAISAL/);
    const browser=renderRestaurantReceipt(db,bill.id);
    assert.match(browser,/Fort View Retreat/);
    assert.match(browser,/IST/);
    assert.doesNotMatch(browser,/GARH JAISAL/);
    let paperBytes;
    await printSavedBill(db,bill.id,{host:'127.0.0.1',port:9100},{send:async payload=>{paperBytes=payload;}});
    assert.match(paperBytes.toString('ascii'),/Fort View Retreat/);
    assert.equal(db.prepare('SELECT items_snapshot FROM restaurant_bills WHERE id=?').get(bill.id).items_snapshot,stored.items_snapshot);
  }finally{db.close();}
});
