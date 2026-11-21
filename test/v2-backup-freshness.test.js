import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {backupFreshness} from '../src/backup-freshness.js';
import {requiredPermission,may} from '../src/access.js';
import {readFileSync} from 'node:fs';

test('backup freshness is read-only, hides paths/secrets and never claims restore verification',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-freshness-'));
  const password='synthetic-test-backup-secret-long-enough';
  const env={FORTLEDGER_BACKUP_DIR:root,FORTLEDGER_BACKUP_PASSPHRASE:password};
  const now=new Date('2027-03-01T12:00:00Z');
  try{
    const missing=backupFreshness({env,now});
    assert.equal(missing.state,'missing');
    assert.equal(missing.needs_attention,true);
    const filename=path.join(root,'fortledger-2027-03-01.flbk');
    fs.writeFileSync(filename,'synthetic unreadable bytes');
    fs.utimesSync(filename,new Date('2027-02-28T00:00:00Z'),new Date('2027-02-28T00:00:00Z'));
    const stale=backupFreshness({env,now});
    assert.equal(stale.state,'stale');
    assert.equal(stale.needs_attention,true);
    fs.utimesSync(filename,new Date('2027-03-01T11:00:00Z'),new Date('2027-03-01T11:00:00Z'));
    const fresh=backupFreshness({env,now});
    assert.equal(fresh.state,'recent');
    assert.equal(fresh.needs_attention,false);
    assert.match(fresh.detail,/not confirmed/,'File timestamp must not certify recoverability');
    assert.doesNotMatch(JSON.stringify([missing,stale,fresh]),/fortledger-freshness-|synthetic-test-backup-secret/);
    assert.equal(fs.readFileSync(filename,'utf8'),'synthetic unreadable bytes','Health check never changes file');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('unconfigured or unreadable backup directories produce actionable but non-sensitive warnings',()=>{
  assert.equal(backupFreshness({env:{}}).state,'unconfigured');
  assert.equal(backupFreshness({env:{FORTLEDGER_BACKUP_DIR:'relative',
    FORTLEDGER_BACKUP_PASSPHRASE:'1234567890123456'}}).state,'invalid');
  assert.equal(backupFreshness({env:{FORTLEDGER_BACKUP_DIR:'/absent/fortledger-test-backup-folder',
    FORTLEDGER_BACKUP_PASSPHRASE:'1234567890123456'}}).state,'unavailable');
});

test('only owner/manager can read backup status; no mutation endpoint permitted',()=>{
  assert.equal(requiredPermission('GET','/system/backup-status'),'system.health.read');
  assert.equal(requiredPermission('POST','/system/backup-status'),null);
  assert.equal(may('owner','system.health.read'),true);
  assert.equal(may('manager','system.health.read'),true);
  assert.equal(may('frontdesk','system.health.read'),false);
  assert.equal(may('cashier','system.health.read'),false);
  const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(ui,/Encrypted backup needs review/);
  assert.match(ui,/can\('system.health.read'\)/);
});
