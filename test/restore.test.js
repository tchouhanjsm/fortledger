import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/database.js';
import {restoreDatabase,validateBackup} from '../src/restore.js';

test('restore a verified backup and preserve the prior database',async ()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-restore-test-'));
  try {
    const source=path.join(dir,'source.sqlite'), target=path.join(dir,'target.sqlite');
    const db=openDatabase(source);
    db.prepare("INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise) VALUES ('Synthetic','2026-12-01','2026-12-02',2,'Unassigned',450000)").run();
    const backup=path.join(dir,'backup.sqlite');
    await db.backup(backup);db.close();
    const old=openDatabase(target);
    old.prepare("INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise) VALUES ('Old synthetic','2026-12-04','2026-12-05',1,'Unassigned',350000)").run();
    old.close();
    assert.deepEqual(validateBackup(backup),{rooms:7,bookings:1});
    assert.throws(()=>restoreDatabase(backup,target),/confirm/);
    const result=restoreDatabase(backup,target,{confirm:true});
    assert.ok(result.previous&&fs.existsSync(result.previous));
    const restored=openDatabase(target);
    assert.equal(restored.prepare("SELECT guest_name FROM bookings").get().guest_name,'Synthetic');
    restored.close();
    const preserved=openDatabase(result.previous);
    assert.equal(preserved.prepare("SELECT guest_name FROM bookings").get().guest_name,'Old synthetic');
    preserved.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('reject invalid sqlite inputs without disturbing current data',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-restore-invalid-'));
  try{
    const target=path.join(dir,'target.sqlite');const db=openDatabase(target);db.close();
    const invalid=path.join(dir,'bad.sqlite');fs.writeFileSync(invalid,'not a database');
    assert.throws(()=>restoreDatabase(invalid,target,{confirm:true}));
    const reopened=openDatabase(target);
    assert.equal(reopened.prepare('SELECT count(*) AS n FROM rooms').get().n,7);
    reopened.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
