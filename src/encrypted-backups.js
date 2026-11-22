import {createCipheriv,createDecipheriv,randomBytes,scryptSync} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateBackup} from './restore.js';
import {authPath} from './data-paths.js';

const MAGIC=Buffer.from('FLBK01');
const HEADER=6+16+12+16;
function assertPassphrase(passphrase) {
  if(typeof passphrase!=='string'||passphrase.length<16)
    throw new Error('Encrypted backups require a passphrase of 16 or more characters');
}
export function encryptBackupBytes(plaintext,passphrase) {
  assertPassphrase(passphrase);
  const salt=randomBytes(16),iv=randomBytes(12),key=scryptSync(passphrase,salt,32);
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  return Buffer.concat([MAGIC,salt,iv,cipher.getAuthTag(),ciphertext]);
}
export function decryptBackupBytes(encrypted,passphrase) {
  assertPassphrase(passphrase);
  if(!Buffer.isBuffer(encrypted)||encrypted.length<=HEADER||!encrypted.subarray(0,6).equals(MAGIC))
    throw new Error('Invalid encrypted backup format');
  const salt=encrypted.subarray(6,22),iv=encrypted.subarray(22,34),
    tag=encrypted.subarray(34,50),payload=encrypted.subarray(50);
  const key=scryptSync(passphrase,salt,32);
  const decipher=createDecipheriv('aes-256-gcm',key,iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload),decipher.final()]);
}
function validatedOwnerAuthBytes(file){
  const raw=fs.readFileSync(file);
  const record=JSON.parse(raw.toString('utf8'));
  if(record?.version!==1||typeof record.salt!=='string'||!/^[a-f0-9]{32}$/.test(record.salt)||
     typeof record.hash!=='string'||!/^[a-f0-9]{128}$/.test(record.hash))
    throw new Error('Original owner credential record is invalid');
  return raw;
}
export function credentialCompanionPath(encryptedFile){
  if(typeof encryptedFile!=='string'||!encryptedFile.endsWith('.flbk'))
    throw new Error('Expected encrypted SQLite backup file');
  return encryptedFile.slice(0,-5)+'.flba';
}
export function verifyEncryptedCredentialCompanion(encryptedFile,passphrase){
  const candidate=credentialCompanionPath(encryptedFile);
  if(!fs.existsSync(candidate))return {present:false,verified:false};
  const raw=decryptBackupBytes(fs.readFileSync(candidate),passphrase);
  const record=JSON.parse(raw.toString('utf8'));
  if(record?.version!==1||typeof record.salt!=='string'||!/^[a-f0-9]{32}$/.test(record.salt)||
     typeof record.hash!=='string'||!/^[a-f0-9]{128}$/.test(record.hash))
    throw new Error('Encrypted owner credential backup is invalid');
  return {present:true,verified:true};
}
export function decryptEncryptedCredentialCompanion(encryptedFile,targetAuth,passphrase){
  const companion=credentialCompanionPath(encryptedFile);
  if(!fs.existsSync(companion))return false; // Older .flbk snapshots remain supported.
  const target=path.resolve(targetAuth);
  if(fs.existsSync(target))throw new Error('Owner credentials already exist; refusing overwrite');
  const raw=decryptBackupBytes(fs.readFileSync(companion),passphrase);
  const record=JSON.parse(raw.toString('utf8'));
  if(record?.version!==1||typeof record.salt!=='string'||!/^[a-f0-9]{32}$/.test(record.salt)||
     typeof record.hash!=='string'||!/^[a-f0-9]{128}$/.test(record.hash))
    throw new Error('Encrypted owner credential backup is invalid');
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
  fs.writeFileSync(target,raw,{flag:'wx',mode:0o600});
  return true;
}

