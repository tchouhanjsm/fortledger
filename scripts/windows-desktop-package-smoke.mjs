import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const stage=process.argv[2];
if(process.platform!=='win32'||!stage||!fs.existsSync(path.join(stage,'FortLedger.exe')))
  throw new Error('Packaged Windows app with compiled native launcher is required');
const node=path.join(stage,'node.exe');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-bundled-ci-'));
const data=path.join(root,'data');
const env={...process.env,FORTLEDGER_DATA_DIR:data,FORTLEDGER_DESKTOP_INSTALLER:'1',
  FORTLEDGER_HOST:'127.0.0.1',PORT:'3000',FORTLEDGER_LAN_ENABLED:'0'};
let server=null;
async function run(script,input){
  return new Promise((resolve,reject)=>{
    const child=spawn(node,[script],{cwd:stage,env,stdio:['pipe','pipe','pipe']});
    let err='',out='';
    child.stderr.on('data',c=>err+=c);
    child.stdout.on('data',c=>out+=c);
    child.once('error',reject);
    child.once('exit',code=>resolve({code,err,out}));
    child.stdin.end(input||'');
  });
}
try{
  let result=await run('src/desktop-first-run.js','synthetic-bundled-owner-password-123\n');
  assert.equal(result.code,0,'First install failed: '+result.err);
  assert.equal(fs.existsSync(path.join(data,'fortledger.sqlite')),true);
  assert.equal(fs.existsSync(path.join(data,'admin-auth.json')),true);
  result=await run('src/desktop-first-run.js','synthetic-bundled-owner-password-123\n');
  assert.notEqual(result.code,0,'An existing hotel ledger may never be reinitialized');
  server=spawn(node,['src/server.js'],{cwd:stage,env,stdio:['pipe','pipe','pipe']});
  let stderr='';
  server.stderr.on('data',c=>stderr+=c.toString().slice(0,1000));
  let ready=false;
  for(let attempts=0;attempts<75;attempts++){
    if(server.exitCode!==null)break;
    try{
      const response=await fetch('http://127.0.0.1:3000/api/auth/status',{
        signal:AbortSignal.timeout(500)});
      if(response.ok){ready=true;break;}
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.equal(ready,true,'Bundled localhost server did not start: '+stderr);
  const res=await fetch('http://127.0.0.1:3000/api/auth/status');
  const status=await res.json();
  assert.equal(status.enabled,true,'Bundled server must enforce owner login');
  const closed=new Promise(resolve=>server.once('exit',(code,signal)=>resolve({code,signal})));
  server.stdin.write('FORTLEDGER_DESKTOP_QUIT\n');
  const resultExit=await Promise.race([
    closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('Desktop graceful shutdown timed out')),12000))
  ]);
  assert.equal(resultExit.code,0,'Desktop quit must close the SQLite app cleanly');
  server=null;
  assert.equal(fs.existsSync(path.join(data,'fortledger.sqlite')),true);
  console.log('PASS packaged runtime, native SQLite, owner-first-run, authenticated loopback and graceful quit');
}finally{
  if(server&&!server.killed)server.kill(); // Synthetic disposable CI data only.
  fs.rmSync(root,{recursive:true,force:true});
}
