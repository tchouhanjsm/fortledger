import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {initializeDesktopOwner} from '../src/desktop-first-run.js';
import {loadPasswordRecord,verifyPassword} from '../src/auth.js';
import {openDatabase} from '../src/database.js';
import {updateStatus} from '../src/update-status.js';

const file=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('desktop owner setup creates the original seven-room database and password only once',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-installer-owner-'));
  const dbFile=path.join(root,'data','fortledger.sqlite');
  const authFile=path.join(root,'data','admin-auth.json');
  try{
    assert.throws(()=>initializeDesktopOwner('too-short',{databaseFile:dbFile,authFile}),/12–256/);
    assert.equal(fs.existsSync(dbFile),false);
    assert.equal(initializeDesktopOwner('synthetic-desktop-owner-password-123',
      {databaseFile:dbFile,authFile}).created,true);
    assert.equal(verifyPassword('synthetic-desktop-owner-password-123',
      loadPasswordRecord(authFile)),true);
    const db=openDatabase(dbFile);
    try{assert.equal(db.prepare('SELECT COUNT(*) n FROM rooms WHERE active=1').get().n,7);}
    finally{db.close();}
    const digest=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    const oldDb=digest(dbFile),oldAuth=digest(authFile);
    assert.throws(()=>initializeDesktopOwner('another-synthetic-password-123',
      {databaseFile:dbFile,authFile}),/Refusing/);
    assert.equal(digest(dbFile),oldDb);
    assert.equal(digest(authFile),oldAuth);
    fs.rmSync(authFile);
    assert.throws(()=>initializeDesktopOwner('a-password-with-missing-original-hash',
      {databaseFile:dbFile,authFile}),/Refusing/);
    assert.equal(digest(dbFile),oldDb);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('installer-managed owner update screen is explicit, read-only and does not call Git',async()=>{
  const old=process.env.FORTLEDGER_DESKTOP_INSTALLER;
  process.env.FORTLEDGER_DESKTOP_INSTALLER='1';
  try{
    const state=await updateStatus({platform:'win32',
      installerStatus:async()=>({platform:'windows',state:'installer_managed',available:false,
        message:'This Windows installation uses a desktop installer'}),
      run:async()=>{throw Error('Git must not be called in bundled installer');}});
    assert.equal(state.platform,'windows');
    assert.equal(state.state,'installer_managed');
    assert.equal(state.available,false);
    assert.match(state.message,/desktop installer/);
  }finally{
    if(old===undefined)delete process.env.FORTLEDGER_DESKTOP_INSTALLER;
    else process.env.FORTLEDGER_DESKTOP_INSTALLER=old;
  }
});
test('Windows desktop package intentionally ships Node, native SQLite, exact app, and no hotel data',()=>{
  const builder=file('scripts/build-windows-installer.ps1');
  const iss=file('installers/FortLedger.iss');
  const launcher=file('scripts/windows-desktop-launcher.cs');
  const guard=file('scripts/windows-installer-guard.ps1');
  const workflow=file('.github/workflows/windows-installer.yml');
  assert.match(builder,/npm\.cmd ci --prefix \$stage --omit=dev/);
  assert.match(builder,/better_sqlite3\.node/);
  assert.match(builder,/node\.exe/);
  assert.match(builder,/windows-desktop-package-smoke\.mjs/);
  assert.match(builder,/ISCC\.exe/);
  assert.doesNotMatch(builder,/Copy-Item.+data|Copy-Item.+admin-auth|Copy-Item.+\.env/i);
  assert.match(iss,/PrivilegesRequired=lowest/);
  assert.match(iss,/DefaultDirName=\{localappdata\}\\Programs\\FortLedger/);
  assert.match(iss,/Name: "\{autodesktop\}\\FortLedger"/);
  assert.match(iss,/Name: "\{autoprograms\}\\FortLedger"/);
  assert.match(iss,/UninstallDisplayIcon=\{app\}\\FortLedger\.exe/);
  assert.match(iss,/PrepareToInstall/);
  assert.match(guard,/Get-NetTCPConnection -LocalPort 3000/);
  assert.match(guard,/Import-FortLedgerBackupSettings/);
  assert.match(guard,/encrypted-recovery-drill\.js/);
  assert.match(launcher,/NotifyIcon/);
  assert.match(launcher,/FIRST RUN|FirstRun\(\)/);
  assert.match(launcher,/FORTLEDGER_DESKTOP_QUIT/);
  assert.match(launcher,/RedirectStandardInput/);
  assert.doesNotMatch(launcher+guard+iss,/git reset --hard|git clean -fd|taskkill|Stop-Process|Process\.Kill\(/i);
  assert.match(workflow,/runs-on: windows-latest/);
  assert.match(workflow,/upload-artifact/);
});
