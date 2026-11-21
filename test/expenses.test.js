import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {dailyCollections} from '../src/daily-collections.js';

test('expenses are immutable, actor-attributed and request retries cannot double-spend',async()=>{
  const db=openDatabase(':memory:');
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const json=async(path,method='GET',body)=>{
    const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  };
  try{
    const request_id=randomUUID(),expense={business_date:'2026-12-02',category:'housekeeping',amount:350,
      method:'cash',payee:'Synthetic vendor',note:'Test supply purchase',request_id};
    const first=await json('/api/finance/expenses','POST',expense);
    assert.equal(first.status,201);
    const retry=await json('/api/finance/expenses','POST',expense);
    assert.equal(retry.status,200);
    assert.equal(retry.data.id,first.data.id);
    assert.equal(retry.data.already_recorded,true);
    assert.equal((await json('/api/finance/expenses?date=2026-12-02')).data.length,1);
    assert.equal((await json('/api/finance/expenses','POST',{...expense,amount:400})).status,400);
    assert.equal((await json('/api/finance/expenses','POST',{...expense,request_id:randomUUID(),amount:-1})).status,400);
    const report=dailyCollections(db,'2026-12-02');
    assert.equal(report.expenses_paid_paise,35000);
    assert.equal(report.net_collections_paise,0);
    assert.equal(report.net_cash_movement_paise,-35000);
    assert.equal(report.by_method.cash.expense_paise,35000);
    const events=(await json('/api/audit/expense/'+first.data.id)).data;
    assert.equal(events.length,1);
    assert.equal(events[0].actor_username,'owner');
    assert.equal(events[0].details.amount_paise,35000);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
test('expense writes are restricted to manager and owner, never restaurant cashier',async()=>{
  const db=openDatabase(':memory:');
  createStaff(db,{username:'cashier22',display_name:'Cashier',role:'cashier',password:'synthetic-cashier-pass-123'});
  createStaff(db,{username:'manager22',display_name:'Manager',role:'manager',password:'synthetic-manager-pass-123'});
  const server=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-pass-123')}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const login=async(username,password)=>{
    const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username,password})});
    assert.equal(response.status,200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  try{
    const cashier=await login('cashier22','synthetic-cashier-pass-123');
    const manager=await login('manager22','synthetic-manager-pass-123');
    const body={business_date:'2026-12-02',category:'supplies',amount:100,method:'upi',request_id:randomUUID()};
    const post=cookie=>fetch(base+'/api/finance/expenses',{method:'POST',
      headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
    assert.equal((await post(cashier)).status,403);
    assert.equal((await fetch(base+'/api/finance/expenses?date=2026-12-02',{headers:{Cookie:cashier}})).status,403);
    assert.equal((await post(manager)).status,201);
    assert.equal((await fetch(base+'/api/finance/expenses?date=2026-12-02',{headers:{Cookie:manager}})).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
