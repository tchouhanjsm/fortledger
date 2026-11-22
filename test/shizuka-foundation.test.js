import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=f=>readFileSync(new URL('../public/'+f,import.meta.url),'utf8');
const css=read('heritage-sky.css'),html=read('index.html'),sprite=read('shizuka-icons.svg');
const value=token=>{
  const escaped=token.replace(/[.*+?^${ }()|[\]\\]/g,'\\$&');
  const match=css.match(new RegExp(escaped+':(#[0-9a-f]{6})\\b','i'));
  assert.ok(match,'Missing hex design token '+token);return match[1];
};
const luminance=hex=>{
  const channel=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
    .map(n=>n<=.04045?n/12.92:Math.pow((n+.055)/1.055,2.4));
  return channel[0]*.2126+channel[1]*.7152+channel[2]*.0722;
};
const ratio=(a,b)=>{
  const x=luminance(a),y=luminance(b);
  return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
};

test('SHIZUKA canonical palette is AA-contrast-safe for meaningful text',()=>{
  assert.equal(value('--sh-washi'),'#f8f6f1');
  assert.equal(value('--sh-indigo'),'#192b42');
  assert.equal(value('--sh-focus'),'#245da8');
  for(const foreground of ['--sh-indigo','--sh-slate','--sh-moss','--sh-vermilion']){
    for(const background of ['--sh-washi','--sh-paper'])
      assert.ok(ratio(value(foreground),value(background))>=4.5,
        foreground+' on '+background+' must meet 4.5:1');
  }
  assert.ok(ratio(value('--sh-brass'),value('--sh-paper'))<4.5,
    'Brass is decorative only, never normal success/status text');
  assert.match(css,/--hs-ink:var\(--sh-indigo\)/);
  assert.match(css,/--hs-focus:var\(--sh-focus\)/);
  assert.doesNotMatch(css,/url\(https?:|@import/i);
});
test('spacing scale and focus use one consistent source, not an added competing theme',()=>{
  const expected={1:4,2:8,3:12,4:16,5:20,6:24,8:32,10:40,12:48,16:64};
  for(const [k,v] of Object.entries(expected))
    assert.match(css,new RegExp('--sh-space-'+k+':'+v+'px\\b'));
  assert.match(css,/--sh-control-height:44px/);
  assert.match(css,/main\{min-width:0;max-width:1600px;padding:var\(--sh-space-8\)\}/);
  assert.match(css,/main\{padding:var\(--sh-space-4\);max-width:none\}/);
  assert.match(css,/#mobile-shortcuts a:focus-visible[^\n]+outline:3px solid var\(--hs-focus\)/);
  assert.doesNotMatch(read('styles.css'),/:root\{font-family:/,
    'The Heritage Sky root owns base typography and surfaces');
});
test('local navigation icons have consistent geometry and accessible text',()=>{
  const labels=['Dashboard','Booking Calendar','Room Inventory','Guests',
    'Invoices','Hotel Settings','Restaurant','My Profile'];
  const ids=['layout-dashboard','calendar-days','bed-double','users',
    'receipt-text','settings-2','utensils','circle-user-round'];
  const nav=html.match(/<nav aria-label="Primary">([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(nav);
  assert.equal((nav.match(/class="nav-icon"/g)||[]).length,8);
  for(let i=0;i<labels.length;i++){
    assert.match(nav,new RegExp('href="/shizuka-icons\\.svg#'+ids[i]+'"'));
    assert.ok(nav.includes(labels[i]+'</a>'));
    assert.ok(sprite.includes('id="'+ids[i]+'" viewBox="0 0 24 24"'));
  }
  assert.equal((nav.match(/aria-hidden="true"/g)||[]).length,8);
  assert.match(css,/\.sidebar \.nav-icon\{[^}]*width:20px;height:20px;/);
  assert.match(html,/id="skip-to-main"/);
  assert.match(html,/id="workspace-main" tabindex="-1"/);
  assert.match(read('app.js'),/\$\('#skip-to-main'\)\.onclick=/);
  assert.doesNotMatch(nav,/[◈▦▤♙▧⚙☕◉]/);
});


test('reservation header uses a defined layout instead of competing flex children',()=>{
  const operations=read('heritage-sky-operations.css');
  assert.match(operations,/#bookings > \.panel-head\{[\s\S]*?grid-template-areas:"intro queues" "intro filters"/);
  assert.match(operations,/grid-template-areas:"intro" "queues" "filters"/);
  assert.match(operations,/@media\(max-width:600px\)\{\.booking-filters\{grid-template-columns:minmax\(0,1fr\)\}\}/);
  assert.doesNotMatch(operations,/\.booking-filters select\{max-width:min\(100%,290px\)/);
});
