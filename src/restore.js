import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const REQUIRED_TABLES=['rooms','bookings','payments'];

export function validateBackup(filename) {
  if (!fs.existsSync(filename)) throw new Error('Backup file not found');
  const db=new Database(filename,{readonly:true,fileMustExist:true});
  try {
    const integrity=db.pragma('integrity_check',{simple:true});
    if (integrity!=='ok') throw new Error('Backup integrity check failed: '+integrity);
    const version=db.pragma('user_version',{simple:true});
    if(version>11)throw new Error('Backup database version '+version+' is newer than this application');
    const foreignKeys=db.pragma('foreign_key_check');
    if(foreignKeys.length)throw new Error('Backup foreign-key consistency check failed');
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
    for(const name of REQUIRED_TABLES)if(!tables.has(name))throw new Error('Backup missing required table: '+name);
    const count=db.prepare('SELECT count(*) AS n FROM rooms').get().n;
    if(count!==7)throw new Error('Backup must contain the seven-room inventory (found '+count+')');
    return {rooms:count,bookings:db.prepare('SELECT count(*) AS n FROM bookings').get().n};
  }finally{db.close();}
}

/**
 * Offline restore: requires the app to be stopped, a backup file, and explicit confirmation.
 * Makes a durable copy of the current DB before replacement, then swaps the validated candidate.
 */
export function restoreDatabase(backupFile,targetFile,{confirm=false}={}) {
  if(!confirm) throw new Error('Restore requires explicit --confirm flag');
  const backup=path.resolve(backupFile),target=path.resolve(targetFile);
  if(backup===target)throw new Error('Cannot restore a database onto itself');
  if(fs.existsSync(target+'-wal')||fs.existsSync(target+'-shm'))
    throw new Error('Database may still be open. Stop FortLedger and ensure SQLite WAL files are cleared before restore.');
  const details=validateBackup(backup);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const candidate=target+'.incoming-'+process.pid;
  if(fs.existsSync(candidate))throw new Error('Temporary restore file exists. Inspect it before retrying.');
  fs.copyFileSync(backup,candidate,fs.constants.COPYFILE_EXCL);
  let previous=null;
  try{
    validateBackup(candidate);
    if(fs.existsSync(target)){
      // Do not overwrite any pre-restore safety copy.
      previous=target+'.before-restore-'+Date.now()+'-'+process.pid;
      fs.copyFileSync(target,previous,fs.constants.COPYFILE_EXCL);
    }
    fs.renameSync(candidate,target);
    return {...details,previous};
  }finally{
    if(fs.existsSync(candidate))fs.unlinkSync(candidate);
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [, ,backupArg,targetArg,confirmation]=process.argv;
  if(!backupArg||!targetArg||confirmation!=='--confirm'){
    console.error('Usage: npm run restore -- <backup.sqlite> <target.sqlite> --confirm');
    process.exitCode=1;
  }else{
    try{
      const details=restoreDatabase(backupArg,targetArg,{confirm:true});
      console.log('Restored',details.rooms,'rooms and',details.bookings,'bookings.');
      console.log('Previous database safety copy:',details.previous??'(no previous database)');
    }catch(e){console.error('Restore failed:',e.message);process.exitCode=1;}
  }
}
