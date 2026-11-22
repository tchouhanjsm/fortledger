import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/database.js';
import {savePasswordRecord,verifyPassword,loadPasswordRecord} from '../src/auth.js';
import {createEncryptedBackup,credentialCompanionPath,verifyEncryptedCredentialCompanion,
  decryptEncryptedCredentialCompanion,scheduleEncryptedBackups} from '../src/encrypted-backups.js';
import {rehearseEncryptedRecovery} from '../src/encrypted-recovery-drill.js';
import {verifyLocalBackupHealth} from '../src/backup-health.js';

const secret='synthetic-encrypted-owner-companion-backup-passphrase';
const fixture=async function(callback){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-credentials-pair-'));
  const live=path.join(root,'data','fortledger.sqlite');
  const auth=path.join(root,'data','admin-auth.json');
  const backups=path.join(root,'backups');
  const db=openDatabase(live);
  savePasswordRecord(auth,'synthetic-original-owner-password-123');
  try{return await callback({root,live,auth,backups,db});}
  finally{db.close();fs.rmSync(root,{recursive:true,force:true});}
};
test('new AES-GCM credential companion is independently encrypted, decryptable and never contains plaintext hash',()=>fixture(async({root,live,auth,backups,db})=>{
  const encrypted=await createEncryptedBackup(db,backups,secret,{authFile:auth});
  assert.equal(encrypted.owner_credentials_encrypted,true);
  const companion=credentialCompanionPath(encrypted.file);
  assert.equal(path.extname(companion),'.flba');
  assert.equal(fs.existsSync(companion),true);
  const text=fs.readFileSync(companion).toString('utf8');
  assert.doesNotMatch(text,/"salt"|"hash"|synthetic-original-owner-password/);
  assert.deepEqual(verifyEncryptedCredentialCompanion(encrypted.file,secret),
    {present:true,verified:true});
  assert.throws(()=>verifyEncryptedCredentialCompanion(encrypted.file,'wrong-password-long-enough'),
    /authenticate|Unsupported state/i);
  const restoredAuth=path.join(root,'restored-admin-auth.json');
  assert.equal(decryptEncryptedCredentialCompanion(encrypted.file,restoredAuth,secret),true);
  assert.equal(verifyPassword('synthetic-original-owner-password-123',loadPasswordRecord(restoredAuth)),true);
  assert.throws(()=>decryptEncryptedCredentialCompanion(encrypted.file,restoredAuth,secret),/already exist|overwrite/);
  const drill=rehearseEncryptedRecovery({backup:encrypted.file,passphrase:secret,auth,live});
  assert.equal(drill.ok,true);
  assert.equal(drill.owner_credential_recoverable,true);
  assert.equal(drill.rooms,7);
  const health=verifyLocalBackupHealth({env:{
    FORTLEDGER_BACKUP_DIR:backups,FORTLEDGER_BACKUP_PASSPHRASE:secret},
    live,auth});
  assert.equal(health.restorable,true);
  assert.equal(health.owner_credential_recoverable,true);
  assert.equal(health.state,'attention','Same physical disk is not independent protection');
}));
test('old standalone encrypted SQLite backups remain readable but are flagged incomplete for owner recovery',()=>fixture(async({root,live,auth,backups,db})=>{
  const encrypted=await createEncryptedBackup(db,backups,secret);
  assert.equal(encrypted.owner_credentials_encrypted,false);
  assert.deepEqual(verifyEncryptedCredentialCompanion(encrypted.file,secret),
    {present:false,verified:false});
  const drill=rehearseEncryptedRecovery({backup:encrypted.file,passphrase:secret,auth,live});
  assert.equal(drill.ok,true);
  assert.equal(drill.owner_credential_recoverable,false);
  assert.equal(decryptEncryptedCredentialCompanion(encrypted.file,path.join(root,'old-owner-auth'),secret),false);
}));
test('retention removes encrypted SQLite and corresponding owner companions together',()=>fixture(async({auth,backups,db})=>{
  for(const day of ['2026-11-20','2026-11-21','2026-11-22']){
    await createEncryptedBackup(db,backups,secret,{retain:2,authFile:auth,
      now:new Date(day+'T04:00:00Z')});
  }
  const names=fs.readdirSync(backups);
  assert.equal(names.filter(f=>f.endsWith('.flbk')).length,2);
  assert.equal(names.filter(f=>f.endsWith('.flba')).length,2);
  for(const filename of names.filter(f=>f.endsWith('.flbk'))){
    assert.equal(fs.existsSync(credentialCompanionPath(path.join(backups,filename))),true);
  }
}));
test('tampered or missing owner companion never reports a complete backup; live hotel data untouched',()=>fixture(async({auth,backups,live,db})=>{
  const encrypted=await createEncryptedBackup(db,backups,secret,{authFile:auth});
  const companion=credentialCompanionPath(encrypted.file);
  const encryptedBytes=fs.readFileSync(companion);
  encryptedBytes[encryptedBytes.length-1]^=1;
  fs.writeFileSync(companion,encryptedBytes);
  assert.throws(()=>verifyEncryptedCredentialCompanion(encrypted.file,secret),/authenticate|Unsupported state/i);
  const health=verifyLocalBackupHealth({env:{FORTLEDGER_BACKUP_DIR:backups,
    FORTLEDGER_BACKUP_PASSPHRASE:secret},live,auth});
  assert.equal(health.state,'failed');
  assert.equal(health.restorable,false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rooms').get().n,7);
}));
test('scheduled backup includes installed Windows owner credential when stored beside the data ledger',()=>fixture(async({root,auth,live,db})=>{
  const backups=path.join(root,'scheduled');
  const env={FORTLEDGER_DATA_DIR:path.dirname(live),
    FORTLEDGER_BACKUP_DIR:backups,FORTLEDGER_BACKUP_PASSPHRASE:secret};
  const errors=[];
  const scheduled=scheduleEncryptedBackups(db,env,{intervalMs:100000,
    logger:{info(){},warn(){},error:m=>errors.push(m)}});
  try{
    await scheduled.idle();
    const files=fs.readdirSync(backups).filter(x=>x.endsWith('.flbk'));
    assert.equal(files.length,1);
    assert.equal(fs.existsSync(credentialCompanionPath(path.join(backups,files[0]))),true);
    assert.deepEqual(errors,[]);
  }finally{scheduled.stop();await scheduled.idle();}
}));
