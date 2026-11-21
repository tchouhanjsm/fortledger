import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/database.js';
import {encryptBackupBytes,decryptBackupBytes,createEncryptedBackup,decryptBackupFile,scheduleEncryptedBackups} from '../src/encrypted-backups.js';

const secret='a long unique test backup password 123';
test('authenticated encryption rejects wrong passphrase and modified bytes',()=>{
  const plaintext=Buffer.from('SQLite synthetic content');
  const one=encryptBackupBytes(plaintext,secret),two=encryptBackupBytes(plaintext,secret);
  assert.equal(decryptBackupBytes(one,secret).toString(),plaintext.toString());
  assert.notDeepEqual(one,two);
  assert.throws(()=>decryptBackupBytes(one,'a different 16-character password'),/authenticate|Unsupported state/i);
  const changed=Buffer.from(one);changed[changed.length-1]^=0x01;
  assert.throws(()=>decryptBackupBytes(changed,secret),/authenticate|Unsupported state/i);
  assert.throws(()=>encryptBackupBytes(plaintext,'short'),/16/);
});
test('encrypted backup captures valid SQLite and decrypts to a verified candidate',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-encrypted-test-'));
  const db=openDatabase(':memory:');
  try{
    db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
      VALUES('Synthetic','2026-12-01','2026-12-02',1,'Unassigned',450000)`).run();
    const result=await createEncryptedBackup(db,dir,secret,{retain:2});
    assert.ok(fs.existsSync(result.file));
    assert.match(result.file,/\.flbk$/);
    assert.notEqual(fs.readFileSync(result.file).toString('utf8',0,15),'SQLite format 3');
    const candidate=path.join(dir,'restored.sqlite');
    const details=decryptBackupFile(result.file,candidate,secret);
    assert.equal(details.rooms,7);
    assert.equal(details.bookings,1);
    const restored=openDatabase(candidate);
    assert.equal(restored.prepare('SELECT guest_name FROM bookings').get().guest_name,'Synthetic');
    restored.close();
    assert.throws(()=>decryptBackupFile(result.file,candidate,secret),/exists/);
    assert.throws(()=>decryptBackupFile(result.file,path.join(dir,'bad.sqlite'),'wrong password long enough'),/authenticate|Unsupported state/i);
    assert.equal(fs.existsSync(path.join(dir,'bad.sqlite')),false);
    await createEncryptedBackup(db,dir,secret,{retain:2,now:new Date('2026-12-02T00:00:00Z')});
    await createEncryptedBackup(db,dir,secret,{retain:2,now:new Date('2026-12-03T00:00:00Z')});
    assert.equal(fs.readdirSync(dir).filter(f=>f.endsWith('.flbk')).length,2);
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('automatic backup is opt-in and does not run without configured secrets',()=>{
  const db=openDatabase(':memory:');
  try{
    const warnings=[];
    const scheduler=scheduleEncryptedBackups(db,{},{
      logger:{warn:x=>warnings.push(x),info:()=>{},error:()=>{}}
    });
    assert.equal(scheduler,null);
    assert.equal(warnings.length,1);
  }finally{db.close();}
});
