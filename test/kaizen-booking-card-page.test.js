import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BOOKING_CARD_BATCH,bookingCardPage} from '../public/booking-card-page.js';

test('initial booking DOM stays bounded while all matching records remain searchable',()=>{
  const items=Array.from({length:705},(_,i)=>({id:i+1}));
  const before=[...items];
  const page=bookingCardPage(items);
  assert.equal(BOOKING_CARD_BATCH,40);
  assert.equal(page.items.length,40);
  assert.equal(page.total,705);
  assert.equal(page.remaining,665);
  assert.equal(page.hasMore,true);
  assert.deepEqual(items,before);
  assert.deepEqual(bookingCardPage(items,80).items.at(-1),items[79]);
  assert.deepEqual(bookingCardPage(items,1000).items.at(-1),items.at(-1));
  assert.equal(bookingCardPage(items,1000).hasMore,false);
});
test('zero and under-batch data show no pagination button',()=>{
  assert.deepEqual(bookingCardPage([]),{items:[],total:0,shown:0,remaining:0,hasMore:false});
  assert.equal(bookingCardPage([{id:1}]).hasMore,false);
  assert.equal(bookingCardPage(Array.from({length:40},(_,i)=>i)).hasMore,false);
  assert.equal(bookingCardPage(Array.from({length:41},(_,i)=>i)).remaining,1);
});
test('invalid page inputs fail without altering the saved ledger',()=>{
  for(const [items,limit] of [[null,40],[[],0],[[],-1],[[],NaN],[[],1.5],[[],Infinity]])
    assert.throws(()=>bookingCardPage(items,limit),/Valid booking matches and visible count/);
});
test('UI computes all filters before limiting rendered cards and resets on query changes',()=>{
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const begin=app.indexOf('function renderBookings(){');
  const end=app.indexOf('function renderCalendar(){',begin);
  const src=app.slice(begin,end);
  assert.ok(src.indexOf("const filtered=bookings.filter")<src.indexOf("const page=bookingCardPage"));
  assert.match(src,/JSON\.stringify\(\[q,statusFilter,workFilter\]\)/);
  assert.match(src,/if\(filterKey!==lastBookingFilterKey\)/);
  assert.match(src,/for\(const b of page\.items\)/);
  assert.match(src,/loadMore\.hidden=!page\.hasMore/);
  assert.match(html,/id="booking-list-more"/);
  assert.match(app,/bookingCardVisibleCount\+=BOOKING_CARD_BATCH/);
  assert.match(src,/matching bookings shown/);
});
