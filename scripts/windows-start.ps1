# Run from the installed repository. Keep this terminal open while using FortLedger.
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
$env:FORTLEDGER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'FortLedger\data'
$legacyDatabase = Join-Path (Get-Location) 'data\fortledger.sqlite'
$persistentDatabase = Join-Path $env:FORTLEDGER_DATA_DIR 'fortledger.sqlite'
if ((Test-Path -LiteralPath $legacyDatabase) -and -not (Test-Path -LiteralPath $persistentDatabase)) {
  throw 'Found an older in-repository data\fortledger.sqlite, but no database in the new persistent Windows folder. Stop: migrate your existing database and admin-auth.json safely before starting/updating. Do not create a fresh empty ledger.'
}
$nodeVersion = (& node --version)
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v22\.') {
  throw "Expected Node.js 22.x. Found: $nodeVersion"
}
Write-Host 'FortLedger uses persistent data in:' $env:FORTLEDGER_DATA_DIR -ForegroundColor Cyan
Write-Host 'After startup open http://127.0.0.1:3000 in this computer only.'
Write-Host 'To stop safely press Ctrl+C in this terminal.' -ForegroundColor Yellow
& node .\scripts\windows-supervisor.mjs
if ($LASTEXITCODE -ne 0) { throw 'FortLedger supervised startup stopped unexpectedly; run npm run doctor and inspect the update journal.' }
