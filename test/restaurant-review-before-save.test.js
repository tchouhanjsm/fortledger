import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../src/database.js';
import {importMenuCsv,createRestaurantBill,listMenu} from '../src/restaurant.js';

test('restaurant review is a distinct unsaved stage; menu and item edits remain possible',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/id="review-restaurant-bill"/);
  assert.match(html,/id="restaurant-review"[^>]+hidden/);
  assert.match(html,/id="save-restaurant-bill" hidden/);
  assert.match(html,/id="restaurant-review-items"/);
  assert.match(html,/id="edit-restaurant-bill"/);
  assert.match(js,/function restaurantBillDraft\(/);
  assert.match(js,/function renderRestaurantReview\(/);
  assert.match(js,/renderRestaurantReview\(\)/);
  assert.match(js,/if\(!restaurantReviewOpen\)/);
  assert.match(js,/Remove '\+item\.name\+' from bill/);
  assert.match(js,/if\(pendingRestaurantBill\)return/);
  assert.match(js,/pendingRestaurantBill=body/);
  const recovery=readFileSync(new URL('../public/restaurant-save-recovery.js',import.meta.url),'utf8');
  assert.match(js,/reconcileRestaurantSaveFailure\(error,\(\)=>api\(/);
  assert.match(recovery,/retry only the original request/i);
  assert.match(js,/retry only the unchanged bill/i);
  assert.match(js,/Bill save response did not contain a valid receipt ID/);
});
test('server only records confirmed final bill; changes to an unsaved cart do not create historical ledger events',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,80,5\nCoffee,Drinks,120,5');
    const items=listMenu(db);
    const preview=[{menu_item_id:items[0].id,quantity:2},{menu_item_id:items[1].id,quantity:1}];
    preview.pop();
    preview[0].quantity=1;
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bills').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bill_requests').get().n,0);
    const saved=createRestaurantBill(db,{request_id:'reviewed-final-bill-001',payment_method:'cash',items:preview});
    assert.equal(saved.items.length,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bills').get().n,1);
    assert.equal(createRestaurantBill(db,{request_id:'reviewed-final-bill-001',payment_method:'cash',items:preview}).id,saved.id);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bill_requests').get().n,1);
  }finally{db.close();}
});
