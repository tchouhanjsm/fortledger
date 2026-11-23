import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {planCodeChanges,gitBlobSha,inspectDesktopCodeUpdate,
  installDesktopCodeUpdate} from '../src/desktop-code-update.js';
import {readInstalledDesktopBuild} from '../src/installer-update-feed.js';

const oldSha='a'.repeat(40),newSha='b'.repeat(40);
const file=(p,bytes)=>({path:p,sha:gitBlobSha(bytes),mode:'100644',size:Buffer.byteLength(bytes)});
const map=(entries)=>new Map(entries.map(x=>[x.path,x]));
const unchanged=[
 file('package.json','{"version":"0.1.0"}'),
 file('package-lock.json','lock'),
 file('scripts/windows-desktop-launcher.cs','launcher'),
 file('scripts/windows-backup-settings.ps1','config'),
 file('scripts/windows-configure-backups.ps1','config'),
 file('scripts/windows-configure-staff-lan.ps1','config')
];
const before=map([...unchanged,file('src/server.js','old-server'),
 file('public/index.html','old-ui')]);
const after=map([...unchanged,file('src/server.js','new-server'),
 file('public/index.html','new-ui'),file('src/new-feature.js','export const newFeature=true;')]);
const makeFixture=()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-app-code-'));
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-updates-'));
  fs.mkdirSync(path.join(root,'src'));fs.mkdirSync(path.join(root,'public'));
  fs.writeFileSync(path.join(root,'src/server.js'),'old-server');
  fs.writeFileSync(path.join(root,'public/index.html'),'old-ui');
  fs.writeFileSync(path.join(root,'installer-build.json'),JSON.stringify({
    sha:oldSha,build_number:80}));
  return {root,work,cleanup:()=>{
    fs.rmSync(root,{recursive:true,force:true});
    fs.rmSync(work,{recursive:true,force:true});
  }};
};
const env={LOCALAPPDATA:'C:\\Fake\\FortLedger',FORTLEDGER_DESKTOP_UPDATE_HOST:'1',
  FORTLEDGER_DATA_DIR:'C:\\Fake\\FortLedger\\data',
  FORTLEDGER_BACKUP_DIR:'D:\\PrivateBackup',FORTLEDGER_BACKUP_PASSPHRASE:'dummy-only-not-used'};
const feed=async()=>({state:'installer_update_available',available:true,target_sha:newSha,
  remote:newSha.slice(0,12),run_number:90,
  download_url:'https://github.com/tchouhanjsm/fortledger/actions/runs/2/artifacts/3'});
const tree=async sha=>sha===oldSha?before:after;
const backup=()=>({restorable:true,owner_auth_present:true,owner_credential_recoverable:true,independent_drive:true});
const freshness=()=>({state:'recent'});
const content={'src/server.js':'new-server','public/index.html':'new-ui',
  'src/new-feature.js':'export const newFeature=true;'};
