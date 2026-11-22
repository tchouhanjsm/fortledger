import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../src/database.js';
import {createProforma} from '../src/invoices.js';
import {savePasswordRecord,loadPasswordRecord,verifyPassword} from '../src/auth.js';
import {backupBeforeUpdate} from '../src/backup-before-update.js';
import {inspectHotelHandover,importHotelHandover} from '../src/import-hotel-handover.js';

const here=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function syntheticSnapshot(work){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-handover-test-'));
  const liveDir=path.join(root,'mac-live'),archives=path.join(root,'protected-archives');
  const dest=path.join(root,'windows','data');
  fs.mkdirSync(liveDir);
  const source=path.join(liveDir,'fortledger.sqlite'),auth=path.join(liveDir,'admin-auth.json');
  const db=openDatabase(source);
  db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
    VALUES('Synthetic historical guest','2027-05-01','2027-05-03',1,'Unassigned',450000)`).run();
  const id=db.prepare('SELECT id FROM bookings').get().id;
  db.prepare('INSERT INTO payments(booking_id,amount_paise,method) VALUES(?,?,?)').run(id,200000,'upi');
  const invoice=createProforma(db,id);
  db.close();
  savePasswordRecord(auth,'synthetic-previous-owner-password-123');
  const archive=await backupBeforeUpdate(archives,{source,auth});
  try{
    await work({root,dest,archive:archive.folder,source,auth,invoice});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('read-only preview and atomic Mac→Windows import preserve original booking, proforma, payment, and owner auth',()=>syntheticSnapshot(async({root,dest,archive,source,auth,invoice})=>{
  const backupDb=path.join(archive,'fortledger.sqlite'),backupAuth=path.join(archive,'admin-auth.json');
  const before=digest(backupDb),beforeAuth=digest(backupAuth),original=digest(source);
  const preview=inspectHotelHandover({sourceDirectory:archive,targetDirectory:dest});
  assert.equal(preview.ready,true);
  assert.equal(preview.rooms,7);
  assert.equal(preview.bookings,1);
  assert.equal(preview.original_auth_present,true);
  assert.equal(fs.existsSync(dest),false);
  assert.equal(digest(source),original);
  assert.throws(()=>importHotelHandover({sourceDirectory:archive,targetDirectory:dest}),/explicit --confirm/);
  const imported=importHotelHandover({sourceDirectory:archive,targetDirectory:dest,confirm:true});
  assert.equal(imported.imported,true);
  assert.equal(digest(path.join(dest,'fortledger.sqlite')),before);
  assert.equal(digest(path.join(dest,'admin-auth.json')),beforeAuth);
  assert.equal(digest(backupDb),before);
  assert.equal(digest(backupAuth),beforeAuth);
  assert.equal(verifyPassword('synthetic-previous-owner-password-123',
    loadPasswordRecord(path.join(dest,'admin-auth.json'))),true);
  const db=openDatabase(path.join(dest,'fortledger.sqlite'));
  try{
    assert.equal(db.prepare('SELECT COUNT(*) n FROM bookings').get().n,1);
    assert.equal(db.prepare('SELECT amount_paise FROM payments').get().amount_paise,200000);
    assert.equal(db.prepare('SELECT number FROM invoices').get().number,invoice.number);
    assert.equal(db.pragma('foreign_key_check').length,0);
  }finally{db.close();}
  assert.throws(()=>importHotelHandover({sourceDirectory:archive,targetDirectory:dest,confirm:true}),/already exists/);
}));
test('refuse a live WAL source, invalid auth, or unrecognized backup; no destination files created',()=>syntheticSnapshot(async({root,dest,archive})=>{
  const file=path.join(archive,'fortledger.sqlite-wal');
  fs.writeFileSync(file,'live-wal-sentinel');
  assert.throws(()=>inspectHotelHandover({sourceDirectory:archive,targetDirectory:dest}),/live SQLite WAL/);
  fs.unlinkSync(file);
  fs.renameSync(path.join(archive,'RECOVERY.txt'),path.join(archive,'RECOVERY.txt.old'));
  assert.throws(()=>inspectHotelHandover({sourceDirectory:archive,targetDirectory:dest}),/must include/);
  fs.renameSync(path.join(archive,'RECOVERY.txt.old'),path.join(archive,'RECOVERY.txt'));
  fs.writeFileSync(path.join(archive,'admin-auth.json'),'not-json');
  assert.throws(()=>inspectHotelHandover({sourceDirectory:archive,targetDirectory:dest}),/Unexpected token|not valid JSON|JSON|Invalid/);
  assert.equal(fs.existsSync(dest),false);
}));
test('import refuses existing auth-only and SQLite-only Windows installations, and old pending imports',()=>syntheticSnapshot(async({root,dest,archive})=>{
  fs.mkdirSync(dest,{recursive:true});
  fs.writeFileSync(path.join(dest,'admin-auth.json'),'existing-owner-dont-overwrite');
  assert.throws(()=>importHotelHandover({sourceDirectory:archive,targetDirectory:dest,confirm:true}),/already exists/);
  assert.equal(fs.readFileSync(path.join(dest,'admin-auth.json'),'utf8'),'existing-owner-dont-overwrite');
  fs.rmSync(dest,{recursive:true,force:true});
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  const oldPending=dest+'.handover-incomplete';
  fs.mkdirSync(oldPending);
  assert.throws(()=>importHotelHandover({sourceDirectory:archive,targetDirectory:dest,confirm:true}),/earlier handover staging/);
  assert.equal(fs.existsSync(dest),false);
}));
test('Windows handover shortcut must stay offline, human-confirmed, and run before initial owner setup',()=>{
  const read=p=>fs.readFileSync(path.join(here,p),'utf8');
  const cmd=read('Import Existing FortLedger Data.cmd');
  const win=read('scripts/windows-import-handover.ps1');
  assert.match(cmd,/windows-import-handover\.ps1/);
  assert.match(win,/admin-auth\.json/);
  assert.match(win,/npm\.cmd ci --no-audit --no-fund/);
  assert.match(win,/npm\.cmd test/);
  assert.match(win,/--preview/);
  assert.match(win,/--confirm/);
  assert.match(win,/Type IMPORT/);
  assert.match(win,/Get-NetTCPConnection -LocalPort 3000 -State Listen/);
  assert.doesNotMatch(win+cmd,/git reset --hard|git clean -fd|Remove-Item.*fortledger|Stop-Process|taskkill/i);
  if(process.platform==='win32'){
    const ps=`$errors=@(); [System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'scripts/windows-import-handover.ps1'),[ref]$null,[ref]$errors) | Out-Null; if($errors.Count){$errors|ForEach-Object{Write-Error $_};exit 1}`;
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{cwd:here,timeout:15000});
  }
});
