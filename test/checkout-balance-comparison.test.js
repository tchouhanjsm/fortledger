import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compareCheckoutBalances} from '../public/checkout-balance-comparison.js';
const original={booking_id:1,totals:{charges_paise:120000,operator_recorded_paise:50000,
 due_paise:70000,accommodation_charge_paise:100000,restaurant_room_charges_paise:20000,
 restaurant_recorded_paise:0},restaurant_room_charges:[
 {bill_id:3,total_paise:20000,tax_included_paise:952,payment_state:'room_receivable',settled_at:null}
 ]};
test('later settlement is visible without changing the frozen checkout',()=>{
 const current=structuredClone(original);
 current.totals.operator_recorded_paise+=20000;current.totals.due_paise-=20000;
 current.totals.restaurant_recorded_paise=20000;
 current.restaurant_room_charges[0].payment_state='operator_recorded_settled';
 current.restaurant_room_charges[0].settled_at='2026-11-25 10:00:00';
 const result=compareCheckoutBalances(original,current);
 assert.equal(result.state,'changed');assert.equal(result.room_bills_changed,true);
 assert.deepEqual(result.changes.map(x=>x.key),['operator_recorded_paise','due_paise','restaurant_recorded_paise']);
 assert.equal(original.totals.due_paise,70000);
});
test('same amounts but different source bill identity remain visibly changed',()=>{
 const current=structuredClone(original);current.restaurant_room_charges[0].bill_id=4;
 assert.equal(compareCheckoutBalances(original,current).state,'changed');
 assert.equal(compareCheckoutBalances(original,structuredClone(original)).state,'unchanged');
});
test('missing or invalid snapshots never claim balances match',()=>{
 for(const current of [null,{...original,booking_id:2},{...original,totals:{}},
  {...original,restaurant_room_charges:null}])
  assert.equal(compareCheckoutBalances(original,current).state,'unavailable');
 assert.equal(compareCheckoutBalances(null,original).state,'unavailable');
});
test('existing checkout register uses a read-only preflight comparison on demand',()=>{
 const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(js,/At checkout: recorded charges/);
 assert.match(js,/compareCheckoutBalances\(preflight,current\)/);
 assert.match(js,/api\('\/api\/bookings\/'\+entry.booking_id\+'\/checkout-invoice-preflight'\)/);
});