export async function createEncryptedBackup(db,directory,passphrase,{retain=30,now=new Date(),authFile=null}={}){
  assertPassphrase(passphrase);
  if(!directory||!path.isAbsolute(directory))throw new Error('Backup directory must be an absolute path');
  if(!Number.isInteger(retain)||retain<2||retain>365)throw new Error('Retention must be 2 to 365 backups');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-backup-'));
  const sqlite=path.join(work,'snapshot.sqlite');
  try{
    await db.backup(sqlite);
    validateBackup(sqlite);
    const encrypted=encryptBackupBytes(fs.readFileSync(sqlite),passphrase);
    const prefix=now.toISOString().replace(/[:.]/g,'-');
    const filename='fortledger-'+prefix+'-'+randomBytes(4).toString('hex')+'.flbk';
    const target=path.join(directory,filename),temp=target+'.tmp';
    // A new .flba companion is independently AES-GCM encrypted with its own
    // fresh salt/nonce. It protects the separate owner hash (not just staff
    // password hashes in SQLite), without ever exposing it in logs or Git.
    const companion=credentialCompanionPath(target),authTemp=companion+'.tmp';
    let installedCompanion=false;
    try{
      if(authFile){
        const sealedAuth=encryptBackupBytes(validatedOwnerAuthBytes(authFile),passphrase);
        fs.writeFileSync(authTemp,sealedAuth,{flag:'wx',mode:0o600});
        fs.renameSync(authTemp,companion);
        installedCompanion=true;
      }
      fs.writeFileSync(temp,encrypted,{flag:'wx',mode:0o600});
      fs.renameSync(temp,target); // Marker of a complete database backup.
    }catch(error){
      if(installedCompanion&&!fs.existsSync(target))
        fs.rmSync(companion,{force:true});
      throw error;
    }finally{
      if(fs.existsSync(temp))fs.rmSync(temp,{force:true});
      if(fs.existsSync(authTemp))fs.rmSync(authTemp,{force:true});
    }
    const backups=fs.readdirSync(directory).filter(f=>/^fortledger-.*\.flbk$/.test(f)).sort().reverse();
    for(const old of backups.slice(retain)){
      fs.rmSync(path.join(directory,old),{force:true});
      fs.rmSync(credentialCompanionPath(path.join(directory,old)),{force:true});
    }
    return {file:target,bytes:encrypted.length,retained:Math.min(backups.length,retain),
      owner_credentials_encrypted:installedCompanion};
  }finally{fs.rmSync(work,{recursive:true,force:true});}
}
export function decryptBackupFile(encryptedFile,outputSqlite,passphrase){
  const output=path.resolve(outputSqlite);
  if(fs.existsSync(output))throw new Error('Restore candidate exists; refusing to overwrite');
  const plaintext=decryptBackupBytes(fs.readFileSync(encryptedFile),passphrase);
  fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});
  try{
    fs.writeFileSync(output,plaintext,{flag:'wx',mode:0o600});
    return validateBackup(output);
  }catch(error){fs.rmSync(output,{force:true});throw error;}
}
/** Verify an encrypted backup can be authenticated and restored to a valid SQLite
 * file, without touching the live database or exposing the decrypted candidate. */
export function verifyEncryptedBackupFile(encryptedFile,passphrase){
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-verify-'));
  try{
    fs.chmodSync(scratch,0o700);
    return decryptBackupFile(encryptedFile,path.join(scratch,'verified.sqlite'),passphrase);
  }finally{
    fs.rmSync(scratch,{recursive:true,force:true});
  }
}
export function scheduleEncryptedBackups(db,env=process.env,{intervalMs=24*60*60*1000,logger=console}={}){
  const directory=env.FORTLEDGER_BACKUP_DIR;
  const passphrase=env.FORTLEDGER_BACKUP_PASSPHRASE;
  if(!directory||!passphrase){
    logger.warn('Encrypted automatic backups not configured. Set FORTLEDGER_BACKUP_DIR and FORTLEDGER_BACKUP_PASSPHRASE.');
    return null;
  }
  assertPassphrase(passphrase);
  let pending=null;
  function run(){
    // Only one SQLite snapshot at a time; shutdown can await its completion.
    if(pending)return pending;
    pending=(async()=>{
      try{
        const owner=authPath(env);
        const result=await createEncryptedBackup(db,directory,passphrase,
          {authFile:fs.existsSync(owner)?owner:null});
        if(!result.owner_credentials_encrypted)
          logger.warn?.('Encrypted database backup completed without owner credentials. Protect the original admin-auth.json separately.');

        logger.info('Encrypted SQLite backup created:',path.basename(result.file));
      }catch(error){logger.error('Encrypted backup failed:',error.message);}
    })().finally(()=>{pending=null;});
    return pending;
  }
  // Protect against loss of today's data: create a snapshot at application startup,
  // then once every 24 hours while the application remains running.
  void run();
  const handle=setInterval(()=>{void run();},intervalMs);
  handle.unref();
  return {stop:()=>clearInterval(handle),run,idle:()=>pending??Promise.resolve()};
}
