# One-time owner/technician setup for staff Wi-Fi HTTPS. Run with UAC admin.
[CmdletBinding()]
param([string]$StaffIP='', [string]$Certificate='',[string]$PrivateKey='',[string]$StaffSubnet='', [switch]$Disable)
$ErrorActionPreference='Stop'
if($env:OS -ne 'Windows_NT'){throw 'Staff networking requires Windows'}
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
  throw 'The hotel owner must approve the Windows UAC administrator prompt for firewall configuration.'
}
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if($Disable){
  $rule='FortLedger Staff HTTPS 3000'
  Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction Stop
  $active=Join-Path $env:LOCALAPPDATA 'FortLedger\lan-settings.json'
  if(Test-Path -LiteralPath $active){
    $archive=$active+'.disabled-'+[guid]::NewGuid().ToString('N')
    Move-Item -LiteralPath $active -Destination $archive
  }
  Write-Host 'Staff Wi-Fi listener disabled. After safe tray restart FortLedger returns to 127.0.0.1 only.' -ForegroundColor Green
  Write-Host 'No hotel bookings, invoices, account hashes or TLS private-key files were deleted.'
  exit 0
}
if(-not $StaffIP){$StaffIP=(Read-Host 'Hotel PC private IPv4 on STAFF Wi-Fi (example 192.168.10.15)').Trim()}
if(-not $StaffSubnet){$StaffSubnet=(Read-Host 'STAFF Wi-Fi CIDR (example 192.168.10.0/24)').Trim()}
if(-not $Certificate){$Certificate=(Read-Host 'Absolute PEM certificate path').Trim().Trim('"')}
if(-not $PrivateKey){$PrivateKey=(Read-Host 'Absolute private-key PEM path').Trim().Trim('"')}
$address=$null
if(-not [Net.IPAddress]::TryParse($StaffIP,[ref]$address) -or $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork){
  throw 'A specific private IPv4 host is required.'
}
if($StaffIP -notmatch '^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$'){
  throw 'Only private staff-Wi-Fi addresses are supported.'
}
if($StaffSubnet -notmatch '^(\d{1,3}\.){3}\d{1,3}/(2[4-9]|3[0-2])$'){
  throw 'Staff subnet must be a valid private /24 through /32 CIDR.'
}
$pieces=$StaffSubnet.Split('/')
$network=$null
if(-not [Net.IPAddress]::TryParse($pieces[0],[ref]$network) -or
   $network.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork){
  throw 'Invalid staff-subnet address.'
}
if($pieces[0] -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)'){
  throw 'Staff subnet must also use private addresses.'
}
$ipBytes=$address.GetAddressBytes();$netBytes=$network.GetAddressBytes()
for($bit=0;$bit -lt [int]$pieces[1];$bit++){
  $octet=[int][Math]::Floor($bit/8)
  $mask=128 -shr ($bit%8)
  if(($ipBytes[$octet] -band $mask) -ne ($netBytes[$octet] -band $mask)){
    throw 'Windows host IP is outside the specified staff subnet.'
  }
}
$assigned=Get-NetIPAddress -IPAddress $StaffIP -AddressFamily IPv4 -ErrorAction SilentlyContinue
if(-not $assigned){throw 'The Windows PC does not currently have this private IP; reserve an IP in the staff router.'}
$profile=Get-NetConnectionProfile -InterfaceIndex $assigned.InterfaceIndex -ErrorAction Stop
if($profile.NetworkCategory -ne 'Private'){throw 'Use a Windows Private network profile, not a public/guest network.'}
$Certificate=[IO.Path]::GetFullPath($Certificate);$PrivateKey=[IO.Path]::GetFullPath($PrivateKey)
if(-not (Test-Path -LiteralPath $Certificate -PathType Leaf) -or
   -not (Test-Path -LiteralPath $PrivateKey -PathType Leaf)){
  throw 'HTTPS certificate and private-key file are required.'
}
$folder=Join-Path $env:LOCALAPPDATA 'FortLedger'
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$config=@{version=1;host=$StaffIP;port=3000;certPath=$Certificate;keyPath=$PrivateKey}
$staging=Join-Path $folder ('lan-settings.preview-'+[guid]::NewGuid().ToString('N')+'.json')
try{
  [IO.File]::WriteAllText($staging,($config|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
  & (Join-Path $root 'node.exe') (Join-Path $root 'src\desktop-lan-settings.js') $staging
  if($LASTEXITCODE -ne 0){throw 'Certificate must match the private IP, key and validity dates.'}
  $rule='FortLedger Staff HTTPS 3000'
  Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction Stop
  New-NetFirewallRule -DisplayName $rule -Direction Inbound -Enabled True -Action Allow -Protocol TCP -LocalPort 3000 -LocalAddress $StaffIP -RemoteAddress $StaffSubnet -Profile Private | Out-Null
  Move-Item -LiteralPath $staging -Destination (Join-Path $folder 'lan-settings.json') -Force
  Write-Host ('Staff-only HTTPS configured: https://'+$StaffIP+':3000') -ForegroundColor Green
  Write-Host 'Restart the tray safely. Staff phones must trust the certificate issuer. Test guest-Wi-Fi denial and disable router port forwarding.' -ForegroundColor Yellow
}finally{
  if(Test-Path -LiteralPath $staging){Remove-Item -LiteralPath $staging -Force}
}
