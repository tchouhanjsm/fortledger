import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';
import {validatedDesktopLanSettings} from '../src/desktop-lan-settings.js';

const openssl=spawnSync('openssl',['version'],{stdio:'ignore'}).status===0;
const ip='192.168.37.15';
test('desktop LAN remains strictly opt-in, and invalid/public configs refuse to load',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fl-desktop-lan-'));
  const file=path.join(dir,'lan-settings.json');
  try{
    assert.equal(validatedDesktopLanSettings(file),null);
    for(const host of ['0.0.0.0','127.0.0.1','8.8.8.8','10.10.10.999','evil.com']){
      fs.writeFileSync(file,JSON.stringify({version:1,host,port:3000,
        certPath:path.join(dir,'a.crt'),keyPath:path.join(dir,'b.key')}));
      assert.throws(()=>validatedDesktopLanSettings(file),/Private staff-network settings invalid/);
    }
    fs.writeFileSync(file,JSON.stringify({version:1,host:ip,port:3001,
      certPath:path.join(dir,'a.crt'),keyPath:path.join(dir,'b.key')}));
    assert.throws(()=>validatedDesktopLanSettings(file),/invalid/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('real certificate SAN/private key pairing is required before enabling staff Wi-Fi', {skip:!openssl},()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fl-desktop-tls-'));
  const cert=path.join(dir,'a.crt'),key=path.join(dir,'b.key'),config=path.join(dir,'config.json');
  try{
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes',
      '-keyout',key,'-out',cert,'-days','2','-subj','/CN=synthetic-staff',
      '-addext','subjectAltName=IP:'+ip],{stdio:'ignore',timeout:15000});
    fs.writeFileSync(config,JSON.stringify({version:1,host:ip,port:3000,
      certPath:cert,keyPath:key}));
    assert.equal(validatedDesktopLanSettings(config).url,'https://'+ip+':3000');
    fs.writeFileSync(config,JSON.stringify({version:1,host:'192.168.37.16',port:3000,
      certPath:cert,keyPath:key}));
    assert.throws(()=>validatedDesktopLanSettings(config),/include the bound private IP/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Windows installer packages opt-in staff Wi-Fi wizard and desktop shutdown remains available on HTTPS',()=>{
  const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
  const desktop=read('scripts/windows-desktop-launcher.cs'),
    script=read('scripts/windows-configure-staff-lan.ps1'),
    builder=read('scripts/build-windows-installer.ps1'),
    server=read('src/server.js');
  assert.match(desktop,/Hotel LAN HTTPS - phone access/);
  assert.match(desktop,/psi\.Verb="runas"/);
  assert.match(desktop,/FORTLEDGER_TLS_CERT/);
  assert.match(desktop,/FORTLEDGER_TLS_KEY/);
  assert.match(desktop,/IPAddress\.TryParse/);
  assert.match(script,/New-NetFirewallRule/);
  assert.match(script,/-RemoteAddress \$StaffSubnet -Profile Private/);
  assert.match(script,/Get-NetConnectionProfile/);
  assert.match(script,/desktop-lan-settings\.js/);
  assert.match(builder,/windows-configure-staff-lan\.ps1/);
  assert.match(server,/network\.mode==='lan'\|\|\(!tls&&host==='127\.0\.0\.1'\)/);
  assert.doesNotMatch(script+desktop,/FORTLEDGER_TLS.*http:\/\/|netsh interface portproxy|0\.0\.0\.0:3000|New-NetFirewallRule.*-RemoteAddress Any/i);
  if(process.platform==='win32'){
    const ps=`$errs=@(); [System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'scripts/windows-configure-staff-lan.ps1'),[ref]$null,[ref]$errs) | Out-Null; if($errs.Count){$errs|ForEach-Object{Write-Error $_};exit 1}`;
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],
      {cwd:fileURLToPath(new URL('..',import.meta.url)),timeout:15000});
  }
});

test('one existing Ethernet-and-Wi-Fi hotel LAN remains HTTPS and firewall restricted',()=>{
  const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
  const script=read('scripts/windows-configure-staff-lan.ps1');
  const guide=read('docs/WINDOWS_STAFF_WIFI.md');
  const gate=read('src/release-readiness.js');
  assert.match(script,/Ethernet or Wi-Fi/);
  assert.match(script,/-RemoteAddress \$StaffSubnet -Profile Private/);
  assert.match(script,/New-NetFirewallRule/);
  assert.match(guide,/No second staff-only Wi-Fi is required/);
  assert.match(guide,/individual FortLedger staff account/);
  assert.match(guide,/no router port-forwarding/);
  assert.match(gate,/denied outside-LAN access/);
  assert.doesNotMatch(script,/RemoteAddress Any|0\.0\.0\.0:3000/);
});
