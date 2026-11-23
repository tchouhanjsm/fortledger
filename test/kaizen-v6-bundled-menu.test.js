import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {GARH_JAISAL_MENU_CSV,GARH_JAISAL_MENU_COUNT,planBundledMenuSync,
  applyBundledMenuSync} from '../src/bundled-garh-jaisal-menu.js';
import {parseMenuCsv,importMenuCsv,listMenu,listMenuForManagement,
  createRestaurantBill,setMenuItemAvailability,updateMenuItemPrice,listRestaurantBills} from '../src/restaurant.js';
import {auditEvents} from '../src/financial-audit.js';
import {requiredPermission} from '../src/access.js';

const owner={id:0,username:'owner',role:'owner'};
const manager={id:8,username:'manager',role:'manager'};
const key=()=>randomBytes(32);
test('owner-provided Garh Jaisal menu is fully bundled, with 142 valid GST-provisional entries',()=>{
  const items=parseMenuCsv(GARH_JAISAL_MENU_CSV);
  assert.equal(GARH_JAISAL_MENU_COUNT,142);
  assert.equal(items.length,142);
  assert.equal(items.find(x=>x.name==='Masala Chai').price_paise,8000);
  assert.equal(items.find(x=>x.name==='Lal Maas').price_paise,70000);
  assert.equal(items.find(x=>x.name==='Chapati').price_paise,32000);
  assert.equal(items.every(x=>x.tax_rate===5),true);
  assert.equal(new Set(items.map(x=>(x.name+' / '+x.category).toLowerCase())).size,142);
});
test('empty installation can review and add all 142 items once, with no generic sample items',()=>{
  const db=openDatabase(':memory:');try{
    const signingKey=key(),p=planBundledMenuSync(db,{signingKey});
    assert.equal(p.count,142);assert.equal(p.missing,142);
    assert.equal(p.preserved,0);assert.deepEqual(p.tax_rates,[5]);
    assert.ok(p.preview_token);
    assert.throws(()=>applyBundledMenuSync(db,{
      preview_token:p.preview_token,confirm_sync:true,confirm_provisional_gst:true
    },{id:4,role:'cashier',username:'cashier'},{signingKey}),/Only owner or manager/);
    assert.throws(()=>applyBundledMenuSync(db,{
      preview_token:p.preview_token,confirm_sync:true
    },owner,{signingKey}),/provisional GST/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM menu_items').get().n,0);
    const result=applyBundledMenuSync(db,{preview_token:p.preview_token,
      confirm_sync:true,confirm_provisional_gst:true},owner,{signingKey});
    assert.deepEqual({added:result.added,preserved:result.preserved,total:result.total},
      {added:142,preserved:0,total:142});
    assert.equal(listMenu(db).length,142);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM operation_audit WHERE action=?').get('menu_item.bundled_added').n,142);
    const again=planBundledMenuSync(db,{signingKey});
    assert.equal(again.missing,0);assert.equal(again.preserved,142);
    const repeat=applyBundledMenuSync(db,{preview_token:again.preview_token,
      confirm_sync:true,confirm_provisional_gst:true},owner,{signingKey});
    assert.equal(repeat.added,0);assert.equal(repeat.preserved,142);
    assert.equal(db.pragma('foreign_key_check').length,0);
  }finally{db.close();}
});
test('existing price, GST, unavailable dishes, IDs and historic bill snapshots are never overwritten',()=>{
  const db=openDatabase(':memory:');try{
    importMenuCsv(db,'name,category,price,tax_rate\nMasala Chai,Hot Drinks,250,0\nLal Maas,Mutton,1500,12\n');
    const old=listMenuForManagement(db);
    const tea=old.find(x=>x.name==='Masala Chai');
    setMenuItemAvailability(db,tea.id,{active:false,expected_active:true},manager);
    const meat=old.find(x=>x.name==='Lal Maas');
    const before=createRestaurantBill(db,{payment_method:'cash',request_id:randomUUID(),
      items:[{menu_item_id:meat.id,quantity:1,unit_price_paise:150000,tax_rate:12}]},owner,
      {requireReviewedPrices:true});
    const signingKey=key(),preview=planBundledMenuSync(db,{signingKey});
    assert.equal(preview.missing,140);
    assert.equal(preview.preserved,2);
    const result=applyBundledMenuSync(db,{preview_token:preview.preview_token,
      confirm_sync:true,confirm_provisional_gst:true},manager,{signingKey});
    assert.equal(result.added,140);
    const after=listMenuForManagement(db);
    assert.equal(after.length,142);
    assert.deepEqual(after.find(x=>x.name==='Masala Chai'),{...tea,active:0});
    assert.deepEqual(after.find(x=>x.name==='Lal Maas'),meat);
    assert.equal(listRestaurantBills(db).find(x=>x.id===before.id).total_paise,150000);
    assert.equal(listRestaurantBills(db).find(x=>x.id===before.id).items[0].tax_rate,12);
    assert.equal(db.pragma('foreign_key_check').length,0);
  }finally{db.close();}
});
test('stale or forged preview fails atomically and never changes a manager-updated menu',()=>{
  const db=openDatabase(':memory:');try{
    importMenuCsv(db,'name,category,price,tax_rate\nMasala Chai,Hot Drinks,80,5');
    const signingKey=key(),preview=planBundledMenuSync(db,{signingKey});
    const id=listMenu(db)[0].id;
    updateMenuItemPrice(db,id,{price_paise:11000,tax_rate:5,
      expected_price_paise:8000,expected_tax_rate:5,
      reason:'Reviewed current menu adjustment'},manager);
    assert.throws(()=>applyBundledMenuSync(db,{preview_token:preview.preview_token,
      confirm_sync:true,confirm_provisional_gst:true},manager,{signingKey}),
      /changed after the built-in preview/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM menu_items').get().n,1);
    assert.throws(()=>applyBundledMenuSync(db,{preview_token:'fabricated',
      confirm_sync:true,confirm_provisional_gst:true},manager,{signingKey}),
      /changed after the built-in preview/);
    assert.equal(listMenu(db)[0].price_paise,11000);
  }finally{db.close();}
});
test('bundled menu API is manager-only, and a cashier can bill after reviewed sync',async()=>{
  assert.equal(requiredPermission('GET','/restaurant/menu/bundled/preview'),'menu.manage');
  assert.equal(requiredPermission('POST','/restaurant/menu/bundled/sync'),'menu.manage');
  const db=openDatabase(':memory:');
  const ownerPassword='alpha-owner-password-strong-enough';
  createStaff(db,{username:'cashiermenus',display_name:'Cashier',role:'cashier',
    password:'strong-cashier-password-123'});
  const server=createApp(db,{authRecord:createPasswordRecord(ownerPassword)}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  async function request(path,method='GET',body,cookie){
    const res=await fetch(base+path,{method,
      headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
    return {status:res.status,body:await res.json(),
      cookie:res.headers.get('set-cookie')?.split(';')[0]};
  }
  try{
    const o=await request('/api/auth/login','POST',{password:ownerPassword});
    const c=await request('/api/auth/login','POST',
      {username:'cashiermenus',password:'strong-cashier-password-123'});
    assert.equal((await request('/api/restaurant/menu/bundled/preview','GET',null,c.cookie)).status,403);
    assert.equal((await request('/api/restaurant/menu/bundled/sync','POST',{
      preview_token:'fake',confirm_sync:true,confirm_provisional_gst:true
    },c.cookie)).status,403);
    assert.equal((await request('/api/restaurant/menu/bundled/preview')).status,401);
    const review=await request('/api/restaurant/menu/bundled/preview','GET',null,o.cookie);
    assert.equal(review.status,200);assert.equal(review.body.missing,142);
    const added=await request('/api/restaurant/menu/bundled/sync','POST',{
      preview_token:review.body.preview_token,confirm_sync:true,confirm_provisional_gst:true
    },o.cookie);
    assert.equal(added.status,200);assert.equal(added.body.added,142);
    assert.equal((await request('/api/restaurant/menu','GET',null,c.cookie)).body.length,142);
    assert.equal((await request('/api/restaurant/menu/bundled/preview','GET',null,c.cookie)).status,403);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
test('built-in menu controls are keyboard-accessible, hidden from cashier and require GST acknowledgement',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/id="bundled-menu-section"/);
  assert.match(html,/id="bundled-menu-sync"[^>]*disabled/);
  assert.match(html,/id="bundled-menu-gst-ack" type="checkbox"/);
  assert.match(js,/confirm_provisional_gst:true/);
  assert.match(js,/if\(!can\('menu\.manage'\)/);
  assert.match(js,/bundledMenuPreview\.missing===0/);
});
