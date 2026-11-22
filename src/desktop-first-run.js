import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {databasePath,authPath} from './data-paths.js';
import {openDatabase} from './database.js';
import {savePasswordRecord} from './auth.js';

/** Used only by the local Windows desktop launcher's first-run password dialog.
 * The password arrives over PRIVATE stdin, never as command-line arguments,
 * environment variables, URLs, installer logs or GitHub content. */
export function initializeDesktopOwner(password,{databaseFile=databasePath(),authFile=authPath(),
  dbOpen=openDatabase,writePassword=savePasswordRecord}={}){
  if(typeof password!=='string'||password.length<12||password.length>256||
     /[\u0000-\u001f\u007f]/.test(password))
    throw new Error('The owner password must be 12–256 characters without control characters');
  const dbExists=fs.existsSync(databaseFile),authExists=fs.existsSync(authFile);
  if(dbExists||authExists)
    throw new Error('Hotel records or owner credentials already exist. Refusing to reset or create a second ledger');
  // This helper is never called from an HTTP request; the GUI launcher runs
  // before opening port 3000 and the owner chooses the secret directly.
  fs.mkdirSync(path.dirname(databaseFile),{recursive:true,mode:0o700});
  const db=dbOpen(databaseFile);
  try{
    const rooms=db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE active=1').get().n;
    if(rooms!==7)throw new Error('Seven-room initialization verification failed');
  }finally{db.close();}
  writePassword(authFile,password); // flag wx; existing passwords are never overwritten
  return {created:true,rooms:7};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const password=fs.readFileSync(0,'utf8').replace(/\r?\n$/,'');
    initializeDesktopOwner(password);
    console.log('Owner credential and initial seven-room data created.');
  }catch(error){
    console.error('FIRST RUN BLOCKED:',error.message);
    process.exitCode=1;
  }
}
