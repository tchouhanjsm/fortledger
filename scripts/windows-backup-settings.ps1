# Shared Windows backup settings: per-user DPAPI only, never plaintext on disk.
# Dot-source this file from the setup, normal startup or manual update script.
$ErrorActionPreference = 'Stop'

function Get-FortLedgerBackupSettingsFile {
  $local = [Environment]::GetFolderPath('LocalApplicationData')
  if (-not $local) { throw 'Windows local application data is not available.' }
  return (Join-Path $local 'FortLedger\backup-settings.json')
}

function Assert-FortLedgerBackupSeparation {
  param([Parameter(Mandatory=$true)][string]$Directory,
        [Parameter(Mandatory=$true)][string]$DataDirectory,
        [string]$AppRoot = '')
  if (-not [IO.Path]::IsPathRooted($Directory) -or
      -not [IO.Path]::IsPathRooted($DataDirectory)) {
    throw 'Backup and live data directories must use absolute paths.'
  }
  $backup = [IO.Path]::GetFullPath($Directory)
  $source = [IO.Path]::GetFullPath($DataDirectory)
  $backupDrive = [IO.Path]::GetPathRoot($backup)
  $sourceDrive = [IO.Path]::GetPathRoot($source)
  if (-not $backupDrive -or -not $sourceDrive -or
      $backupDrive.Equals($sourceDrive,[StringComparison]::OrdinalIgnoreCase)) {
    throw 'Encrypted backup folder must be on a different protected drive or network share from the live database.'
  }
  if ($AppRoot) {
    $app = [IO.Path]::GetFullPath($AppRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
    if ($backup.Equals($app,[StringComparison]::OrdinalIgnoreCase) -or
        $backup.StartsWith($app+[IO.Path]::DirectorySeparatorChar,
          [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Encrypted backups must not be kept inside the Git application directory.'
    }
  }
  if (-not (Test-Path -LiteralPath $backup -PathType Container)) {
    throw 'Protected backup folder does not exist. Connect the external drive and create its folder first.'
  }
  $item = Get-Item -LiteralPath $backup -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Backup folder is a redirected link; choose an actual external-drive folder.'
  }
  return $backup
}

function Convert-FortLedgerSecureText {
  param([Parameter(Mandatory=$true)][Security.SecureString]$SecureText)
  $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureText)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Save-FortLedgerBackupSettings {
  param([Parameter(Mandatory=$true)][string]$Directory,
        [Parameter(Mandatory=$true)][Security.SecureString]$Passphrase,
        [Parameter(Mandatory=$true)][string]$DataDirectory,
        [string]$AppRoot = '',
        [string]$SettingsFile = (Get-FortLedgerBackupSettingsFile))
  if ($env:OS -ne 'Windows_NT') { throw 'DPAPI settings are supported only on Windows.' }
  $destination=Assert-FortLedgerBackupSeparation -Directory $Directory -DataDirectory $DataDirectory -AppRoot $AppRoot
  $plain=Convert-FortLedgerSecureText $Passphrase
  if ($plain.Length -lt 16) { throw 'Encrypted backup passphrase must be at least 16 characters.' }
  # Windows CurrentUser DPAPI through .NET, not a dependency on a PowerShell
  # Security module which can be unavailable on constrained Windows runners.
  $bytes=[Text.Encoding]::UTF8.GetBytes($plain)
  $plain=$null
  try {
    $sealed=[Convert]::ToBase64String(
      [Security.Cryptography.ProtectedData]::Protect(
        $bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
  } finally {
    [Array]::Clear($bytes,0,$bytes.Length)
  }
  $folder=Split-Path -Parent $SettingsFile
  if (-not (Test-Path -LiteralPath $folder)) {
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
  }
  $settings=@{version=1; directory=$destination; passphrase_dpapi=$sealed} |
    ConvertTo-Json -Compress
  $temporary=$SettingsFile+'.tmp-'+[guid]::NewGuid().ToString('N')
  try {
    [IO.File]::WriteAllText($temporary,$settings,(New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $SettingsFile -Force
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}

function Import-FortLedgerBackupSettings {
  param([Parameter(Mandatory=$true)][string]$DataDirectory,
        [string]$AppRoot = '',
        [string]$SettingsFile = (Get-FortLedgerBackupSettingsFile))
  # An explicitly configured launcher environment wins over the saved local
  # account profile, but must satisfy the same safety checks.
  if ($env:FORTLEDGER_BACKUP_DIR -and $env:FORTLEDGER_BACKUP_PASSPHRASE) {
    [void](Assert-FortLedgerBackupSeparation -Directory $env:FORTLEDGER_BACKUP_DIR -DataDirectory $DataDirectory -AppRoot $AppRoot)
    if ($env:FORTLEDGER_BACKUP_PASSPHRASE.Length -lt 16) {
      throw 'Encrypted backup passphrase is too short.'
    }
    return $true
  }
  if (-not (Test-Path -LiteralPath $SettingsFile -PathType Leaf)) { return $false }
  if ($env:OS -ne 'Windows_NT') { throw 'Windows DPAPI settings cannot be opened on another operating system.' }
  try {
    $stored=Get-Content -LiteralPath $SettingsFile -Raw | ConvertFrom-Json
    if ($stored.version -ne 1 -or -not $stored.directory -or -not $stored.passphrase_dpapi) {
      throw 'Invalid encrypted backup settings format.'
    }
    $folder=Assert-FortLedgerBackupSeparation -Directory $stored.directory -DataDirectory $DataDirectory -AppRoot $AppRoot
    $protected=[Convert]::FromBase64String([string]$stored.passphrase_dpapi)
    $unsealed=[Security.Cryptography.ProtectedData]::Unprotect(
      $protected,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    try {
      $secret=[Text.Encoding]::UTF8.GetString($unsealed)
      if ($secret.Length -lt 16) { throw 'Backup passphrase configuration is invalid.' }
      $env:FORTLEDGER_BACKUP_DIR=$folder
      $env:FORTLEDGER_BACKUP_PASSPHRASE=$secret
      $secret=$null
    } finally {
      [Array]::Clear($unsealed,0,$unsealed.Length)
    }
    return $true
  }catch{
    throw 'Protected backup configuration cannot be unlocked on this Windows account or drive. Reconfigure locally; do not overwrite a working backup.'
  }
}
