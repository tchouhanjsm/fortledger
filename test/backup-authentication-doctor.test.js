import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/database.js';
import {createEncryptedBackup,verifyEncryptedBackupFile} from '../src/encrypted-backups.js';
import {savePasswordRecord} from '../src/auth.js';
import {diagnose} from '../src/doctor.js';

const secret='safe-only-synthetic-backup-secret-123';
test('doctor authenticates newest backup before declaring it recent or reliable',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-backup-audit-'));
  let db;
  try{
    const live=path.join(dir,'live','fortledger.sqlite');
    const backupDir=path.join(dir,'separate','backups');
    const auth=path.join(dir,'live','admin-auth.json');
    db=openDatabase(live);savePasswordRecord(auth,'test-only-strong-owner-password-123');
    const saved=await createEncryptedBackup(db,backupDir,secret);
    const env={FORTLEDGER_BACKUP_DIR:backupDir,FORTLEDGER_BACKUP_PASSPHRASE:secret};
    const healthy=diagnose({databaseFile:live,authFile:auth,env});
    assert.equal(healthy.checks.find(c=>c.name==='Encrypted backup integrity').status,'pass');
    assert.equal(healthy.checks.find(c=>c.name==='Encrypted backups').status,'pass');
    assert.equal(healthy.checks.find(c=>c.name==='Backup storage separation').status,'warn');
    assert.equal(healthy.production_ready,false);
    assert.equal(verifyEncryptedBackupFile(saved.file,secret).rooms,7);

    const corrupted=Buffer.from(fs.readFileSync(saved.file));
    corrupted[corrupted.length-1]^=0x02;
    fs.writeFileSync(saved.file,corrupted);
    const broken=diagnose({databaseFile:live,authFile:auth,env});
    assert.equal(broken.checks.find(c=>c.name==='Encrypted backup integrity').status,'fail');
    assert.equal(broken.healthy,false);
    assert.equal(broken.production_ready,false);
    assert.equal(fs.existsSync(live),true);
    assert.throws(()=>verifyEncryptedBackupFile(saved.file,secret),/authenticate|Unsupported state/i);
  }finally{db?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('doctor cannot be fooled by a recent backup timestamp with the wrong passphrase',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-backup-pass-'));
  let db;
  try{
    const live=path.join(dir,'hotel.sqlite'),backups=path.join(dir,'backups');
    const auth=path.join(dir,'admin-auth.json');
    db=openDatabase(live);savePasswordRecord(auth,'test-only-strong-owner-password-123');
    await createEncryptedBackup(db,backups,secret);
    const result=diagnose({databaseFile:live,authFile:auth,
      env:{FORTLEDGER_BACKUP_DIR:backups,FORTLEDGER_BACKUP_PASSPHRASE:'different-password-long-enough'}});
    assert.equal(result.checks.find(c=>c.name==='Encrypted backup integrity').status,'fail');
    assert.equal(result.healthy,false);
  }finally{db?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
