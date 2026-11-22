import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/server.js';
import Database from 'better-sqlite3';
import {openDatabase} from '../src/database.js';
import {importMenuCsv,listMenu,createRestaurantBill,restaurantBillRequest} from '../src/restaurant.js';
import {validateBackup} from '../src/restore.js';
import {diagnose} from '../src/doctor.js';
import {savePasswordRecord} from '../src/auth.js';

test('existing v7 hotel lacking restaurant_bill_requests migrates without touching past sales',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-v7-restaurant-'));
  const file=path.join(dir,'hotel.sqlite'),auth=path.join(dir,'admin-auth.json');
  let db;
  try{
    db=openDatabase(file);
    importMenuCsv(db,'name,category,price,tax_rate\nMasala Chai,Drinks,80,5');
    const old=createRestaurantBill(db,{payment_method:'upi',items:[{menu_item_id:listMenu(db)[0].id,quantity:2}]});
    const before=db.prepare('SELECT * FROM restaurant_bills WHERE id=?').get(old.id);
    db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
      VALUES('Synthetic Existing Guest','2027-04-01','2027-04-02',1,'Unassigned',400000)`).run();
    db.prepare("INSERT INTO payments(booking_id,amount_paise,method) VALUES(1,50000,'upi')").run();
    db.exec('DROP TABLE restaurant_bill_requests');
    db.pragma('user_version = 7');
    db.close();db=null;
    savePasswordRecord(auth,'synthetic owner password for migration');
    const prior=diagnose({databaseFile:file,authFile:auth,env:{}});
    assert.equal(prior.checks.find(c=>c.name==='Application schema').status,'fail');
    db=openDatabase(file);
    assert.equal(db.pragma('user_version',{simple:true}),12);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bill_requests').get().n,0,
      'Do not invent idempotency markers for historical bills');
    assert.deepEqual(db.prepare('SELECT * FROM restaurant_bills WHERE id=?').get(old.id),before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,1);
    assert.equal(db.prepare('SELECT SUM(amount_paise) AS n FROM payments').get().n,50000);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n,1);
    const body={request_id:randomUUID(),payment_method:'cash',
      items:[{menu_item_id:listMenu(db)[0].id,quantity:1}]};
    const saved=createRestaurantBill(db,body);
    assert.equal(saved.already_recorded,false);
    assert.equal(createRestaurantBill(db,body).already_recorded,true);
    assert.deepEqual(restaurantBillRequest(db,body.request_id),{recorded:true,id:saved.id});
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,2);
    db.close();db=null;
    db=openDatabase(file);
    assert.equal(db.pragma('user_version',{simple:true}),12);
    assert.equal(createRestaurantBill(db,body).id,saved.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,2);
    const upgraded=diagnose({databaseFile:file,authFile:auth,env:{}});
    assert.equal(upgraded.checks.find(c=>c.name==='Schema migration version').status,'pass');
    assert.equal(upgraded.checks.find(c=>c.name==='Application schema').status,'pass');
    assert.equal(validateBackup(file).rooms,7);
  }finally{db?.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('v7 restaurant migration is atomic on a corrupt legacy schema and never advances version',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-v7-failed-'));
  const file=path.join(dir,'hotel.sqlite');
  let db;
  try{
    db=openDatabase(file);
    importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,100,5');
    db.exec('DROP TABLE restaurant_bill_requests');
    // An incompatible table with the expected name must not be silently
    // marked as migrated; the operator needs an integrity repair, not a fake success.
    db.exec('CREATE TABLE restaurant_bill_requests(request_id TEXT PRIMARY KEY)');
    db.pragma('user_version = 7');
    db.close();db=null;
    assert.throws(()=>openDatabase(file),/restaurant bill request schema|no column named|no such column|missing/i);
    const inspect=new Database(file,{readonly:true,fileMustExist:true});
    assert.equal(inspect.pragma('user_version',{simple:true}),7);
    assert.equal(inspect.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n,1);
    inspect.close();
  }finally{db?.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('real HTTP bill creation succeeds on upgraded v7 hotel and preserves exactly-once writes',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-v7-api-'));
  const file=path.join(dir,'hotel.sqlite');
  let db,server;
  try{
    db=openDatabase(file);
    importMenuCsv(db,'name,category,price,tax_rate\nTea,Drinks,95,5');
    db.exec('DROP TABLE restaurant_bill_requests');
    db.pragma('user_version = 7');
    db.close();db=null;
    db=openDatabase(file);
    server=createApp(db).listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    const root='http://127.0.0.1:'+server.address().port;
    const request_id=randomUUID();
    const body={request_id,payment_method:'upi',
      items:[{menu_item_id:listMenu(db)[0].id,quantity:1}]};
    const post=()=>fetch(root+'/api/restaurant/bills',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const first=await post();
    assert.equal(first.status,201);
    const initial=await first.json();
    const retry=await post();
    assert.equal(retry.status,200);
    assert.equal((await retry.json()).id,initial.id);
    const lookup=await fetch(root+'/api/restaurant/bills/request/'+request_id);
    assert.deepEqual(await lookup.json(),{recorded:true,id:initial.id});
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bills').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_bill_requests').get().n,1);
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    db?.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('post-migration corruption is detected on startup before guest billing can begin',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-v8-guard-'));
  const file=path.join(dir,'hotel.sqlite');
  let db;
  try{
    db=openDatabase(file);
    assert.equal(db.pragma('user_version',{simple:true}),12);
    db.exec('DROP TABLE restaurant_bill_requests');
    db.close();db=null;
    assert.throws(()=>openDatabase(file),/Restaurant billing schema is incomplete/);
    const readOnly=new Database(file,{readonly:true,fileMustExist:true});
    assert.equal(readOnly.pragma('user_version',{simple:true}),12);
    readOnly.close();
  }finally{db?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
