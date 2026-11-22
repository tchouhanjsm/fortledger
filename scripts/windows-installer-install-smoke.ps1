# CI ONLY: exercise the actual Inno Setup EXE against a disposable Windows profile.
# Does not use real hotel records or launch the GUI on an unattended runner.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference='Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows is required for installer integration test.' }
if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) { throw 'Installer EXE was not built.' }
$root=Join-Path $env:TEMP ('fortledger-install-smoke-'+[guid]::NewGuid().ToString('N'))
$target=Join-Path $root 'InstalledApp'
New-Item -ItemType Directory -Path $root -Force | Out-Null
# A synthetic data marker demonstrates that uninstall never purges the separate
# hotel profile folder. No SQLite booking, invoice or password is created here.
$profileData=Join-Path $env:LOCALAPPDATA 'FortLedger\data'
New-Item -ItemType Directory -Path $profileData -Force | Out-Null
$marker=Join-Path $profileData ('installer-ci-sentinel-'+[guid]::NewGuid().ToString('N')+'.txt')
[IO.File]::WriteAllText($marker,'synthetic data separation sentinel')
try{
  Write-Host 'Installing Inno EXE silently into a disposable directory...' -ForegroundColor Cyan
  $argsToSetup=@('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/DIR="'+$target+'"'))
  $install=Start-Process -FilePath $Installer -ArgumentList $argsToSetup -Wait -PassThru
  if ($install.ExitCode -ne 0) { throw ('Inno Setup install exited '+$install.ExitCode) }
  foreach($item in @('FortLedger.exe','node.exe','src\server.js','public\index.html',
      'node_modules\better-sqlite3\build\Release\better_sqlite3.node','unins000.exe')){
    if(-not (Test-Path -LiteralPath (Join-Path $target $item) -PathType Leaf)){
      throw ('Installed application file missing: '+$item)
    }
  }
  $startMenu=Join-Path ([Environment]::GetFolderPath('Programs')) 'FortLedger.lnk'
  $desktop=Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'FortLedger.lnk'
  foreach($shortcut in @($startMenu,$desktop)){
    if(-not (Test-Path -LiteralPath $shortcut -PathType Leaf)){
      throw ('Installer did not create the staff shortcut: '+$shortcut)
    }
    $shell=New-Object -ComObject WScript.Shell
    $link=$shell.CreateShortcut($shortcut)
    if ([IO.Path]::GetFullPath($link.TargetPath) -ne [IO.Path]::GetFullPath((Join-Path $target 'FortLedger.exe'))){
      throw 'Shortcut does not open the installed local FortLedger application.'
    }
  }
  Write-Host 'Uninstalling program files while keeping profile data...' -ForegroundColor Cyan
  $uninstaller=Join-Path $target 'unins000.exe'
  $uninstall=Start-Process -FilePath $uninstaller -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -PassThru -Wait
  if ($uninstall.ExitCode -ne 0) { throw 'Inno uninstall failed.' }
  if (-not (Test-Path -LiteralPath $marker -PathType Leaf) -or
      [IO.File]::ReadAllText($marker) -ne 'synthetic data separation sentinel') {
    throw 'Uninstall changed separate persistent hotel data — unsafe.'
  }
  Write-Host 'PASS: real installer installed native runtime, desktop/Start Menu icons and preserved profile data on uninstall.' -ForegroundColor Green
}finally{
  if(Test-Path -LiteralPath $marker){Remove-Item -LiteralPath $marker -Force}
  if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}
}
