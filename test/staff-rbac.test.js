import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {may,requiredPermission} from '../src/access.js';

test('permissions are deny-by-default for staff and owner retains full access',()=>{
  assert.equal(may('cashier','settings.admin'),false);
  assert.equal(may('cashier','restaurant.write'),true);
  assert.equal(may('frontdesk','bookings.write'),true);
  assert.equal(may('frontdesk','restaurant.read'),false);
  assert.equal(may('manager','restaurant.pos'),false);
  assert.equal(may('cashier','restaurant.pos'),true);
  assert.equal(may('frontdesk','refunds.write'),false);
  assert.equal(may('manager','settings.admin'),false);
  assert.equal(may('owner','staff.admin'),true);
  assert.equal(requiredPermission('GET','/backup'),'settings.admin');
  assert.equal(requiredPermission('POST','/bookings/1/payments/2/refunds'),'refunds.write');
  assert.equal(requiredPermission('GET','/restaurant/menu'),'restaurant.read');
  assert.equal(requiredPermission('POST','/some-future-endpoint'),null);
});
test('owner can create staff; cashier cannot see bookings or backups and revocation is immediate',async()=>{
  const db=openDatabase(':memory:');
  const server=createApp(db,{authRecord:createPasswordRecord('sample-owner-secret-123')}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const request=async(path,method='GET',body,cookie)=>{
    const response=await fetch(base+path,{
      method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
      body:body===undefined?undefined:JSON.stringify(body)
    });
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  try{
    assert.equal((await request('/api/bookings')).status,401);
    const owner=await request('/api/auth/login','POST',{password:'sample-owner-secret-123'});
    assert.equal(owner.status,200);
    assert.equal(owner.data.user.role,'owner');
    const cashier=await request('/api/staff','POST',{
      username:'cashier01',display_name:'Sample Cashier',role:'cashier',password:'cashier-test-secret-123'
    },owner.cookie);
    assert.equal(cashier.status,201);
    assert.equal('password_json' in cashier.data,false);
    assert.equal((await request('/api/staff','GET',undefined,owner.cookie)).data.length,1);
    const session=await request('/api/auth/login','POST',{username:'cashier01',password:'cashier-test-secret-123'});
    assert.equal(session.status,200);
    assert.equal(session.data.user.role,'cashier');
    assert.equal((await request('/api/me','GET',undefined,session.cookie)).data.role,'cashier');
    assert.equal((await request('/api/restaurant/menu','GET',undefined,session.cookie)).status,200);
    assert.equal((await request('/api/restaurant/checked-in','GET',undefined,session.cookie)).status,200);
    assert.equal((await request('/api/bookings','GET',undefined,session.cookie)).status,403);
    assert.equal((await request('/api/invoices','GET',undefined,session.cookie)).status,403);
    assert.equal((await request('/api/backup','GET',undefined,session.cookie)).status,403);
    assert.equal((await request('/api/settings/business','GET',undefined,session.cookie)).status,403);
    assert.equal((await request('/api/staff','GET',undefined,session.cookie)).status,403);
    assert.equal((await request('/api/staff','POST',{
      username:'otherstaff',display_name:'Other',role:'manager',password:'another-long-password-123'
    },session.cookie)).status,403);
    const update=await request('/api/staff/'+cashier.data.id,'PATCH',{active:false},owner.cookie);
    assert.equal(update.status,200);
    assert.equal((await request('/api/restaurant/menu','GET',undefined,session.cookie)).status,401);
    assert.equal((await request('/api/auth/login','POST',{username:'cashier01',password:'cashier-test-secret-123'})).status,401);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
test('front desk can manage bookings, not refunds or hotel admin settings',async()=>{
  const db=openDatabase(':memory:');
  const {createStaff}=await import('../src/staff.js');
  createStaff(db,{username:'reception01',display_name:'Reception',role:'frontdesk',password:'frontdesk-secret-123'});
  const server=createApp(db,{authRecord:createPasswordRecord('owner-secret-456789')}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try{
    const base='http://127.0.0.1:'+server.address().port;
    const login=await fetch(base+'/api/auth/login',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:'reception01',password:'frontdesk-secret-123'})
    });
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const request=(url,method='GET')=>fetch(base+url,{method,headers:{
      Cookie:cookie,'Content-Type':'application/json'
    },body:method==='GET'?undefined:'{}'});
    assert.equal((await request('/api/bookings')).status,200);
    assert.equal((await request('/api/restaurant/menu')).status,403);
    assert.equal((await request('/api/restaurant/bills')).status,403);
    assert.equal((await request('/api/restaurant/checked-in')).status,403);
    assert.equal((await request('/api/bookings/1/folio')).status,200);
    assert.equal((await request('/api/restaurant/menu/import','POST')).status,403);
    assert.equal((await request('/api/bookings/1/payments/2/refunds','POST')).status,403);
    assert.equal((await request('/api/settings/business','PUT')).status,403);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
