# Verify the currently RUNNING local installation after a separately performed
# safe sync/update. Read-only: never logs in, edits SQLite or submits a booking.
[CmdletBinding()]
param([ValidateRange(1,65535)][int]$Port = 3000)
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
$env:FORTLEDGER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'FortLedger\data'
$dbFile = Join-Path $env:FORTLEDGER_DATA_DIR 'fortledger.sqlite'
$authFile = Join-Path $env:FORTLEDGER_DATA_DIR 'admin-auth.json'
if (-not (Test-Path -LiteralPath $dbFile -PathType Leaf)) {
  throw 'No persistent FortLedger database found. Do not create a new empty hotel ledger.'
}
if (-not (Test-Path -LiteralPath $authFile -PathType Leaf)) {
  throw 'Missing administrator credentials. Recover admin-auth.json before using the hotel.'
}
$nodeVersion = (& node --version)
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v22\.') { throw "Expected Node.js 22.x. Found: $nodeVersion" }
$revision = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not determine installed application revision.' }
Write-Host ('Installed revision: ' + $revision)
Write-Host 'Checking SQLite integrity, existing rooms, encrypted backup, and printer configuration...'
& npm.cmd run doctor
if ($LASTEXITCODE -ne 0) { throw 'Local doctor reported a failure. Do not declare live test passed.' }
$origin = 'http://127.0.0.1:' + $Port
try {
  $login = Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 -Uri ($origin + '/api/auth/status')
  $status = $login.Content | ConvertFrom-Json
  if ($login.StatusCode -ne 200 -or $null -eq $status.enabled -or $null -eq $status.authenticated) {
    throw 'Local authentication status returned an unexpected response.'
  }
  $home = Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 -Uri ($origin + '/')
  if ($home.StatusCode -ne 200 -or $home.Headers['Content-Type'] -notmatch 'text/html') {
    throw 'Local application home page is missing or not HTML.'
  }
} catch {
  throw ('Local HTTP probe failed. Start via scripts\windows-start.ps1 in another terminal, then retry. ' + $_.Exception.Message)
}
if (-not $status.enabled) {
  throw 'Authentication gate is disabled; do not use FortLedger with real hotel data.'
}
Write-Host 'PASS: existing database diagnostics, local login endpoint, and application HTML.' -ForegroundColor Green
Write-Host 'This probe is read-only; it does not verify staff login, guest workflow or physical printer output.' -ForegroundColor Yellow
Write-Host 'Release remains NOT RELEASED until physical restore, Epson paper and GST accountant checks are signed off.' -ForegroundColor Yellow
