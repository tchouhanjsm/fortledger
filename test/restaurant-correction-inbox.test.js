import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {importMenuCsv,listMenu,createRestaurantBill} from '../src/restaurant.js';
import {restaurantCorrectionInbox,submitRestaurantCorrectionCase,reviewRestaurantCorrectionCase} from '../src/restaurant-correction-cases.js';
import {requiredPermission,may} from '../src/access.js';

const owner={id:0,username:'owner',role:'owner'},manager={id:7,username:'manager',role:'manager'};
test('source-linked restaurant correction inbox reflects owner and accountant queues without money writes',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,'name,category,price,tax_rate\nChai,Drinks,105,5');
    const item=listMenu(db)[0];
    const bill=createRestaurantBill(db,{payment_method:'cash',items:[{menu_item_id:item.id,quantity:2}]});
    const make=reason=>submitRestaurantCorrectionCase(db,bill.id,{request_id:randomUUID(),reason,
      lines:[{line_index:0,quantity:1}]},manager);
    const waiting=make('Incorrect quantity recorded');
    const escalated=make('Wrong serving on receipt');
    const dismissed=make('Duplicate service request');
    reviewRestaurantCorrectionCase(db,escalated.id,{request_id:randomUUID(),
      disposition:'needs_accountant',note:'Qualified review required'},owner);
    reviewRestaurantCorrectionCase(db,dismissed.id,{request_id:randomUUID(),
      disposition:'dismissed',note:'Original bill was correct'},owner);
    const queue=restaurantCorrectionInbox(db,manager);
    assert.equal(queue.total,2);
    assert.equal(queue.counts.awaiting_owner,1);
    assert.equal(queue.counts.needs_accountant,1);
    assert.equal(queue.counts.all,3);
    assert.deepEqual(queue.items.map(x=>x.id).sort((a,b)=>a-b),
      [waiting.id,escalated.id].sort((a,b)=>a-b));
    assert.equal(restaurantCorrectionInbox(db,owner,{status:'awaiting_owner'}).total,1);
    assert.equal(restaurantCorrectionInbox(db,owner,{status:'needs_accountant'}).total,1);
    assert.equal(restaurantCorrectionInbox(db,owner,{status:'all',limit:1}).items.length,1);
    assert.equal(restaurantCorrectionInbox(db,owner,{status:'all',offset:2}).items.length,1);
    assert.equal(queue.financial_entries_written,false);
    assert.equal(queue.gst_credit_notes_issued,false);
    assert.equal(queue.refunds_sent,false);
    assert.throws(()=>restaurantCorrectionInbox(db,{id:9,username:'cashier',role:'cashier'}),
      /Authenticated authorized staff/);
    assert.throws(()=>restaurantCorrectionInbox(db,owner,{status:'issued'}),/Invalid/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_correction_case_reviews').get().n,2);
    assert.equal(db.pragma('foreign_key_check').length,0);
  }finally{db.close();}
});
test('correction inbox GET permission cannot be used by cashiers or written to by anyone',()=>{
  assert.equal(requiredPermission('GET','/restaurant/correction-cases/inbox'),'restaurant.correction.preview');
  assert.equal(requiredPermission('POST','/restaurant/correction-cases/inbox'),null);
  assert.equal(may('owner','restaurant.correction.preview'),true);
  assert.equal(may('manager','restaurant.correction.preview'),true);
  assert.equal(may('cashier','restaurant.correction.preview'),false);
});
