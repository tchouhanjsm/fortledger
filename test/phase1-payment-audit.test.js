import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';

test('existing hotel payment rows survive additive migration with unknown method explicitly flagged',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-legacy-method-'));
  const file=path.join(dir,'legacy.sqlite');
  try{
    const legacy=new Database(file);
    legacy.exec(`
      CREATE TABLE rooms(id INTEGER PRIMARY KEY,name TEXT UNIQUE NOT NULL,category TEXT DEFAULT 'Unassigned',active INTEGER DEFAULT 1);
      INSERT INTO rooms(id,name) VALUES (1,'Room 1'),(2,'Room 2'),(3,'Room 3'),(4,'Room 4'),(5,'Room 5'),(6,'Room 6'),(7,'Room 7');
      CREATE TABLE bookings(id INTEGER PRIMARY KEY,guest_name TEXT NOT NULL,company_name TEXT NOT NULL DEFAULT '',checkin TEXT NOT NULL,checkout TEXT NOT NULL,rooms_count INTEGER NOT NULL,room_id INTEGER,category TEXT NOT NULL DEFAULT 'Unassigned',meal_plan TEXT NOT NULL DEFAULT 'CP',nightly_rate_paise INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'reserved',created_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO bookings(id,guest_name,checkin,checkout,rooms_count,nightly_rate_paise)
        VALUES(1,'Synthetic','2026-12-01','2026-12-02',1,450000);
      CREATE TABLE payments(id INTEGER PRIMARY KEY,booking_id INTEGER NOT NULL,amount_paise INTEGER NOT NULL,note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO payments(id,booking_id,amount_paise,note) VALUES(1,1,100000,'legacy deposit');
    `);
    legacy.close();
    const migrated=openDatabase(file);
    assert.equal(migrated.prepare('SELECT amount_paise FROM payments WHERE id=1').get().amount_paise,100000);
    assert.equal(migrated.prepare('SELECT method FROM payments WHERE id=1').get().method,'unrecorded');
    assert.equal(migrated.prepare('SELECT COUNT(*) AS n FROM rooms').get().n,7);
    migrated.close();
    const reopened=openDatabase(file);
    assert.equal(reopened.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('payments') WHERE name='method'").get().n,1);
    reopened.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('booking and payment audit records preserve actor, method and business records',async()=>{
  const db=openDatabase(':memory:'),server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const query=async(p,method='GET',body)=>{
    const response=await fetch(base+p,{method,headers:{'Content-Type':'application/json'},
      body:body?JSON.stringify(body):undefined});
    return {status:response.status,value:await response.json()};
  };
  try{
    const booking=await query('/api/bookings','POST',{guest_name:'Synthetic Test',
      checkin:'2026-12-01',checkout:'2026-12-02',rooms_count:2,category:'Unassigned',
      meal_plan:'CP',nightly_rate:4500,amount_paid:4500,advance_method:'upi'});
    assert.equal(booking.status,201);
    const id=booking.value.id;
    const receipt=await query('/api/bookings/'+id+'/payments','POST',{amount:250,method:'cash'});
    assert.equal(receipt.status,201);
    const payments=(await query('/api/bookings/'+id+'/payments')).value;
    assert.deepEqual(payments.map(x=>x.method),['upi','cash']);
    assert.equal(payments.reduce((sum,x)=>sum+x.amount_paise,0),475000);
    const audit=(await query('/api/audit/booking/'+id)).value;
    assert.equal(audit.length,1);
    assert.equal(audit[0].actor_username,'owner');
    assert.equal(audit[0].action,'booking.created');
    const paymentAudit=(await query('/api/audit/payment/'+payments[0].id)).value;
    assert.equal(paymentAudit[0].details.method,'upi');
    assert.equal((await query('/api/bookings')).value[0].due_paise,425000);
    assert.equal((await query('/api/audit/unsupported/1')).status,400);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
