import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {updateStatus} from '../src/update-status.js';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {requiredPermission,may} from '../src/access.js';

const current='a'.repeat(40),newHead='b'.repeat(40);
function fakeGit({branch='main',origin='https://github.com/tchouhanjsm/fortledger.git',
  dirty='',remote=newHead,offline=false}={}){
  const calls=[];
  const run=async args=>{
    calls.push([...args]);
    const cmd=args.join(' ');
    if(cmd==='rev-parse --verify HEAD')return current;
    if(cmd==='branch --show-current')return branch;
    if(cmd==='remote get-url origin')return origin;
    if(cmd==='status --porcelain=v1 --untracked-files=all')return dirty;
    if(cmd==='ls-remote --exit-code origin refs/heads/main'){
      if(offline)throw Error('Network offline');
      return remote+'\trefs/heads/main';
    }
    throw Error('Unexpected git invocation: '+cmd);
  };
  return {run,calls};
}
test('owner Update Center is inspection-only and finds clean official revisions',async()=>{
  const g=fakeGit();
  const status=await updateStatus({run:g.run,platform:'win32'});
  assert.deepEqual(status,{
    platform:'windows',state:'new_revision',current:current.slice(0,12),
    remote:newHead.slice(0,12),available:true,
    message:'New GitHub revision detected. Installation still requires a safe fast-forward, backup and restart.'
  });
  assert.equal(g.calls.length,5);
  assert.equal(g.calls.some(args=>['merge','reset','pull','fetch','checkout'].includes(args[0])),false);
  const same=await updateStatus({run:fakeGit({remote:current}).run});
  assert.equal(same.state,'up_to_date');
  assert.equal(same.available,false);
});
test('update check fails safely for dirty, non-main, wrong origin, offline and malformed Git output',async()=>{
  for(const data of [{dirty:'?? package-lock.json'}, {dirty:' M public/app.js'},
    {origin:'https://github.com/attacker/fortledger.git'}, {branch:'feature/unsafe'}]){
    const g=fakeGit(data);
    const result=await updateStatus({run:g.run});
    assert.equal(result.state,'blocked');
    assert.equal(result.available,false);
    assert.ok(!g.calls.some(x=>x[0]==='ls-remote'),
      'Never contact remote when local app checkout is unsafe');
  }
  for(const data of [{offline:true},{remote:'not-a-valid-commit'}]){
    const result=await updateStatus({run:fakeGit(data).run});
    assert.equal(result.state,'unavailable');
    assert.equal(result.available,false);
  }
});
test('Update Center endpoint is owner-only; no authorization for installing code',async()=>{
  assert.equal(requiredPermission('GET','/system/updates'),'system.update');
  assert.equal(requiredPermission('POST','/system/updates'),null);
  assert.equal(may('manager','system.update'),false);
  assert.equal(may('cashier','system.update'),false);
  let checks=0;
  const db=openDatabase(':memory:');
  createStaff(db,{username:'managerqa',display_name:'Manager',role:'manager',password:'synthetic-manager-password-123'});
  const app=createApp(db,{authRecord:createPasswordRecord('synthetic-owner-password-123'),
    checkUpdates:async()=>{checks++;return {platform:'windows',state:'new_revision',available:true,current:'a'.repeat(12),remote:'b'.repeat(12),message:'Test update available'};}});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const login=async(username,password)=>{
    const res=await fetch(base+'/api/auth/login',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username,password})});
    assert.equal(res.status,200);
    return res.headers.get('set-cookie').split(';')[0];
  };
  try{
    assert.equal((await fetch(base+'/api/system/updates')).status,401);
    const manager=await login('managerqa','synthetic-manager-password-123');
    const owner=await login('owner','synthetic-owner-password-123');
    assert.equal((await fetch(base+'/api/system/updates',{headers:{Cookie:manager}})).status,403);
    assert.equal(checks,0);
    const result=await fetch(base+'/api/system/updates',{headers:{Cookie:owner}});
    assert.equal(result.status,200);
    assert.equal((await result.json()).state,'new_revision');
    assert.equal(result.headers.get('cache-control'),'no-store');
    assert.equal(checks,1);
    assert.equal((await fetch(base+'/api/system/updates',{method:'POST',
      headers:{Cookie:owner,'Content-Type':'application/json'},body:'{}'})).status,404,
      'An owner may inspect but must not trigger an HTTP update');
    assert.equal(checks,1);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
  const legacy=openDatabase(':memory:');
  const anonymous=createApp(legacy,{checkUpdates:async()=>{checks++;return {};}});
  const listener=anonymous.listen(0,'127.0.0.1');
  await new Promise(resolve=>listener.once('listening',resolve));
  try{
    assert.equal((await fetch('http://127.0.0.1:'+listener.address().port+'/api/system/updates')).status,403);
    assert.equal(checks,1);
  }finally{await new Promise(resolve=>listener.close(resolve));legacy.close();}
});
test('Windows desktop update refuses unsafe states and never silently wipes data',()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const read=p=>fs.readFileSync(path.join(root,p),'utf8');
  const updater=read('scripts/windows-update.ps1');
  const quick=read('scripts/windows-quick-update.ps1');
  const launcher=read('Update FortLedger.cmd');
  const html=read('public/index.html'),client=read('public/app.js');
  assert.match(updater,/git status --porcelain=v1 --untracked-files=all/);
  assert.match(updater,/git merge --ff-only origin\/main/);
  assert.match(updater,/npm\.cmd ci --no-audit --no-fund/);
  assert.match(updater,/backup-before-update\.js/);
  assert.match(updater,/Get-NetTCPConnection -LocalPort 3000 -State Listen/);
  assert.match(quick,/recovery:encrypted-drill/);
  assert.match(quick,/windows-update\.ps1/);
  assert.match(quick,/windows-start\.ps1/);
  assert.match(quick,/LastWriteTimeUtc/);
  assert.match(launcher,/windows-quick-update\.ps1/);
  assert.doesNotMatch(updater+'\n'+quick,/git reset --hard|git clean -fd|Remove-Item.*fortledger\.sqlite|taskkill|Stop-Process/i);
  assert.match(html,/id="update-center"[^>]*hidden/);
  assert.match(html,/id="update-center-check"/);
  assert.match(client,/\$\('#update-center'\)\.hidden=!can\('system.update'\)/);
  assert.match(client,/api\/system\/updates/);
  if(process.platform==='win32'){
    // Actual PowerShell parser, not a fake interpretation of Windows shell syntax.
    const ps=`$errors=@(); [System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'scripts/windows-quick-update.ps1'),[ref]$null,[ref]$errors) | Out-Null; if($errors.Count){$errors | ForEach-Object {Write-Error $_}; exit 1}; [System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'scripts/windows-update.ps1'),[ref]$null,[ref]$errors) | Out-Null; if($errors.Count){$errors | ForEach-Object {Write-Error $_}; exit 1}`;
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{cwd:root,timeout:15000});
  }
});
