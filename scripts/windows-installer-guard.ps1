# Pre-copy installer safety gate. Runs BEFORE any program files can be updated.
# Existing hotel SQLite and administrator credentials are NEVER touched here.
param([Parameter(Mandatory=$true)][string]$InstallDirectory,
      [Parameter(Mandatory=$true)][string]$Verifier)
$ErrorActionPreference='Stop'
$live=Join-Path $env:LOCALAPPDATA 'FortLedger\data'
$db=Join-Path $live 'fortledger.sqlite'
$auth=Join-Path $live 'admin-auth.json'
try {
  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    if (@(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue).Count -gt 0) {
      throw 'FortLedger or another application is running on port 3000. Finish bookings/bills and close FortLedger from the tray before installing.'
    }
  }
  $dbExists=Test-Path -LiteralPath $db -PathType Leaf
  $authExists=Test-Path -LiteralPath $auth -PathType Leaf
  if ($dbExists -xor $authExists) {
    throw 'Hotel records and owner credentials are incomplete; stop and recover the original files.'
  }
  if ($dbExists -and (Test-Path -LiteralPath (Join-Path $InstallDirectory 'FortLedger.exe'))) {
    # For an existing desktop installation, require a recent independently
    # verified encrypted backup BEFORE any executable or native module changes.
    $settingsScript=Join-Path $InstallDirectory 'scripts\windows-backup-settings.ps1'
    $node=Join-Path $InstallDirectory 'node.exe'
    $drill=Join-Path $InstallDirectory 'src\encrypted-recovery-drill.js'
    if (-not (Test-Path -LiteralPath $settingsScript) -or
        -not (Test-Path -LiteralPath $node) -or
        -not (Test-Path -LiteralPath $drill)) {
      throw 'Existing desktop installation cannot verify backup recovery. Use reviewed manual recovery, not a blind upgrade.'
    }
    . $settingsScript
    $configured=Import-FortLedgerBackupSettings -DataDirectory $live -AppRoot $InstallDirectory
    if (-not $configured -or -not $env:FORTLEDGER_BACKUP_DIR -or
        -not $env:FORTLEDGER_BACKUP_PASSPHRASE) {
      throw 'Configure encrypted backups on a separate drive before updating this installation.'
    }
    $latest=Get-ChildItem -LiteralPath $env:FORTLEDGER_BACKUP_DIR -Filter 'fortledger-*.flbk' -File |
      Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $latest -or ((Get-Date).ToUniversalTime() - $latest.LastWriteTimeUtc).TotalHours -gt 36 -or
        ((Get-Date).ToUniversalTime() - $latest.LastWriteTimeUtc).TotalHours -lt 0) {
      throw 'A recent separate-drive encrypted backup (36 hours or less) is required before updating.'
    }
    $env:FORTLEDGER_DATA_DIR=$live
    # Legacy SQLite-only snapshots are not sufficient to recover owner login
    # on a replacement PC, even if SQLite itself decrypts successfully.
    if (-not (Test-Path -LiteralPath $Verifier -PathType Leaf)) {
      throw 'The verified installer is missing its independent owner credential verifier.'
    }
    & $node $drill $latest.FullName --require-owner-companion
    if ($LASTEXITCODE -ne 0) {
      throw 'Encrypted backup restore verification failed; application files were not updated.'
    }
    # The included verifier comes from the NEW setup: an older installed drill
    # cannot silently ignore the strict owner-companion requirement.
    & $node $Verifier $latest.FullName
    if ($LASTEXITCODE -ne 0) {
      throw 'Original owner credential companion could not be authenticated. No app files were replaced.'
    }
  }
  exit 0
}catch{
  Write-Error ('INSTALLER BLOCKED: '+$_.Exception.Message)
  exit 1
}finally{
  $env:FORTLEDGER_BACKUP_PASSPHRASE=$null
  $env:FORTLEDGER_BACKUP_DIR=$null
}
