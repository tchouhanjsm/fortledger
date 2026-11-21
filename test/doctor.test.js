import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/database.js';
import {savePasswordRecord} from '../src/auth.js';
import {diagnose} from '../src/doctor.js';

test('doctor verifies a local installation without leaking guest or banking details',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-doctor-'));
  try{
    const file=path.join(dir,'fortledger.sqlite');
    const auth=path.join(dir,'admin-auth.json');
    const db=openDatabase(file);
    db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
      VALUES('PRIVATE SECRET GUEST','2026-12-01','2026-12-02',1,'Unassigned',450000)`).run();
    db.close();
    savePasswordRecord(auth,'long private test password 123');
    const result=diagnose({databaseFile:file,authFile:auth,env:{}});
    assert.equal(result.healthy,true);
    assert.equal(result.production_ready,false);
    assert.equal(result.checks.find(x=>x.name==='SQLite integrity').status,'pass');
    assert.equal(result.checks.find(x=>x.name==='Local administrator').status,'pass');
    assert.equal(result.checks.find(x=>x.name==='Encrypted backups').status,'warn');
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE SECRET GUEST|private test password/);
    const bad=diagnose({databaseFile:file,authFile:auth,env:{FORTLEDGER_PRINTER_HOST:'8.8.8.8'}});
    assert.equal(bad.healthy,false);
    assert.equal(bad.checks.find(x=>x.name==='Epson printer').status,'fail');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('doctor does not create a missing database or fabricate readiness',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-doctor-missing-'));
  try{
    const file=path.join(dir,'not-created.sqlite');
    const result=diagnose({databaseFile:file,authFile:path.join(dir,'missing.json'),env:{}});
    assert.equal(result.healthy,false);
    assert.equal(result.checks.find(x=>x.name==='SQLite database').status,'fail');
    assert.equal(fs.existsSync(file),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
