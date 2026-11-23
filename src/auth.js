import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {authPath} from './data-paths.js';
import {getStaffById,getStaffLogin,getOwnerProfile} from './staff.js';
import {may,requiredPermission} from './access.js';
import {createStaffPinService,PIN_SESSION_MS} from './staff-pin.js';

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
export function replacePasswordRecord(filename,newPassword){
  const record=createPasswordRecord(newPassword);
  if(!filename)throw new Error('Owner password file is not configured');
  if(!fs.existsSync(filename))throw new Error('Owner password file missing; password not changed');
  const temp=filename+'.new-'+process.pid+'-'+randomBytes(4).toString('hex');
  try{
    fs.writeFileSync(temp,JSON.stringify(record,null,2)+'\n',{mode:0o600,flag:'wx'});
    fs.renameSync(temp,filename);
    return record;
  }finally{
    if(fs.existsSync(temp))fs.unlinkSync(temp);
  }
}
export function authGate(record,db,{authFile=null,network=null}={}){
  const sessions=new Map(),failures=new Map();
  const name='fortledger_session';
  const lan=network?.mode==='lan';
  const localRequest=req=>!lan&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const pinService=createStaffPinService(db,{getOwnerHash:()=>record?.hash,localOnly:()=>!lan});
  const cookieAttributes=(req)=>'; HttpOnly; SameSite=Strict; Path=/'+(lan?'; Secure':'');
  function revokeUserSessions(id){
    for(const [token,item] of sessions)if(item.actor.id===id)sessions.delete(token);
  }
  function changePassword(req,res){
    if(!record)return res.status(400).json({error:'Authentication not configured'});
    if(req.auth_method!=='password')return res.status(403).json({error:'Full password sign-in required to change credentials'});
    const previous=req.body?.current_password,next=req.body?.new_password;
    if(typeof previous!=='string'||typeof next!=='string')
      return res.status(400).json({error:'Current and new passwords are required'});
    const key=req.actor.id+':'+(req.ip||'local'),now=Date.now();
    const entry=failures.get('change:'+key)||{count:0,until:0};
    if(entry.until>now)return res.status(429).json({error:'Too many attempts; try again later'});
    const actor=req.actor;
    let valid=false;
    if(actor.id===0)valid=verifyPassword(previous,record);
    else{
      const staff=db.prepare('SELECT password_json FROM staff_users WHERE id=? AND active=1').get(actor.id);
      try{valid=Boolean(staff&&verifyPassword(previous,JSON.parse(staff.password_json)));}
      catch{valid=false;}
    }
    if(!valid){
      entry.count++;
      if(entry.count>=5){entry.count=0;entry.until=now+15*60*1000;}
      failures.set('change:'+key,entry);
      return res.status(401).json({error:'Current password incorrect'});
    }
    failures.delete('change:'+key);
    if(previous===next)return res.status(400).json({error:'New password must differ from the current password'});
    try{
      if(actor.id===0){
        if(!authFile)return res.status(400).json({error:'Owner password file not configured'});
        record=replacePasswordRecord(authFile,next);
      }else{
        const hashed=createPasswordRecord(next);
        db.prepare('UPDATE staff_users SET password_json=? WHERE id=? AND active=1')
          .run(JSON.stringify(hashed),actor.id);
      }
      if(actor.id===0){
        db.prepare('DELETE FROM staff_pin_credentials').run();
        db.prepare('DELETE FROM staff_pin_failures').run();
        for(const [token,item] of sessions)if(item.method==='pin')sessions.delete(token);
      }else pinService.revokeStaffId(actor.id);
      revokeUserSessions(actor.id);
      res.setHeader('Set-Cookie',name+'='+cookieAttributes(req)+'; Max-Age=0');
      res.json({ok:true,reauthenticate:true});
    }catch(error){res.status(400).json({error:error.message});}
  }

  function session(req){
    const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));
    const token=raw?.slice(name.length+1);
    const item=token&&sessions.get(token);
    if(!item)return null;
    if(item.expires<Date.now()){sessions.delete(token);return null;}
    // Re-read staff status and role on every request: revocations apply immediately.
    const actor=item.actor.id===0?getOwnerProfile(db):getStaffById(db,item.actor.id);
    if(!actor?.active){sessions.delete(token);return null;}
    if(item.method==='pin'&&!['frontdesk','cashier'].includes(actor.role)){
      sessions.delete(token);return null;
    }
    return {token,actor,method:item.method||'password'};
  }
  function protect(req,res,next){
    if(!record){req.actor={id:0,username:'owner',display_name:'Owner',role:'owner',active:true};return next();}
    const found=session(req);
    if(!found)return res.status(401).json({error:'Login required'});
    req.actor=found.actor;
    req.auth_method=found.method;
    next();
  }
  function authorize(req,res,next){
    const permission=requiredPermission(req.method,req.path);
    if(req.actor?.role==='owner')return next();
    if(!permission||!may(req.actor?.role,permission))
      return res.status(403).json({error:'Your staff role does not permit this operation'});
    next();
  }
  function checkRequest(req,res,next){
    if(['POST','PUT','PATCH','DELETE'].includes(req.method)){
      // Only the owner-only historical original upload accepts PDF bytes.
      // All existing write APIs remain JSON-only and same-origin protected.
      const explicitPdfImport=req.method==='POST'&&
        req.path==='/external-invoice-originals/import'&&req.is('application/pdf');
      if(!req.is('application/json')&&!explicitPdfImport)
        return res.status(415).json({error:'JSON requests required except authenticated original PDF import'});
      const origin=req.headers.origin;
      if(origin){
        let url;
        try{url=new URL(origin);}catch{return res.status(403).json({error:'Invalid origin'});}
        const goodOrigin=lan?
          url.protocol==='https:'&&url.host===network.host+':'+network.port&&req.socket.encrypted:
          ['127.0.0.1','localhost'].includes(url.hostname)&&
            url.host===req.headers.host&&['http:','https:'].includes(url.protocol);
        if(!goodOrigin)
          return res.status(403).json({error:'Cross-origin request rejected'});
      }
    }
    next();
  }
  function login(req,res){
    if(!record)return res.status(400).json({error:'Authentication not configured'});
    const username=String(req.body?.username||'owner').trim().toLowerCase();
    const ip=req.ip||'local',now=Date.now(),key=ip+':'+username;
    const entry=failures.get(key)||{count:0,until:0};
    if(entry.until>now)return res.status(429).json({error:'Too many attempts; try again later'});
    const actor=username==='owner'?
      (verifyPassword(req.body?.password,record)?getOwnerProfile(db):null):
      getStaffLogin(db,username,req.body?.password);
    if(!actor){
      entry.count++;
      if(entry.count>=5){entry.until=now+15*60*1000;entry.count=0;}
      failures.set(key,entry);
      return res.status(401).json({error:'Invalid username or password'});
    }
    failures.delete(key);
    const token=randomBytes(32).toString('hex');
    sessions.set(token,{expires:now+SESSIONS_MS,actor:{id:actor.id},method:'password'});
    res.setHeader('Set-Cookie',name+'='+token+cookieAttributes(req)+'; Max-Age=28800');
    res.json({ok:true,user:actor});
  }
  function pinLogin(req,res){
    if(!record||!localRequest(req)||!pinService.enabled())
      return res.status(403).json({error:'Quick sign-in is unavailable on this computer'});
    try{
      const actor=pinService.check(req.body?.username,req.body?.pin,req.headers.cookie||'');
      if(!actor)return res.status(401).json({error:'PIN sign-in unavailable. Use your full password or ask the owner to reset quick sign-in'});
      const token=randomBytes(32).toString('hex');
      sessions.set(token,{expires:Date.now()+PIN_SESSION_MS,actor:{id:actor.id},method:'pin'});
      res.setHeader('Set-Cookie',name+'='+token+cookieAttributes(req)+'; Max-Age=7200');
      res.json({ok:true,user:actor});
    }catch(error){res.status(401).json({error:'PIN sign-in unavailable. Use your full password'});}
  }
  function pinLoginStatus(req,res){
    res.json({available:Boolean(record&&localRequest(req)&&pinService.enabled())});
  }
  function pinProfile(req,res){
    const staff=['frontdesk','cashier'].includes(req.actor?.role);
    res.json({available:Boolean(staff&&record&&localRequest(req)&&pinService.enabled()),
      enrolled:Boolean(staff&&localRequest(req)&&pinService.enrolled(req.actor,req.headers.cookie||''))});
  }
  function pinEnroll(req,res){
    if(!localRequest(req)||!record||!pinService.enabled())
      return res.status(403).json({error:'Local trusted-device sign-in is unavailable'});
    if(req.auth_method!=='password')
      return res.status(403).json({error:'Sign in using your full password to enroll or reset a PIN'});
    if(!['frontdesk','cashier'].includes(req.actor?.role))
      return res.status(403).json({error:'Only front desk or cashier accounts can use quick PIN'});
    const key='pin-enroll:'+req.actor.id,now=Date.now();
    const entry=failures.get(key)||{count:0,until:0};
    if(entry.until>now)return res.status(429).json({error:'Too many attempts; sign in later using your password'});
    let passwordValid=false;
    try{
      const row=db.prepare('SELECT password_json FROM staff_users WHERE id=? AND active=1').get(req.actor.id);
      passwordValid=Boolean(row&&verifyPassword(req.body?.current_password,JSON.parse(row.password_json)));
    }catch{}
    if(!passwordValid){
      entry.count++;
      if(entry.count>=5){entry.count=0;entry.until=now+15*60*1000;}
      failures.set(key,entry);
      return res.status(401).json({error:'Current password incorrect'});
    }
    failures.delete(key);
    try{
      const result=pinService.enroll(req.actor,req.body?.pin,req.body?.confirm_pin,req.headers.cookie||'');
      res.setHeader('Set-Cookie',pinService.deviceCookieName+'='+result.device+
        '; HttpOnly; SameSite=Strict; Path=/; Max-Age=7776000');
      res.json({enrolled:true,notice:'This browser is registered. PIN sign-in is available only here on this computer.'});
    }catch(error){res.status(400).json({error:error.message});}
  }
  function pinRevoke(req,res){
    if(!localRequest(req)||req.auth_method!=='password')
      return res.status(403).json({error:'Full password sign-in on this computer required'});
    let verified=false;
    try{
      const row=db.prepare('SELECT password_json FROM staff_users WHERE id=? AND active=1').get(req.actor.id);
      verified=Boolean(row&&verifyPassword(req.body?.current_password,JSON.parse(row.password_json)));
    }catch{}
    if(!verified)return res.status(401).json({error:'Current password incorrect'});
    try{
      const result=pinService.revoke(req.actor);
      for(const [token,item] of sessions)if(item.actor.id===req.actor.id&&item.method==='pin')sessions.delete(token);
      res.json(result);
    }catch(error){res.status(400).json({error:error.message});}
  }
  function pinPolicyGet(req,res){
    if(req.actor?.role!=='owner'||req.auth_method!=='password'||!localRequest(req))
      return res.status(403).json({error:'Owner password session on this computer required'});
    res.json({enabled:pinService.enabled()});
  }
  function pinPolicyUpdate(req,res){
    if(req.actor?.role!=='owner'||req.auth_method!=='password'||!localRequest(req))
      return res.status(403).json({error:'Owner password session on this computer required'});
    const key='pin-policy:'+req.ip,now=Date.now(),entry=failures.get(key)||{count:0,until:0};
    if(entry.until>now)return res.status(429).json({error:'Too many attempts; try again later'});
    if(!verifyPassword(req.body?.current_password,record)){
      entry.count++;
      if(entry.count>=5){entry.count=0;entry.until=now+15*60*1000;}
      failures.set(key,entry);
      return res.status(401).json({error:'Current owner password incorrect'});
    }
    failures.delete(key);
    try{
      const result=pinService.setEnabled(req.actor,req.body?.enabled);
      if(!result.enabled)for(const [token,item] of sessions)if(item.method==='pin')sessions.delete(token);
      res.json(result);
    }catch(error){res.status(400).json({error:error.message});}
  }
  function logout(req,res){
    const found=session(req);
    if(found)sessions.delete(found.token);
    res.setHeader('Set-Cookie',name+'='+cookieAttributes(req)+'; Max-Age=0');
    res.json({ok:true});
  }
  return {protect,authorize,checkRequest,login,pinLogin,pinLoginStatus,pinProfile,pinEnroll,pinRevoke,
    pinPolicyGet,pinPolicyUpdate,logout,changePassword,revokeUserSessions,
    revokeStaffPin:id=>pinService.revokeStaffId(id),status:req=>({
    enabled:Boolean(record),authenticated:!record||Boolean(session(req))
  })};
}
