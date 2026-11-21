import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../src/database.js';
import {importMenuCsv,listMenu,createRestaurantBill,linkManualRoomCharge,listRestaurantBills} from '../src/restaurant.js';
import {getGuestFolio} from '../src/folio.js';

test('unmatched manual restaurant charge cannot enter guest folio before verified linking',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,120,0');
    const item=listMenu(db)[0];
    const bill=createRestaurantBill(db,{payment_method:'room',manual_room:'Tent 2',manual_guest:'Synthetic A',
      items:[{menu_item_id:item.id,quantity:2}]});
    assert.equal(bill.booking_id,null);
    const stored=listRestaurantBills(db)[0];
    assert.equal(stored.manual_room,'Tent 2');
    assert.equal(stored.manual_guest,'Synthetic A');
    const bookingId=Number(db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status)
      VALUES('Synthetic A','2026-12-01','2026-12-02',1,'Unassigned',450000,'reserved')`).run().lastInsertRowid);
    assert.equal(getGuestFolio(db,bookingId).bills.length,0);
    assert.throws(()=>linkManualRoomCharge(db,bill.id,bookingId),/checked-in/);
    db.prepare("UPDATE bookings SET status='checked_in' WHERE id=?").run(bookingId);
    const linked=linkManualRoomCharge(db,bill.id,bookingId);
    assert.equal(linked.booking_id,bookingId);
    assert.equal(getGuestFolio(db,bookingId).bills.length,1);
    assert.equal(getGuestFolio(db,bookingId).restaurant_due_paise,24000);
    assert.throws(()=>linkManualRoomCharge(db,bill.id,bookingId),/already linked/);
    assert.equal(db.prepare('SELECT count(*) AS n FROM restaurant_bills').get().n,1);
    const original=db.prepare('SELECT manual_room,manual_guest FROM restaurant_bills WHERE id=?').get(bill.id);
    assert.deepEqual(original,{manual_room:'Tent 2',manual_guest:'Synthetic A'});
  }finally{db.close();}
});
test('manual room entry cannot silently create a room charge without identifying guest and room',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,120,0');
    const id=listMenu(db)[0].id;
    assert.throws(()=>createRestaurantBill(db,{payment_method:'room',manual_room:'Tent 2',
      items:[{menu_item_id:id,quantity:1}]}),/room identifier and guest name/);
  }finally{db.close();}
});
test('restaurant HTML includes every static DOM ID referenced in its application script',()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
  const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(match=>match[1]));
  const required=[...new Set([...js.matchAll(/\$\(['"]#([A-Za-z0-9_-]+)['"]\)/g)].map(match=>match[1]))];
  assert.ok(ids.has('restaurant'),'restaurant section must exist');
  assert.deepEqual(required.filter(id=>!ids.has(id)),[],'Missing DOM IDs break app.js initialization');
});
