# FortLedger Windows first-time setup (PowerShell 5.1+, no admin required).
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
$env:FORTLEDGER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'FortLedger\data'
$legacyDatabase = Join-Path (Get-Location) 'data\fortledger.sqlite'
$persistentDatabase = Join-Path $env:FORTLEDGER_DATA_DIR 'fortledger.sqlite'
if ((Test-Path -LiteralPath $legacyDatabase) -and -not (Test-Path -LiteralPath $persistentDatabase)) {
  throw 'Found an older in-repository data\fortledger.sqlite, but no database in the new persistent Windows folder. Stop: migrate your existing database and admin-auth.json safely before starting/updating. Do not create a fresh empty ledger.'
}
$env:npm_config_package_lock = 'false'
$nodeVersion = (& node --version)
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v22\.') {
  throw "FortLedger currently requires Node.js 22.x for reliable native SQLite builds. Found: $nodeVersion"
}
& git --version
if ($LASTEXITCODE -ne 0) { throw 'Install Git for Windows first.' }
New-Item -ItemType Directory -Force -Path $env:FORTLEDGER_DATA_DIR | Out-Null
Write-Host 'Installing local application dependencies...' -ForegroundColor Cyan
& npm.cmd install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm install failed. Check the SQLite native build troubleshooting notes.' }
Write-Host 'Running application tests...' -ForegroundColor Cyan
& npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed; do not enter business data.' }
$authPath = Join-Path $env:FORTLEDGER_DATA_DIR 'admin-auth.json'
if (-not (Test-Path -LiteralPath $authPath)) {
  Write-Host 'Create your local administrator password. It will not be uploaded to GitHub.' -ForegroundColor Cyan
  & npm.cmd run setup-auth
  if ($LASTEXITCODE -ne 0) { throw 'Admin password setup was not completed.' }
} else {
  Write-Host 'Existing administrator password found; preserving it.' -ForegroundColor Green
}
Write-Host ''
Write-Host 'Setup finished. Start FortLedger with:' -ForegroundColor Green
Write-Host 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-start.ps1'
