import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import {execFileSync,spawnSync} from 'node:child_process';
import {checkServerIdentity} from 'node:tls';
import {createPasswordRecord} from '../src/auth.js';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {macPreflight} from '../src/mac-preflight.js';
import {readLanTlsCredentials,localListenerSettings} from '../src/network-policy.js';

const opensslAvailable=spawnSync('openssl',['version'],{stdio:'ignore'}).status===0;
const privateIp='192.168.21.12';

function fixture(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fl-tls-ci-'));
  const certPath=path.join(directory,'synthetic.crt');
  const keyPath=path.join(directory,'synthetic.key');
  try{
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes',
      '-keyout',keyPath,'-out',certPath,'-days','2',
      '-subj','/CN=fortledger-synthetic','-addext','subjectAltName=IP:'+privateIp],
      {stdio:'ignore',timeout:15000});
    return {directory,certPath,keyPath};
  }catch(error){fs.rmSync(directory,{recursive:true,force:true});throw error;}
}
const settings=f=>localListenerSettings({
  FORTLEDGER_LAN_ENABLED:'1',FORTLEDGER_HOST:privateIp,PORT:'3000',
  FORTLEDGER_TLS_CERT:f.certPath,FORTLEDGER_TLS_KEY:f.keyPath
});

test('synthetic real HTTPS handshake enforces cookies, exact Host and Origin', {skip:!opensslAvailable}, async()=>{
  const files=fixture(),db=openDatabase(':memory:');
  let server;
  try{
    const network=settings(files),tls=readLanTlsCredentials(network);
    const app=createApp(db,{network,authRecord:createPasswordRecord('synthetic-owner-password-strong'),
      checkUpdates:async()=>({platform:'windows',state:'installer_managed',available:false})});
    server=https.createServer({cert:tls.cert,key:tls.key,minVersion:'TLSv1.2'},app)
      .listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    const request=(route,{method='GET',host=privateIp+':3000',origin,body,cookie}={})=>
      new Promise((resolve,reject)=>{
        const raw=body===undefined?undefined:JSON.stringify(body);
        const headers={Host:host};
        if(origin!==undefined)headers.Origin=origin;
        if(cookie)headers.Cookie=cookie;
        if(raw!==undefined){headers['Content-Type']='application/json';headers['Content-Length']=Buffer.byteLength(raw);}
        const req=https.request({hostname:'127.0.0.1',port:server.address().port,
          method,path:route,headers,ca:tls.cert,rejectUnauthorized:true,
          checkServerIdentity:(_h,peer)=>checkServerIdentity(privateIp,peer)},
        res=>{
          const chunks=[];
          res.on('data',chunk=>chunks.push(chunk));
          res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,
            body:Buffer.concat(chunks).toString('utf8')}));
        });
        req.on('error',reject);req.end(raw);
      });
    const status=await request('/api/auth/status');
    assert.equal(status.status,200);
    assert.equal(status.headers['cache-control'],'no-store');
    const foreign=await request('/api/auth/status',{host:'hotel.evil:3000'});
    assert.equal(foreign.status,421);
    const blocked=await request('/api/auth/login',{method:'POST',
      origin:'http://'+privateIp+':3000',body:{username:'owner',password:'synthetic-owner-password-strong'}});
    assert.equal(blocked.status,403);
    const login=await request('/api/auth/login',{method:'POST',
      origin:'https://'+privateIp+':3000',
      body:{username:'owner',password:'synthetic-owner-password-strong'}});
    assert.equal(login.status,200);
    assert.match(login.headers['set-cookie'][0],/; Secure(?:;|$)/);
    assert.match(login.headers['set-cookie'][0],/SameSite=Strict/);
    const cookie=login.headers['set-cookie'][0].split(';')[0];
    const me=await request('/api/me',{cookie});
    assert.equal(me.status,200);
    assert.equal(JSON.parse(me.body).role,'owner');
    // In installer mode, a trusted staff-HTTPS owner may READ the official
    // installer feed; never allow installing/restarting over a phone session.
    const priorDesktop=process.env.FORTLEDGER_DESKTOP_INSTALLER;
    process.env.FORTLEDGER_DESKTOP_INSTALLER='1';
    try{
      const official=await request('/api/system/updates',{cookie});
      assert.equal(official.status,200);
      assert.equal(JSON.parse(official.body).state,'installer_managed');
      const installAttempt=await request('/api/system/updates/install',{
        method:'POST',cookie,origin:'https://'+privateIp+':3000',body:{
          confirmation:'stop_after_current_requests',target_sha:'a'.repeat(40)
        }});
      assert.equal(installAttempt.status,403);
    }finally{
      if(priorDesktop===undefined)delete process.env.FORTLEDGER_DESKTOP_INSTALLER;
      else process.env.FORTLEDGER_DESKTOP_INSTALLER=priorDesktop;
    }
    const denied=await request('/api/auth/logout',{method:'POST',
      origin:'https://evil.example',cookie,body:{}});
    assert.equal(denied.status,403);
    const logout=await request('/api/auth/logout',{method:'POST',
      origin:'https://'+privateIp+':3000',cookie,body:{}});
    assert.equal(logout.status,200);
    assert.match(logout.headers['set-cookie'][0],/Max-Age=0/);
    assert.equal((await request('/api/me',{cookie})).status,401);
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    db.close();
    fs.rmSync(files.directory,{recursive:true,force:true});
  }
});

