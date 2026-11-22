import fs from 'node:fs';
import path from 'node:path';
import {authPath,databasePath} from './data-paths.js';
import {backupFreshness} from './backup-freshness.js';
import {verifyEncryptedBackupFile,verifyEncryptedCredentialCompanion} from './encrypted-backups.js';

const MATCH=/^fortledger-.*\.flbk$/;

/** Explicit owner-triggered verification. The normal lightweight dashboard
 * only reports file freshness; this decrypts a copy into an isolated scratch
 * database and checks SQLite integrity without touching the live ledger.
 * Never return directory names, guest details or passphrases to the browser. */
export function verifyLocalBackupHealth({
  env=process.env,now=new Date(),auth=authPath(env),live=databasePath(env),
  restore=verifyEncryptedBackupFile
}={}){
  const basic=backupFreshness({env,now});
  const result={state:basic.state,configured:!['unconfigured','invalid'].includes(basic.state),
    recent:basic.state==='recent',restorable:false,owner_auth_present:false,
    independent_drive:false,owner_credential_recoverable:false,detail:basic.detail};
  if(basic.state!=='recent')return result;
  try{
    const root=fs.realpathSync(env.FORTLEDGER_BACKUP_DIR);
    const databaseDir=path.dirname(path.resolve(live));
    const disk=path.parse(root).root.toLowerCase(),dbDisk=path.parse(databaseDir).root.toLowerCase();
    const different=process.platform==='win32'?
      path.win32.parse(root).root.toLowerCase()!==path.win32.parse(databaseDir).root.toLowerCase():
      disk!==dbDisk;
    result.independent_drive=different;
    result.owner_auth_present=fs.existsSync(auth);
    const options=fs.readdirSync(root,{withFileTypes:true})
      .filter(x=>x.isFile()&&MATCH.test(x.name))
      .map(x=>{const file=path.join(root,x.name);return {file,mtime:fs.statSync(file).mtimeMs};})
      .sort((a,b)=>b.mtime-a.mtime);
    if(!options.length)throw new Error('No encrypted file');
    const validated=restore(options[0].file,env.FORTLEDGER_BACKUP_PASSPHRASE);
    if(validated?.rooms!==7)throw new Error('Room inventory mismatch');
    const ownerArtifact=verifyEncryptedCredentialCompanion(
      options[0].file,env.FORTLEDGER_BACKUP_PASSPHRASE);
    result.restorable=true;
    result.owner_credential_recoverable=ownerArtifact.verified;
    result.state=result.independent_drive&&result.owner_auth_present&&
      result.owner_credential_recoverable?'verified':'attention';
    result.detail=result.state==='verified'?
      'Latest encrypted SQLite backup decrypted, passed integrity checks and contains seven rooms. Full replacement-device recovery still needs separate testing.':
      'Backup SQLite passed integrity checks, but separate-drive storage or a recoverable encrypted owner credential is missing. Keep the original admin-auth.json independently protected.';
  }catch{
    result.state='failed';
    result.restorable=false;
    result.owner_credential_recoverable=false;
    result.detail='Latest encrypted backup could not be independently decrypted and validated. Do not install updates until a verified backup exists.';
  }
  return result;
}
