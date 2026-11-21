import path from 'node:path';
import {decryptBackupFile} from './encrypted-backups.js';
const [,,source,target]=process.argv;
const passphrase=process.env.FORTLEDGER_BACKUP_PASSPHRASE;
if(!source||!target){
  console.error('Usage: FORTLEDGER_BACKUP_PASSPHRASE=... npm run backup:decrypt -- backup.flbk restored-candidate.sqlite');
  process.exitCode=1;
}else{
  try{
    const details=decryptBackupFile(path.resolve(source),path.resolve(target),passphrase);
    console.log('Decrypted verified backup candidate:',details);
    console.log('Stop FortLedger and use npm run restore -- <candidate.sqlite> ./data/fortledger.sqlite --confirm');
  }catch(error){console.error('Unable to decrypt backup:',error.message);process.exitCode=1;}
}
