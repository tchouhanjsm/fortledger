import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
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
const feed=async()=>({state:'source_update_available',available:true,target_sha:newSha,
  remote:newSha.slice(0,12),run_number:80,
  ci_run_url:'https://github.com/tchouhanjsm/fortledger/actions/runs/2'});
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
    assert.equal(readInstalledDesktopBuild(path.join(f.root,'installer-build.json')).build_number,80);
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

test('Windows CI packages byte-for-byte Git blobs in src/public (no hidden CRLF conversion)',()=>{
  if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true')return;
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const output=execFileSync('git',['ls-tree','-r','HEAD','src','public'],
    {cwd:root,encoding:'utf8',maxBuffer:2*1024*1024});
  let compared=0;
  for(const line of output.trim().split(/\r?\n/)){
    const match=/^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(line);
    if(!match)continue;
    const [,expected,file]=match;
    assert.equal(gitBlobSha(fs.readFileSync(path.join(root,file))),expected,
      'Windows checkout changed Git blob bytes: '+file);
    compared++;
  }
  assert.ok(compared>40,'Expected to verify the full installed JS/UI source set');
});

test('verified same-PC encrypted checkpoints allow ordinary source patches but block schema changes',async()=>{
 const f=makeFixture();
 const localEnv={...env,LOCALAPPDATA:'C:\\Fake',
  FORTLEDGER_BACKUP_DIR:'C:\\Fake\\FortLedger\\local-backups',
  FORTLEDGER_BACKUP_LOCAL_ONLY:'1'};
 const localHealth=()=>({...backup(),independent_drive:false});
 try{
   const settings={root:f.root,env:localEnv,platform:'win32',
     feed,trees:tree,freshness,backupHealth:localHealth};
   const check=await inspectDesktopCodeUpdate(settings);
   assert.equal(check.ready,true);
   assert.equal(check.recovery_scope,'local_checkpoint');
   const schema=map([...after.values(),file('src/database.js','new-migration')]);
   const unsafe=await inspectDesktopCodeUpdate({...settings,
     trees:async sha=>sha===oldSha?before:schema});
   assert.equal(unsafe.ready,false);
   assert.match(unsafe.blockers.join(' '),/Schema, restore and credential-storage/);
   const wrong=await inspectDesktopCodeUpdate({...settings,
     env:{...localEnv,FORTLEDGER_BACKUP_DIR:'C:\\Fake\\FortLedger\\data\\backups'}});
   assert.equal(wrong.ready,false);
   const applied=await installDesktopCodeUpdate(newSha,{...settings,workRoot:f.work,
     fetchFile:async (_sha,name)=>Buffer.from(content[name])});
   assert.equal(applied.updated,true);
 }finally{f.cleanup();}
});

test('interrupted source update marker blocks another patch and preserves previous source',async()=>{
 const f=makeFixture();try{
  const marker=path.join(f.work,'source-update-pending.json');
  fs.writeFileSync(marker,'{}');
  await assert.rejects(installDesktopCodeUpdate(newSha,{root:f.root,workRoot:f.work,
    env,platform:'win32',feed,trees:tree,freshness,backupHealth:backup,
    fetchFile:async (_sha,p)=>Buffer.from(content[p])}),{code:'CODE_UNCERTAIN'});
  assert.equal(fs.readFileSync(path.join(f.root,'src/server.js'),'utf8'),'old-server');
  assert.equal(fs.existsSync(marker),true);
 }finally{f.cleanup();}
});
test('before first write, rollback bytes and marker exist; write failure restores and verifies old build',async()=>{
 const f=makeFixture(),rename=fs.renameSync;
 try{
  const marker=path.join(f.work,'source-update-pending.json');
  let observed=false;
  fs.renameSync=(from,to)=>{
   if(to===path.join(f.root,'src/server.js')){
    const record=JSON.parse(fs.readFileSync(marker,'utf8'));
    assert.equal(fs.readFileSync(path.join(f.work,record.stage,'rollback','src/server.js'),'utf8'),'old-server');
    observed=true;
   }
   if(to===path.join(f.root,'public/index.html'))throw new Error('synthetic write failure');
   return rename(from,to);
  };
  await assert.rejects(installDesktopCodeUpdate(newSha,{root:f.root,workRoot:f.work,
    env,platform:'win32',feed,trees:tree,freshness,backupHealth:backup,
    fetchFile:async (_sha,p)=>Buffer.from(content[p])}),/synthetic write failure/);
  assert.equal(observed,true);
  assert.equal(fs.existsSync(marker),false);
  assert.equal(fs.readFileSync(path.join(f.root,'src/server.js'),'utf8'),'old-server');
  assert.equal(readInstalledDesktopBuild(path.join(f.root,'installer-build.json')).sha,oldSha);
 }finally{fs.renameSync=rename;f.cleanup();}
});
test('native launcher checks pending patch before starting the existing application',()=>{
 const launcher=readFileSync(new URL('../scripts/windows-desktop-launcher.cs',import.meta.url),'utf8');
 const launch=launcher.slice(launcher.indexOf('private void Launch()'));
 assert.ok(launch.indexOf('source-update-pending.json')<launch.indexOf('Process.Start(psi)'));
 assert.match(launch,/File.GetAttributes\(pending\)/);
});
