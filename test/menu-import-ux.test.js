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
    assert.equal((await preview.json()).count,1);
    assert.equal(listMenu(db).length,0);
    const imported=await fetch(base+'/api/restaurant/menu/import',{method:'POST',headers,body:JSON.stringify({csv})});
    assert.equal(imported.status,200);
    assert.equal(listMenu(db).length,1);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
