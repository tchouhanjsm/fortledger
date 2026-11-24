import path from 'node:path';
import fs from 'node:fs';
import {backupFreshness} from './backup-freshness.js';
import {verifyLocalBackupHealth} from './backup-health.js';
import {createEncryptedBackup} from './encrypted-backups.js';
import {authPath,databasePath} from './data-paths.js';

function clean(s){return path.win32.normalize(s).replace(/[\\/]+$/,'').toLowerCase();}
/** A local DPAPI-sealed checkpoint protects a routine source patch against
 * software mistakes, NOT drive loss, ransomware or Windows profile loss.
 * Never accept an arbitrary same-drive folder as the trusted emergency store. */
export function routineRecoveryPolicy({env=process.env,platform=process.platform}={}){
  if(platform!=='win32')throw new Error('Windows routine update recovery required');
  const folder=env.FORTLEDGER_BACKUP_DIR,pass=env.FORTLEDGER_BACKUP_PASSPHRASE;
  // Use the explicit Windows folder in synthetic cross-platform tests and
  // the installed runtime's own resolved data file on the real Windows PC.
  const live=env.FORTLEDGER_DB||env.FORTLEDGER_DATA_DIR||databasePath(env);
  if(typeof folder!=='string'||!path.win32.isAbsolute(folder)||
     typeof pass!=='string'||pass.length<16||!path.win32.isAbsolute(live))
    throw new Error('A configured encrypted backup is required before source updates');
  if(env.FORTLEDGER_BACKUP_LOCAL_ONLY==='1'){
    const parent=env.LOCALAPPDATA;
    if(typeof parent!=='string'||!path.win32.isAbsolute(parent)||
       clean(folder)!==clean(path.win32.join(parent,'FortLedger','local-backups')))
      throw new Error('Local routine checkpoint must use the original sealed Windows profile folder');
    return {scope:'local_checkpoint',independent_disaster_recovery:false};
  }
  const sourceRoot=path.win32.parse(live).root.toLowerCase();
  const destinationRoot=path.win32.parse(folder).root.toLowerCase();
  if(!destinationRoot||sourceRoot===destinationRoot)
    throw new Error('External backup settings must use another protected volume');
  return {scope:'independent',independent_disaster_recovery:true};
}
export function verifyRoutineUpdateBackup({
  env=process.env,platform=process.platform,
  freshness=backupFreshness,health=verifyLocalBackupHealth
}={}){
  const policy=routineRecoveryPolicy({env,platform});
  if(freshness({env}).state!=='recent')
    throw new Error('Latest encrypted checkpoint is not recent; review backup health');
  const status=health({env});
  if(status?.restorable!==true||status?.owner_auth_present!==true||
     status?.owner_credential_recoverable!==true||
     (policy.scope==='independent'&&status?.independent_drive!==true))
    throw new Error('Encrypted hotel ledger and owner credentials must pass isolated recovery checks');
  return policy;
}
/** Called AFTER HTTP listener drain, while SQLite is still open and before
 * the independent tray can replace source. Does not move or reset hotel data. */
export async function prepareRoutineUpdateCheckpoint(db,{
  env=process.env,platform=process.platform,authFile=authPath(env),
  create=createEncryptedBackup,freshness=backupFreshness,
  health=verifyLocalBackupHealth,exists=fs.existsSync
}={}){
  const policy=routineRecoveryPolicy({env,platform});
  if(!exists(authFile))
    throw new Error('Original owner credential missing; update not attempted');
  const artifact=await create(db,env.FORTLEDGER_BACKUP_DIR,
    env.FORTLEDGER_BACKUP_PASSPHRASE,{authFile});
  if(artifact?.owner_credentials_encrypted!==true)
    throw new Error('New checkpoint did not include original owner credentials');
  const verified=verifyRoutineUpdateBackup({env,platform,freshness,health});
  return {state:'verified',scope:verified.scope,
    independent_disaster_recovery:policy.independent_disaster_recovery};
}
