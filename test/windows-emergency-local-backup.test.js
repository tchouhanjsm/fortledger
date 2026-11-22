import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {backupFreshness} from '../src/backup-freshness.js';

test('automatic local encrypted backup is a same-PC emergency copy, never disguised as disaster-safe',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-local-emergency-'));
  try{
    const passphrase='synthetic-long-emergency-local-passphrase';
    const env={FORTLEDGER_BACKUP_DIR:dir,FORTLEDGER_BACKUP_PASSPHRASE:passphrase,
      FORTLEDGER_BACKUP_LOCAL_ONLY:'1'};
    assert.equal(backupFreshness({env}).state,'missing');
    const marker=path.join(dir,'fortledger-synthetic.flbk');
    fs.writeFileSync(marker,'synthetic-not-real');
    // Windows filesystem timestamps can be a fraction ahead of Date.now().
    // Use an explicit past timestamp so real backup freshness is tested fairly.
    const prior=new Date(Date.now()-60*1000);
    fs.utimesSync(marker,prior,prior);
    const local=backupFreshness({env});
    assert.equal(local.state,'recent');
    assert.equal(local.needs_attention,true);
    assert.match(local.detail,/THIS Windows PC|separate protected drive/i);
    const external=backupFreshness({env:{...env,FORTLEDGER_BACKUP_LOCAL_ONLY:'0'}});
    assert.equal(external.state,'recent');
    assert.equal(external.needs_attention,false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('native launcher creates only Windows CurrentUser DPAPI sealed key and refuses orphaning older backups',()=>{
  const src=fs.readFileSync(new URL('../scripts/windows-desktop-launcher.cs',import.meta.url),'utf8');
  assert.match(src,/ConfigureEmergencyLocalBackup\(ProcessStartInfo psi\)/);
  assert.match(src,/DataProtectionScope.CurrentUser/);
  assert.match(src,/FileMode.CreateNew/);
  assert.match(src,/local-backup-settings\.json/);
  assert.match(src,/local-backups/);
  assert.match(src,/FORTLEDGER_BACKUP_LOCAL_ONLY/);
  assert.match(src,/Local encrypted backups exist without their key/);
  assert.match(src,/Directory\.GetFiles\(folder,"fortledger-\*\.flbk"\)/);
  assert.match(src,/ConfigureEmergencyLocalBackup\(psi\)/);
  assert.match(src,/RandomNumberGenerator\.Create\(\)/);
  assert.doesNotMatch(src,/Process\.Kill\(|git reset --hard|File\.Delete\(data/);
});
