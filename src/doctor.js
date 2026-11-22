import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEFAULT_AUTH_FILE,loadPasswordRecord} from './auth.js';
import {databasePath} from './data-paths.js';
import {validatePrinterAddress} from './printer.js';
import {verifyEncryptedBackupFile} from './encrypted-backups.js';

export function diagnose({
  databaseFile=databasePath(),
  authFile=DEFAULT_AUTH_FILE,
  env=process.env,now=new Date()
}={}){
  const checks=[];
  const add=(name,status,detail)=>checks.push({name,status,detail});
  try{
    const auth=loadPasswordRecord(authFile);
    add('Local administrator',''+(auth?'pass':'fail'),auth?'Password hash configured':'Run npm run setup-auth');
  }catch{add('Local administrator','fail','Password configuration invalid or unreadable');}
  if(!fs.existsSync(databaseFile)){
    add('SQLite database','fail','Database not initialized; run the application once');
  }else{
    let db;
    try{
      db=new Database(databaseFile,{readonly:true,fileMustExist:true});
      const integrity=db.pragma('integrity_check',{simple:true});
      add('SQLite integrity',integrity==='ok'?'pass':'fail',integrity==='ok'?'Integrity check passed':'Integrity check failed');
      const schemaVersion=db.pragma('user_version',{simple:true});
      add('Schema migration version',schemaVersion===9?'pass':'warn',
        schemaVersion===9?'Schema v9 confirmed':'Database is legacy or from a newer release; review app compatibility');
      const fk=db.pragma('foreign_key_check');
      add('Foreign-key integrity',fk.length?'fail':'pass',fk.length?'Database contains foreign-key violations':'Foreign keys consistent');
      const tableNames=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
      const required=['rooms','bookings','payments','payment_refunds','invoices','tax_invoice_drafts',
        'restaurant_bills','restaurant_bill_requests','booking_create_requests',
        'restaurant_settlements','restaurant_print_jobs','hotel_brand_assets'];
      const missing=required.filter(name=>!tableNames.has(name));
      add('Application schema',missing.length?'fail':'pass',missing.length?'Missing tables: '+missing.join(', '):'Expected tables present');
      if(tableNames.has('rooms')){
        const count=db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE active=1').get().n;
        add('Room inventory',count===7?'pass':'warn',count+' active physical rooms; expected 7');
      }
      if(tableNames.has('restaurant_bills')){
        const missing=db.prepare("SELECT COUNT(*) AS n FROM restaurant_bills WHERE payment_method='room' AND booking_id IS NULL").get().n;
        add('Manual room charges',missing?'warn':'pass',missing?missing+' unmatched room charges require review':'No unmatched room charges');
      }
      if(tableNames.has('restaurant_print_jobs')){
        const uncertain=db.prepare("SELECT COUNT(*) AS n FROM restaurant_print_jobs WHERE state='uncertain' OR state='sending'").get().n;
        add('Receipt print queue',uncertain?'warn':'pass',uncertain?uncertain+' print attempts need physical review':'No uncertain print jobs');
      }
    }catch{add('SQLite diagnostics','fail','Cannot inspect database safely');}
    finally{db?.close();}
  }
  const dir=env.FORTLEDGER_BACKUP_DIR,secret=env.FORTLEDGER_BACKUP_PASSPHRASE;
  if(!dir||!secret)add('Encrypted backups','warn','Set backup folder and separate passphrase');
  else if(!path.isAbsolute(dir)||secret.length<16)add('Encrypted backups','fail','Backup path must be absolute and passphrase at least 16 characters');
  else if(!fs.existsSync(dir))add('Encrypted backups','warn','Backup folder does not exist yet');
  else{
    try{
      const resolvedDir=fs.realpathSync(dir);
      const dataDir=path.resolve(path.dirname(databaseFile));
      const sameDataFolder=resolvedDir===dataDir||resolvedDir.startsWith(dataDir+path.sep);
      const filenames=fs.readdirSync(resolvedDir)
        .filter(f=>/^fortledger-.*\.flbk$/.test(f))
        .map(f=>({file:path.join(resolvedDir,f),mtime:fs.statSync(path.join(resolvedDir,f)).mtimeMs}))
        .sort((a,b)=>b.mtime-a.mtime);
      const latest=filenames[0];
      const ageHours=latest?(now.getTime()-latest.mtime)/3600000:Infinity;
      if(!latest){
        add('Encrypted backups','warn','No encrypted backup found; check scheduler');
      }else{
        try{
          const summary=verifyEncryptedBackupFile(latest.file,secret);
          if(summary.rooms!==7)throw new Error('Invalid room inventory');
          add('Encrypted backup integrity','pass','Latest encrypted snapshot authenticated and SQLite validated');
          add('Encrypted backups',ageHours>=0&&ageHours<=36?'pass':'warn',
            ageHours>=0&&ageHours<=36?'Latest verified snapshot within 36 hours':
              'Latest verified backup is stale; check scheduler');
        }catch{
          add('Encrypted backup integrity','fail','Latest encrypted snapshot could not be authenticated or validated; restore readiness unknown');
          add('Encrypted backups','warn','Do not rely on this backup until a verified replacement exists');
        }
      }
      add('Backup storage separation','warn',sameDataFolder?
        'Backup is inside the live database folder; move backups to independently protected storage':
        'Path is separate from live data; a physically separate drive has not been verified');
    }catch{
      add('Encrypted backups','fail','Unable to safely inspect configured backup folder');
    }
  }
  if(!env.FORTLEDGER_PRINTER_HOST)add('Epson printer','warn','No LAN printer configured; browser print remains available');
  else{
    try{
      validatePrinterAddress(env.FORTLEDGER_PRINTER_HOST,Number(env.FORTLEDGER_PRINTER_PORT||9100));
      add('Epson printer','warn','Private-LAN configuration valid; physical printing still unverified');
    }catch{add('Epson printer','fail','Invalid private-LAN printer settings');}
  }
  add('Statutory GST tax invoices','warn','Only review drafts enabled; Rule 46, signature and e-invoicing checks outstanding');
  const passed=checks.filter(x=>x.status==='pass').length;
  const failed=checks.filter(x=>x.status==='fail').length;
  return {checks,summary:{passed,failed,warnings:checks.length-passed-failed},healthy:failed===0,production_ready:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=diagnose();
  for(const check of result.checks)console.log('['+check.status.toUpperCase()+'] '+check.name+': '+check.detail);
  console.log('Summary:',result.summary.passed,'passed,',result.summary.warnings,'warnings,',result.summary.failed,'failed.');
  console.log('PRE-PRODUCTION: statutory, hardware and deployment checks remain required.');
  if(!result.healthy)process.exitCode=1;
}
