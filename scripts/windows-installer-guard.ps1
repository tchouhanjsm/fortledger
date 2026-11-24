# Pre-copy installer safety gate. Runs BEFORE any program files can be updated.
# Existing hotel SQLite and administrator credentials are NEVER touched here.
param([Parameter(Mandatory=$true)][string]$InstallDirectory,
      [Parameter(Mandatory=$true)][string]$Verifier,
      [string]$DiagnosticFile='')
$ErrorActionPreference='Stop'
$live=Join-Path $env:LOCALAPPDATA 'FortLedger\data'
$db=Join-Path $live 'fortledger.sqlite'
$auth=Join-Path $live 'admin-auth.json'
try {
  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $listeners=@(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
      # Task Manager may close the tray while leaving its Node server alive.
      # Diagnose the exact listener without killing a server mid-transaction.
      $owners=@($listeners | Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object {
          $ownerPid=[int]$_
          $processName='unknown'
          try { $processName=(Get-Process -Id $ownerPid -ErrorAction Stop).ProcessName }
          catch { }
          ('PID '+$ownerPid+' ('+$processName+')')
        })
      throw ('Port 3000 is still listening: '+($owners -join ', ')+
        '. Close FortLedger from the Windows system tray, not Task Manager. '+
        'If the tray was forcibly ended and a Node server remained, finish hotel work, '+
        'verify a recoverable backup, then restart Windows normally and run the installer '+
        'before reopening FortLedger. Never terminate unknown processes or bypass this guard.')
    }
  }
  $dbExists=Test-Path -LiteralPath $db -PathType Leaf
  $authExists=Test-Path -LiteralPath $auth -PathType Leaf
  if ($dbExists -xor $authExists) {
    throw 'Hotel records and owner credentials are incomplete; stop and recover the original files.'
  }
  if ($dbExists) {
    # The persistent hotel ledger is independent of the selected setup directory.
    # Selecting another app directory must NEVER skip backup/credential checks.
    if (-not (Test-Path -LiteralPath (Join-Path $InstallDirectory 'FortLedger.exe') -PathType Leaf)) {
      throw ('Existing hotel records detected, but the selected setup directory is '+
        'not the previously installed FortLedger desktop. Select the ORIGINAL '+
        'FortLedger program directory for a reviewed upgrade, or stop for manual '+
        'recovery if that application has been lost. Do not install alongside the '+
        'same live ledger or delete owner credentials to bypass backup checks.')
    }
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
      throw ('Configure encrypted backups on a separate drive before updating this installation. '+
        'Nothing has been replaced. Choose the installer backup-setup helper or '+
        'FortLedger tray > Configure encrypted backups (owner). After setup, start '+
        'the existing app and use My Profile > Protected backups > Prepare safe update '+
        'backup (if available), verify a matching .flbk/.flba pair, close the tray '+
        'safely and retry. Never delete the hotel database or original owner login.')
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
  $diagnostic='INSTALLER BLOCKED: '+$_.Exception.Message
  # The temporary installer error report has only operational blockers,
  # never passwords, PDF contents, guest data, DB mutations, or PIDs of
  # unrelated processes beyond the owner of the blocked listening port.
  if ($DiagnosticFile) {
    try { [IO.File]::WriteAllText($DiagnosticFile,$diagnostic,[Text.Encoding]::ASCII) }
    catch { }
  }
  Write-Error $diagnostic
  exit 1
}finally{
  $env:FORTLEDGER_BACKUP_PASSPHRASE=$null
  $env:FORTLEDGER_BACKUP_DIR=$null
}
