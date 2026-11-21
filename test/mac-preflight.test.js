import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/database.js';
import {savePasswordRecord} from '../src/auth.js';
import {macPreflight} from '../src/mac-preflight.js';

test('Mac preflight inspects the effective hotel paths without modifying files or exposing credentials',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-mac-check-'));
  try{
    const data=path.join(root,'hotel-data'),backup=path.join(root,'external-backup');
    fs.mkdirSync(data);
    const dbFile=path.join(data,'fortledger.sqlite'),auth=path.join(data,'admin-auth.json');
    const db=openDatabase(dbFile);db.close();
    savePasswordRecord(auth,'synthetic mac auth password long enough');
    const env={FORTLEDGER_DATA_DIR:data,FORTLEDGER_BACKUP_DIR:backup,
      FORTLEDGER_BACKUP_PASSPHRASE:'test-only secret long enough',PORT:'3001'};
    const before=fs.statSync(dbFile).mtimeMs;
    const result=macPreflight({env,platform:'darwin',nodeVersion:'22.1.0'});
    assert.equal(result.healthy,true);
    assert.equal(result.production_ready,false);
    assert.equal(result.active_database,dbFile);
    assert.equal(result.active_auth_file,auth);
    assert.equal(result.checks.find(c=>c.name==='Operating system').status,'pass');
    assert.equal(result.checks.find(c=>c.name==='Database diagnostics').status,'pass');
    assert.equal(result.checks.find(c=>c.name==='Local listener').status,'pass');
    assert.doesNotMatch(JSON.stringify(result),/synthetic mac auth password|test-only secret/);
    assert.equal(fs.statSync(dbFile).mtimeMs,before);
    assert.equal(fs.existsSync(backup),false,'Preflight must not create backup folders');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Mac preflight flags dangerous listener configuration and never initializes a missing hotel database',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-mac-absent-'));
  try{
    const env={FORTLEDGER_DATA_DIR:root,FORTLEDGER_HOST:'0.0.0.0',PORT:'3000'};
    const result=macPreflight({env,platform:'darwin',nodeVersion:'22.0.0'});
    assert.equal(result.healthy,false);
    assert.equal(result.checks.find(c=>c.name==='Database file').status,'warn');
    assert.equal(result.checks.find(c=>c.name==='Local listener').status,'fail');
    assert.equal(fs.existsSync(path.join(root,'fortledger.sqlite')),false);
    assert.equal(result.production_ready,false);
    const old=macPreflight({env:{FORTLEDGER_DATA_DIR:root},platform:'darwin',nodeVersion:'20.0.0'});
    assert.equal(old.checks.find(c=>c.name==='Node.js version').status,'fail');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
