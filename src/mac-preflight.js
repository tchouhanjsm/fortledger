import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dataDirectory,databasePath,authPath} from './data-paths.js';
import {localListenerSettings} from './network-policy.js';
import {diagnose} from './doctor.js';

/** Read-only preflight. Do not copy a running WAL database, print secrets,
 * create directories, or change the environment used by FortLedger. */
export function macPreflight({env=process.env,platform=process.platform,nodeVersion=process.versions.node}={}){
  const checks=[];
  const check=(name,status,detail)=>checks.push({name,status,detail});
  if(platform!=='darwin')check('Operating system','warn','This procedure targets macOS; no operating-system change is made');
  else check('Operating system','pass','macOS detected');
  const major=Number(String(nodeVersion).split('.')[0]);
  check('Node.js version',major>=22?'pass':'fail',major>=22?'Node.js 22 or newer':'Install Node.js 22 or newer');
  const dataDir=dataDirectory(env),dbFile=databasePath(env),authFile=authPath(env);
  check('Data configuration','pass',env.FORTLEDGER_DATA_DIR?
    'Explicit FORTLEDGER_DATA_DIR will be preserved':'Using the default data directory relative to the current working directory');
  const dbExists=fs.existsSync(dbFile),authExists=fs.existsSync(authFile);
  check('Database file',dbExists?'pass':'warn',dbExists?
    'Existing database found; do not copy or replace its live WAL files':
    'No database found at the effective path; confirm your original data configuration before starting');
  check('Administrator file',authExists?'pass':'warn',authExists?
    'Existing authentication file found':'No administrator credential file at the effective path; do not reset an existing installation');
  try{
    const listener=localListenerSettings(env);
    check('Local listener','pass','Loopback only, configured port '+listener.port);
  }catch(error){check('Local listener','fail',error.message);}
  const backupDir=env.FORTLEDGER_BACKUP_DIR;
  if(backupDir){
    const dataResolved=path.resolve(dataDir),backupResolved=path.resolve(backupDir);
    if(backupResolved===dataResolved||backupResolved.startsWith(dataResolved+path.sep))
      check('Backup location','warn','Encrypted backup directory is inside live data; keep an independently protected copy elsewhere');
    else check('Backup location','pass','Backup folder differs from live data; physical separation still needs confirmation');
  }else check('Backup location','warn','No encrypted backup directory configured');
  // Doctor is only invoked for an existing database; it opens SQLite read-only.
  const doctor=dbExists?diagnose({databaseFile:dbFile,authFile,env}):null;
  if(doctor){
    const bad=doctor.checks.filter(item=>item.status==='fail');
    check('Database diagnostics',bad.length?'fail':'pass',bad.length?
      'Run npm run doctor for the failing local checks':'Read-only database integrity and configuration checks completed');
  }
  return {checks,healthy:checks.every(item=>item.status!=='fail'),
    production_ready:false,active_database:dbFile,active_auth_file:authFile,
    notes:[
      'This command does not update, repair, restore, or back up the live hotel database.',
      'Stop hotel operations and confirm an independently verified encrypted backup before updating code.',
      'Live physical Mac, phone, printer and accountant release acceptance is still required.'
    ]};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=macPreflight();
  for(const entry of result.checks)
    console.log('['+entry.status.toUpperCase()+'] '+entry.name+': '+entry.detail);
  console.log('Database:',result.active_database);
  console.log('Authentication file:',result.active_auth_file);
  for(const note of result.notes)console.log('NOTE:',note);
  console.log('PRE-PRODUCTION / NOT RELEASED');
  if(!result.healthy)process.exitCode=1;
}
