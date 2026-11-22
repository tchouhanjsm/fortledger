import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createWorkspaceNavigator} from '../public/workspace-navigation.js';

function harness(){
  const win={location:{hash:'#dashboard'}};
  const events=[],attrs=new Map();
  const target={
    hidden:false,tabIndex:-1,
    hasAttribute:key=>attrs.has(key),
    setAttribute:(key,value)=>attrs.set(key,value),
    closest:()=>null,
    focus:opts=>events.push(['focus',opts.preventScroll]),
    scrollIntoView:opts=>events.push(['scroll',opts.block])
  };
  const doc={getElementById:id=>id==='home-closing'?target:null};
  let renderCount=0,nav;
  nav=createWorkspaceNavigator({win,doc,views:{dashboard:{},rooms:{},bookings:{}},
    render:()=>{renderCount++;nav.afterRender('dashboard');},
    canVisit:view=>view!=='rooms'});
  return {nav,win,events,attrs,target,get renderCount(){return renderCount;}};
}
test('same-view attention link focuses target and scrolls after rendering, exactly once',()=>{
  const h=harness();
  assert.equal(h.nav.navigate('dashboard','home-closing'),true);
  assert.equal(h.renderCount,1);
  assert.deepEqual(h.events,[['focus',true],['scroll','start']]);
  assert.equal(h.attrs.get('tabindex'),'-1');
  assert.equal(h.nav.afterRender('dashboard'),false);
  assert.equal(h.nav.navigate('dashboard','missing'),true);
  assert.equal(h.events.length,2,'missing target must not focus anything');
});
test('cross-view navigation waits for hashchange and refuses inaccessible or wrong targets',()=>{
  const h=harness();
  assert.equal(h.nav.navigate('bookings','home-closing'),true);
  assert.equal(h.win.location.hash,'#bookings');
  assert.equal(h.events.length,0);
  assert.equal(h.nav.afterRender('dashboard'),false);
  assert.equal(h.events.length,0);
  assert.equal(h.nav.navigate('rooms','home-closing'),false);
  assert.equal(h.win.location.hash,'#bookings');
  assert.throws(()=>h.nav.navigate('unknown','home-closing'),/Unknown workspace/);
  assert.throws(()=>h.nav.navigate('dashboard','../../secret'),/Invalid workspace target/);
});
test('real dashboard actions use shared route-aware target navigation',()=>{
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const source=app.slice(app.indexOf('function openFilteredBookingQueue'),app.indexOf('function renderDashboard'));
  assert.match(app,/workspaceNavigator\.afterRender\(view\)/);
  assert.match(source,/workspaceNavigator\.navigate\('bookings','bookings'\)/);
  assert.match(source,/workspaceNavigator\.navigate\('rooms','rooms'\)/);
  assert.match(source,/workspaceNavigator\.navigate\('rooms','maintenance-workspace'\)/);
  assert.match(source,/workspaceNavigator\.navigate\('restaurant','restaurant-history-section'\)/);
  assert.match(source,/workspaceNavigator\.navigate\('dashboard','home-closing'\)/);
  assert.doesNotMatch(source,/window\.location\.hash='business-settings';[\s\S]*daily-close-form/);
});
