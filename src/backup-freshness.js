import fs from 'node:fs';
import path from 'node:path';

/** Lightweight file freshness only. A recent file is NOT proof of a
 * decryptable or independently recoverable backup. Never expose paths. */
export function backupFreshness({env=process.env,now=new Date()}={}){
  const directory=env.FORTLEDGER_BACKUP_DIR,passphrase=env.FORTLEDGER_BACKUP_PASSPHRASE;
  if(!directory||!passphrase)return {state:'unconfigured',needs_attention:true,
    detail:'Encrypted backups not fully configured on the hotel server'};
  if(!path.isAbsolute(directory)||passphrase.length<16)
    return {state:'invalid',needs_attention:true,detail:'Encrypted backup configuration requires operator review'};
  try{
    const candidates=fs.readdirSync(directory,{withFileTypes:true})
      .filter(item=>item.isFile()&&/^fortledger-.*\.flbk$/.test(item.name))
      .map(item=>fs.statSync(path.join(directory,item.name)).mtimeMs);
    if(!candidates.length)return {state:'missing',needs_attention:true,
      detail:'No encrypted backup file found on the hotel server'};
    const newest=Math.max(...candidates),ageHours=(now.getTime()-newest)/3600000;
    if(!Number.isFinite(ageHours)||ageHours<0)return {state:'invalid',needs_attention:true,
      detail:'Backup timestamps need review'};
    if(ageHours>36)return {state:'stale',needs_attention:true,
      detail:'Latest backup file is older than 36 hours'};
    return {state:'recent',needs_attention:false,
      detail:'A recent encrypted backup file exists; restore integrity is not confirmed'};
  }catch{return {state:'unavailable',needs_attention:true,
    detail:'Cannot inspect the configured encrypted backup directory'};}
}
