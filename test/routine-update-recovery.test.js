import test from 'node:test';
import assert from 'node:assert/strict';
import {routineRecoveryPolicy,verifyRoutineUpdateBackup,
  prepareRoutineUpdateCheckpoint} from '../src/routine-update-recovery.js';

const profile='C:\\Users\\Synthetic\\AppData\\Local';
const local={LOCALAPPDATA:profile,
 FORTLEDGER_DATA_DIR:profile+'\\FortLedger\\data',
 FORTLEDGER_BACKUP_DIR:profile+'\\FortLedger\\local-backups',
 FORTLEDGER_BACKUP_PASSPHRASE:'synthetic-local-secret-for-unit-tests',
 FORTLEDGER_BACKUP_LOCAL_ONLY:'1'};
const valid=()=>({restorable:true,owner_auth_present:true,
 owner_credential_recoverable:true,independent_drive:false});
const freshness=()=>({state:'recent'});
test('sealed local checkpoint is useful for a routine code patch, not independent recovery',()=>{
 const policy=routineRecoveryPolicy({env:local,platform:'win32'});
 assert.equal(policy.scope,'local_checkpoint');
 assert.equal(policy.independent_disaster_recovery,false);
 assert.equal(verifyRoutineUpdateBackup({env:local,platform:'win32',
   health:valid,freshness}).scope,'local_checkpoint');
 assert.throws(()=>routineRecoveryPolicy({env:{...local,FORTLEDGER_BACKUP_DIR:
   profile+'\\FortLedger\\data\\backups'},platform:'win32'}),/sealed Windows profile folder/);
 assert.throws(()=>routineRecoveryPolicy({env:{...local,FORTLEDGER_BACKUP_PASSPHRASE:'short'},
   platform:'win32'}),/configured encrypted backup/);
 assert.throws(()=>verifyRoutineUpdateBackup({env:local,platform:'win32',
   health:()=>({...valid(),owner_credential_recoverable:false}),freshness}),/isolated recovery/);
 assert.throws(()=>verifyRoutineUpdateBackup({env:local,platform:'win32',
   health:valid,freshness:()=>({state:'stale'})}),/not recent/);
});
test('independent backups retain volume separation and original owner recovery',()=>{
 const independent={...local,FORTLEDGER_BACKUP_LOCAL_ONLY:'0',
   FORTLEDGER_BACKUP_DIR:'D:\\HotelBackups'};
 assert.equal(routineRecoveryPolicy({env:independent,platform:'win32'}).scope,'independent');
 assert.throws(()=>verifyRoutineUpdateBackup({env:independent,platform:'win32',
   health:valid,freshness}),/isolated recovery/);
 assert.throws(()=>routineRecoveryPolicy({env:{...independent,
   FORTLEDGER_BACKUP_DIR:'C:\\Backup'},platform:'win32'}),/another protected volume/);
});
test('automatic final-ledger checkpoint includes original owner credentials and verifies recovery',async()=>{
 let called=0,seenAuth=null;
 const result=await prepareRoutineUpdateCheckpoint({synthetic:true},{
   env:local,platform:'win32',authFile:'original-owner-auth.json',
   exists:()=>true,freshness,health:valid,
   create:async (_db,folder,pass,options)=>{
     called++;seenAuth=options.authFile;
     assert.equal(folder,local.FORTLEDGER_BACKUP_DIR);
     assert.equal(pass,local.FORTLEDGER_BACKUP_PASSPHRASE);
     return {owner_credentials_encrypted:true};
   }});
 assert.equal(called,1);
 assert.equal(seenAuth,'original-owner-auth.json');
 assert.equal(result.scope,'local_checkpoint');
 assert.equal(result.independent_disaster_recovery,false);
 await assert.rejects(()=>prepareRoutineUpdateCheckpoint({},{
   env:local,platform:'win32',authFile:'missing.json',exists:()=>false,
   create:()=>{throw Error('should not run')}}),/Original owner credential/);
 await assert.rejects(()=>prepareRoutineUpdateCheckpoint({},{
   env:local,platform:'win32',authFile:'auth.json',exists:()=>true,
   create:async()=>({owner_credentials_encrypted:false}),
   freshness,health:valid}),/did not include original owner/);
});
