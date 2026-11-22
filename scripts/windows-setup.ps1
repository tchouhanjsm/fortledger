# FortLedger Windows first-time setup (PowerShell 5.1+, no admin required).
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
if (-not $env:LOCALAPPDATA) { throw 'Windows local application data folder is required.' }
$env:FORTLEDGER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'FortLedger\data'
$root=(Get-Location).Path
$origin=(& git remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $origin -notmatch '^(https://github\.com/|git@github\.com:)tchouhanjsm/fortledger(\.git)?$') {
  throw 'This is not the official FortLedger checkout; no installation has started.'
}
$branch=(& git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') {
  throw 'First-time setup requires the official main branch.'
}
if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
  $running=@(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
  if ($running.Count -gt 0) {
    throw 'Stop the app on port 3000 before running setup; financial records must not change during installation.'
  }
}
$legacyDatabase = Join-Path (Get-Location) 'data\fortledger.sqlite'
$persistentDatabase = Join-Path $env:FORTLEDGER_DATA_DIR 'fortledger.sqlite'
if ((Test-Path -LiteralPath $legacyDatabase) -and -not (Test-Path -LiteralPath $persistentDatabase)) {
  throw 'Found an older in-repository data\fortledger.sqlite, but no database in the new persistent Windows folder. Stop: migrate your existing database and admin-auth.json safely before starting/updating. Do not create a fresh empty ledger.'
}
$authPath = Join-Path $env:FORTLEDGER_DATA_DIR 'admin-auth.json'
if ((Test-Path -LiteralPath $persistentDatabase -PathType Leaf) -and
    -not (Test-Path -LiteralPath $authPath -PathType Leaf)) {
  throw 'Existing hotel database found without its original administrator credentials. STOP and recover admin-auth.json instead of creating a new password.'
}
if ((Test-Path -LiteralPath $authPath -PathType Leaf) -and
    -not (Test-Path -LiteralPath $persistentDatabase -PathType Leaf)) {
  throw 'Existing administrator credentials found without a hotel database. STOP: verify the original ledger path or first-start status. Never initialize a replacement ledger blindly.'
}
# Install exactly the tested dependency tree in the committed package-lock.json.
$nodeVersion = (& node --version)
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v22\.') {
  throw "FortLedger currently requires Node.js 22.x for reliable native SQLite builds. Found: $nodeVersion"
}
& git --version
if ($LASTEXITCODE -ne 0) { throw 'Install Git for Windows first.' }
New-Item -ItemType Directory -Force -Path $env:FORTLEDGER_DATA_DIR | Out-Null
Write-Host 'Installing local application dependencies...' -ForegroundColor Cyan
& npm.cmd ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed. Check the committed lockfile, Node 22 and SQLite native-build troubleshooting.' }
Write-Host 'Running application tests...' -ForegroundColor Cyan
& npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed; do not enter business data.' }
if (-not (Test-Path -LiteralPath $authPath)) {
  Write-Host 'Create your local administrator password. It will not be uploaded to GitHub.' -ForegroundColor Cyan
  & npm.cmd run setup-auth
  if ($LASTEXITCODE -ne 0) { throw 'Admin password setup was not completed.' }
} else {
  Write-Host 'Existing administrator password found; preserving it.' -ForegroundColor Green
}
Write-Host ''
. (Join-Path $PSScriptRoot 'windows-backup-settings.ps1')
$settingsFile=Get-FortLedgerBackupSettingsFile
if (-not (Test-Path -LiteralPath $settingsFile -PathType Leaf) -and
    -not $env:FORTLEDGER_BACKUP_DIR) {
  Write-Host 'Protected backups are needed for safe upgrades and recovery.' -ForegroundColor Yellow
  $setupBackup=(Read-Host 'Configure a separate encrypted backup drive now? [Y/n]').Trim()
  if ($setupBackup -notmatch '^[Nn]') {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'windows-configure-backups.ps1')
    if ($LASTEXITCODE -ne 0) {
      Write-Warning 'Backup configuration was not completed. Windows Update Center will remain blocked.'
    }
  } else {
    Write-Warning 'Skipped protected backups. Configure them before entering real guest data.'
  }
}
Write-Host ''
Write-Host 'Setup finished. Use Start FortLedger.cmd or this command:' -ForegroundColor Green
Write-Host 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-start.ps1'
Write-Host 'First startup creates an empty seven-room SQLite ledger ONLY on a new installation.'
Write-Host 'Existing Mac hotel data must be imported from a consistent offline backup, not recreated.'
