import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/database.js';
import {scheduleEncryptedBackups,verifyEncryptedBackupFile} from '../src/encrypted-backups.js';

test('graceful desktop shutdown waits for the current encrypted backup before SQLite closes',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-shutdown-backup-'));
  const db=openDatabase(':memory:');
  let release,started;
  const gate=new Promise(resolve=>release=resolve);
  const startedPromise=new Promise(resolve=>started=resolve);
  const source={backup:async target=>{
    started();
    await gate;
    await db.backup(target);
  }};
  const env={FORTLEDGER_BACKUP_DIR:root,
    FORTLEDGER_BACKUP_PASSPHRASE:'synthetic-long-private-backup-passphrase'};
  const errors=[];
  const scheduler=scheduleEncryptedBackups(source,env,{
    intervalMs:100000,
    logger:{info(){},error:(...parts)=>errors.push(parts.join(' '))}
  });
  try{
    await startedPromise;
    scheduler.stop();
    let completed=false;
    const idle=scheduler.idle().then(()=>{completed=true;});
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(completed,false,'Encrypted backup still in progress');
    assert.equal(scheduler.run(),scheduler.run(),
      'Shutdown must never start a second backup while the first runs');
    release();
    await idle;
    assert.deepEqual(errors,[]);
    const artifacts=fs.readdirSync(root).filter(f=>f.endsWith('.flbk'));
    assert.equal(artifacts.length,1);
    assert.equal(verifyEncryptedBackupFile(path.join(root,artifacts[0]),
      env.FORTLEDGER_BACKUP_PASSPHRASE).rooms,7);
  }finally{
    release();
    scheduler.stop();
    await scheduler.idle();
    db.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
});
