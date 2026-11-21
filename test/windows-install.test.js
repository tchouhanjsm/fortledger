import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {databasePath,authPath,dataDirectory} from '../src/data-paths.js';
import {openDatabase} from '../src/database.js';
import {backupBeforeUpdate} from '../src/backup-before-update.js';
import {validateBackup} from '../src/restore.js';

test('Windows external data location is independent of Git application code folder',()=>{
  const dir=path.join(os.tmpdir(),'synthetic-fortledger-test');
  const env={FORTLEDGER_DATA_DIR:dir};
  assert.equal(dataDirectory(env),path.resolve(dir));
  assert.equal(databasePath(env),path.join(path.resolve(dir),'fortledger.sqlite'));
  assert.equal(authPath(env),path.join(path.resolve(dir),'admin-auth.json'));
  assert.equal(databasePath({...env,FORTLEDGER_DB:path.join(dir,'special.sqlite')}),
    path.join(path.resolve(dir),'special.sqlite'));
});
test('pre-update backup is consistent, preserves credentials and does not alter source database',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-update-test-'));
  const data=path.join(root,'data'),backups=path.join(root,'update-backups');
  fs.mkdirSync(data);
  const source=path.join(data,'fortledger.sqlite');
  const auth=path.join(data,'admin-auth.json');
  fs.writeFileSync(auth,'{"synthetic":"hashed credential only"}');
  const db=openDatabase(source);
  db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
    VALUES('Synthetic','2026-12-01','2026-12-02',1,'Unassigned',450000)`).run();
  db.close();
  const hash=()=>createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  const before=hash();
  try{
    const backup=await backupBeforeUpdate(backups,{source,auth});
    const backedUpDb=path.join(backup.folder,'fortledger.sqlite');
    assert.equal(validateBackup(backedUpDb).bookings,1);
    assert.equal(validateBackup(backedUpDb).rooms,7);
    assert.equal(fs.readFileSync(path.join(backup.folder,'admin-auth.json'),'utf8'),
      fs.readFileSync(auth,'utf8'));
    assert.equal(hash(),before);
    assert.ok(fs.existsSync(path.join(backup.folder,'RECOVERY.txt')));
    assert.notEqual(backup.folder,data);
    await assert.rejects(()=>backupBeforeUpdate(data,{source,auth}),/outside/);
    // Prevent backups which appear separate by filename but are still located
    // within the live SQLite data tree (or linked into it).
    await assert.rejects(()=>backupBeforeUpdate(path.join(data,'nested','backups'),{source,auth}),/outside/);
    assert.equal(fs.existsSync(path.join(data,'nested','backups','fortledger.sqlite')),false);
    const alias=path.join(root,'external-alias');
    try{
      fs.symlinkSync(data,alias,process.platform==='win32'?'junction':'dir');
      await assert.rejects(()=>backupBeforeUpdate(path.join(alias,'nested'),{source,auth}),/outside/);
    }catch(error){
      if(!['EPERM','EACCES','ENOTSUP'].includes(error.code))throw error;
    }
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('updates do not create a missing or corrupt live database',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-update-empty-'));
  try{
    const source=path.join(root,'absent.sqlite'),backups=path.join(root,'backups');
    await assert.rejects(()=>backupBeforeUpdate(backups,{source}),/not found/);
    assert.equal(fs.existsSync(source),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
