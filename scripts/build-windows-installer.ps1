# CI-only Windows packaging. Bundles Node 22, production dependencies, and native GUI.
[CmdletBinding()]
param([ValidatePattern('^0\.1\.0\.[0-9]{1,5}$')][string]$Version='0.1.0.1')
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
if ($env:OS -ne 'Windows_NT') { throw 'Installer packaging requires Windows.' }
$nodeVersion=(& node --version)
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v22\.') {
  throw "Bundled production runtime must be Node.js 22.x; found $nodeVersion"
}
$stage=Join-Path $root 'dist\windows\app'
$destination=Join-Path $root 'dist\installer'
New-Item -ItemType Directory -Force -Path $stage,$destination | Out-Null
# Strict allowlist. Never package Git, runtime data, passwords, backups or .env.
Copy-Item -LiteralPath (Join-Path $root 'package.json'),(Join-Path $root 'package-lock.json') -Destination $stage
Copy-Item -LiteralPath (Join-Path $root 'src'),(Join-Path $root 'public') -Destination $stage -Recurse
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'scripts') | Out-Null
foreach($name in @('windows-backup-settings.ps1','windows-configure-backups.ps1')){
  Copy-Item -LiteralPath (Join-Path $root ('scripts\'+$name)) -Destination (Join-Path $stage 'scripts')
}
$nodeBinary=(Get-Command node.exe -ErrorAction Stop).Source
Copy-Item -LiteralPath $nodeBinary -Destination (Join-Path $stage 'node.exe')
Write-Host 'Installing only production native Windows dependencies into the package...' -ForegroundColor Cyan
& npm.cmd ci --prefix $stage --omit=dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Production dependency installation failed; packaging blocked.' }
if (-not (Test-Path -LiteralPath (Join-Path $stage 'node_modules\better-sqlite3\build\Release\better_sqlite3.node'))) {
  throw 'Native SQLite Windows x64 addon missing; a broken installer must not be published.'
}
Add-Type -AssemblyName System.Drawing
$bitmap=New-Object System.Drawing.Bitmap(128,128)
$graphics=[System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(34,50,75))
$font=New-Object System.Drawing.Font('Segoe UI',84,[System.Drawing.FontStyle]::Bold,[System.Drawing.GraphicsUnit]::Pixel)
$brush=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(243,211,155))
$graphics.DrawString('F',$font,$brush,17,9)
$ico=[System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$stream=[IO.File]::Open((Join-Path $stage 'fortledger.ico'),[IO.FileMode]::Create)
try { $ico.Save($stream) }finally{ $stream.Dispose();$ico.Dispose();$brush.Dispose();$font.Dispose();$graphics.Dispose();$bitmap.Dispose() }
$csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc)) { throw 'Windows .NET Framework C# compiler missing.' }
$compileArgs=@('/nologo','/target:winexe','/platform:x64','/optimize+',
  ('/win32icon:'+(Join-Path $stage 'fortledger.ico')),
  ('/out:'+(Join-Path $stage 'FortLedger.exe')),
  '/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll',
  '/reference:System.Web.Extensions.dll','/reference:System.Runtime.Serialization.dll',
  '/reference:System.Security.dll',(Join-Path $root 'scripts\windows-desktop-launcher.cs'))
& $csc @compileArgs
if ($LASTEXITCODE -ne 0) { throw 'Windows GUI launcher C# compilation failed.' }
Write-Host 'Running bundled Node/SQLite authentication and graceful-stop smoke test...' -ForegroundColor Cyan
& node .\scripts\windows-desktop-package-smoke.mjs $stage
if ($LASTEXITCODE -ne 0) { throw 'Bundled app smoke test failed.' }
$programFiles32=[Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
$iscc=Join-Path $programFiles32 'Inno Setup 6\ISCC.exe'
if (-not (Test-Path -LiteralPath $iscc)) { throw 'Inno Setup 6 compiler not found on Windows runner.' }
& $iscc ("/DAppVersion="+$Version) (Join-Path $root 'installers\FortLedger.iss')
if ($LASTEXITCODE -ne 0) { throw 'Inno installer build failed.' }
$file=Join-Path $destination ('FortLedger-Setup-'+$Version+'-win-x64.exe')
if (-not (Test-Path -LiteralPath $file)) { throw 'Installer executable missing after compilation.' }
$hash=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
Write-Host 'Verifying actual installer/uninstaller and desktop icon creation...' -ForegroundColor Cyan
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'windows-installer-install-smoke.ps1') -Installer $file
if ($LASTEXITCODE -ne 0) { throw 'Inno installer integration verification failed.' }
Write-Host ('INSTALLER BUILT: '+$file) -ForegroundColor Green
Write-Host ('SHA256: '+$hash)
Write-Host 'UNSIGNED ALPHA: physical Windows installation, SmartScreen and real restore acceptance remain required.' -ForegroundColor Yellow
