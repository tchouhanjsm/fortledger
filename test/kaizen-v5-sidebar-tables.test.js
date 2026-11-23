import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {importMenuCsv,listMenu,createRestaurantBill,listRestaurantBills,updateMenuItemPrice} from '../src/restaurant.js';
import {createRestaurantTable,changeRestaurantTable,listRestaurantTables} from '../src/restaurant-tables.js';
import {renderRestaurantReceipt} from '../src/restaurant-receipt.js';
import {buildReceipt} from '../src/printer.js';
import {auditEvents} from '../src/financial-audit.js';
import {requiredPermission} from '../src/access.js';

const owner={id:0,username:'owner',role:'owner'},manager={id:4,username:'manager',role:'manager'};
test('schema v13 adds optional physical table labels and disabled-by-default PIN policy',()=>{
  const db=openDatabase(':memory:');
  try{
    assert.equal(db.pragma('user_version',{simple:true}),13);
    assert.deepEqual(listRestaurantTables(db),[]);
    assert.equal(db.prepare('SELECT enabled FROM staff_pin_policy WHERE id=1').get().enabled,0);
    assert.equal(db.pragma('foreign_key_check').length,0);
  }finally{db.close();}
});
test('table names are opt-in, audited and immutable on saved restaurant receipts and retry',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,105,5');
    const item=listMenu(db)[0];
    assert.throws(()=>createRestaurantTable(db,{label:'T1'},{id:5,username:'cashier',role:'cashier'}),/Only owner or manager/);
    const table=createRestaurantTable(db,{label:'Courtyard 1'},manager);
    assert.equal(table.label,'Courtyard 1');
    assert.throws(()=>createRestaurantTable(db,{label:'courtyard 1'},owner),/UNIQUE/);
    assert.throws(()=>createRestaurantTable(db,{label:'<script>'},owner),/Table name/);
    const input={payment_method:'cash',table_id:table.id,request_id:randomUUID(),
      items:[{menu_item_id:item.id,quantity:2,unit_price_paise:item.price_paise,tax_rate:item.tax_rate}]};
    const bill=createRestaurantBill(db,input,owner,{requireReviewedPrices:true});
    assert.equal(bill.table_label,'Courtyard 1');
    assert.equal(createRestaurantBill(db,input,owner,{requireReviewedPrices:true}).already_recorded,true);
    assert.throws(()=>createRestaurantBill(db,{...input,table_id:null},owner,{requireReviewedPrices:true}),/different details/);
    const past=listRestaurantBills(db)[0];
    assert.equal(past.table_label,'Courtyard 1');
    assert.match(renderRestaurantReceipt(db,bill.id),/Table: Courtyard 1/);
    assert.match(buildReceipt({...past,items_snapshot:JSON.stringify(past.items)}).toString(),/Table: Courtyard 1/);
    assert.throws(()=>changeRestaurantTable(db,table.id,{active:false,expected_active:false},manager),/changed since review/);
    assert.equal(changeRestaurantTable(db,table.id,{active:false,expected_active:true},manager).active,0);
    assert.deepEqual(listRestaurantTables(db),[]);
    assert.equal(listRestaurantBills(db)[0].table_label,'Courtyard 1');
    assert.throws(()=>createRestaurantBill(db,{...input,request_id:randomUUID()},owner,{requireReviewedPrices:true}),
      /Dining table is no longer available/);
    const walkin=createRestaurantBill(db,{payment_method:'cash',items:[{menu_item_id:item.id,quantity:1}]});
    assert.equal(listRestaurantBills(db).find(b=>b.id===walkin.id).table_label,null);
    assert.equal(db.pragma('foreign_key_check').length,0);
    assert.deepEqual(auditEvents(db,{entityType:'restaurant_table',entityId:table.id}).map(x=>x.action),
      ['restaurant_table.disabled','restaurant_table.created']);
  }finally{db.close();}
});
test('legacy v12 table-free request fingerprint stays unchanged for safe retries after migration',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,80,5');
    const item=listMenu(db)[0],request_id=randomUUID();
    const items=[{menu_item_id:item.id,quantity:1,unit_price_paise:item.price_paise,tax_rate:item.tax_rate}];
    const original=JSON.stringify({
      payment_method:'cash',booking_id:null,manual_room:'',manual_guest:'',items
    });
    const priorHash=createHash('sha256').update(original).digest('hex');
    const bill=createRestaurantBill(db,{request_id,payment_method:'cash',items},owner,{requireReviewedPrices:true});
    const recorded=db.prepare('SELECT fingerprint FROM restaurant_bill_requests WHERE request_id=?').get(request_id);
    assert.equal(recorded.fingerprint,priorHash,
      'An optional empty table must not invalidate old pending request IDs');
    const retry=createRestaurantBill(db,{request_id,payment_method:'cash',items},owner,{requireReviewedPrices:true});
    assert.equal(retry.already_recorded,true);
    assert.equal(retry.id,bill.id);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bills').get().n,1);
  }finally{db.close();}
});
test('manager price and GST edit enforces exact prior state and preserves saved bills',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,'name,category,price,tax_rate\nMasala Chai,Drinks,100,5');
    const item=listMenu(db)[0];
    const bill=createRestaurantBill(db,{payment_method:'cash',
      items:[{menu_item_id:item.id,quantity:2}]});
    const updated={price_paise:12500,tax_rate:12,expected_price_paise:10000,expected_tax_rate:5,
      reason:'Reviewed new printed menu price'};
    assert.throws(()=>updateMenuItemPrice(db,item.id,updated,{id:6,username:'cashier',role:'cashier'}),/Only owner or manager/);
    assert.equal(updateMenuItemPrice(db,item.id,updated,manager).price_paise,12500);
    assert.throws(()=>updateMenuItemPrice(db,item.id,updated,manager),/changed since review/);
    assert.equal(listRestaurantBills(db)[0].total_paise,20000);
    assert.equal(listRestaurantBills(db)[0].items[0].unit_price_paise,10000);
    assert.match(renderRestaurantReceipt(db,bill.id),/₹100.00/);
    assert.equal(auditEvents(db,{entityType:'menu_item',entityId:item.id})[0].action,
      'menu_item.price_tax_updated');
    assert.throws(()=>updateMenuItemPrice(db,item.id,{...updated,expected_price_paise:12500,expected_tax_rate:12,reason:'short'},manager),/reason/);
  }finally{db.close();}
});
test('server enforces RBAC on table and price endpoints, preserving legacy draft bills',async()=>{
  assert.equal(requiredPermission('POST','/restaurant/tables'),'menu.manage');
  assert.equal(requiredPermission('GET','/restaurant/tables'),'restaurant.read');
  assert.equal(requiredPermission('PATCH','/restaurant/tables/1/visibility'),'menu.manage');
  assert.equal(requiredPermission('PATCH','/restaurant/menu/1/price'),'menu.manage');
  const db=openDatabase(':memory:');
  const ownerPassword='synthetic-v5-owner-password-long';
  createStaff(db,{username:'managerqa',display_name:'QA Manager',role:'manager',password:'synthetic-manager-password-long'});
  createStaff(db,{username:'cashierqa',display_name:'QA Cashier',role:'cashier',password:'synthetic-cashier-password-long'});
  importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,100,5');
  const app=createApp(db,{authRecord:createPasswordRecord(ownerPassword)});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  const request=async(path,{method='GET',body,cookie}={})=>{
    const r=await fetch(base+path,{method,
      headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
      body:body===undefined?undefined:JSON.stringify(body)});
    const text=await r.text();
    return {status:r.status,data:JSON.parse(text),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  };
  try{
    const o=await request('/api/auth/login',{method:'POST',body:{password:ownerPassword}});
    const m=await request('/api/auth/login',{method:'POST',body:{username:'managerqa',password:'synthetic-manager-password-long'}});
    const c=await request('/api/auth/login',{method:'POST',body:{username:'cashierqa',password:'synthetic-cashier-password-long'}});
    assert.equal((await request('/api/restaurant/tables',{cookie:c.cookie})).status,200);
    assert.equal((await request('/api/restaurant/tables',{method:'POST',body:{label:'Rooftop 1'},cookie:c.cookie})).status,403);
    const created=await request('/api/restaurant/tables',{method:'POST',body:{label:'Rooftop 1'},cookie:m.cookie});
    assert.equal(created.status,201);
    assert.equal((await request('/api/restaurant/tables/all',{cookie:c.cookie})).status,403);
    const id=listMenu(db)[0].id;
    assert.equal((await request('/api/restaurant/menu/'+id+'/price',{method:'PATCH',cookie:c.cookie,body:{
      price_paise:15000,tax_rate:5,expected_price_paise:10000,expected_tax_rate:5,reason:'Reviewed menu change'
    }})).status,403);
    const amended=await request('/api/restaurant/menu/'+id+'/price',{method:'PATCH',cookie:m.cookie,body:{
      price_paise:15000,tax_rate:5,expected_price_paise:10000,expected_tax_rate:5,reason:'Reviewed menu change'
    }});
    assert.equal(amended.status,200);
    const stale=await request('/api/restaurant/menu/'+id+'/price',{method:'PATCH',cookie:o.cookie,body:{
      price_paise:15500,tax_rate:5,expected_price_paise:10000,expected_tax_rate:5,reason:'Second reviewed change'
    }});
    assert.equal(stale.status,409);
    assert.equal((await request('/api/restaurant/tables/'+created.data.id+'/visibility',{method:'PATCH',
      body:{active:false,expected_active:true},cookie:m.cookie})).status,200);
  }finally{await new Promise(r=>server.close(r));db.close();}
});
test('sidebar and PIN interfaces preserve password fallback and hidden owner controls',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const login=readFileSync(new URL('../public/login.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../public/heritage-sky.css',import.meta.url),'utf8');
  assert.match(html,/id="sidebar-toggle"/);
  assert.match(html,/class="nav-label"/);
  assert.match(html,/id="restaurant-table-management"/);
  assert.match(html,/id="restaurant-table"/);
  assert.match(html,/id="menu-price-dialog"/);
  assert.match(html,/id="profile-quick-pin"/);
  assert.match(html,/id="owner-staff-pin"/);
  assert.match(login,/id="login-pin-toggle"/);
  assert.match(login,/name="password"/);
  assert.match(login,/name="pin"/);
  assert.match(app,/localStorage\.setItem\('fortledger\.sidebar\.compact'/);
  assert.match(css,/sidebar\.is-collapsed/);
});
