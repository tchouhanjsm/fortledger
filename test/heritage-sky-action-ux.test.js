import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/heritage-sky-operations.css',import.meta.url),'utf8');
test('routine booking actions stay primary; sensitive secondary actions stay accessible',()=>{
  assert.match(js,/actions\.append\(edit,payment,folioButton,more\)/);
  assert.match(js,/moreItems\.append\(notesButton,history,refundButton,proforma\)/);
  assert.match(js,/moreTitle\.setAttribute\('aria-label','More actions for booking #'/);
  assert.match(js,/payment\.disabled=!can\('payments\.write'\)/);
  assert.match(js,/refundButton\.disabled=!can\('refunds\.write'\)/);
});
test('responsive action disclosure is keyboard accessible and hidden routes stay hidden',()=>{
  assert.match(css,/\[hidden\]\{display:none!important\}/);
  assert.match(css,/\.booking-more summary:focus-visible/);
  assert.match(css,/\.booking-more-actions button\{min-height:42px/);
  assert.doesNotMatch(css,/url\(https?:/i);
});
