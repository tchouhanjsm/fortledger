import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {authPath} from './data-paths.js';

export const DEFAULT_AUTH_FILE=authPath();
const SESSIONS_MS=8*60*60*1000;
export function createPasswordRecord(password){
  if(typeof password!=='string'||password.length<12||password.length>256)
    throw new Error('Admin password must be 12–256 characters');
  const salt=randomBytes(16).toString('hex');
  const hash=scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex');
  return {version:1,salt,hash};
}
export function verifyPassword(password,record){
  if(typeof password!=='string'||!record||record.version!==1)return false;
  if(typeof record.salt!=='string'||!/^[a-f0-9]{32}$/.test(record.salt)||
     typeof record.hash!=='string'||!/^[a-f0-9]{128}$/.test(record.hash))return false;
  const expected=Buffer.from(record.hash,'hex'),actual=scryptSync(password,Buffer.from(record.salt,'hex'),64);
  return timingSafeEqual(expected,actual);
}
export function loadPasswordRecord(filename=DEFAULT_AUTH_FILE){
  if(!fs.existsSync(filename))return null;
  const record=JSON.parse(fs.readFileSync(filename,'utf8'));
  if(record?.version!==1||typeof record.salt!=='string'||!/^[a-f0-9]{32}$/.test(record.salt)||
     typeof record.hash!=='string'||!/^[a-f0-9]{128}$/.test(record.hash))
    throw new Error('Invalid admin-auth.json');
  return record;
}
export function savePasswordRecord(filename,password){
  const record=createPasswordRecord(password);
  fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
  fs.writeFileSync(filename,JSON.stringify(record,null,2)+'\n',{mode:0o600,flag:'wx'});
  return filename;
}
export function authGate(record){
  const sessions=new Map(),failures=new Map();
  const name='fortledger_session';
  function session(req){
    const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));
    const token=raw?.slice(name.length+1);
    const expires=token&&sessions.get(token);
    if(!expires)return null;
    if(expires<Date.now()){sessions.delete(token);return null;}
    return token;
  }
  function protect(req,res,next){
    if(!record)return next();
    if(!session(req))return res.status(401).json({error:'Login required'});
    next();
  }
  function checkRequest(req,res,next){
    if(['POST','PUT','PATCH','DELETE'].includes(req.method)){
      if(!req.is('application/json'))return res.status(415).json({error:'JSON requests required'});
      const origin=req.headers.origin;
      if(origin){
        let url;
        try{url=new URL(origin);}catch{return res.status(403).json({error:'Invalid origin'});}
        if(!['127.0.0.1','localhost'].includes(url.hostname)||
           url.host!==req.headers.host || !['http:','https:'].includes(url.protocol))
          return res.status(403).json({error:'Cross-origin request rejected'});
      }
    }
    next();
  }
  function login(req,res){
    if(!record)return res.status(400).json({error:'Authentication not configured'});
    const ip=req.ip||'local',now=Date.now(),entry=failures.get(ip)||{count:0,until:0};
    if(entry.until>now)return res.status(429).json({error:'Too many attempts; try again later'});
    if(!verifyPassword(req.body?.password,record)){
      entry.count++;
      if(entry.count>=5){entry.until=now+15*60*1000;entry.count=0;}
      failures.set(ip,entry);
      return res.status(401).json({error:'Invalid password'});
    }
    failures.delete(ip);
    const token=randomBytes(32).toString('hex');
    sessions.set(token,now+SESSIONS_MS);
    res.setHeader('Set-Cookie',name+'='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800');
    res.json({ok:true});
  }
  function logout(req,res){
    const token=session(req);
    if(token)sessions.delete(token);
    res.setHeader('Set-Cookie',name+'=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ok:true});
  }
  return {protect,checkRequest,login,logout,status:req=>({enabled:Boolean(record),authenticated:!record||Boolean(session(req))})};
}
