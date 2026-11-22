import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareDailyClosing} from '../public/daily-close-preparation.js';

function fixture(){
  const zero=()=>({hotel_paise:0,restaurant_paise:0,refund_paise:0,
    expense_paise:0,net_collected_paise:0});
  const by_method={cash:zero(),upi:zero(),card:zero(),bank:zero(),unrecorded:zero()};
  Object.assign(by_method.cash,{hotel_paise:1000,restaurant_paise:300,
    refund_paise:200,expense_paise:100,net_collected_paise:1100});
  Object.assign(by_method.upi,{hotel_paise:500,restaurant_paise:200,
    net_collected_paise:700});
  return {business_date:'2026-11-22',timezone:'Asia/Kolkata',by_method,
    hotel_received_paise:1500,restaurant_received_paise:500,
    refunds_recorded_paise:200,net_collections_paise:1800,
    expenses_paid_paise:100,net_cash_movement_paise:1700,
    unrecorded_method_paise:0,
    current_unmatched_room_charges:{count:1,amount_paise:400},
    current_unpaid_room_charges:{count:2,amount_paise:900}};
}
test('daily closing preview is read-only and reconciles distinct receipt sources by method',()=>{
  const src=fixture(),before=structuredClone(src);
  const prepared=prepareDailyClosing(src);
  assert.deepEqual(src,before);
  assert.deepEqual(prepared.methods.map(x=>x.method),['cash','upi','card','bank','unrecorded']);
  assert.equal(prepared.totals.hotel_paise,1500);
  assert.equal(prepared.totals.restaurant_paise,500);
  assert.equal(prepared.cash_net_movement_paise,1000);
  assert.equal(prepared.warnings.length,2);
  assert.match(prepared.disclaimer,/not bank-confirmed/);
  assert.match(prepared.warnings[1],/receivables \(not collected\)/);
});
test('mismatched ledger totals fail visibly rather than silently correcting a financial number',()=>{
  const src=fixture();src.restaurant_received_paise+=1;
  assert.throws(()=>prepareDailyClosing(src),/Daily ledger mismatch/);
  const other=fixture();other.by_method.upi.net_collected_paise++;
  assert.throws(()=>prepareDailyClosing(other),/Method receipts do not reconcile/);
});
test('a refund-heavy IST day can have negative net recorded cash, not invalid transactions',()=>{
  const src=fixture();
  src.by_method.cash.hotel_paise=0;src.by_method.cash.restaurant_paise=0;
  src.by_method.cash.refund_paise=500;src.by_method.cash.net_collected_paise=-500;
  src.by_method.cash.expense_paise=0;
  src.hotel_received_paise=500;src.restaurant_received_paise=200;
  src.refunds_recorded_paise=500;src.net_collections_paise=200;
  src.expenses_paid_paise=0;src.net_cash_movement_paise=200;
  const result=prepareDailyClosing(src);
  assert.equal(result.methods[0].net_movement_paise,-500);
});
test('missing financial source data fails closed and no unauthenticated preview HTML is exposed',()=>{
  const src=fixture();delete src.by_method.card;
  assert.throws(()=>prepareDailyClosing(src),/Missing card/);
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(app,/async function renderDailyClosePreparation/);
  assert.match(app,/can\('finance.read'\)/);
  assert.match(html,/id="daily-close-preparation"/);
});
