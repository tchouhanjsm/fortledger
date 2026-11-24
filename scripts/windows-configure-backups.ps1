# One-time encrypted external-backup setup. Secret is sealed with Windows DPAPI
# for this Windows account, never written to Git or displayed in terminal output.
param([string]$BackupDirectory = '', [string]$AppRoot = '')
$ErrorActionPreference='Stop'
# The installer can extract the trusted helper into a temporary folder. Pass the
# real installed app directory explicitly; never infer the hotel data path from
# the temporary helper location or write into the installer unpack folder.
if ($AppRoot) {
  if (-not [IO.Path]::IsPathRooted($AppRoot)) {
    throw 'Installed FortLedger application folder must be absolute.'
  }
  $root=[IO.Path]::GetFullPath($AppRoot)
} else {
  $root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}
$live=Join-Path $env:LOCALAPPDATA 'FortLedger\data'
. (Join-Path $PSScriptRoot 'windows-backup-settings.ps1')
if (-not $BackupDirectory) {
  Write-Host 'Choose a folder on a separate encrypted drive or protected network share.' -ForegroundColor Cyan
  Write-Host 'Example: E:\FortLedgerBackups (create the folder using File Explorer first).'
  $BackupDirectory=(Read-Host 'Absolute backup folder').Trim().Trim('"')
}
if (-not $BackupDirectory) { throw 'Backup folder is required. No settings were changed.' }
# Validate before asking for the secret.
$verified=Assert-FortLedgerBackupSeparation -Directory $BackupDirectory -DataDirectory $live -AppRoot $root
Write-Host 'Your backup passphrase must be at least 16 characters, and must be'
Write-Host 'stored separately for recovery on another computer.' -ForegroundColor Yellow
$secret=Read-Host 'Backup passphrase (hidden)' -AsSecureString
$repeat=Read-Host 'Confirm backup passphrase (hidden)' -AsSecureString
$one=Convert-FortLedgerSecureText $secret
$two=Convert-FortLedgerSecureText $repeat
try {
  if ($one.Length -lt 16) { throw 'Backup passphrase must have at least 16 characters.' }
  if ($one -cne $two) { throw 'Backup passphrase confirmation does not match.' }
}finally{
  $one=$null
  $two=$null
}
Save-FortLedgerBackupSettings -Directory $verified -Passphrase $secret -DataDirectory $live -AppRoot $root
Write-Host ''
Write-Host 'PASS: external backup settings saved with this Windows user account DPAPI.' -ForegroundColor Green
Write-Host 'No database or backup was overwritten.'
Write-Host 'Backups begin when the app starts; verify them with Diagnose FortLedger.cmd'
Write-Host 'and rehearse recovery on a separate device. DPAPI settings do not migrate'
Write-Host 'to a different Windows user or PC: retain your passphrase separately.'
