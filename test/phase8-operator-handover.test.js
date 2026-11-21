import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../scripts/windows-recovery-rehearsal.ps1',import.meta.url),'utf8');
const handover=readFileSync(new URL('../docs/PHASE8_OPERATOR_HANDOVER.md',import.meta.url),'utf8');
const release=readFileSync(new URL('../src/release-readiness.js',import.meta.url),'utf8');

test('Windows handover rehearses authenticated artifact without writing the live database',()=>{
  assert.match(script,/Param(?:eter)?\(Mandatory=\$true\)/i);
  assert.match(script,/\$BackupFile/);
  assert.match(script,/FORTLEDGER_DATA_DIR/);
  assert.match(script,/fortledger\.sqlite/);
  assert.match(script,/admin-auth\.json/);
  assert.match(script,/FORTLEDGER_BACKUP_PASSPHRASE/);
  assert.match(script,/IsPathRooted\(\$BackupFile\)/);
  assert.match(script,/encrypted-recovery-drill\.js/);
  assert.match(script,/\$LASTEXITCODE -ne 0/);
  assert.doesNotMatch(script,/\bsrc[\\/]restore\.js\b/i);
  assert.doesNotMatch(script,/\bbackup:decrypt\b/);
  assert.doesNotMatch(script,/\bgit\s+(?:reset|checkout|clean)\b/i);
  assert.doesNotMatch(script,/\b(?:Remove-Item|Move-Item|Copy-Item)\b/);
  assert.match(script,/NOT CERTIFIED/);
});
test('handover requires physical acceptance instead of fabricating release approval',()=>{
  for(const topic of [
    'replacement-Windows restoration','actual paper','200% browser zoom',
    'accountant','NO-GO','--confirm','before-restore','offline'
  ])assert.ok(handover.toLowerCase().includes(topic.toLowerCase()),topic);
  assert.match(handover,/NOT RELEASED/);
  assert.match(release,/verdict:'NOT RELEASED'/);
  assert.match(release,/production_ready:false/);
});
