import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=name=>fs.readFileSync(path.join(root,name),'utf8');

test('Windows first-run launchers are a one-double-click flow with a stable external data directory',()=>{
  for(const [cmd,target] of [
    ['Install FortLedger.cmd','windows-setup.ps1'],
    ['Start FortLedger.cmd','windows-start.ps1'],
    ['Diagnose FortLedger.cmd','windows-diagnostics.ps1'],
    ['Configure FortLedger Backups.cmd','windows-configure-backups.ps1']
  ]){
    const body=source(cmd);
    assert.match(body,new RegExp(target.replaceAll('.','\\.')));
    assert.match(body,/powershell\.exe -NoProfile -ExecutionPolicy Bypass -File/);
    assert.match(body,/pause/);
    assert.doesNotMatch(body,/git reset|Remove-Item|rd \/s|del \/f/i);
  }
  const start=source('scripts/windows-start.ps1');
  const setup=source('scripts/windows-setup.ps1');
  const quick=source('scripts/windows-quick-update.ps1');
  const backup=source('scripts/windows-backup-settings.ps1');
  assert.match(start,/windows-supervisor\.mjs/);
  assert.match(start,/Import-FortLedgerBackupSettings/);
  assert.match(quick,/Import-FortLedgerBackupSettings/);
  assert.match(setup,/windows-configure-backups\.ps1/);
  assert.match(setup,/admin-auth\.json/);
  assert.match(setup,/Existing hotel database found without its original administrator credentials/);
  assert.match(setup,/npm\.cmd ci --no-audit --no-fund/);
  assert.match(setup,/npm\.cmd test/);
  assert.match(backup,/ProtectedData]::Protect/);
  assert.match(backup,/ProtectedData]::Unprotect/);
  assert.match(backup,/GetPathRoot/);
  assert.match(backup,/different protected drive/);
  assert.match(backup,/DataProtectionScope]::CurrentUser/);
  assert.doesNotMatch(backup,/git\s+push|Invoke-WebRequest/);
});

test('PowerShell parses every Windows onboarding, backup and update entrypoint',()=>{
  if(process.platform!=='win32')return;
  const files=[
    'scripts/windows-backup-settings.ps1',
    'scripts/windows-configure-backups.ps1',
    'scripts/windows-setup.ps1','scripts/windows-start.ps1',
    'scripts/windows-quick-update.ps1','scripts/windows-update.ps1',
    'scripts/windows-diagnostics.ps1'
  ];
  const list=files.map(x=>"'"+x+"'").join(',');
  const script=`$errors=@(); foreach($file in @(${list})){[System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) $file),[ref]$null,[ref]$errors)|Out-Null}; if($errors.Count){$errors|ForEach-Object {Write-Error $_};exit 1}`;
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{cwd:root,timeout:20000});
});

test('Windows DPAPI stores an encrypted secret, reloads under same user and refuses invalid location',()=>{
  if(process.platform!=='win32')return;
  const script=String.raw`
$ErrorActionPreference='Stop'
. './scripts/windows-backup-settings.ps1'
$dir=Join-Path $env:TEMP ('fortledger-dpapi-synthetic-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dir | Out-Null
try {
  $pass='synthetic-ci-only-secret-123'
  $secure=New-Object System.Security.SecureString
  foreach($char in $pass.ToCharArray()) { $secure.AppendChar($char) }
  $secure.MakeReadOnly()
  $file=Join-Path $dir 'config.json'
  $data='Z:\FortLedgerSynthetic\data'
  try {
    [void](Assert-FortLedgerBackupSeparation -Directory $dir -DataDirectory $dir)
    throw 'Same-drive backup was incorrectly allowed'
  }catch{
    if($_.Exception.Message -notmatch 'different protected drive') {throw}
  }
  Save-FortLedgerBackupSettings -Directory $dir -Passphrase $secure -DataDirectory $data -SettingsFile $file
  $saved=[IO.File]::ReadAllText($file)
  if($saved.Contains($pass)) {throw 'DPAPI config revealed plaintext'}
  $env:FORTLEDGER_BACKUP_DIR=$null
  $env:FORTLEDGER_BACKUP_PASSPHRASE=$null
  $ok=Import-FortLedgerBackupSettings -SettingsFile $file -DataDirectory $data
  if(-not $ok -or $env:FORTLEDGER_BACKUP_DIR -ne $dir -or
    $env:FORTLEDGER_BACKUP_PASSPHRASE -ne $pass) {throw 'DPAPI reloading failed'}
  $env:FORTLEDGER_BACKUP_PASSPHRASE=$null
  $env:FORTLEDGER_BACKUP_DIR=$null
  $json=Get-Content $file -Raw | ConvertFrom-Json
  $json.passphrase_dpapi='intentionally-corrupt'
  [IO.File]::WriteAllText($file,($json|ConvertTo-Json -Compress))
  try {
    [void](Import-FortLedgerBackupSettings -SettingsFile $file -DataDirectory $data)
    throw 'Corrupt DPAPI settings were accepted'
  }catch{
    if($_.Exception.Message -notmatch 'cannot be unlocked') {throw}
  }
}finally{
  $env:FORTLEDGER_BACKUP_PASSPHRASE=$null
  $env:FORTLEDGER_BACKUP_DIR=$null
  Remove-Item -LiteralPath $dir -Recurse -Force
}
`;
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],
    {cwd:root,timeout:25000,windowsHide:true});
});
