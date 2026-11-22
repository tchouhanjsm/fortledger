# Safe handover BEFORE first Windows setup. Never import onto existing hotel data.
# The source is a consistent verified snapshot folder with SQLite + original
# admin-auth.json, NOT a raw live WAL file or standalone encrypted .flbk.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
if (-not $env:LOCALAPPDATA) { throw 'Windows local application data directory is unavailable.' }
$env:FORTLEDGER_DATA_DIR=Join-Path $env:LOCALAPPDATA 'FortLedger\data'
$target=$env:FORTLEDGER_DATA_DIR
$origin=(& git remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $origin -notmatch '^(https://github\.com/|git@github\.com:)tchouhanjsm/fortledger(\.git)?$') {
  throw 'Import is allowed only from the trusted FortLedger Git checkout.'
}
if ((& git branch --show-current).Trim() -ne 'main' -or $LASTEXITCODE -ne 0) {
  throw 'Use the reviewed main branch for an existing hotel data handover.'
}
$version=(& node --version)
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v22\.') {
  throw 'Node.js 22.x is required for a validated SQLite handover.'
}
if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
  $running=@(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
  if ($running.Count -gt 0) { throw 'Stop any running FortLedger on port 3000 before importing existing hotel data.' }
}
if (Test-Path -LiteralPath $target) {
  throw 'The Windows hotel data folder already exists. Import refuses to overwrite existing data, even if it appears empty. Stop and review rather than deleting records.'
}
Write-Host 'Transfer ONLY a verified consistent SQLite backup and its original admin-auth.json.' -ForegroundColor Yellow
Write-Host 'Keep the snapshot folder on an encrypted external drive; never commit or email it.'
$source=(Read-Host 'Absolute path of the verified Mac snapshot folder').Trim().Trim('"')
if (-not $source -or -not [IO.Path]::IsPathRooted($source)) {
  throw 'An absolute protected snapshot folder is required. No hotel data was changed.'
}
Write-Host 'Installing dependencies to validate the original hotel ledger...' -ForegroundColor Cyan
& npm.cmd ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Dependency setup failed. Import has not started.' }
& npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Regression tests failed. Import has not started.' }
& node .\src\import-hotel-handover.js $source $target --preview
if ($LASTEXITCODE -ne 0) { throw 'Handover preview refused. No Windows hotel ledger was created.' }
Write-Host ''
Write-Host 'WARNING: this is a one-time transfer of an existing private hotel ledger.' -ForegroundColor Yellow
Write-Host 'It does not replace the source Mac or create new owner credentials.'
$approval=(Read-Host 'Type IMPORT to install the verified snapshot into the empty Windows destination').Trim()
if ($approval -cne 'IMPORT') { throw 'Import cancelled. No Windows hotel ledger was created.' }
& node .\src\import-hotel-handover.js $source $target --confirm
if ($LASTEXITCODE -ne 0) { throw 'Import did not complete. Do not reset, delete or overwrite existing hotel files.' }
Write-Host 'Existing hotel snapshot and original admin-auth imported.' -ForegroundColor Green
Write-Host 'Next: run Install FortLedger.cmd (it will preserve the original owner hash),'
Write-Host 'then Start FortLedger.cmd, sign in using the EXISTING owner password,'
Write-Host 'verify historic bookings/invoices/restaurant bills and run Diagnose FortLedger.cmd.'
Write-Host 'Do not use both computers to record live hotel transactions concurrently.'