test('Mac preflight checks real certificate/key and assigned IP without modifying them',
  {skip:!opensslAvailable},()=>{
  const files=fixture();
  const env={FORTLEDGER_LAN_ENABLED:'1',FORTLEDGER_HOST:privateIp,PORT:'3000',
    FORTLEDGER_TLS_CERT:files.certPath,FORTLEDGER_TLS_KEY:files.keyPath,
    FORTLEDGER_DATA_DIR:files.directory};
  const interfaces={en0:[{family:'IPv4',address:privateIp}]};
  try{
    const before=fs.statSync(files.certPath).mtimeMs;
    const good=macPreflight({env,platform:'darwin',nodeVersion:'22.1.0',interfaces});
    assert.equal(good.healthy,true);
    assert.equal(good.checks.find(c=>c.name==='LAN interface address').status,'pass');
    assert.equal(good.checks.find(c=>c.name==='LAN TLS credentials').status,'pass');
    assert.equal(good.production_ready,false);
    assert.equal(fs.statSync(files.certPath).mtimeMs,before);
    assert.doesNotMatch(JSON.stringify(good),/synthetic\.key|synthetic\.crt/);
    const wrongInterface=macPreflight({env,platform:'darwin',nodeVersion:'22.1.0',
      interfaces:{en0:[{family:'IPv4',address:'192.168.21.99'}]}});
    assert.equal(wrongInterface.checks.find(c=>c.name==='LAN interface address').status,'fail');
    assert.equal(wrongInterface.healthy,false);
    const wrongIp=macPreflight({env:{...env,FORTLEDGER_HOST:'192.168.21.99'},
      platform:'darwin',nodeVersion:'22.1.0',interfaces:{en0:[{family:'IPv4',address:'192.168.21.99'}]}});
    assert.equal(wrongIp.checks.find(c=>c.name==='LAN TLS credentials').status,'fail');
    assert.equal(wrongIp.healthy,false);
    execFileSync('openssl',['genrsa','-out',path.join(files.directory,'unrelated.key'),'2048'],
      {stdio:'ignore',timeout:15000});
    assert.throws(()=>readLanTlsCredentials({...settings(files),
      keyPath:path.join(files.directory,'unrelated.key')}),/do not match/);
  }finally{fs.rmSync(files.directory,{recursive:true,force:true});}
});
