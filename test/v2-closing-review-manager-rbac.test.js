import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {createDailyClose} from '../src/daily-close.js';
import {recordExpense} from '../src/expenses.js';
import {requiredPermission} from '../src/access.js';

test('manager can review stale closing; front desk and cashier cannot, including direct API',async()=>{
  assert.equal(requiredPermission('POST','/finance/closing/review'),'finance.write');
  assert.equal(requiredPermission('GET','/finance/closing/attention'),'finance.read');
  assert.equal(requiredPermission('DELETE','/finance/closing/review'),null);
  const db=openDatabase(':memory:'),day='2027-04-15';
  createStaff(db,{username:'managerqa',display_name:'Manager QA',role:'manager',password:'strong-synthetic-manager-password'});
  createStaff(db,{username:'deskqa',display_name:'Desk QA',role:'frontdesk',password:'strong-synthetic-desk-password'});
  createStaff(db,{username:'cashqa',display_name:'Cashier QA',role:'cashier',password:'strong-synthetic-cash-password'});
  const actor={id:0,username:'owner',role:'owner'};
  createDailyClose(db,{business_date:day,opening_cash:0,counted_cash:0,request_id:randomUUID()},actor);
  recordExpense(db,{business_date:day,category:'supplies',amount:10,method:'cash',request_id:randomUUID()},actor);
  const server=createApp(db,{authRecord:createPasswordRecord('strong-synthetic-owner-password')}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const login=async(username,password)=>{
    const res=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    assert.equal(res.status,200);
    return res.headers.get('set-cookie').split(';')[0];
  };
  const review=async cookie=>fetch(base+'/api/finance/closing/review',{method:'POST',
    headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({
      business_date:day,disposition:'acknowledged',reason:'Verified signed closing source records'
    })});
  try{
    const manager=await login('managerqa','strong-synthetic-manager-password');
    const frontdesk=await login('deskqa','strong-synthetic-desk-password');
    const cashier=await login('cashqa','strong-synthetic-cash-password');
    assert.equal((await review(frontdesk)).status,403);
    assert.equal((await review(cashier)).status,403);
    assert.equal((await fetch(base+'/api/finance/closing/attention',{headers:{Cookie:frontdesk}})).status,403);
    assert.equal((await fetch(base+'/api/finance/closing/attention',{headers:{Cookie:manager}})).status,200);
    const saved=await review(manager);
    assert.equal(saved.status,200);
    assert.equal((await saved.json()).review.reviewer,'managerqa');
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
