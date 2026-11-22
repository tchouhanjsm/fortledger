import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {importMenuCsv,listMenu,createRestaurantBill,linkManualRoomCharge} from '../src/restaurant.js';
import {getGuestFolio} from '../src/folio.js';
import {auditEvents} from '../src/financial-audit.js';

const owner={id:0,username:'owner',role:'owner'};
const manager={id:18,username:'manager-18',role:'manager'};
const cashier={id:19,username:'cashier-19',role:'cashier'};
function fixture(){
  const db=openDatabase(':memory:');
  importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,120,0');
  const b=db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,
    nightly_rate_paise,status) VALUES('Different Guest','2027-05-01','2027-05-02',1,
    'Unassigned',450000,'checked_in')`).run().lastInsertRowid;
  db.prepare('INSERT INTO booking_room_allocations(booking_id,room_id) VALUES(?,1)').run(b);
  const bill=createRestaurantBill(db,{payment_method:'room',manual_room:'Tent 2',
    manual_guest:'Original Guest',items:[{menu_item_id:listMenu(db)[0].id,quantity:1}]},cashier);
  return {db,bookingId:Number(b),billId:bill.id};
}
test('guest A room 2 cannot silently enter different guest room 1 folio',()=>{
  const {db,bookingId,billId}=fixture();
  try{
    assert.throws(()=>linkManualRoomCharge(db,billId,bookingId,{actor:cashier}),/owner\/manager override/);
    assert.throws(()=>linkManualRoomCharge(db,billId,bookingId,{actor:cashier,
      override:true,reason:'I checked all the source records'}),/owner\/manager override/);
    assert.throws(()=>linkManualRoomCharge(db,billId,bookingId,{actor:manager,
      override:true,reason:'too short'}),/review reason/);
    assert.equal(getGuestFolio(db,bookingId).bills.length,0);
    assert.equal(db.prepare('SELECT booking_id FROM restaurant_bills WHERE id=?').get(billId).booking_id,null);
    assert.equal(auditEvents(db,{entityType:'restaurant_bill',entityId:billId}).length,1,
      'Only the bill-creation event may exist before manual review');
    const linked=linkManualRoomCharge(db,billId,bookingId,{actor:manager,override:true,
      reason:'Reviewed signed paper slip and guest confirmation'});
    assert.equal(linked.override,true);
    assert.equal(getGuestFolio(db,bookingId).bills.length,1);
    const audit=auditEvents(db,{entityType:'restaurant_bill',entityId:billId});
    assert.equal(audit.length,2);
    assert.equal(audit[0].action,'restaurant_bill.linked');
    assert.equal(audit[0].actor_username,'manager-18');
    assert.equal(audit[0].details.original_guest,'Original Guest');
    assert.equal(audit[0].details.original_room,'Tent 2');
    assert.equal(audit[0].details.matched_guest,'Different Guest');
    assert.deepEqual(audit[0].details.assigned_rooms,['Room 1']);
    assert.equal(audit[0].details.reason,'Reviewed signed paper slip and guest confirmation');
    assert.throws(()=>linkManualRoomCharge(db,billId,bookingId,{actor:owner,override:true,
      reason:'Reviewed signed paper slip and guest confirmation'}),/already linked/);
  }finally{db.close();}
});

test('HTTP manual room link fails closed on mismatch, and records owner review when overridden',async()=>{
  const {db,bookingId,billId}=fixture();
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const post=async(body)=>{
    const response=await fetch(base+'/api/restaurant/bills/'+billId+'/link-booking',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {status:response.status,json:await response.json()};
  };
  try{
    const blocked=await post({booking_id:bookingId});
    assert.equal(blocked.status,400);
    assert.match(blocked.json.error,/owner\/manager override/);
    const approved=await post({booking_id:bookingId,override:true,
      reason:'Manager reviewed handwritten original slip'});
    assert.equal(approved.status,200);
    assert.equal(approved.json.override,true);
    const audit=auditEvents(db,{entityType:'restaurant_bill',entityId:billId});
    assert.equal(audit[0].actor_username,'owner');
    assert.equal(audit[0].details.override,true);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
