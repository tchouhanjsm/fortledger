# FortLedger operator rehearsal: READ-ONLY with respect to the live hotel.
# Uses the authenticated .flbk artifact; the Node routine decrypts and restores
# only inside a disposable private scratch folder. No release certificate issued.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$BackupFile,
  [switch]$ReplacementDevice
)
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
if (-not $ReplacementDevice) {
  $env:FORTLEDGER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'FortLedger\data'
  $live = Join-Path $env:FORTLEDGER_DATA_DIR 'fortledger.sqlite'
  $auth = Join-Path $env:FORTLEDGER_DATA_DIR 'admin-auth.json'
  if (-not (Test-Path -LiteralPath $live -PathType Leaf)) {
    throw 'Live database not found in the persistent Windows data folder. Use -ReplacementDevice for an artifact-only rehearsal.'
  }
  if (-not (Test-Path -LiteralPath $auth -PathType Leaf)) {
    throw 'Administrator credential file is missing. STOP: recover the correct admin-auth.json securely.'
  }
}
if (-not [System.IO.Path]::IsPathRooted($BackupFile)) {
  throw 'Supply an absolute path to an independent encrypted .flbk backup.'
}
$backup = [System.IO.Path]::GetFullPath($BackupFile)
if (-not (Test-Path -LiteralPath $backup -PathType Leaf) -or
    [System.IO.Path]::GetExtension($backup) -ne '.flbk') {
  throw 'Encrypted .flbk backup file not found.'
}
if (-not $env:FORTLEDGER_BACKUP_PASSPHRASE -or $env:FORTLEDGER_BACKUP_PASSPHRASE.Length -lt 16) {
  throw 'Set FORTLEDGER_BACKUP_PASSPHRASE in this PowerShell session from a separately stored secret. Never place it in Git or command history.'
}
$nodeVersion = (& node --version)
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v22\.') {
  throw "Node.js 22.x is required for this validated recovery drill. Found: $nodeVersion"
}
Write-Host 'Verifying actual encrypted backup and credential copy in disposable storage...' -ForegroundColor Cyan
$drillArguments = @('.\src\encrypted-recovery-drill.js', $backup)
if ($ReplacementDevice) {
  $drillArguments += '--replacement-device'
}
& node @drillArguments
if ($LASTEXITCODE -ne 0) {
  throw 'Encrypted backup rehearsal FAILED. Do not restore or overwrite the live hotel database.'
}
Write-Host ''
Write-Host 'PASS: isolated encrypted backup rehearsal only.' -ForegroundColor Green
Write-Host 'NOT CERTIFIED: external-drive independence, replacement Windows machine, successful login, actual Epson paper, or GST issuance.' -ForegroundColor Yellow
Write-Host 'Next: follow the documented replacement-device restoration and verify the original owner login.'
