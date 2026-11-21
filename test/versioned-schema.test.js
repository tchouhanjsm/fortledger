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
  assert.equal(db.pragma('user_version',{simple:true}),6);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n,7);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,1);
  assert.equal(db.prepare('SELECT amount_paise FROM payments').get().amount_paise,150000);
  assert.equal(db.prepare('SELECT method FROM payments').get().method,'unrecorded');
  db.close();
  db=openDatabase(file);
  assert.equal(db.pragma('user_version',{simple:true}),6);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,1);
  db.close();
  assert.equal(validateBackup(file).rooms,7);
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

test('existing v1 ledger upgrades to v2 expenses without erasing historical invoices or payments',()=>tempDb(file=>{
  let db=openDatabase(file);
  const booking=Number(db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
    VALUES('Synthetic','2026-12-01','2026-12-02',1,'Unassigned',450000)`).run().lastInsertRowid);
  db.prepare("INSERT INTO payments(booking_id,amount_paise,method) VALUES(?,150000,'upi')").run(booking);
  db.exec('DROP TABLE expenses');
  db.pragma('user_version = 1');
  db.close();
  db=openDatabase(file);
  assert.equal(db.pragma('user_version',{simple:true}),6);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,1);
  assert.equal(db.prepare('SELECT SUM(amount_paise) AS n FROM payments').get().n,150000);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='expenses'").get().n,1);
  db.close();
}));

test('existing v2 database receives only room housekeeping rows on upgrade to v3',()=>tempDb(file=>{
  let db=openDatabase(file);
  const id=Number(db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
    VALUES('Synthetic','2026-12-01','2026-12-02',1,'Unassigned',450000)`).run().lastInsertRowid);
  db.prepare("INSERT INTO payments(booking_id,amount_paise,method) VALUES(?,150000,'upi')").run(id);
  db.exec('DROP TABLE room_housekeeping');
  db.pragma('user_version = 2');
  db.close();
  db=openDatabase(file);
  assert.equal(db.pragma('user_version',{simple:true}),6);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM room_housekeeping').get().n,7);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM room_housekeeping WHERE status='ready'").get().n,7);
  assert.equal(db.prepare('SELECT SUM(amount_paise) AS n FROM payments').get().n,150000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,1);
  db.close();
}));

test('v3 inventory and finance data upgrade safely to v4 daily close table',()=>tempDb(file=>{
  let db=openDatabase(file);
  const id=Number(db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
    VALUES('Synthetic','2026-12-01','2026-12-02',1,'Unassigned',450000)`).run().lastInsertRowid);
  db.prepare("INSERT INTO payments(booking_id,amount_paise,method) VALUES(?,150000,'upi')").run(id);
  db.exec('DROP TABLE daily_closes');
  db.pragma('user_version = 3');
  db.close();
  db=openDatabase(file);
  assert.equal(db.pragma('user_version',{simple:true}),6);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='daily_closes'").get().n,1);
  assert.equal(db.prepare('SELECT SUM(amount_paise) AS n FROM payments').get().n,150000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM room_housekeeping').get().n,7);
  db.close();
}));

test('existing v4 bookings and payments survive additive maintenance schema v5 upgrade',()=>tempDb(file=>{
  let db=openDatabase(file);
  const id=Number(db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
    VALUES('Synthetic','2026-12-01','2026-12-02',1,'Unassigned',450000)`).run().lastInsertRowid);
  db.prepare("INSERT INTO payments(booking_id,amount_paise,method) VALUES(?,150000,'upi')").run(id);
  db.exec('DROP TABLE maintenance_issues');
  db.pragma('user_version = 4');
  db.close();
  db=openDatabase(file);
  assert.equal(db.pragma('user_version',{simple:true}),6);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM maintenance_issues").get().n,0);
  assert.equal(db.prepare("SELECT SUM(amount_paise) AS n FROM payments").get().n,150000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM room_housekeeping').get().n,7);
  db.close();
}));

test('v5 to v6 creates guest directory without changing existing hotel records',()=>tempDb(file=>{
  let db=openDatabase(file);
  const id=Number(db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
    VALUES('Historic synthetic','2026-12-01','2026-12-02',1,'Unassigned',450000)`).run().lastInsertRowid);
  db.prepare("INSERT INTO payments(booking_id,amount_paise,method) VALUES(?,150000,'upi')").run(id);
  db.exec('DROP INDEX idx_bookings_guest_profile');
  db.exec('ALTER TABLE bookings DROP COLUMN guest_id');
  db.exec('DROP TABLE guest_profiles');
  db.pragma('user_version = 5');
  db.close();
  db=openDatabase(file);
  assert.equal(db.pragma('user_version',{simple:true}),6);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_profiles').get().n,0);
  assert.equal(db.prepare('SELECT guest_id FROM bookings WHERE id=?').get(id).guest_id,null);
  assert.equal(db.prepare('SELECT SUM(amount_paise) AS n FROM payments').get().n,150000);
  db.close();
}));
