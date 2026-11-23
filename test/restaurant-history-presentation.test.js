import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../src/database.js';
import {createRestaurantBill,importMenuCsv,listRestaurantBills,listMenu} from '../src/restaurant.js';
import {settleRoomBill} from '../src/folio.js';

test('saved restaurant bill listing shows real settlement state without altering immutable item snapshots',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,'name,category,price,tax_rate\nMasala Chai,Drinks,80,5\nCoffee,Drinks,120,5');
    const items=listMenu(db),tea=items.find(x=>x.name==='Masala Chai'),coffee=items.find(x=>x.name==='Coffee');
    const id=Number(db.prepare(`INSERT INTO bookings
      (guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status)
      VALUES('History Synthetic Guest','2027-09-01','2027-09-02',1,'Unassigned',450000,'checked_in')`)
      .run().lastInsertRowid);
    const cash=createRestaurantBill(db,{request_id:randomUUID(),payment_method:'cash',
      items:[{menu_item_id:tea.id,quantity:1}]});
    const linked=createRestaurantBill(db,{request_id:randomUUID(),payment_method:'room',booking_id:id,
      items:[{menu_item_id:coffee.id,quantity:2}]});
    const unlinked=createRestaurantBill(db,{request_id:randomUUID(),payment_method:'room',
      manual_guest:'Awaiting verification',manual_room:'Unconfirmed',
      items:[{menu_item_id:tea.id,quantity:2}]});
    const before=db.prepare('SELECT items_snapshot FROM restaurant_bills WHERE id=?').get(linked.id).items_snapshot;
    let rows=listRestaurantBills(db);
    assert.equal(rows.length,3);
    assert.equal(rows.find(x=>x.id===cash.id).settlement_method,null);
    assert.equal(rows.find(x=>x.id===linked.id).settlement_method,null);
    assert.equal(rows.find(x=>x.id===unlinked.id).booking_id,null);
    assert.equal(rows.find(x=>x.id===linked.id).items[0].quantity,2);
    const paid=settleRoomBill(db,id,linked.id,'upi',null,{request_id:randomUUID()});
    assert.equal(paid.settled_paise,24000);
    rows=listRestaurantBills(db);
    const updated=rows.find(x=>x.id===linked.id);
    assert.equal(updated.settlement_method,'upi');
    assert.match(updated.settled_at,/^\d{4}-\d{2}-\d{2} /);
    assert.equal(updated.total_paise,24000);
    assert.equal(db.prepare('SELECT items_snapshot FROM restaurant_bills WHERE id=?').get(linked.id).items_snapshot,before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,3);
  }finally{db.close();}
});

test('restaurant overview and filtered history are read-only, accessible and aligned with real settlement state',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/id="restaurant-overview"/);
  assert.match(html,/id="restaurant-history-filters"/);
  for(const filter of ['all','paid','unpaid','unmatched'])
    assert.ok(html.includes('data-bill-filter="'+filter+'"'));
  assert.match(app,/function restaurantBillStatus\(/);
  assert.match(app,/bill\.settlement_method/);
  assert.match(app,/settled_at/);
  assert.match(app,/restaurant-history-details/);
  assert.match(app,/restaurant-history-items/);
  assert.match(app,/if\\(can\\('restaurant\\.pos'\\)\\&\\&isRestaurantCashier\\(\\)\\)/);
  assert.match(app,/Check printer status/);
  assert.match(app,/physical paper NOT verified/);
  const cashierPrintBlock=app.indexOf("if(can('restaurant.pos')&&isRestaurantCashier())");
  assert.ok(cashierPrintBlock>=0&&app.indexOf("const lan=label('button','LAN Print'",cashierPrintBlock)>cashierPrintBlock,
    'Manager must never see a cashier-only LAN Print button');
  assert.match(app,/restaurant-history-filters/);
  assert.match(app,/restaurantBillFilter=/);
  assert.match(app,/restaurantBillTime\(/);
  assert.match(app,/hotelDateAt\(/);
  assert.equal(app.slice(app.indexOf('function renderRestaurantHistory'),app.indexOf("$('#restaurant-history-search').oninput")).includes("api('/api/restaurant/bills')"),false);
  assert.ok(html.indexOf('id="restaurant-history-section"')<html.indexOf('id="menu-import-section"'),
    'Saved bills should be more prominent than seldom-used menu administration');
});
