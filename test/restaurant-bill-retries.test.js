import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {importMenuCsv,listMenu,createRestaurantBill,restaurantBillRequest} from '../src/restaurant.js';

function withBillDb(work){
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,'name,category,price,tax_rate\nMasala Chai,Drinks,80,5\nPaneer Pakora,Snacks,280,5');
    return work(db);
  }finally{db.close();}
}
test('exactly-once restaurant bill retry never creates duplicate cash/UPI/card/room bills',()=>{
  withBillDb(db=>{
    for(const method of ['cash','upi','card']){
      const request_id=randomUUID();
      const body={request_id,payment_method:method,items:[{menu_item_id:1,quantity:2}]};
      const first=createRestaurantBill(db,body);
      const again=createRestaurantBill(db,body);
      assert.equal(first.already_recorded,false);
      assert.equal(again.already_recorded,true);
      assert.equal(first.id,again.id);
      assert.equal(first.total_paise,16000);
      assert.deepEqual(restaurantBillRequest(db,request_id),{recorded:true,id:first.id});
      assert.throws(()=>createRestaurantBill(db,{...body,items:[{menu_item_id:1,quantity:1}]}),/different details/);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,3);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bill_requests').get().n,3);
  });
});
test('retry resolves original saved receipt after menu price changes',()=>{
  withBillDb(db=>{
    const body={request_id:randomUUID(),payment_method:'upi',items:[{menu_item_id:1,quantity:1}]};
    const first=createRestaurantBill(db,body);
    importMenuCsv(db,'name,category,price,tax_rate\nMasala Chai,Drinks,200,5');
    const again=createRestaurantBill(db,body);
    assert.equal(again.id,first.id);
    assert.equal(again.total_paise,8000);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,1);
  });
});
test('room-charge replay succeeds even after guest checkout; new charges require active guest',()=>{
  withBillDb(db=>{
    const booking=Number(db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise,status)
      VALUES('Synthetic Room Guest','2027-02-01','2027-02-02',1,'Unassigned',100000,'checked_in')`).run().lastInsertRowid);
    const body={request_id:randomUUID(),payment_method:'room',booking_id:booking,items:[{menu_item_id:2,quantity:1}]};
    const saved=createRestaurantBill(db,body);
    db.prepare("UPDATE bookings SET status='checked_out' WHERE id=?").run(booking);
    assert.equal(createRestaurantBill(db,body).id,saved.id);
    assert.throws(()=>createRestaurantBill(db,{...body,request_id:randomUUID()}),/checked-in guest/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,1);
  });
});
test('restaurant bill lookup endpoint is read only and UUID validation fails safely',async()=>{
  const db=openDatabase(':memory:');
  importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,80,5');
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const request_id=randomUUID();
    const body={request_id,payment_method:'cash',items:[{menu_item_id:1,quantity:1}]};
    const post=()=>fetch(base+'/api/restaurant/bills',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const first=await post();assert.equal(first.status,201);
    const a=await first.json();
    const retry=await post();assert.equal(retry.status,200);
    assert.equal((await retry.json()).id,a.id);
    const lookup=await fetch(base+'/api/restaurant/bills/request/'+request_id);
    assert.deepEqual(await lookup.json(),{recorded:true,id:a.id});
    const unknown=await fetch(base+'/api/restaurant/bills/request/'+randomUUID());
    assert.deepEqual(await unknown.json(),{recorded:false});
    const invalid=await fetch(base+'/api/restaurant/bills/request/short');
    assert.equal(invalid.status,400);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,1);
  }finally{await new Promise(r=>server.close(r));db.close();}
});
