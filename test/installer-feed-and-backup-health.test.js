import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {checkInstallerUpdate,readInstalledDesktopBuild} from '../src/installer-update-feed.js';
import {verifyLocalBackupHealth} from '../src/backup-health.js';
import {createEncryptedBackup} from '../src/encrypted-backups.js';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {requiredPermission} from '../src/access.js';

const installed='a'.repeat(40),next='b'.repeat(40);
const old={sha:installed,build_number:3};
const run={id:121,head_sha:next,head_branch:'main',event:'push',
  status:'completed',conclusion:'success',name:'Windows Installer (unsigned alpha)',
  run_number:8};
function readFeed({runs=[run],artifacts=[{name:'FortLedger-Windows-Setup-alpha',id:19,
  size_in_bytes:30000000,expired:false}]}={}){
  return async url=>url.includes('/workflows/')?{workflow_runs:runs}:{artifacts};
}
const approve=async sha=>({approved:true,sha});

test('Only exact main push with full CI evidence and nonexpired official artifact can notify installer update',async()=>{
  const good=await checkInstallerUpdate({installed:old,read:readFeed(),approve});
  assert.equal(good.state,'installer_update_available');
  assert.equal(good.available,true);
  assert.equal(good.remote,next.slice(0,12));
  assert.equal(good.download_url,
    'https://github.com/tchouhanjsm/fortledger/actions/runs/121/artifacts/19');
  for(const bad of [
    {...run,head_branch:'feature'}, {...run,event:'pull_request'},
    {...run,status:'queued'}, {...run,conclusion:'failure'},
    {...run,run_number:3}, {...run,head_sha:installed},
    {...run,name:'Unexpected workflow'}, {...run,head_sha:'broken'}
  ]){
    const result=await checkInstallerUpdate({installed:old,read:readFeed({runs:[bad]}),approve});
    assert.equal(result.available,false);
  }
  for(const bad of [
    {name:'FortLedger-Windows-Setup-alpha',id:19,size_in_bytes:30000000,expired:true},
    {name:'FortLedger-Windows-Setup-alpha',id:19,size_in_bytes:5,expired:false},
    {name:'SomethingElse',id:19,size_in_bytes:30000000,expired:false}
  ]){
    assert.equal((await checkInstallerUpdate({
      installed:old,read:readFeed({artifacts:[bad]}),approve})).available,false);
  }
  assert.equal((await checkInstallerUpdate({installed:old,read:readFeed(),
    approve:async()=>({approved:false})})).available,false);
  const offline=await checkInstallerUpdate({installed:old,read:async()=>{throw Error('offline');},approve});
  assert.equal(offline.state,'installer_check_unavailable');
  assert.equal(offline.available,false);
  assert.equal(offline.download_url,null);
});
test('Build identity reads only valid pinned sha/build number metadata',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-build-stamp-'));
  const file=path.join(dir,'installer-build.json');
  try{
    assert.equal(readInstalledDesktopBuild(file),null);
    fs.writeFileSync(file,JSON.stringify({sha:next,build_number:8}));
    assert.deepEqual(readInstalledDesktopBuild(file),{sha:next,build_number:8});
    fs.writeFileSync(file,JSON.stringify({sha:'bad',build_number:8}));
    assert.equal(readInstalledDesktopBuild(file),null);
    fs.writeFileSync(file,JSON.stringify({sha:next,build_number:0}));
    assert.equal(readInstalledDesktopBuild(file),null);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('On-demand backup verification decrypts into isolated scratch without changing live SQLite',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-owner-backup-status-'));
  const db=openDatabase(':memory:');
  try{
    const auth=path.join(folder,'admin-auth.json');
    fs.writeFileSync(auth,JSON.stringify(createPasswordRecord('synthetic-password-long-123')));
    const env={FORTLEDGER_BACKUP_DIR:folder,
      FORTLEDGER_BACKUP_PASSPHRASE:'a-long-secret-for-synthetic-tests'};
    const first=verifyLocalBackupHealth({env,auth,live:path.join(folder,'live.sqlite')});
    assert.equal(first.state,'missing');
    await createEncryptedBackup(db,folder,env.FORTLEDGER_BACKUP_PASSPHRASE);
    const verified=verifyLocalBackupHealth({env,auth,live:path.join(folder,'live.sqlite')});
    assert.equal(verified.restorable,true);
    assert.equal(verified.owner_auth_present,true);
    assert.equal(verified.independent_drive,false);
    assert.equal(verified.state,'attention');
    const wrong=verifyLocalBackupHealth({env:{...env,FORTLEDGER_BACKUP_PASSPHRASE:'wrong-secret-but-still-long-enough'},
      auth,live:path.join(folder,'live.sqlite')});
    assert.equal(wrong.restorable,false);
    assert.equal(wrong.state,'failed');
    assert.doesNotMatch(JSON.stringify(wrong),/synthetic-tests|\.flbk/);
  }finally{db.close();fs.rmSync(folder,{recursive:true,force:true});}
});
test('Backup verification and release status remain authenticated owner-only',async()=>{
  assert.equal(requiredPermission('GET','/system/backup-verify'),'system.update');
  const db=openDatabase(':memory:');
  createStaff(db,{username:'cashierupdate',display_name:'Cashier',role:'cashier',
    password:'synthetic-cashier-password-long'});
  let invoked=0;
  const app=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-password-long'),
    checkBackupHealth:()=>{invoked++;return {state:'verified',restorable:true};},
    checkUpdates:async()=>({platform:'windows',state:'installer_update_available',available:true,
      download_url:'https://github.com/tchouhanjsm/fortledger/actions/runs/121/artifacts/19'})});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  try{
    assert.equal((await fetch(url+'/api/system/backup-verify')).status,401);
    const login=async(name,password)=>{
      const response=await fetch(url+'/api/auth/login',{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({username:name,password})});
      assert.equal(response.status,200);
      return response.headers.get('set-cookie').split(';')[0];
    };
    const cashier=await login('cashierupdate','synthetic-cashier-password-long');
    assert.equal((await fetch(url+'/api/system/backup-verify',{headers:{Cookie:cashier}})).status,403);
    const owner=await login('owner','synthetic-owner-password-long');
    const response=await fetch(url+'/api/system/backup-verify',{headers:{Cookie:owner}});
    assert.equal(response.status,200);
    assert.equal((await response.json()).restorable,true);
    assert.equal(invoked,1,'No expensive restore attempt for unauthorized staff');
    const update=await fetch(url+'/api/system/updates',{headers:{Cookie:owner}});
    assert.equal(update.status,200);
    assert.equal((await update.json()).state,'installer_update_available');
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
