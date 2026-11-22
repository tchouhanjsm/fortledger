# Safe, repeatable Git fast-forward update for an existing Windows FortLedger checkout.
param(
  [ValidatePattern('^[a-fA-F0-9]{40}$')]
  [string]$ExpectedCommit = ''
)
# Requires that the app be stopped before running. NEVER removes business data.
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
$env:FORTLEDGER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'FortLedger\data'
$legacyDatabase = Join-Path (Get-Location) 'data\fortledger.sqlite'
$persistentDatabase = Join-Path $env:FORTLEDGER_DATA_DIR 'fortledger.sqlite'
if ((Test-Path -LiteralPath $legacyDatabase) -and -not (Test-Path -LiteralPath $persistentDatabase)) {
  throw 'Found an older in-repository data\fortledger.sqlite, but no database in the new persistent Windows folder. Stop: migrate your existing database and admin-auth.json safely before starting/updating. Do not create a fresh empty ledger.'
}
# The lockfile is committed; use npm ci for reproducible updates.
$backupDir = Join-Path $env:LOCALAPPDATA 'FortLedger\update-backups'
$nodeVersion = (& node --version)
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v22\.') { throw "Expected Node.js 22.x. Found: $nodeVersion" }
$gitBranch = (& git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $gitBranch -ne 'main') { throw 'Updates require the main branch. Do not modify the checked-out branch.' }
$origin = (& git remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $origin -notmatch '^(https://github\.com/|git@github\.com:)tchouhanjsm/fortledger(\.git)?$') {
  throw "Unexpected Git remote URL. Review before updating: $origin"
}
$changed = @(& git status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0 -or $changed.Count -gt 0) {
  throw 'The app checkout has tracked or untracked changes (including possible package-lock.json conflicts). Preserve/review them before updating; nothing will be overwritten.'
}
# On Windows 10/11, refuse update while default local server is listening.
if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
  $listening = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
  if ($listening.Count -gt 0) { throw 'A server is listening on port 3000. Stop FortLedger (Ctrl+C) before updating.' }
}
Write-Host 'Creating a verified consistent SQLite backup BEFORE Git changes...' -ForegroundColor Cyan
& node .\src\backup-before-update.js $backupDir
if ($LASTEXITCODE -ne 0) { throw 'Backup could not be verified. Update aborted with code and data unchanged.' }
$previous = (& git rev-parse HEAD).Trim()
Write-Host 'Previous application revision:' $previous
Write-Host 'Fetching latest approved main branch...' -ForegroundColor Cyan
& git fetch origin main
if ($LASTEXITCODE -ne 0) { throw 'Git fetch failed. No application files changed.' }
if ($ExpectedCommit) {
  $fetchedCommit = (& git rev-parse refs/remotes/origin/main).Trim()
  if ($LASTEXITCODE -ne 0 -or $fetchedCommit -ne $ExpectedCommit) {
    throw 'GitHub main changed since owner approval. No merge attempted; check update readiness again.'
  }
}
& git merge --ff-only origin/main
if ($LASTEXITCODE -ne 0) { throw 'Fast-forward refused; inspect Git status. Backup remains intact.' }
if ($ExpectedCommit) {
  $installedCommit = (& git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $installedCommit -ne $ExpectedCommit) {
    throw 'Installed revision differs from approved commit. Leave the app stopped and inspect.'
  }
}
Write-Host 'Installing dependencies for updated code...' -ForegroundColor Cyan
& npm.cmd ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "Dependency update failed. Previous commit: $previous. Data was not deleted; do not start until resolved." }
Write-Host 'Checking all automated tests...' -ForegroundColor Cyan
& npm.cmd test
if ($LASTEXITCODE -ne 0) { throw "Tests failed. Previous commit: $previous. Do not start the updated app until resolved." }
Write-Host ''
Write-Host 'Code updated successfully. Persistent bookings/invoices/password were left untouched.' -ForegroundColor Green
Write-Host 'Before live use, start through scripts\windows-start.ps1 and inspect your data and npm run doctor.'
