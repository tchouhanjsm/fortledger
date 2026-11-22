import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {importMenuCsv,planMenuImport,listMenu,createRestaurantBill,listRestaurantBills} from '../src/restaurant.js';

const key=Buffer.from('synthetic test-only preview signing secret');
const opts={require_preview:true,signingKey:key,confirm_import:true};
const csv=(rows)=>'name,category,price,tax_rate\n'+rows.join('\n');
test('menu import plans new/changed/unchanged/suspicious rows using stable NOCASE IDs and exact prices',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,csv(['Tea,Drinks,100,5','Coffee,Drinks,150,5','Water,Drinks,30,0','Soup,Food,80,5']));
    const tea=listMenu(db).find(x=>x.name==='Tea');
    const original=createRestaurantBill(db,{payment_method:'cash',items:[{menu_item_id:tea.id,quantity:2}]});
    const soupId=listMenu(db).find(x=>x.name==='Soup').id;
    db.prepare('UPDATE menu_items SET active=0 WHERE id=?').run(soupId);
    const update=csv(['tea,drinks,105,5','Coffee,Drinks,240,5','Water,Drinks,30,0',
      'Soup,Food,80,5','Juice,Drinks,45,5']);
    const preview=planMenuImport(db,update,{signingKey:key});
    assert.equal(preview.preview.length,5);
    assert.deepEqual(preview.summary,{new:1,updated:2,unchanged:1,suspicious:1});
    assert.equal(preview.preview[0].existing_id,tea.id);
    assert.equal(preview.preview[0].row_number,2);
    assert.equal(preview.preview[1].change,'suspicious');
    assert.equal(preview.preview[1].old_price_paise,15000);
    assert.equal(preview.preview[1].price_delta_paise,9000);
    assert.equal(preview.preview[3].reactivates,true);
    assert.equal(preview.preview[4].existing_id,null);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM menu_items').get().n,4,
      'Planning must never write');
    assert.throws(()=>importMenuCsv(db,update,{...opts,preview_token:preview.preview_token}),
      /Suspicious menu price/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM menu_items').get().n,4);
    const imported=importMenuCsv(db,update,{...opts,preview_token:preview.preview_token,approve_suspicious:true});
    assert.equal(imported.imported,5);
    assert.deepEqual(imported.summary,preview.summary);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM menu_items').get().n,5);
    assert.equal(db.prepare('SELECT price_paise FROM menu_items WHERE id=?').get(tea.id).price_paise,10500);
    assert.equal(db.prepare('SELECT active FROM menu_items WHERE id=?').get(soupId).active,1);
    assert.equal(listRestaurantBills(db)[0].items[0].unit_price_paise,10000);
    assert.equal(listRestaurantBills(db)[0].total_paise,original.total_paise);
    assert.throws(()=>importMenuCsv(db,update,{...opts,preview_token:preview.preview_token,approve_suspicious:true}),
      /changed after preview/,'The same approval cannot be replayed against a changed menu');
  }finally{db.close();}
});
test('menu preview rejects ambiguous case duplicates and flags GST rate changes without partial mutation',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,csv(['Masala Chai,Tea,120,5']));
    const gstChange=csv(['masala chai,tea,120,12']);
    const plan=planMenuImport(db,gstChange,{signingKey:key});
    assert.equal(plan.summary.suspicious,1);
    assert.match(plan.preview[0].concern,/GST rate/);
    assert.throws(()=>importMenuCsv(db,gstChange,{...opts,preview_token:plan.preview_token}),
      /explicit review/);
    assert.equal(listMenu(db)[0].tax_rate,5);
    db.prepare('INSERT INTO menu_items(name,category,price_paise,tax_rate) VALUES(?,?,?,?)')
      .run('MASALA CHAI','TEA',13000,5);
    assert.throws(()=>planMenuImport(db,gstChange,{signingKey:key}),/ambiguous case-duplicate/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM menu_items').get().n,2);
  }finally{db.close();}
});
test('preview approval binds original bytes, current menu state and current running server secret',()=>{
  const db=openDatabase(':memory:');
  try{
    importMenuCsv(db,csv(['Tea,Drinks,100,5']));
    const a=csv(['Tea,Drinks,105,5']),plan=planMenuImport(db,a,{signingKey:key});
    assert.throws(()=>importMenuCsv(db,a,{...opts}),/Preview this exact CSV/);
    assert.throws(()=>importMenuCsv(db,a,{...opts,preview_token:plan.preview_token,confirm_import:false}),
      /Confirm the reviewed/);
    assert.throws(()=>importMenuCsv(db,a+'\nJuice,Drinks,120,5',{...opts,preview_token:plan.preview_token}),
      /changed after preview/);
    assert.throws(()=>importMenuCsv(db,a,{...opts,signingKey:Buffer.from('different secret'),
      preview_token:plan.preview_token}),/changed after preview/);
    importMenuCsv(db,csv(['Coffee,Drinks,110,5']));
    assert.throws(()=>importMenuCsv(db,a,{...opts,preview_token:plan.preview_token}),/changed after preview/);
    assert.equal(listMenu(db).find(x=>x.name==='Tea').price_paise,10000);
  }finally{db.close();}
});
test('HTTP import cannot bypass exact preview, explicit confirmation or changed-state rejection',async()=>{
  const db=openDatabase(':memory:');
  importMenuCsv(db,csv(['Tea,Drinks,100,5']));
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const post=async(path,data)=>{
    const res=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(data)});
    return {status:res.status,body:await res.json()};
  };
  try{
    const src=csv(['Tea,Drinks,180,5']);
    const preview=await post('/api/restaurant/menu/preview',{csv:src});
    assert.equal(preview.status,200);
    assert.equal(preview.body.summary.suspicious,1);
    assert.equal((await post('/api/restaurant/menu/import',{csv:src})).status,400);
    assert.equal((await post('/api/restaurant/menu/import',{csv:src,
      preview_token:preview.body.preview_token,confirm_import:true})).status,400);
    const changed=await post('/api/restaurant/menu/import',{csv:src,
      preview_token:preview.body.preview_token,confirm_import:true,approve_suspicious:true});
    assert.equal(changed.status,200);
    assert.equal(changed.body.summary.suspicious,1);
    assert.equal(listMenu(db)[0].price_paise,18000);
    const replay=await post('/api/restaurant/menu/import',{csv:src,
      preview_token:preview.body.preview_token,confirm_import:true,approve_suspicious:true});
    assert.equal(replay.status,400);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM menu_items').get().n,1);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
test('dashboard warning targets actual closing form and unmatched bill filter',()=>{
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const attention=app.slice(app.indexOf('function renderTodayAttention'),app.indexOf('function renderDashboard'));
  assert.match(attention,/workspaceNavigator\.navigate\('dashboard','home-closing'\)/);
  assert.match(attention,/\$\('#home-closing'\)\.open=true/);
  assert.match(attention,/restaurantBillFilter='unmatched'/);
  assert.doesNotMatch(attention,/daily-close-form[\s\S]*window\.location\.hash='business-settings'/);
});
