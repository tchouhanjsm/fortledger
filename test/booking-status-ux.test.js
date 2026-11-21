import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('lifecycle status controls prevent duplicate in-flight mutations and release on failure',()=>{
  assert.match(js,/status\.disabled=true;row\.setAttribute\('aria-busy','true'\)/);
  assert.match(js,/await api\('\/api\/bookings\/'\+b\.id\+'\/status'/);
  assert.match(js,/status\.disabled=false;row\.removeAttribute\('aria-busy'\)/);
});
test('successful booking status persists independently of UI refresh outcome',()=>{
  assert.match(js,/let outcome;\s*try\{\s*outcome=await api/);
  assert.match(js,/try\{await load\(\);\}/);
  assert.match(js,/Booking status saved, but refresh failed/);
});
test('cancellation never implies an advance is automatically refunded',()=>{
  assert.match(js,/releases room inventory but does not automatically refund any advance/);
  assert.match(js,/if\(reason\.trim\(\)\.length<3\)/);
  assert.match(js,/body\.reason=reason\.trim\(\)/);
});
