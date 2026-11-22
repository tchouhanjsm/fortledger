# Read-only Windows workstation checks. Does not start/restore/update a database.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
$env:FORTLEDGER_DATA_DIR=Join-Path $env:LOCALAPPDATA 'FortLedger\data'
. (Join-Path $PSScriptRoot 'windows-backup-settings.ps1')
$configured=Import-FortLedgerBackupSettings -DataDirectory $env:FORTLEDGER_DATA_DIR -AppRoot $root
Write-Host 'FortLedger Windows diagnostics (read-only).' -ForegroundColor Cyan
Write-Host ('Code revision: '+((& git rev-parse --short HEAD).Trim()))
Write-Host ('Data configuration: '+$env:FORTLEDGER_DATA_DIR)
Write-Host ('Protected external backups configured: '+$(if($configured){'yes'}else{'no'}))
if (-not $configured) {
  Write-Warning 'Configure FortLedger Backups.cmd before relying on the automatic updater.'
}
& npm.cmd run doctor
if ($LASTEXITCODE -ne 0) {
  throw 'Diagnostics reported a failure. Leave existing guest records and passwords untouched.'
}
Write-Host 'Diagnostics finished; real printer, staff Wi-Fi, GST and off-device restore still require physical acceptance.' -ForegroundColor Yellow
