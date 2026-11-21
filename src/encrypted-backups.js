import {createCipheriv,createDecipheriv,randomBytes,scryptSync} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateBackup} from './restore.js';

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
export async function createEncryptedBackup(db,directory,passphrase,{retain=30,now=new Date()}={}){
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
    try{
      fs.writeFileSync(temp,encrypted,{flag:'wx',mode:0o600});
      fs.renameSync(temp,target);
    }finally{if(fs.existsSync(temp))fs.rmSync(temp,{force:true});}
    const backups=fs.readdirSync(directory).filter(f=>/^fortledger-.*\.flbk$/.test(f)).sort().reverse();
    for(const old of backups.slice(retain))fs.rmSync(path.join(directory,old),{force:true});
    return {file:target,bytes:encrypted.length,retained:Math.min(backups.length,retain)};
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
  let running=false;
  async function run(){
    if(running)return;
    running=true;
    try{
      const result=await createEncryptedBackup(db,directory,passphrase);
      logger.info('Encrypted SQLite backup created:',path.basename(result.file));
    }catch(error){logger.error('Encrypted backup failed:',error.message);}
    finally{running=false;}
  }
  // Protect against loss of today's data: create a snapshot at application startup,
  // then once every 24 hours while the application remains running.
  void run();
  const handle=setInterval(()=>{void run();},intervalMs);
  handle.unref();
  return {stop:()=>clearInterval(handle),run};
}
