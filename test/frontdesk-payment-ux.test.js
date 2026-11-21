import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');

test('received-payment form is accessible and requires amount and method',()=>{
  const html=read('index.html');
  assert.match(html,/<dialog id="booking-payment-dialog" aria-labelledby="payment-title">/);
  assert.match(html,/id="booking-payment-form"/);
  assert.match(html,/name="amount" type="number" min="0\.01" step="0\.01" required/);
  assert.match(html,/<select name="method" required>/);
  assert.match(html,/id="payment-message" role="status" aria-live="polite"/);
  assert.match(html,/Record only money actually received/);
});

test('received-payment dialog uses same request ID when retrying uncertain writes',()=>{
  const js=read('app.js');
  const begin=js.indexOf("$('#booking-payment-form').onsubmit=");
  const end=js.indexOf('async function showPayments(b)',begin);
  assert.ok(begin>=0&&end>begin);
  const handler=js.slice(begin,end);
  assert.match(handler,/form\.dataset\.pendingRequestId\|\|crypto\.randomUUID\(\)/);
  assert.match(handler,/form\.dataset\.pendingRequestId=request_id/);
  assert.match(handler,/JSON\.stringify\(\{amount,method,request_id\}\)/);
  assert.match(handler,/button\.disabled=true/);
  assert.match(handler,/if\(!can\('payments\.write'\)/);
  assert.match(handler,/Review the ledger before retrying/);
  assert.match(handler,/catch\(error\)\{alert\('Payment recorded, but refresh failed/);
  assert.doesNotMatch(handler,/prompt\(/);
});

test('payment and refund buttons follow current server permission names',()=>{
  const js=read('app.js');
  assert.match(js,/payment\.disabled=!can\('payments\.write'\)/);
  assert.match(js,/refundButton\.disabled=!can\('refunds\.write'\)/);
  assert.match(js,/payment\.onclick=\(\)=>addPayment\(b\)/);
});
