import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {databasePath,authPath} from './data-paths.js';
import {validateBackup} from './restore.js';

/** Save a consistent SQLite snapshot WITHOUT opening/migrating the live application. */
export async function backupBeforeUpdate(destinationDir,{source=databasePath(),auth=authPath()}={}){
  source=path.resolve(source);
  destinationDir=path.resolve(destinationDir);
  if(!fs.existsSync(source))throw new Error('FortLedger database not found. Never update an uninitialized installation blindly.');
  if(destinationDir===path.dirname(source))throw new Error('Pre-update backups must be outside the active data folder');
  fs.mkdirSync(destinationDir,{recursive:true,mode:0o700});
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const folder=path.join(destinationDir,'update-'+stamp+'-'+process.pid);
  fs.mkdirSync(folder,{mode:0o700});
  let db;
  try{
    db=new Database(source,{readonly:true,fileMustExist:true});
    const target=path.join(folder,'fortledger.sqlite');
    await db.backup(target);
    db.close();db=null;
    const detail=validateBackup(target);
    if(fs.existsSync(auth))fs.copyFileSync(auth,path.join(folder,'admin-auth.json'),fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(folder,'RECOVERY.txt'),
      'FortLedger pre-update backup. Keep this directory private.\\n'+
      'Stop the app before restoring. Verify backup using npm run restore -- <backup.sqlite> <target.sqlite> --confirm.\\n');
    return {folder,detail};
  }catch(error){
    db?.close();
    fs.rmSync(folder,{recursive:true,force:true});
    throw error;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){
  const [, ,destination]=process.argv;
  if(!destination){console.error('Usage: node src/backup-before-update.js <absolute backup folder>');process.exitCode=1;}
  else{
    try{
      const result=await backupBeforeUpdate(destination);
      console.log('VERIFIED BACKUP:',result.folder);
      console.log('Rooms:',result.detail.rooms,'Bookings:',result.detail.bookings);
    }catch(error){console.error('BACKUP FAILED:',error.message);process.exitCode=1;}
  }
}
