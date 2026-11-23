import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/heritage-sky.css',import.meta.url),'utf8');
const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('main sidebar follows reception task order, with all eight bookmarkable routes',()=>{
  const begin=html.indexOf('aria-label="Primary">'),end=html.indexOf('</nav>',begin);
  const destinations=[...html.slice(begin,end).matchAll(/<a href="#([^"]+)"/g)].map(x=>x[1]);
  assert.deepEqual(destinations,['dashboard','bookings','rooms','restaurant','guests',
    'invoices','business-settings','profile']);
  assert.equal(new Set(destinations).size,8);
  assert.match(js,/nav\.hidden=Boolean\(currentUser&&!can\(VIEW_ACCESS/);
});
test('adaptive sidebar keeps labels and variable height/width without using an icon-only rail',()=>{
  const start=css.indexOf('/* Kaizen V4: one responsive sidebar contract');
  assert.ok(start>=0);
  const section=css.slice(start);
  assert.match(section,/@media \(min-width:701px\)/);
  assert.match(section,/width:clamp\(216px,18vw,272px\)/);
  assert.match(section,/height:100dvh/);
  assert.match(section,/gap:clamp\(5px,\.8vh,12px\)/);
  assert.match(section,/min-height:clamp\(44px,5\.5vh,54px\)/);
  assert.match(section,/font-size:clamp\(12px,1vw,14px\)/);
  assert.match(section,/@media \(min-width:701px\) and \(max-width:900px\)/);
  assert.match(section,/@media \(max-width:700px\)/);
  assert.doesNotMatch(section,/font-size:0|display:none.*nav a/);
});
test('mobile secondary navigation uses the existing route permissions and keyboard Escape recovery',()=>{
  assert.match(html,/id="mobile-shortcuts"/);
  assert.match(html,/id="mobile-more-panel"/);
  assert.match(js,/if\(event\.key!=='Escape'\)return/);
  assert.match(js,/toggle\.focus\(\{preventScroll:true\}\)/);
  assert.match(js,/toggle\.setAttribute\('aria-expanded','false'\)/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});
