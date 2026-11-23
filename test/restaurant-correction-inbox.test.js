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


test('overlapping active correction requests flag original-line quantity exposure without creating financial entries',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,'name,category,price,tax_rate\nChai,Drinks,105,5\nCoffee,Drinks,150,5');
    const menu=listMenu(db);
    const bill=createRestaurantBill(db,{payment_method:'cash',items:[
      {menu_item_id:menu[0].id,quantity:3},{menu_item_id:menu[1].id,quantity:2}
    ]});
    const submit=(reason,line_index,quantity)=>submitRestaurantCorrectionCase(db,bill.id,{
      request_id:randomUUID(),reason,lines:[{line_index,quantity}]
    },manager);
    const first=submit('First disputed serving',0,2);
    const second=submit('Second disputed serving',0,2);
    const separate=submit('Independent item complaint',1,1);
    const dismissed=submit('Disputed line already settled',0,1);
    reviewRestaurantCorrectionCase(db,dismissed.id,{
      request_id:randomUUID(),disposition:'dismissed',note:'No actual bill correction authorised'
    },owner);
    const report=restaurantCorrectionInbox(db,manager,{status:'all'});
    const byId=new Map(report.items.map(entry=>[entry.id,entry]));
    for(const [current,other] of [[first,second],[second,first]]){
      const alerts=byId.get(current.id).review_alerts;
      assert.equal(alerts.length,1);
      assert.equal(alerts[0].code,'proposed_quantities_exceed_saved_line');
      assert.equal(alerts[0].line_index,0);
      assert.equal(alerts[0].original_quantity,3);
      assert.equal(alerts[0].active_proposed_quantity,4);
      assert.deepEqual(alerts[0].related_case_ids,[other.id]);
    }
    assert.deepEqual(byId.get(separate.id).review_alerts,[],
      'different original lines must not falsely imply duplicate corrections');
    assert.deepEqual(byId.get(dismissed.id).review_alerts,[],
      'dismissed cases do not count as pending correction quantities');
    reviewRestaurantCorrectionCase(db,second.id,{
      request_id:randomUUID(),disposition:'dismissed',note:'Duplicate proposal resolved without a refund'
    },owner);
    assert.deepEqual(restaurantCorrectionInbox(db,owner).items.find(x=>x.id===first.id).review_alerts,[]);
    const another=submit('Another disputed serving amount',0,1);
    const after=restaurantCorrectionInbox(db,manager,{status:'open'});
    const caution=after.items.find(x=>x.id===first.id).review_alerts;
    assert.equal(caution[0].code,'possible_same_line_overlap');
    assert.equal(caution[0].active_proposed_quantity,3);
    assert.equal(caution[0].related_case_ids[0],another.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_settlements').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_correction_case_reviews').get().n,2);
    assert.equal(db.pragma('user_version',{simple:true}),13);
  }finally{db.close();}
});
