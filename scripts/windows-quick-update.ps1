# Double-click launcher invokes this only after the operator stops FortLedger.
# No forced process termination, guest-data deletion, Git reset, or silent migration.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
Write-Host 'FortLedger Windows safe-update assistant' -ForegroundColor Cyan
Write-Host 'It will not interrupt an active reception or restaurant transaction.' -ForegroundColor Yellow

# The one-click path requires independently protected encrypted backup readiness.
# A timestamp-only file check is insufficient: inspect the latest actual artifact.
$env:FORTLEDGER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'FortLedger\data'
if (-not $env:FORTLEDGER_BACKUP_DIR -or -not $env:FORTLEDGER_BACKUP_PASSPHRASE) {
  throw 'Encrypted backup settings are required for the quick updater. Configure an independent protected backup first, or use the documented manual update procedure.'
}
$backupDir = $env:FORTLEDGER_BACKUP_DIR
if (-not [IO.Path]::IsPathRooted($backupDir)) {
  throw 'Backup folder must be an absolute path.'
}
$backups = @(Get-ChildItem -LiteralPath $backupDir -File -Filter 'fortledger-*.flbk' -ErrorAction Stop |
  Sort-Object LastWriteTimeUtc -Descending)
if ($backups.Count -eq 0 -or ((Get-Date).ToUniversalTime()-$backups[0].LastWriteTimeUtc).TotalHours -gt 36) {
  throw 'An independently protected encrypted backup from the last 36 hours is required.'
}
if ($backups[0].FullName.StartsWith($root+[IO.Path]::DirectorySeparatorChar,
  [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Encrypted backup must be outside the Git application checkout.'
}
Write-Host 'Verifying that the latest encrypted backup can be restored in isolation...' -ForegroundColor Cyan
& npm.cmd run recovery:encrypted-drill -- $backups[0].FullName
if ($LASTEXITCODE -ne 0) { throw 'Encrypted restore drill failed; app files were not updated.' }

# The existing updater checks for an active listener, original data folder, Git
# branch/origin/cleanliness, creates a separate verified SQLite snapshot,
# fast-forwards main and runs full Node tests. No operation writes into GitHub.
Write-Host 'Running the existing verified Git update and regression checks...' -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'windows-update.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Update failed. Leave FortLedger stopped and review the error and verified backups.' }

Write-Host 'Restarting FortLedger with the original persistent Windows data path...' -ForegroundColor Cyan
$startup = Join-Path $PSScriptRoot 'windows-start.ps1'
Start-Process -FilePath 'powershell.exe' -WorkingDirectory $root -ArgumentList (
  '-NoProfile -ExecutionPolicy Bypass -File "'+$startup+'"'
) | Out-Null
Write-Host 'Update tests passed and the normal startup window was launched.' -ForegroundColor Green
Write-Host 'Open http://127.0.0.1:3000 and sign in. Verify existing records before further use.'
