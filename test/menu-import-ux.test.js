import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {parseMenuCsv,importMenuCsv,listMenu} from '../src/restaurant.js';
import {createApp} from '../src/server.js';

test('Excel BOM, alternative headings and reordered extra columns are supported',()=>{
  const csv='\uFEFFItem Name,GST %,Price (INR),Category,Notes\r\n"Tea, Masala",5%,₹105.00,Beverages,Hot\r\nCoffee,0,150,Drinks,Cold\r\n';
  const items=parseMenuCsv(csv);
  assert.equal(items.length,2);
  assert.deepEqual(items[0],{name:'Tea, Masala',category:'Beverages',price_paise:10500,tax_rate:5});
  const db=openDatabase(':memory:');
  try{
    assert.equal(importMenuCsv(db,csv).imported,2);
    assert.equal(listMenu(db).length,2);
  }finally{db.close();}
});
test('bad CSV has row-specific errors and never partially imports',()=>{
  const db=openDatabase(':memory:');
  try{
    assert.throws(()=>importMenuCsv(db,'Item Name,Category,Price\nTea,Drinks,100'),/tax_rate/);
    assert.throws(()=>importMenuCsv(db,'Item Name,Category,Price,GST\nTea,Drinks,100,\n'),/Line 2.*blank/);
    assert.throws(()=>importMenuCsv(db,'Item Name,Category,Price,GST\nTea,Drinks,100,5\nBad,Drinks,-1,5\n'),/Line 3/);
    assert.equal(listMenu(db).length,0);
  }finally{db.close();}
});
test('preview is non-mutating; importing verified CSV writes once',async()=>{
  const db=openDatabase(':memory:');
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try{
    const base='http://127.0.0.1:'+server.address().port;
    const csv='Item Name,Category,Price,GST Rate\nTea,Beverages,100,5';
    const headers={'Content-Type':'application/json'};
    const preview=await fetch(base+'/api/restaurant/menu/preview',{method:'POST',headers,body:JSON.stringify({csv})});
    assert.equal(preview.status,200);
    const checked=await preview.json();
    assert.equal(checked.count,1);
    assert.equal(checked.preview.length,1);
    assert.deepEqual(checked.category_counts,{Beverages:1});
    assert.deepEqual(checked.tax_rates,[5]);
    assert.equal(listMenu(db).length,0);
    const imported=await fetch(base+'/api/restaurant/menu/import',{method:'POST',headers,body:JSON.stringify({csv})});
    assert.equal(imported.status,200);
    assert.equal(listMenu(db).length,1);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});

test('bulk menu review returns every row and detects category/rate coverage without importing',async()=>{
  const db=openDatabase(':memory:');
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try{
    const base='http://127.0.0.1:'+server.address().port;
    const rows=Array.from({length:142},(_,i)=>
      'Dish '+String(i+1).padStart(3,'0')+','+(i<80?'Breakfast':'Dinner')+','+(100+i)+','+(i<80?5:12));
    const csv='name,category,price,tax_rate\n'+rows.join('\n');
    const response=await fetch(base+'/api/restaurant/menu/preview',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csv})});
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal(data.count,142);
    assert.equal(data.preview.length,142);
    assert.deepEqual(data.category_counts,{Breakfast:80,Dinner:62});
    assert.deepEqual(data.tax_rates,[5,12]);
    assert.equal(listMenu(db).length,0,'Review must not change the ledger');
    const imported=await fetch(base+'/api/restaurant/menu/import',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csv})});
    assert.equal(imported.status,200);
    assert.equal(listMenu(db).length,142);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
