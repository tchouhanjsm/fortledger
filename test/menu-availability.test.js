import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {may,requiredPermission} from '../src/access.js';
import {auditEvents} from '../src/financial-audit.js';
import {importMenuCsv,listMenu,listMenuForManagement,setMenuItemAvailability,createRestaurantBill} from '../src/restaurant.js';

const sample='name,category,price,tax_rate\nMasala Chai,Drinks,120,5';
const manager={id:4,username:'managerqa',role:'manager'};
test('availability is manager-only, optimistic, audited, and preserves historic bills',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,sample);
    const original=listMenu(db)[0],id=original.id;
    const billInput={request_id:randomUUID(),payment_method:'cash',
      items:[{menu_item_id:id,quantity:2,unit_price_paise:original.price_paise,tax_rate:original.tax_rate}]};
    const saved=createRestaurantBill(db,billInput,null,{requireReviewedPrices:true});
    assert.equal(saved.total_paise,24000);
    assert.throws(()=>setMenuItemAvailability(db,id,{active:false,expected_active:true},
      {id:6,username:'cashierqa',role:'cashier'}),/Only owner or manager/);
    assert.equal(setMenuItemAvailability(db,id,{active:false,expected_active:true},manager).active,0);
    assert.equal(listMenu(db).length,0);
    const all=listMenuForManagement(db);
    assert.equal(all.length,1);assert.equal(all[0].id,id);assert.equal(all[0].active,0);
    assert.throws(()=>setMenuItemAvailability(db,id,{active:true,expected_active:true},manager),
      /changed since review/);
    assert.throws(()=>setMenuItemAvailability(db,id,{active:true,expected_active:0},manager),
      /must be explicit/);
    assert.throws(()=>createRestaurantBill(db,{...billInput,request_id:randomUUID()},null,
      {requireReviewedPrices:true}),/not found or unavailable/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bills').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bill_requests').get().n,1);
    const replay=createRestaurantBill(db,billInput,null,{requireReviewedPrices:true});
    assert.equal(replay.already_recorded,true);
    assert.equal(replay.id,saved.id);
    const logs=auditEvents(db,{entityType:'menu_item',entityId:id});
    assert.equal(logs.length,1);assert.equal(logs[0].action,'menu_item.disabled');
    assert.equal(logs[0].actor_username,'managerqa');
    const restored=setMenuItemAvailability(db,id,{active:true,expected_active:false},manager);
    assert.equal(restored.id,id);assert.equal(restored.active,1);
    assert.equal(listMenu(db).length,1);
    assert.equal(listMenu(db)[0].price_paise,original.price_paise);
    const events=auditEvents(db,{entityType:'menu_item',entityId:id});
    assert.deepEqual(events.map(e=>e.action),['menu_item.enabled','menu_item.disabled']);
    const past=db.prepare('SELECT items_snapshot,total_paise FROM restaurant_bills WHERE id=?').get(saved.id);
    assert.equal(past.total_paise,24000);
    assert.equal(JSON.parse(past.items_snapshot)[0].unit_price_paise,12000);
  }finally{db.close();}
});

test('only manager and owner can read inactive menu and change availability over HTTP',async()=>{
  assert.equal(may('cashier','menu.manage'),false);
  assert.equal(requiredPermission('GET','/restaurant/menu/all'),'menu.manage');
  assert.equal(requiredPermission('PATCH','/restaurant/menu/1/availability'),'menu.manage');
  assert.equal(requiredPermission('GET','/restaurant/menu'),'restaurant.read');
  assert.equal(requiredPermission('POST','/restaurant/bills'),'restaurant.pos');
  const db=openDatabase(':memory:');
  importMenuCsv(db,sample);
  createStaff(db,{username:'cashierqa',display_name:'Cashier QA',role:'cashier',
    password:'a-synthetic-long-cashier-password'});
  createStaff(db,{username:'managerqa',display_name:'Manager QA',role:'manager',
    password:'a-synthetic-long-manager-password'});
  const server=createApp(db,{authRecord:createPasswordRecord('a-synthetic-long-owner-password')}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const login=async(username,password)=>{
    const res=await fetch(base+'/api/auth/login',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    assert.equal(res.status,200);return res.headers.get('set-cookie').split(';')[0];
  };
  const request=async(cookie,method,path,payload)=>{
    const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie},
      ...(payload?{body:JSON.stringify(payload)}:{})});
    return {status:res.status,data:await res.json()};
  };
  try{
    const cashier=await login('cashierqa','a-synthetic-long-cashier-password');
    const managerCookie=await login('managerqa','a-synthetic-long-manager-password');
    const id=listMenu(db)[0].id,path='/api/restaurant/menu/'+id+'/availability';
    assert.equal((await request(cashier,'GET','/api/restaurant/menu/all')).status,403);
    assert.equal((await request(cashier,'PATCH',path,{active:false,expected_active:true})).status,403);
    const initial=await request(managerCookie,'GET','/api/restaurant/menu/all');
    assert.equal(initial.status,200);assert.equal(initial.data.length,1);
    assert.equal((await request(managerCookie,'PATCH',path,{active:false,expected_active:true})).status,200);
    assert.equal((await request(managerCookie,'PATCH',path,{active:true,expected_active:true})).status,409);
    const hidden=await request(cashier,'GET','/api/restaurant/menu');
    assert.equal(hidden.status,200);assert.equal(hidden.data.length,0);
    const inactive=await request(managerCookie,'GET','/api/restaurant/menu/all');
    assert.equal(inactive.data[0].active,0);
    assert.equal((await request(managerCookie,'PATCH',path,{active:true,expected_active:false})).status,200);
    const active=await request(cashier,'GET','/api/restaurant/menu');
    assert.equal(active.data.length,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM operation_audit WHERE entity_type=?').get('menu_item').n,2);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});

test('availability controls stay manager-only in the existing calm restaurant workspace',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/id="menu-availability-section"/);
  assert.match(html,/id="menu-availability-message" role="status" aria-live="polite"/);
  assert.match(app,/if\(!can\('menu\.manage'\)\)return/);
  assert.match(app,/expected_active:wasActive/);
  assert.match(app,/renderMenuAvailability\(item\.id\)/);
});
