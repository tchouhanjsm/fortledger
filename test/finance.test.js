import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingTotals,nightsBetween,toPaise } from '../src/finance.js';

test('Awaita: two rooms, one night, GST-inclusive 4500, 4500 advance',()=>{
  const t=bookingTotals({checkin:'2026-12-01',checkout:'2026-12-02',rooms_count:2,nightly_rate_paise:toPaise(4500),paid_paise:toPaise(4500)});
  assert.deepEqual(t,{nights:1,total_paise:900000,taxable_paise:857143,gst_paise:42857,paid_paise:450000,due_paise:450000,credit_paise:0});
});
test('cross-year stay counts correctly',()=>assert.equal(nightsBetween('2026-12-30','2027-01-02'),3));
test('reject invalid date and zero-night stays',()=>{
  assert.throws(()=>nightsBetween('2026-02-30','2026-03-02'));
  assert.throws(()=>nightsBetween('2026-12-02','2026-12-02'));
});
test('overpayment is credit, not negative due',()=>{
  const t=bookingTotals({checkin:'2026-12-01',checkout:'2026-12-02',rooms_count:1,nightly_rate_paise:10000,paid_paise:15000});
  assert.equal(t.due_paise,0);assert.equal(t.credit_paise,5000);
});
test('negative rates are rejected',()=>assert.throws(()=>toPaise(-100)));

test('money parser is exact for paise and rejects silent rounding',()=>{
  assert.equal(toPaise('4500.50'),450050);
  assert.equal(toPaise('0.01'),1);
  assert.equal(toPaise('00012.30'),1230);
  assert.equal(toPaise(4500.5),450050);
  for(const amount of ['1.005','0.001','1e3','-1','',null,undefined,NaN,Infinity,{},'abc']){
    assert.throws(()=>toPaise(amount),/non-negative|decimal/);
  }
  assert.throws(()=>toPaise('999999999999999999999.00'),/safe financial range/);
});
