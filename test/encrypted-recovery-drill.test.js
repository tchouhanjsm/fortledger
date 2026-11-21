import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/database.js';
import {createEncryptedBackup} from '../src/encrypted-backups.js';
import {rehearseEncryptedRecovery} from '../src/encrypted-recovery-drill.js';

const passphrase='synthetic-strong-backup-passphrase-2026';
test('rehearsal restores real encrypted artifact with existing finance without changing live DB',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-phase8-drill-'));
  let db;
  try{
    const live=path.join(dir,'live.sqlite'),auth=path.join(dir,'admin-auth.json');
    const backups=path.join(dir,'external-simulated');
    db=openDatabase(live);
    const booking=Number(db.prepare(`INSERT INTO bookings
      (guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
      VALUES('SECRET SYNTHETIC GUEST','2027-02-01','2027-02-02',1,'Unassigned',450000)`).run().lastInsertRowid);
    db.prepare("INSERT INTO payments(booking_id,amount_paise,method) VALUES(?,150000,'cash')").run(booking);
    fs.writeFileSync(auth,'{"synthetic":"test-only"}',{mode:0o600});
    const encrypted=await createEncryptedBackup(db,backups,passphrase);
    const result=rehearseEncryptedRecovery({backup:encrypted.file,passphrase,auth,live});
    assert.equal(result.ok,true);
    assert.equal(result.rooms,7);
    assert.equal(result.bookings,1);
    assert.equal(result.admin_auth_copied,true);
    assert.ok(result.schema_tables>10);
    assert.match(result.disclaimer,/not|no physical/i);
    assert.doesNotMatch(JSON.stringify(result),/SECRET SYNTHETIC GUEST|synthetic-strong/);
    assert.equal(db.prepare('SELECT SUM(amount_paise) AS n FROM payments').get().n,150000);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,1);
    assert.equal(fs.readdirSync(dir).some(x=>x.startsWith('restored.sqlite')),false);
  }finally{db?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('wrong password, changed bytes and absent credentials fail without touching live hotel',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-phase8-bad-'));
  let db;
  try{
    const live=path.join(dir,'live.sqlite'),auth=path.join(dir,'auth.json');
    db=openDatabase(live);
    const encrypted=await createEncryptedBackup(db,path.join(dir,'backups'),passphrase);
    assert.throws(()=>rehearseEncryptedRecovery({backup:encrypted.file,passphrase,auth,live}),/authentication file missing/);
    fs.writeFileSync(auth,'test-only');
    assert.throws(()=>rehearseEncryptedRecovery({
      backup:encrypted.file,passphrase:'incorrect-passphrase-long-enough',auth,live
    }),/authenticate|Unsupported state/i);
    const changed=fs.readFileSync(encrypted.file);
    changed[changed.length-1]^=1;fs.writeFileSync(encrypted.file,changed);
    assert.throws(()=>rehearseEncryptedRecovery({backup:encrypted.file,passphrase,auth,live}),/authenticate|Unsupported state/i);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n,7);
    assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
  }finally{db?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
