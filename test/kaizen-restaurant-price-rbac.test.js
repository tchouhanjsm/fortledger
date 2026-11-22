import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {importMenuCsv,listMenu} from '../src/restaurant.js';
import {may,requiredPermission} from '../src/access.js';

test('menu management is not inherited from permission to create restaurant bills',()=>{
  assert.equal(may('cashier','restaurant.write'),true);
  assert.equal(may('cashier','menu.manage'),false);
  assert.equal(may('frontdesk','menu.manage'),false);
  assert.equal(may('manager','menu.manage'),true);
  assert.equal(may('owner','menu.manage'),true);
  assert.equal(requiredPermission('POST','/restaurant/menu/preview'),'menu.manage');
  assert.equal(requiredPermission('POST','/restaurant/menu/import'),'menu.manage');
  assert.equal(requiredPermission('POST','/restaurant/bills'),'restaurant.write');
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(app,/\$\('#menu-import-section'\)\.hidden=!can\('menu\.manage'\)/);
  assert.match(app,/\$\('#restaurant-jump-menu'\)\.hidden=!can\('menu\.manage'\)/);
  assert.match(app,/function lockPendingRestaurantInputs\(locked\)/);
  assert.match(app,/unit_price_paise:item\.price_paise,tax_rate:item\.tax_rate/);
});
test('authenticated waiter bills only after reviewing exact current GST and menu price; retry is unchanged',async()=>{
  const db=openDatabase(':memory:');
  importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,100,5');
  createStaff(db,{username:'cashierqa',display_name:'Cashier QA',role:'cashier',
    password:'a-synthetic-long-cashier-password'});
  createStaff(db,{username:'managerqa',display_name:'Manager QA',role:'manager',
    password:'a-synthetic-long-manager-password'});
  const server=createApp(db,{authRecord:createPasswordRecord('a-synthetic-long-owner-password')}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const login=async(username,password)=>{
    const r=await fetch(base+'/api/auth/login',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];
  };
  const post=async(cookie,path,payload)=>{
    const res=await fetch(base+path,{method:'POST',headers:{
      'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(payload)});
    return {status:res.status,data:await res.json()};
  };
  try{
    const cashier=await login('cashierqa','a-synthetic-long-cashier-password');
    const manager=await login('managerqa','a-synthetic-long-manager-password');
    const makeCsv=price=>'name,category,price,tax_rate\nTea,Drinks,'+price+',5';
    assert.equal((await post(cashier,'/api/restaurant/menu/preview',{csv:makeCsv(120)})).status,403);
    assert.equal((await post(cashier,'/api/restaurant/menu/import',{csv:makeCsv(120)})).status,403);
    const menuRoute='/api/restaurant/menu',billRoute='/api/restaurant/bills';
    let item=listMenu(db)[0];
    const original={request_id:randomUUID(),payment_method:'cash',
      items:[{menu_item_id:item.id,quantity:2,unit_price_paise:item.price_paise,
        tax_rate:item.tax_rate}]};
    assert.equal((await post(cashier,billRoute,{...original,
      request_id:randomUUID(),items:[{menu_item_id:item.id,quantity:2}]})).status,400,
      'Authenticated cashiers must submit reviewed prices');
    const preview=await post(manager,menuRoute+'/preview',{csv:makeCsv(120)});
    assert.equal(preview.status,200);
    assert.equal((await post(manager,menuRoute+'/import',{
      csv:makeCsv(120),preview_token:preview.data.preview_token,confirm_import:true})).status,200);
    const stale=await post(cashier,billRoute,original);
    assert.equal(stale.status,409);
    assert.match(stale.data.error,/price or GST rate changed/i);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bills').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bill_requests').get().n,0);
    item=listMenu(db)[0];
    const finalBill={request_id:randomUUID(),payment_method:'upi',
      items:[{menu_item_id:item.id,quantity:2,unit_price_paise:item.price_paise,
        tax_rate:item.tax_rate}]};
    const saved=await post(cashier,billRoute,finalBill);
    assert.equal(saved.status,201);
    assert.equal(saved.data.total_paise,24000);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bills').get().n,1);
    const nextPreview=await post(manager,menuRoute+'/preview',{csv:makeCsv(140)});
    assert.equal(nextPreview.status,200);
    assert.equal((await post(manager,menuRoute+'/import',{
      csv:makeCsv(140),preview_token:nextPreview.data.preview_token,confirm_import:true})).status,200);
    const retry=await post(cashier,billRoute,finalBill);
    assert.equal(retry.status,200);
    assert.equal(retry.data.already_recorded,true);
    assert.equal(retry.data.id,saved.data.id);
    assert.equal(retry.data.total_paise,24000);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bills').get().n,1);
    const different=await post(cashier,billRoute,{...finalBill,
      items:[{...finalBill.items[0],unit_price_paise:14000}]});
    assert.equal(different.status,400);
    assert.match(different.data.error,/already used with different details/);
    const historical=db.prepare('SELECT items_snapshot,total_paise FROM restaurant_bills WHERE id=?')
      .get(saved.data.id);
    assert.equal(historical.total_paise,24000);
    assert.equal(JSON.parse(historical.items_snapshot)[0].unit_price_paise,12000);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
