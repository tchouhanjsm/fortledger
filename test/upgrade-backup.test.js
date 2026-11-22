import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {openDatabase} from '../src/database.js';
import {savePasswordRecord,createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {requiredPermission} from '../src/access.js';
import {createApp} from '../src/server.js';
import {prepareVerifiedUpgradeBackup,UpgradeBackupRefusal,isSeparateBackupVolume}
  from '../src/upgrade-backup.js';
import {credentialCompanionPath,createEncryptedBackup} from '../src/encrypted-backups.js';

const passphrase='synthetic-independent-update-backup-secret-123';
async function fixture(cb){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-prepare-upgrade-'));
  const data=path.join(root,'data'),backup=path.join(root,'external');
  fs.mkdirSync(backup);
  const live=path.join(data,'fortledger.sqlite'),auth=path.join(data,'admin-auth.json');
  const db=openDatabase(live);
  savePasswordRecord(auth,'synthetic-owner-credential-password-123');
  try{
    return await cb({root,data,backup,live,auth,db,env:{
      FORTLEDGER_BACKUP_DIR:backup,FORTLEDGER_BACKUP_PASSPHRASE:passphrase,
      FORTLEDGER_DATA_DIR:data
    }});
  }finally{
    db.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
}
test('owner prepares an encrypted pair and proves complete isolated recovery without changing hotel data',()=>fixture(async({backup,live,auth,db,env})=>{
  db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
    VALUES('Synthetic internal guest','2027-02-01','2027-02-03',1,'Unassigned',500000)`).run();
  const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  db.pragma('wal_checkpoint(TRUNCATE)');
  const beforeAuth=hash(auth);
  const count=db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n;
  const state=await prepareVerifiedUpgradeBackup(db,{env,authFile:auth,liveFile:live,
    // The CI test workspace is on a single disk; only mock the physical
    // separate-drive predicate, NEVER the real encryption/recovery code.
    independent:()=>true});
  assert.equal(state.state,'prepared');
  assert.equal(state.isolated_restore_verified,true);
  assert.equal(state.owner_credential_recoverable,true);
  assert.equal(state.independent_drive,true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,count);
  assert.equal(hash(auth),beforeAuth);
  const files=fs.readdirSync(backup).filter(x=>x.endsWith('.flbk'));
  assert.equal(files.length,1);
  assert.equal(fs.existsSync(credentialCompanionPath(path.join(backup,files[0]))),true);
  assert.doesNotMatch(JSON.stringify(state),/Synthetic|\.flbk|admin-auth|\\\\|\/tmp\//);
}));
test('refuse same-PC, misconfigured, corrupt-owner and same-volume destinations before creating a backup',()=>fixture(async({backup,live,auth,db,env})=>{
  const fn=args=>prepareVerifiedUpgradeBackup(db,{env,authFile:auth,liveFile:live,...args});
  await assert.rejects(fn({env:{...env,FORTLEDGER_BACKUP_LOCAL_ONLY:'1'},independent:()=>true}),
    /Only same-computer emergency/);
  await assert.rejects(fn({independent:()=>false}),/same drive/);
  await assert.rejects(fn({env:{...env,FORTLEDGER_BACKUP_DIR:backup+'-missing'},independent:()=>true}),
    /unavailable/);
  await assert.rejects(fn({env:{...env,FORTLEDGER_BACKUP_PASSPHRASE:'bad'},independent:()=>true}),
    /Configure the external/);
  fs.writeFileSync(auth,'corrupt-json');
  await assert.rejects(fn({independent:()=>true}),/original owner credential/);
  assert.equal(fs.readdirSync(backup).length,0);
  assert.equal(isSeparateBackupVolume('C:\\HotelBackups','C:\\HotelData\\ledger.sqlite','win32'),false);
  assert.equal(isSeparateBackupVolume('E:\\HotelBackups','C:\\HotelData\\ledger.sqlite','win32'),true);
}));
test('failed isolated recovery never reports upgrade prepared or discards an uncertain backup',()=>fixture(async({live,auth,db,env,backup})=>{
  await assert.rejects(prepareVerifiedUpgradeBackup(db,{
    env,authFile:auth,liveFile:live,independent:()=>true,
    rehearse:()=>({ok:true,rooms:7,owner_credential_recoverable:false})
  }),/could not be created and completely verified/);
  assert.equal(fs.readdirSync(backup).some(x=>x.endsWith('.flbk')),true,
    'Do not silently delete questionable backup files; preserve them for review');
}));
test('prepare endpoint is owner-only, localhost-only, serializes clicks and waits during shutdown',async()=>{
  assert.equal(requiredPermission('POST','/system/backup-prepare'),'system.update');
  assert.equal(requiredPermission('GET','/system/backup-prepare'),null);
  const db=openDatabase(':memory:');
  createStaff(db,{username:'cashierupgrade',display_name:'Cashier',
    role:'cashier',password:'synthetic-cashier-upgrade-password-123'});
  let release;
  const waiting=new Promise(resolve=>release=resolve);
  let attempts=0;
  const app=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-upgrade-password-123'),
    prepareUpgradeBackup:async()=>{attempts++;await waiting;
      return {state:'prepared',isolated_restore_verified:true,owner_credential_recoverable:true};}});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  async function login(username,password){
    const r=await fetch(url+'/api/auth/login',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    assert.equal(r.status,200);
    return r.headers.get('set-cookie').split(';')[0];
  }
  const request=cookie=>fetch(url+'/api/system/backup-prepare',{method:'POST',
    headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:'{}'});
  try{
    assert.equal((await request()).status,401);
    const cashier=await login('cashierupgrade','synthetic-cashier-upgrade-password-123');
    assert.equal((await request(cashier)).status,403);
    assert.equal(attempts,0);
    const owner=await login('owner','synthetic-owner-upgrade-password-123');
    const first=request(owner);
    for(let i=0;i<80&&attempts===0;i++)await new Promise(r=>setTimeout(r,10));
    assert.equal(attempts,1);
    assert.equal((await request(owner)).status,409);
    let idle=false;
    const stopped=app.locals.waitForUpgradeBackup().then(()=>{idle=true;});
    await new Promise(r=>setTimeout(r,10));
    assert.equal(idle,false);
    release();
    assert.equal((await first).status,200);
    await stopped;
    assert.equal(idle,true);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE active=1').get().n,7);
  }finally{
    release();
    await new Promise(r=>server.close(r));
    db.close();
  }
});

test('Windows installer rejects a decryptable legacy SQLite-only backup without original owner credentials',()=>fixture(async({backup,live,auth,db})=>{
  const good=await createEncryptedBackup(db,backup,passphrase,{authFile:auth});
  const old=await createEncryptedBackup(db,backup,passphrase);
  const drill=path.resolve('src/encrypted-recovery-drill.js');
  const env={...process.env,FORTLEDGER_BACKUP_PASSPHRASE:passphrase,
    FORTLEDGER_AUTH_FILE:auth,FORTLEDGER_DB:live};
  const run=file=>spawnSync(process.execPath,[drill,file,'--require-owner-companion'],
    {env,encoding:'utf8',timeout:20000});
  const accepted=run(good.file);
  assert.equal(accepted.status,0,'Verified encrypted pair should qualify: '+accepted.stderr);
  const refused=run(old.file);
  assert.notEqual(refused.status,0,'Legacy SQLite-only archive must not qualify');
  assert.match(refused.stderr,/owner credential companion is missing/);
  const guard=fs.readFileSync(new URL('../scripts/windows-installer-guard.ps1',import.meta.url),'utf8');
  assert.match(guard,/--require-owner-companion/);
}));