test('code patch plan touches only actual src/public changes and never native files',()=>{
  const plan=planCodeChanges(before,after);
  assert.equal(plan.supported,true);
  assert.deepEqual(plan.changes.map(x=>x.path).sort(),
    ['public/index.html','src/new-feature.js','src/server.js']);
  assert.equal(gitBlobSha('hello'),createHash('sha1')
    .update('blob 5\0hello').digest('hex'));
});
test('native dependency, tray and backup script changes refuse source-only update',()=>{
  for(const target of ['package-lock.json','scripts/windows-desktop-launcher.cs',
    'scripts/windows-configure-backups.ps1']){
    const changed=map([...after.values()].map(row=>
      row.path===target?file(target,'different'):row));
    const plan=planCodeChanges(before,changed);
    assert.equal(plan.supported,false);
    assert.match(plan.reason,/full Windows installer/);
  }
  const symlink=map([...after.values(),{path:'src/symlink',
    sha:'a'.repeat(40),mode:'120000',size:10}]);
  assert.equal(planCodeChanges(before,symlink).supported,false);
});
test('owner readiness refuses unverified external backups and wrong host',async()=>{
  const f=makeFixture();try{
    const base={root:f.root,env,platform:'win32',
      feed,trees:tree,freshness,backupHealth:backup};
    assert.equal((await inspectDesktopCodeUpdate(base)).ready,true);
    assert.equal((await inspectDesktopCodeUpdate({...base,
      env:{...env,FORTLEDGER_DESKTOP_UPDATE_HOST:'0'}})).ready,false);
    assert.equal((await inspectDesktopCodeUpdate({...base,
      backupHealth:()=>({restorable:false})})).ready,false);
    assert.equal((await inspectDesktopCodeUpdate({...base,
      freshness:()=>({state:'stale'})})).ready,false);
    const revised=map([...after.values()].map(row=>row.path==='package-lock.json'?
      file('package-lock.json','different'):row));
    assert.equal((await inspectDesktopCodeUpdate({...base,
      trees:async sha=>sha===oldSha?before:revised})).ready,false);
  }finally{f.cleanup();}
});
test('pinned update modifies only changed source, preserves other files and persists build identity',async()=>{
  const f=makeFixture();try{
    const keep=path.join(f.root,'node.exe');
    const owner=path.join(f.root,'admin-auth.json');
    fs.writeFileSync(keep,'original bundled runtime');
    fs.writeFileSync(owner,'original owner hash');
    const result=await installDesktopCodeUpdate(newSha,{root:f.root,workRoot:f.work,
      env,platform:'win32',feed,trees:tree,freshness,backupHealth:backup,
      fetchFile:async (sha,p)=>Buffer.from(content[p])});
    assert.equal(result.changed,3);
    assert.equal(fs.readFileSync(path.join(f.root,'src/server.js'),'utf8'),'new-server');
    assert.equal(fs.readFileSync(path.join(f.root,'public/index.html'),'utf8'),'new-ui');
    assert.equal(fs.readFileSync(path.join(f.root,'src/new-feature.js'),'utf8'),
      'export const newFeature=true;');
    assert.equal(fs.readFileSync(owner,'utf8'),'original owner hash');
    assert.equal(fs.readFileSync(keep,'utf8'),'original bundled runtime');
    assert.equal(readInstalledDesktopBuild(path.join(f.root,'installer-build.json')).sha,newSha);
    assert.equal(readInstalledDesktopBuild(path.join(f.root,'installer-build.json')).build_number,90);
    assert.match(fs.readFileSync(path.join(f.work,'code-update-journal.jsonl'),'utf8'),
      /"kind":"source_applied"/);
  }finally{f.cleanup();}
});
test('bad pinned Git content and modified local source never install or advance version',async()=>{
  for(const corrupt of [true,false]){
    const f=makeFixture();
    try{
      if(!corrupt)fs.writeFileSync(path.join(f.root,'src/server.js'),'operator edited');
      await assert.rejects(installDesktopCodeUpdate(newSha,{
        root:f.root,workRoot:f.work,env,platform:'win32',
        feed,trees:tree,freshness,backupHealth:backup,
        fetchFile:async(sha,p)=>Buffer.from(corrupt&&p==='public/index.html'?'tampered':content[p])
      }),/integrity check|Installed application files differ/);
      assert.equal(readInstalledDesktopBuild(path.join(f.root,'installer-build.json')).sha,oldSha);
      assert.equal(fs.existsSync(path.join(f.root,'src/new-feature.js')),false);
    }finally{f.cleanup();}
  }
});
test('update agent and Windows tray refuse unsafe subprocess and require clean exit',()=>{
  const launcher=readFileSync(new URL('../scripts/windows-desktop-launcher.cs',import.meta.url),'utf8');
  const server=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(launcher,/FORTLEDGER_DESKTOP_PATCH:/);
  assert.match(launcher,/server.ExitCode!=0/);
  assert.match(launcher,/patchTask=Task.Run/);
  assert.match(server,/closeDataSafely/);
  assert.match(server,/FORTLEDGER_DESKTOP_UPDATE_HOST/);
  assert.match(app,/Apply code update & restart/);
  assert.doesNotMatch(launcher,/taskkill|Kill\(\)|Stop-Process/i);
});
