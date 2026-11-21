import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {databasePath,authPath} from './data-paths.js';
import {restoreDatabase,validateBackup} from './restore.js';

function digest(db){
  const tables=db.prepare(`SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map(x=>x.name);
  const hash=createHash('sha256');
  for(const table of tables){
    // Names come exclusively from the SQLite schema, never from user input.
    const quoted='"'+table.replaceAll('"','""')+'"';
    hash.update('TABLE:'+table+'\n');
    for(const row of db.prepare('SELECT * FROM '+quoted+' ORDER BY rowid').iterate()){
      const normalized=Object.fromEntries(Object.entries(row).map(([key,value])=>[
        key,Buffer.isBuffer(value)?{blob:value.toString('base64')}:value
      ]));
      hash.update(JSON.stringify(normalized)+'\n');
    }
  }
  return {tables:tables.length,hash:hash.digest('hex')};
}
/** Isolated rehearsal: consistent SQLite snapshot -> restore into scratch dir -> verify every table/row. */
export async function runRecoveryDrill({source=databasePath(),auth=authPath(),requireAuth=true}={}){
  source=path.resolve(source);auth=path.resolve(auth);
  if(!fs.existsSync(source))throw new Error('Live database not found; no recovery rehearsal performed');
  if(requireAuth&&!fs.existsSync(auth))throw new Error('Admin authentication file missing from configured data location');
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-recovery-drill-'));
  let live=null,verified=null,restored=null;
  try{
    fs.chmodSync(scratch,0o700);
    const snapshot=path.join(scratch,'consistent.sqlite');
    const restoredFile=path.join(scratch,'restored.sqlite');
    live=new Database(source,{readonly:true,fileMustExist:true});
    await live.backup(snapshot);
    live.close();live=null;
    const summary=validateBackup(snapshot);
    verified=new Database(snapshot,{readonly:true,fileMustExist:true});
    const before=digest(verified);
    verified.close();verified=null;
    restoreDatabase(snapshot,restoredFile,{confirm:true});
    restored=new Database(restoredFile,{readonly:true,fileMustExist:true});
    const after=digest(restored);
    restored.close();restored=null;
    if(before.tables!==after.tables||before.hash!==after.hash)
      throw new Error('Restored records differ from consistent backup snapshot');
    let authVerified=false;
    if(fs.existsSync(auth)){
      const copied=path.join(scratch,'admin-auth.json');
      fs.copyFileSync(auth,copied,fs.constants.COPYFILE_EXCL);
      const original=createHash('sha256').update(fs.readFileSync(auth)).digest('hex');
      const recovered=createHash('sha256').update(fs.readFileSync(copied)).digest('hex');
      if(original!==recovered)throw new Error('Administrator credential backup verification failed');
      authVerified=true;
    }
    return {ok:true,schema_tables:before.tables,rooms:summary.rooms,
      bookings:summary.bookings,admin_auth_copied:authVerified,
      disclaimer:'Automated isolated local rehearsal only; no actual off-device recovery or Windows installation verified'};
  }finally{
    live?.close();verified?.close();restored?.close();
    fs.rmSync(scratch,{recursive:true,force:true});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const r=await runRecoveryDrill();
    console.log('PASS: isolated recovery rehearsal; '+r.rooms+' rooms, '+r.bookings+' bookings, '+r.schema_tables+' tables verified.');
    console.log('Admin credential copy verified:',r.admin_auth_copied?'yes':'no');
    console.log('NOT a physical off-device disaster-recovery verification.');
  }catch(error){console.error('FAIL: recovery rehearsal:',error.message);process.exitCode=1;}
}
