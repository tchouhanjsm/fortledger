import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {createRestaurantTable,changeRestaurantTable,listRestaurantTables,
  previewRestaurantTableSetup,applyRestaurantTableSetup} from '../src/restaurant-tables.js';
import {auditEvents} from '../src/financial-audit.js';

const owner={id:0,username:'owner',role:'owner'};
const manager={id:4,username:'manager',role:'manager'};
test('preview/confirm bulk dining tables preserves active/hidden names and is replay-safe by re-preview',()=>{
  const db=openDatabase(':memory:');
  try{
    const old=createRestaurantTable(db,{label:'Courtyard 1'},manager);
    changeRestaurantTable(db,old.id,{active:false,expected_active:true},manager);
    const labels=['Rooftop 1','Courtyard 1','Rooftop 2'];
    const preview=previewRestaurantTableSetup(db,{labels},owner);
    assert.deepEqual(preview.to_create,['Rooftop 1','Rooftop 2']);
    assert.equal(preview.already_hidden.length,1);
    assert.equal(listRestaurantTables(db).length,0,'preview must not create tables');
    assert.throws(()=>previewRestaurantTableSetup(db,{labels:['T1','t1']},owner),/Repeated/);
    assert.throws(()=>previewRestaurantTableSetup(db,{labels:['T1','<script>']},owner),/Table name/);
    assert.throws(()=>previewRestaurantTableSetup(db,{labels:[]},owner),/1–30/);
    assert.throws(()=>previewRestaurantTableSetup(db,{labels},{
      id:6,username:'cashier',role:'cashier'}),/Only owner or manager/);
    const result=applyRestaurantTableSetup(db,{labels,review_token:preview.review_token},manager);
    assert.equal(result.created.length,2);
    assert.equal(db.prepare('SELECT active FROM restaurant_tables WHERE id=?').get(old.id).active,0);
    assert.deepEqual(listRestaurantTables(db).map(x=>x.label),['Rooftop 1','Rooftop 2']);
    assert.throws(()=>applyRestaurantTableSetup(db,{labels,review_token:preview.review_token},owner),
      /changed since preview/);
    const rerun=previewRestaurantTableSetup(db,{labels},owner);
    assert.equal(rerun.to_create.length,0);
    assert.equal(applyRestaurantTableSetup(db,{labels,review_token:rerun.review_token},owner).created.length,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_tables').get().n,3);
    assert.equal(auditEvents(db,{entityType:'restaurant_table',entityId:result.created[0].id})[0].action,
      'restaurant_table.created');
    assert.equal(db.pragma('user_version',{simple:true}),13);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
  }finally{db.close();}
});
test('table setup endpoints restrict cashier and reject stale review on authenticated server',async()=>{
  const db=openDatabase(':memory:');
  const password='synthetic-owner-table-setup-long';
  createStaff(db,{username:'managerqa',display_name:'QA Manager',role:'manager',
    password:'synthetic-manager-table-setup-long'});
  createStaff(db,{username:'cashierqa',display_name:'QA Cashier',role:'cashier',
    password:'synthetic-cashier-table-setup-long'});
  const app=createApp(db,{authRecord:createPasswordRecord(password)});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const request=async(url,{method='GET',body,cookie}={})=>{
    const response=await fetch(base+url,{method,headers:{
      'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
      body:body===undefined?undefined:JSON.stringify(body)});
    return {code:response.status,data:await response.json(),
      cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  try{
    const o=await request('/api/auth/login',{method:'POST',body:{password}});
    const m=await request('/api/auth/login',{method:'POST',body:{
      username:'managerqa',password:'synthetic-manager-table-setup-long'}});
    const c=await request('/api/auth/login',{method:'POST',body:{
      username:'cashierqa',password:'synthetic-cashier-table-setup-long'}});
    assert.equal((await request('/api/restaurant/tables/setup/preview',{
      method:'POST',cookie:c.cookie,body:{labels:['Roof 1']}})).code,403);
    assert.equal((await request('/api/restaurant/tables/setup/apply',{
      method:'POST',cookie:c.cookie,body:{labels:['Roof 1'],review_token:'a'.repeat(64)}})).code,403);
    const preview=await request('/api/restaurant/tables/setup/preview',{
      method:'POST',cookie:m.cookie,body:{labels:['Roof 1','Roof 2']}});
    assert.equal(preview.code,200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_tables').get().n,0);
    const added=await request('/api/restaurant/tables/setup/apply',{
      method:'POST',cookie:o.cookie,body:{
        labels:['Roof 1','Roof 2'],review_token:preview.data.review_token}});
    assert.equal(added.code,201);
    assert.equal(added.data.created.length,2);
    assert.equal((await request('/api/restaurant/tables/setup/apply',{
      method:'POST',cookie:o.cookie,body:{
        labels:['Roof 1','Roof 2'],review_token:preview.data.review_token}})).code,409);
    assert.deepEqual((await request('/api/restaurant/tables',{cookie:c.cookie})).data.map(x=>x.label),
      ['Roof 1','Roof 2']);
    assert.equal((await request('/api/restaurant/tables/setup/preview',{
      cookie:o.cookie,method:'GET'})).code,403);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
