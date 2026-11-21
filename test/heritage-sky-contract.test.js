import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=filename=>readFileSync(new URL('../public/'+filename,import.meta.url),'utf8');

test('Heritage Sky remains offline and includes real visible navigation',()=>{
  const index=read('index.html'),css=read('heritage-sky.css');
  assert.match(index,/href="\/heritage-sky\.css"/);
  assert.match(index,/href="#bookings"/);
  assert.match(index,/href="#rooms"/);
  assert.match(css,/\.sidebar nav\{display:flex/);
  assert.match(css,/\.sidebar nav a\{flex:none/);
  assert.match(css,/:focus-visible/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.doesNotMatch(css,/@import|url\(https?:/i);
});

test('Room overview uses separate confirmed, reserved, cleaning and outage states',()=>{
  const index=read('index.html'),js=read('app.js');
  assert.match(index,/id="today-room-board"/);
  assert.match(js,/function renderTodayRoomBoard\(today\)/);
  assert.match(js,/status==='checked_in'/);
  assert.match(js,/status==='reserved'/);
  assert.match(js,/Housekeeping: /);
  assert.match(js,/Out of service today/);
  assert.match(js,/if\(!can\('rooms.read'\)\)return/);
  assert.match(js,/function hotelToday\(\)/);
  assert.match(js,/timeZone:'Asia\/Kolkata'/);
});

test('Booking filtering retains backend lifecycle controls',()=>{
  const js=read('app.js'),index=read('index.html');
  assert.match(index,/id="booking-status-filter"/);
  assert.match(js,/statusFilter==='all'\|\|b\.status===statusFilter/);
  assert.match(js,/\$\('#booking-status-filter'\)\.onchange=renderBookings/);
  assert.match(js,/api\('\/api\/bookings\/'.*?\+b\.id\+'\/status'/s);
});

test('Cash closing remains explicit, server-sourced and stale visibly disclosed',()=>{
  const js=read('app.js');
  assert.match(js,/close\.stale\?'alert':'status'/);
  assert.match(js,/summary\.classList\.toggle\('close-stale'/);
  assert.match(js,/api\('\/api\/finance\/closing\?date='/);
  assert.match(js,/Record final day closing\?/);
});
