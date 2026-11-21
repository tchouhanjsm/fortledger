import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {openDatabase} from '../src/database.js';
import {validateBackup} from '../src/restore.js';

function tempDb(work){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-migration-'));
  const file=path.join(dir,'hotel.sqlite');
  try{return work(file);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('legacy version-zero database upgrades once without losing hotel records',()=>tempDb(file=>{
  let db=openDatabase(file);
  const booking=Number(db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
    VALUES('Synthetic','2026-12-01','2026-12-02',1,'Unassigned',450000)`).run().lastInsertRowid);
  db.prepare("INSERT INTO payments(booking_id,amount_paise,method) VALUES(?,150000,'unrecorded')").run(booking);
  db.pragma('user_version = 0'); // simulate pre-versioned, already populated installation
  db.close();
  db=openDatabase(file);
  assert.equal(db.pragma('user_version',{simple:true}),1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n,7);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,1);
  assert.equal(db.prepare('SELECT amount_paise FROM payments').get().amount_paise,150000);
  assert.equal(db.prepare('SELECT method FROM payments').get().method,'unrecorded');
  db.close();
  db=openDatabase(file);
  assert.equal(db.pragma('user_version',{simple:true}),1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,1);
  db.close();
  assert.equal(validateBackup(file).schema_version,1);
}));
test('future schema versions are rejected without changing the file',()=>tempDb(file=>{
  let db=openDatabase(file);
  db.pragma('user_version = 99');db.close();
  assert.throws(()=>openDatabase(file),/newer than this FortLedger version/);
  const inspect=new Database(file,{readonly:true});
  assert.equal(inspect.pragma('user_version',{simple:true}),99);
  assert.equal(inspect.prepare('SELECT COUNT(*) AS n FROM rooms').get().n,7);
  inspect.close();
  assert.throws(()=>validateBackup(file),/newer than this application/);
}));
test('failed legacy upgrade rolls back instead of marking invalid data migrated',()=>tempDb(file=>{
  let db=openDatabase(file);
  db.close();
  const broken=new Database(file);
  broken.pragma('foreign_keys = OFF');
  broken.prepare(`INSERT INTO payments(booking_id,amount_paise,method) VALUES(99999,10000,'unrecorded')`).run();
  broken.pragma('user_version = 0');
  broken.close();
  assert.throws(()=>openDatabase(file),/foreign key violations/);
  const inspect=new Database(file,{readonly:true});
  assert.equal(inspect.pragma('user_version',{simple:true}),0);
  assert.equal(inspect.prepare('SELECT COUNT(*) AS n FROM payments').get().n,1);
  inspect.close();
  assert.throws(()=>validateBackup(file),/foreign-key consistency/);
}));
