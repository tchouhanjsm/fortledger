import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../scripts/windows-live-check.ps1',import.meta.url),'utf8');
const update=readFileSync(new URL('../scripts/windows-update.ps1',import.meta.url),'utf8');
test('live verification is local-only and read-only, and refuses absent hotel credentials',()=>{
  assert.match(script,/127\.0\.0\.1/);
  assert.match(script,/api\/auth\/status/);
  assert.match(script,/Invoke-WebRequest -UseBasicParsing/);
  assert.match(script,/npm\.cmd run doctor/);
  assert.match(script,/if \(\$LASTEXITCODE -ne 0\)/);
  assert.match(script,/admin-auth\.json/);
  assert.match(script,/fortledger\.sqlite/);
  assert.match(script,/authentication gate is disabled/i);
  assert.doesNotMatch(script,/\b(?:POST|PATCH|DELETE|PUT)\b/);
  assert.doesNotMatch(script,/Invoke-RestMethod|git\s+(?:pull|reset|merge|checkout)|Remove-Item|Move-Item|Copy-Item/);
});
test('only existing sync script can change application files after protective backup',()=>{
  assert.match(update,/backup-before-update\.js/);
  assert.match(update,/merge --ff-only origin\/main/);
  assert.match(update,/npm\.cmd test/);
  assert.match(update,/status --porcelain=v1 --untracked-files=all/);
  assert.match(update,/tracked or untracked changes/);
  assert.match(update,/npm\.cmd ci --no-audit --no-fund/);
});
