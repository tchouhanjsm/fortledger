import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {authGate,createPasswordRecord} from '../src/auth.js';
import {isLocalMaintenanceRequest,requireConfiguredHost} from '../src/network-policy.js';

const network={mode:'lan',host:'192.168.1.15',port:3000,localMaintenance:true};
const password='test-owner-password-long';
const local=()=>({headers:{host:'127.0.0.1:3000'},socket:{localAddress:'127.0.0.1',remoteAddress:'127.0.0.1'}});
const lan=()=>({headers:{host:'192.168.1.15:3000'},socket:{localAddress:'192.168.1.15',remoteAddress:'192.168.1.22',encrypted:true}});
function response(){
  return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;},
    status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
}
test('loopback maintenance requires exact socket and host; forwarded or spoofed headers do not qualify',()=>{
  const guard=requireConfiguredHost(network);
  for(const req of [local(),lan()]){
    let passed=false;guard(req,response(),()=>{passed=true;});assert.equal(passed,true);
  }
  assert.equal(isLocalMaintenanceRequest(local(),network),true);
  assert.equal(isLocalMaintenanceRequest(lan(),network),false);
  assert.equal(isLocalMaintenanceRequest(local(),{...network,localMaintenance:false}),false);
  for(const req of [
    {...lan(),headers:{host:'127.0.0.1:3000','x-forwarded-for':'127.0.0.1'}},
    {...local(),socket:{localAddress:'192.168.1.15',remoteAddress:'127.0.0.1'}},
    {...local(),socket:{localAddress:'127.0.0.1',remoteAddress:'192.168.1.22'}},
    {...lan(),socket:{...lan().socket,encrypted:false}},
    {...local(),headers:{host:'evil.example:3000'}}
  ]){
    assert.equal(isLocalMaintenanceRequest(req,network),false);
    let passed=false;const res=response();guard(req,res,()=>{passed=true;});
    assert.equal(passed,false);assert.equal(res.code,421);
  }
});
test('one auth authority isolates TLS and local sessions and rejects cross-origin writes',()=>{
  const db=openDatabase(':memory:');
  try{
    const gate=authGate(createPasswordRecord(password),db,{network});
    const login=req=>{
      req.body={username:'owner',password};const res=response();gate.login(req,res);
      assert.equal(res.code,200);return res.headers['Set-Cookie'];
    };
    const localCookie=login(local()),lanCookie=login(lan());
    assert.doesNotMatch(localCookie,/; Secure/);assert.match(lanCookie,/; Secure/);
    for(const [request,cookie,allowed] of [[local(),localCookie,true],[lan(),lanCookie,true],[local(),lanCookie,false],[lan(),localCookie,false]]){
      request.headers.cookie=cookie.split(';')[0];let passed=false;const res=response();
      gate.protect(request,res,()=>{passed=true;});
      assert.equal(passed,allowed);if(!allowed)assert.equal(res.code,401);
    }
    for(const [request,origin,allowed] of [[local(),'http://127.0.0.1:3000',true],[local(),'https://192.168.1.15:3000',false],[lan(),'http://127.0.0.1:3000',false],[lan(),'https://192.168.1.15:3000',true]]){
      request.method='POST';request.path='/system/updates/install';request.headers.origin=origin;request.is=()=>true;
      let passed=false;const res=response();gate.checkRequest(request,res,()=>{passed=true;});
      assert.equal(passed,allowed);
    }
  }finally{db.close();}
});
test('real loopback HTTP owner can check updates with LAN config enabled, no anonymous access',async()=>{
  const db=openDatabase(':memory:');let checks=0;
  const config={...network};
  const app=createApp(db,{authRecord:createPasswordRecord(password),network:config,
    checkUpdates:async()=>{checks++;return {state:'fixture'};}});
  const listener=app.listen(0,'127.0.0.1');
  try{
    await once(listener,'listening');config.port=listener.address().port;
    const base='http://127.0.0.1:'+config.port;
    assert.equal((await fetch(base+'/api/system/updates')).status,401);
    const login=await fetch(base+'/api/auth/login',{method:'POST',
      headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({username:'owner',password})});
    assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const result=await fetch(base+'/api/system/updates',{headers:{Cookie:cookie}});
    assert.equal(result.status,200);assert.equal((await result.json()).state,'fixture');assert.equal(checks,1);
    const status=await fetch(base+'/api/network/staff-access',{headers:{Cookie:cookie}});
    assert.equal((await status.json()).phone_url,'https://'+config.host+':'+config.port);
  }finally{await new Promise(resolve=>listener.close(resolve));db.close();}
});
test('packaged server shares one app and drains both listeners before checkpoint and patch',()=>{
  const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  assert.match(source,/if\(desktopCodeHost&&tls\)network.localMaintenance=true/);
  assert.match(source,/endpoints.push\(\{server:http.createServer\(handle\),host:'127.0.0.1'\}\)/);
  assert.match(source,/Promise.all\(endpoints.map/);
  assert.match(source,/drainListeners\(async\(\)=>\{\s*try\{await closeDataSafely\(\{forCodeUpdate:true\}\)/);
  assert.equal((source.match(/backups=scheduleEncryptedBackups\(db\)/g)||[]).length,1);
});
