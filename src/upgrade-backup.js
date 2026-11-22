import fs from 'node:fs';
import path from 'node:path';
import {authPath,databasePath} from './data-paths.js';
import {loadPasswordRecord} from './auth.js';
import {createEncryptedBackup} from './encrypted-backups.js';
import {rehearseEncryptedRecovery} from './encrypted-recovery-drill.js';

/** Guard a manual update against same-PC emergency copies. Path root checks
 * are conservative, but cannot prove physical encryption or offsite recovery. */
export function isSeparateBackupVolume(directory,live,platform=process.platform){
  const parser=platform==='win32'?path.win32:path;
  const left=parser.parse(directory).root.toLowerCase();
  const right=parser.parse(live).root.toLowerCase();
  return Boolean(left&&right&&left!==right);
}

export class UpgradeBackupRefusal extends Error {
  constructor(message){super(message);this.name='UpgradeBackupRefusal';}
}

/** A deliberate OWNER action: create a fresh AES-GCM SQLite + owner-hash pair
 * on an already configured separate drive and perform a complete isolated
 * recovery rehearsal. Neither live SQLite nor login credentials are modified.
 * Never return guest names, file paths or passwords in results/errors. */
export async function prepareVerifiedUpgradeBackup(db,{
  env=process.env,authFile=authPath(env),liveFile=databasePath(env),
  independent=isSeparateBackupVolume,
  create=createEncryptedBackup,rehearse=rehearseEncryptedRecovery
}={}){
  if(env.FORTLEDGER_BACKUP_LOCAL_ONLY==='1')
    throw new UpgradeBackupRefusal(
      'Only same-computer emergency backups are configured. Connect and configure a separately protected backup drive before upgrading.');
  const directory=env.FORTLEDGER_BACKUP_DIR;
  const passphrase=env.FORTLEDGER_BACKUP_PASSPHRASE;
  if(typeof directory!=='string'||!path.isAbsolute(directory)||
     typeof passphrase!=='string'||passphrase.length<16)
    throw new UpgradeBackupRefusal(
      'Configure the external encrypted backup drive from the FortLedger Windows tray and restart the app.');
  let root;
  try{
    root=fs.realpathSync(directory);
    if(!fs.statSync(root).isDirectory()||
       fs.lstatSync(directory).isSymbolicLink())throw new Error('Not a physical folder');
  }catch{
    throw new UpgradeBackupRefusal(
      'The protected backup drive is unavailable. Reconnect it before preparing an update.');
  }
  if(!independent(root,path.resolve(liveFile)))
    throw new UpgradeBackupRefusal(
      'The backup target is on the same drive as the hotel database. A separate protected drive is required for upgrades.');
  try{
    if(!fs.statSync(authFile).isFile()||!loadPasswordRecord(authFile))
      throw new Error('Missing original owner credential');
  }catch{
    throw new UpgradeBackupRefusal(
      'The original owner credential file is missing or invalid. Do not reset the hotel password; recover the original file first.');
  }
  let artifact;
  try{
    artifact=await create(db,root,passphrase,{authFile});
    if(artifact.owner_credentials_encrypted!==true)
      throw new Error('Owner companion was not created');
    const recovery=rehearse({
      backup:artifact.file,passphrase,auth:authFile,live:liveFile
    });
    if(recovery?.ok!==true||recovery.rooms!==7||
       recovery.owner_credential_recoverable!==true||
       recovery.admin_auth_copied!==true)
      throw new Error('Incomplete isolated recovery rehearsal');
    return {
      state:'prepared',independent_drive:true,encrypted:true,
      owner_credential_recoverable:true,isolated_restore_verified:true,
      detail:'A new encrypted hotel-ledger and owner-credential backup passed an isolated restore check on the configured separate drive. Finish staff work and close FortLedger safely before running a verified installer. Replacement-PC recovery and physical drive protection still require separate testing.'
    };
  }catch{
    // Preserve any partially written backup for review. Never modify/delete
    // the live ledger or silently claim that an uncertain file is ready.
    throw new UpgradeBackupRefusal(
      'The new external backup could not be created and completely verified. Do not upgrade; check the drive and owner backup configuration.');
  }
}
