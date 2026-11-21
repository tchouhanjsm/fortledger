import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bookingDraftError} from '../public/booking-editor-guards.js';

const valid={checkin:'2026-11-21',checkout:'2026-11-23',rooms_count:'2'};
test('booking validation accepts back-to-back hotel nights and partial room assignment',()=>{
  assert.equal(bookingDraftError(valid,0),'');
  assert.equal(bookingDraftError(valid,1),'');
  assert.equal(bookingDraftError(valid,2),'');
});
test('checkout date must follow checkin and incomplete dates are blocked',()=>{
  for(const dates of [
    {checkin:'2026-11-21',checkout:'2026-11-21'},
    {checkin:'2026-11-21',checkout:'2026-11-20'},
    {checkin:'',checkout:'2026-11-23'},
    {checkin:'2026-11-21',checkout:''}
  ])assert.match(bookingDraftError({...valid,...dates},1),/Check-out must be after check-in/);
});
test('room count is limited to seven and cannot be exceeded by assignments',()=>{
  assert.match(bookingDraftError({...valid,rooms_count:0},0),/one and seven/);
  assert.match(bookingDraftError({...valid,rooms_count:8},0),/one and seven/);
  assert.match(bookingDraftError(valid,3),/cannot exceed/);
});
test('form guards preserve unsaved work and prevent dismissal while saving',()=>{
  const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(js,/function bookingFormSnapshot\(\)/);
  assert.match(js,/roomIds=\[\.\.\.document\.querySelectorAll\('#room-assignment-list input:checked'\)\]/);
  assert.match(js,/bookingFormSnapshot\(\)!==bookingFormBaseline/);
  assert.match(js,/Discard unsaved booking changes\?/);
  assert.match(js,/addEventListener\('cancel',event=>/);
  assert.match(js,/if\(bookingSavePending\)\{event\.preventDefault\(\);return;\}/);
  assert.match(js,/if\(bookingSavePending\)return;/);
  assert.match(js,/bookingDraftError\(data,data\.room_ids\.length\)/);
  assert.match(js,/bookings\/request\/.*encodeURIComponent\(data.request_id\)/);
  assert.match(js,/Retry only unchanged details/);
  assert.match(js,/network response was lost, but the original booking was confirmed/);
});
test('checkin and checkout require physical confirmation and existing folio review',()=>{
  const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(js,/Confirm the guest has physically arrived/);
  assert.match(js,/Checkout will mark assigned rooms as needing cleaning/);
  assert.match(js,/folio\.combined_due_paise>0/);
  assert.match(js,/body\.acknowledge_balance=true/);
});
