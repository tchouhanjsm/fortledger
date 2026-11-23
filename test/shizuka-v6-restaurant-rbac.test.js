import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {importMenuCsv,listMenu} from '../src/restaurant.js';
import {may,requiredPermission} from '../src/access.js';

test('V6 restaurant capabilities fail closed and preserve front-desk folio access',()=>{
  assert.equal(may('cashier','restaurant.pos'),true);
  assert.equal(may('frontdesk','restaurant.read'),false);
  assert.equal(may('frontdesk','folio.read'),true);
  assert.equal(may('frontdesk','folio.write'),true);
  assert.equal(may('manager','restaurant.pos'),false);
  assert.equal(may('manager','menu.manage'),true);
  assert.equal(requiredPermission('POST','/restaurant/bills'),'restaurant.pos');
  assert.equal(requiredPermission('GET','/restaurant/bills'),'restaurant.read');
  assert.equal(requiredPermission('POST','/restaurant/bills/1/print'),'restaurant.pos');
  assert.equal(requiredPermission('POST','/restaurant/bills/1/link-booking'),'restaurant.link');
  assert.equal(requiredPermission('GET','/restaurant/bills/request/valid-123456789'),'restaurant.pos');
  assert.equal(requiredPermission('PUT','/restaurant/unknown-action'),null);
  assert.equal(requiredPermission('GET','/bookings/1/folio'),'folio.read');
});

test('V6 HTTP boundary: cashier POS only, manager oversight, front desk hotel only',async()=>{
  const db=openDatabase(':memory:');
  const ownerPassword='owner-v6-synthetic-password-123';
  createStaff(db,{username:'cashier-v6',display_name:'Restaurant Operator',role:'cashier',
    password:'cashier-v6-synthetic-password-123'});
  createStaff(db,{username:'manager-v6',display_name:'Manager',role:'manager',
    password:'manager-v6-synthetic-password-123'});
  createStaff(db,{username:'frontdesk-v6',display_name:'Reception',role:'frontdesk',
    password:'frontdesk-v6-synthetic-password-123'});
  importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,80,5');
  const server=createApp(db,{authRecord:createPasswordRecord(ownerPassword)}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  async function request(path,{cookie,method='GET',body}={}){
    const response=await fetch(base+path,{method,headers:{
      'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})
    },body:body===undefined?undefined:JSON.stringify(body)});
    const text=await response.text();
    let data;try{data=JSON.parse(text);}catch{data=text;}
    return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  try{
    const owner=await request('/api/auth/login',{method:'POST',body:{password:ownerPassword}});
    const cashier=await request('/api/auth/login',{method:'POST',body:{
      username:'cashier-v6',password:'cashier-v6-synthetic-password-123'}});
    const manager=await request('/api/auth/login',{method:'POST',body:{
      username:'manager-v6',password:'manager-v6-synthetic-password-123'}});
    const frontdesk=await request('/api/auth/login',{method:'POST',body:{
      username:'frontdesk-v6',password:'frontdesk-v6-synthetic-password-123'}});
    for(const session of [owner,cashier,manager,frontdesk])assert.equal(session.status,200);
    const item=listMenu(db)[0];
    const body={request_id:randomUUID(),payment_method:'cash',items:[{
      menu_item_id:item.id,quantity:2,unit_price_paise:item.price_paise,tax_rate:item.tax_rate
    }]};
    assert.equal((await request('/api/restaurant/menu',{cookie:frontdesk.cookie})).status,403);
    assert.equal((await request('/api/restaurant/checked-in',{cookie:frontdesk.cookie})).status,403);
    assert.equal((await request('/api/restaurant/bills',{cookie:frontdesk.cookie})).status,403);
    assert.equal((await request('/api/restaurant/bills',{method:'POST',cookie:frontdesk.cookie,body})).status,403);
    assert.equal((await request('/api/bookings',{cookie:frontdesk.cookie})).status,200);
    assert.equal((await request('/api/restaurant/menu',{cookie:cashier.cookie})).status,200);
    assert.equal((await request('/api/restaurant/menu/all',{cookie:cashier.cookie})).status,403);
    assert.equal((await request('/api/bookings',{cookie:cashier.cookie})).status,403);
    assert.equal((await request('/api/restaurant/bills',{method:'POST',cookie:manager.cookie,body})).status,403);
    assert.equal((await request('/api/restaurant/bills',{method:'POST',cookie:owner.cookie,body})).status,403);
    const saved=await request('/api/restaurant/bills',{method:'POST',cookie:cashier.cookie,body});
    assert.equal(saved.status,201);
    assert.equal(saved.data.total_paise,16000);
    const retry=await request('/api/restaurant/bills',{method:'POST',cookie:cashier.cookie,body});
    assert.equal(retry.status,200);
    assert.equal(retry.data.id,saved.data.id);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM restaurant_bills').get().n,1);
    assert.equal((await request('/api/restaurant/bills',{cookie:manager.cookie})).status,200);
    assert.equal((await request('/api/restaurant/bills/'+saved.data.id+'/receipt',{cookie:manager.cookie})).status,200);
    assert.equal((await request('/api/restaurant/bills/'+saved.data.id+'/receipt',{cookie:frontdesk.cookie})).status,403);
    assert.equal((await request('/api/restaurant/bills/'+saved.data.id+'/print',{
      cookie:manager.cookie,method:'POST',body:{reprint:false}
    })).status,403);
    assert.equal((await request('/api/restaurant/bills/request/'+body.request_id,{cookie:cashier.cookie})).data.id,
      saved.data.id);
    assert.equal((await request('/api/restaurant/bills/request/'+body.request_id,{cookie:frontdesk.cookie})).status,403);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
