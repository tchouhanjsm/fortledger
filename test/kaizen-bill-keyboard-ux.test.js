import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('the bill review transition has one accessible focus target and a polite saved receipt status',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/<section id="restaurant-review"[^>]+aria-labelledby="restaurant-review-heading"/);
  assert.match(html,/<h3 id="restaurant-review-heading" tabindex="-1">/);
  assert.match(html,/<p id="restaurant-message" role="status" aria-live="polite" tabindex="-1">/);
  assert.match(app,/\$\('#restaurant-review-heading'\)\.focus\(\{preventScroll:true\}\)/);
  assert.match(app,/\$\('#menu-search'\)\.focus\(\{preventScroll:true\}\)/);
  assert.match(app,/message\.focus\(\{preventScroll:true\}\)/);
  assert.match(app,/\$\('#restaurant-review'\)\.scrollIntoView\(\{block:'nearest'\}\)/);
});

test('Heritage Sky remains offline and has keyboard focus/reduced-motion foundation',()=>{
  const css=readFileSync(new URL('../public/heritage-sky.css',import.meta.url),'utf8');
  assert.match(css,/:where\(button,a,input,select,textarea,summary\):focus-visible/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/--hs-focus:/);
  assert.match(css,/--hs-ivory:/);
  assert.doesNotMatch(css,/@import\s+url\(/);
});
