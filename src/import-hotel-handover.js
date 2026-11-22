import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateBackup} from './restore.js';
import {loadPasswordRecord} from './auth.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const NAME='fortledger.sqlite',AUTH='admin-auth.json',MARKER='RECOVERY.txt';

function within(parent,target){
  const relative=path.relative(parent,target);
  return relative===''||(!relative.startsWith('..'+path.sep)&&
    relative!=='..'&&!path.isAbsolute(relative));
}
function hash(file){
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Preview an independently created, consistent SQLite+auth backup. No files
 * are changed by inspection. A RECOVERY.txt marker is a *format check*, not
 * cryptographic proof; use separately encrypted physical transfer media. */
export function inspectHotelHandover({sourceDirectory,targetDirectory}={}){
  if(typeof sourceDirectory!=='string'||!path.isAbsolute(sourceDirectory)||
     typeof targetDirectory!=='string'||!path.isAbsolute(targetDirectory))
    throw new Error('An absolute backup folder and Windows destination folder are required');
  const source=fs.realpathSync(sourceDirectory),destination=path.resolve(targetDirectory);
  if(!fs.statSync(source).isDirectory())throw new Error('Backup source must be a folder');
  if(within(ROOT,source)||within(ROOT,destination))
    throw new Error('Backup and persistent hotel data must remain outside the Git application folder');
  if(within(source,destination)||within(destination,source))
    throw new Error('Source backup and hotel data destination must be separate');
  if(fs.existsSync(destination))
    throw new Error('Windows hotel data destination already exists. Never import over an existing ledger or password file; inspect the current installation first.');
  const sourceDb=path.join(source,NAME),sourceAuth=path.join(source,AUTH);
  const marker=path.join(source,MARKER);
  for(const file of [sourceDb,sourceAuth,marker]){
    if(!fs.existsSync(file)||!fs.statSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())
      throw new Error('A consistent FortLedger backup must include the SQLite snapshot, original admin-auth.json and RECOVERY.txt');
  }
  if(fs.existsSync(sourceDb+'-wal')||fs.existsSync(sourceDb+'-shm'))
    throw new Error('Backup source includes live SQLite WAL files; export a consistent snapshot instead of copying a live database');
  const label=fs.readFileSync(marker,'utf8').slice(0,2048);
  if(!label.includes('FortLedger pre-update backup'))
    throw new Error('Unrecognized backup format: use the verified FortLedger pre-update snapshot utility');
  const summary=validateBackup(sourceDb);
  if(!loadPasswordRecord(sourceAuth))
    throw new Error('Original hotel administrator credential file is missing or invalid');
  return {ready:true,rooms:summary.rooms,bookings:summary.bookings,
    original_auth_present:true,
    note:'Source snapshot and credentials validated separately; their historical association and physical transport require operator verification'};
}

/** Stage and revalidate BOTH files before a single folder rename. Refuse every
 * existing target, never overwrite a running/partial hotel or alter source. */
export function importHotelHandover({sourceDirectory,targetDirectory,confirm=false}={}){
  if(confirm!==true)throw new Error('Import requires explicit --confirm after an operator preview');
  const plan=inspectHotelHandover({sourceDirectory,targetDirectory});
  const source=fs.realpathSync(sourceDirectory),destination=path.resolve(targetDirectory);
  const parent=path.dirname(destination),base=path.basename(destination);
  fs.mkdirSync(parent,{recursive:true,mode:0o700});
  const pending=fs.readdirSync(parent).filter(x=>x.startsWith(base+'.handover-'));
  if(pending.length)throw new Error('An earlier handover staging folder exists; inspect it before attempting another import');
  const stage=path.join(parent,base+'.handover-'+randomBytes(8).toString('hex'));
  fs.mkdirSync(stage,{mode:0o700});
  let imported=false;
  try{
    for(const name of [NAME,AUTH]){
      const from=path.join(source,name),to=path.join(stage,name);
      const before=hash(from);
      fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);
      if(hash(to)!==before||hash(from)!==before)
        throw new Error('Source backup changed or the staged file did not match; no hotel files installed');
    }
    const verified=validateBackup(path.join(stage,NAME));
    if(!loadPasswordRecord(path.join(stage,AUTH))||
       verified.rooms!==plan.rooms||verified.bookings!==plan.bookings)
      throw new Error('Staged hotel backup differs from preview; import cancelled');
    if(fs.existsSync(destination))throw new Error('Hotel data destination appeared during import; refusing to overwrite');
    fs.renameSync(stage,destination);
    imported=true;
    return {...plan,imported:true};
  }finally{
    if(!imported&&fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [sourceDirectory,targetDirectory,mode]=process.argv.slice(2);
  if(!sourceDirectory||!targetDirectory||!['--preview','--confirm'].includes(mode)){
    console.error('Usage: node src/import-hotel-handover.js <absolute verified snapshot folder> <absolute Windows data folder> --preview|--confirm');
    process.exitCode=1;
  }else{
    try{
      const args={sourceDirectory,targetDirectory};
      const result=mode==='--preview'?inspectHotelHandover(args):
        importHotelHandover({...args,confirm:true});
      console.log(mode==='--preview'?'VERIFIED PREVIEW:':'IMPORTED VERIFIED HOTEL SNAPSHOT:');
      console.log('Physical rooms:',result.rooms,'Bookings:',result.bookings);
      console.log('Original administrator credential file:',result.original_auth_present?'present':'MISSING');
      console.log('No money, invoice, room assignment or guest data was regenerated.');
      console.log('Verify existing records after a backed-up first startup; physical acceptance still required.');
    }catch(error){console.error('HANDOVER REFUSED:',error.message);process.exitCode=1;}
  }
}
