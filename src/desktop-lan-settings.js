import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {isPrivateLanIp,readLanTlsCredentials} from './network-policy.js';

const SETTING_NAME='lan-settings.json';
export function desktopLanSettingsFile(env=process.env){
  const data=env.LOCALAPPDATA||
    (process.platform==='win32'?path.join(os.homedir(),'AppData','Local'):null);
  if(!data)return null;
  return path.join(data,'FortLedger',SETTING_NAME);
}
/** Never open a public interface or accept an unvalidated hostname. */
export function validatedDesktopLanSettings(file=desktopLanSettingsFile()){
  if(!file||!fs.existsSync(file))return null;
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));
  if(saved?.version!==1||!isPrivateLanIp(saved.host)||saved.port!==3000||
     typeof saved.certPath!=='string'||typeof saved.keyPath!=='string'||
     !path.isAbsolute(saved.certPath)||!path.isAbsolute(saved.keyPath))
    throw new Error('Private staff-network settings invalid. Correct or disable LAN before opening FortLedger');
  if(!fs.statSync(saved.certPath).isFile()||!fs.statSync(saved.keyPath).isFile())
    throw new Error('Private staff-network certificate or key missing');
  readLanTlsCredentials({mode:'lan',host:saved.host,port:3000,
    certPath:saved.certPath,keyPath:saved.keyPath});
  return {mode:'lan',host:saved.host,port:3000,
    certPath:saved.certPath,keyPath:saved.keyPath,
    url:'https://'+saved.host+':3000'};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [file]=process.argv.slice(2);
  try{
    if(!file||!path.isAbsolute(file))
      throw new Error('Absolute configuration file required');
    const verified=validatedDesktopLanSettings(file);
    if(!verified)throw new Error('Staff HTTPS configuration is missing');
    console.log('Verified staff HTTPS listener:',verified.url);
    console.log('Phone certificate trust and staff/guest Wi-Fi isolation still require onsite checks.');
  }catch(error){console.error('LAN CONFIGURATION REFUSED:',error.message);process.exitCode=1;}
}
