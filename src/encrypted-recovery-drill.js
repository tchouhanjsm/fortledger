import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {authPath,databasePath} from './data-paths.js';
import {decryptBackupFile,decryptEncryptedCredentialCompanion} from './encrypted-backups.js';
import {restoreDatabase,validateBackup} from './restore.js';

function snapshotFingerprint(file){
  const db=new Database(file,{readonly:true,fileMustExist:true});
  try{
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all().map(x=>x.name);
    const hash=createHash('sha256');
    for(const table of tables){
      const name='"'+table.replaceAll('"','""')+'"';
      hash.update('TABLE:'+table+'\n');
      for(const row of db.prepare('SELECT * FROM '+name+' ORDER BY rowid').iterate()){
        const safe=Object.fromEntries(Object.entries(row).map(([k,v])=>[
          k,Buffer.isBuffer(v)?{blob:v.toString('base64')}:v
        ]));
        hash.update(JSON.stringify(safe)+'\n');
      }
    }
    return {tables:tables.length,hash:hash.digest('hex')};
  }finally{db.close();}
}

/** Rehearsal of the actual encrypted backup artifact, not a new local snapshot.
 * Both decrypted candidate and restored target are isolated in a private scratch
 * folder and destroyed after verification. The live DB is never opened for write. */
export function rehearseEncryptedRecovery({backup,passphrase,
  auth=authPath(),requireAuth=true,live=databasePath()}={}){
  if(!backup||!path.isAbsolute(backup))throw new Error('Provide an absolute encrypted backup file path');
  if(!fs.existsSync(backup))throw new Error('Encrypted backup file not found');
  if(typeof passphrase!=='string'||passphrase.length<16)
    throw new Error('Encrypted backup passphrase is missing or invalid');
  if(requireAuth&&!fs.existsSync(auth))throw new Error('Administrator authentication file missing; recovery incomplete');
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-external-rehearsal-'));
  try{
    fs.chmodSync(scratch,0o700);
    const candidate=path.join(scratch,'candidate.sqlite');
    const target=path.join(scratch,'restored.sqlite');
    if(path.resolve(live)===candidate||path.resolve(live)===target)
      throw new Error('Recovery scratch location must not be the live database');
    const original=decryptBackupFile(backup,candidate,passphrase);
    const before=snapshotFingerprint(candidate);
    const restored=restoreDatabase(candidate,target,{confirm:true});
    const after=snapshotFingerprint(target);
    const inspected=validateBackup(target);
    // New snapshots carry an independently encrypted owner-password hash.
    // Old .flbk files remain readable but are explicitly incomplete for
    // replacement-device owner credential recovery.
    const protectedOwner=decryptEncryptedCredentialCompanion(
      backup,path.join(scratch,'owner-credentials-from-artifact.json'),passphrase);
    if(before.hash!==after.hash||before.tables!==after.tables||
      original.rooms!==restored.rooms||original.bookings!==inspected.bookings)
      throw new Error('Recovered SQLite content differs from authenticated backup');
    let authVerified=false;
    if(fs.existsSync(auth)){
      const copy=path.join(scratch,'admin-auth.json');
      fs.copyFileSync(auth,copy,fs.constants.COPYFILE_EXCL);
      const digest=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      if(digest(copy)!==digest(auth))throw new Error('Administrator credential copy differs');
      authVerified=true;
    }
    return {ok:true,rooms:inspected.rooms,bookings:inspected.bookings,
      schema_tables:before.tables,admin_auth_copied:authVerified,
      owner_credential_recoverable:protectedOwner,
      disclaimer:'Isolated encrypted-artifact rehearsal only; no physical replacement device, external-drive independence or Windows restore certified'};
  }finally{fs.rmSync(scratch,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const backup=process.argv[2];
  try{
    const result=rehearseEncryptedRecovery({
      backup,passphrase:process.env.FORTLEDGER_BACKUP_PASSPHRASE
    });
    console.log('PASS: authenticated encrypted backup restored into isolated disposable database.');
    console.log('Rooms:',result.rooms,'Bookings:',result.bookings,'Schema tables:',result.schema_tables);
    console.log('Administrator credentials verified:',result.admin_auth_copied?'yes':'no');
    console.log('Original owner credential separately encrypted in this backup:',
      result.owner_credential_recoverable?'yes':'NO — retain independent owner-auth copy');
    console.log('Not a physical replacement-device certification.');
  }catch(error){console.error('FAIL: encrypted recovery rehearsal:',error.message);process.exitCode=1;}
}
