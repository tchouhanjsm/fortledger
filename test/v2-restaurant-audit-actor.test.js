import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {importMenuCsv,listMenu,createRestaurantBill} from '../src/restaurant.js';
import {auditEvents} from '../src/financial-audit.js';

const owner={id:0,username:'owner',role:'owner'};
const cashier={id:17,username:'cashier-17',role:'cashier'};
const setup=()=>{const db=openDatabase(':memory:');importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,100,5');return db;};

test('restaurant sale and cashier audit commit atomically; replay never duplicates attribution',()=>{
  const db=setup();
  try{
    const body={request_id:randomUUID(),payment_method:'cash',
      items:[{menu_item_id:listMenu(db)[0].id,quantity:2}]};
    const first=createRestaurantBill(db,body,cashier);
    const second=createRestaurantBill(db,body,owner);
    assert.equal(second.id,first.id);
    assert.equal(second.already_recorded,true);
    const audit=auditEvents(db,{entityType:'restaurant_bill',entityId:first.id});
    assert.equal(audit.length,1);
    assert.equal(audit[0].action,'restaurant_bill.created');
    assert.equal(audit[0].actor_username,'cashier-17');
    assert.equal(audit[0].actor_role,'cashier');
    assert.equal(audit[0].details.amount_paise,20000);
    assert.equal(audit[0].details.payment_method,'cash');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bill_requests').get().n,1);
    assert.throws(()=>createRestaurantBill(db,{...body,request_id:randomUUID()},{
      id:-1,username:'invalid',role:'cashier'
    }),/Invalid audit event/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,1,
      'audit failure must also roll back the sale and its idempotency marker');
  }finally{db.close();}
});

test('HTTP restaurant POST carries actor into the audit ledger, and retries have one record',async()=>{
  const db=setup(),server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const body={request_id:randomUUID(),payment_method:'upi',
      items:[{menu_item_id:listMenu(db)[0].id,quantity:1}]};
    const send=async()=>{
      const response=await fetch(base+'/api/restaurant/bills',{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      return {status:response.status,payload:await response.json()};
    };
    const first=await send(),replay=await send();
    assert.equal(first.status,201);
    assert.equal(replay.status,200);
    assert.equal(replay.payload.id,first.payload.id);
    const events=await fetch(base+'/api/audit/restaurant_bill/'+first.payload.id);
    assert.equal(events.status,200);
    const audit=await events.json();
    assert.equal(audit.length,1);
    assert.equal(audit[0].actor_username,'owner');
    assert.equal(audit[0].action,'restaurant_bill.created');
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
