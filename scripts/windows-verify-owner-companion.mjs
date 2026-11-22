// Read-only, self-contained verification bundled in the NEW Windows setup.
// Old installed applications may not know the new strict recovery-drill flag.
// Never ask the old software to validate a file format it may silently ignore.
import fs from 'node:fs';
import path from 'node:path';
import {createDecipheriv,scryptSync} from 'node:crypto';

function verifyOwnerCompanion(backup,passphrase){
  if(!backup||!path.isAbsolute(backup)||!backup.endsWith('.flbk'))
    throw new Error('Expected an absolute paired SQLite backup path');
  if(!passphrase||passphrase.length<16)
    throw new Error('Protected backup passphrase is not configured');
  const file=backup.slice(0,-5)+'.flba';
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())
    throw new Error('The original owner credential backup is missing; do not replace hotel program files');
  const b=fs.readFileSync(file);
  if(b.length<=50||!b.subarray(0,6).equals(Buffer.from('FLBK01')))
    throw new Error('Invalid encrypted owner companion');
  const decipher=createDecipheriv('aes-256-gcm',scryptSync(passphrase,b.subarray(6,22),32),b.subarray(22,34));
  decipher.setAuthTag(b.subarray(34,50));
  const plaintext=Buffer.concat([decipher.update(b.subarray(50)),decipher.final()]);
  try{
    const record=JSON.parse(plaintext.toString('utf8'));
    if(record?.version!==1||
      typeof record.salt!=='string'||!/^[a-f0-9]{32}$/.test(record.salt)||
      typeof record.hash!=='string'||!/^[a-f0-9]{128}$/.test(record.hash))
      throw new Error('Malformed recovered owner record');
    return true;
  }finally{plaintext.fill(0);}
}
if(import.meta.url===new URL('file://'+process.argv[1]?.replaceAll('\\','/')).href){
  try{
    verifyOwnerCompanion(process.argv[2],process.env.FORTLEDGER_BACKUP_PASSPHRASE);
    console.log('PASS: encrypted owner credential companion authenticated without exposing the credential.');
  }catch{
    console.error('FAIL: complete encrypted owner credential recovery not verified. Installer blocked.');
    process.exitCode=1;
  }
}
export {verifyOwnerCompanion};
