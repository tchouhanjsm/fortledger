import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {request as httpRequest} from 'node:http';
import {isAllowedLocalHost,localListenerSettings} from '../src/network-policy.js';

test('hostname allowlist accepts only canonical loopback origins and valid TCP ports',()=>{
  for(const host of ['127.0.0.1','localhost','127.0.0.1:3000','localhost:65535'])
    assert.equal(isAllowedLocalHost(host),true,host);
  for(const host of [
    undefined,'','hotel.internal','fortledger.local','0.0.0.0','192.168.1.5',
    '127.0.0.1.evil.example','localhost.evil.test','localhost:0','localhost:99999',
    'localhost:80@evil.test','localhost:3000:4000','LOCALHOST:999999','[::1]:3000',
    'localhost:443/anything','localhost:3000\\r\\nHost: evil.test'
  ])assert.equal(isAllowedLocalHost(host),false,String(host));
});
test('startup keeps local-only default and blocks unsafe network exposure',()=>{
  assert.deepEqual(localListenerSettings({}),{host:'127.0.0.1',port:3000});
  assert.deepEqual(localListenerSettings({FORTLEDGER_HOST:'localhost',PORT:'3900'}),{host:'localhost',port:3900});
  for(const host of ['0.0.0.0','::','192.168.0.8','fortledger.example','', ' 10.0.0.1 ']){
    if(!host)continue;
    assert.throws(()=>localListenerSettings({FORTLEDGER_HOST:host}),/Unsafe FORTLEDGER_HOST/);
  }
  for(const port of ['0','99999','123abc','-1','NaN'])
    assert.throws(()=>localListenerSettings({PORT:port}),/PORT must/);
});
test('Host-header guard rejects rebinding before login and never touches hotel records',async()=>{
  const db=openDatabase(':memory:');
  const server=createApp(db,{authRecord:createPasswordRecord('secure-test-owner-password')}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try{
    const root='http://127.0.0.1:'+server.address().port;
    const status=await fetch(root+'/api/auth/status');
    assert.equal(status.status,200);
    assert.equal((await status.json()).enabled,true);
    // Raw HTTP sends the exact Host header; Node fetch/Undici may overwrite
    // forbidden headers, so fetch() cannot exercise this security boundary.
    const requestHost=(hostname,pathname)=>new Promise((resolve,reject)=>{
      const req=httpRequest(root+pathname,{headers:{Host:hostname}},res=>{
        const chunks=[];
        res.on('data',chunk=>chunks.push(chunk));
        res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
        res.on('error',reject);
      });
      req.on('error',reject);req.end();
    });
    for(const header of ['other.hotel','127.0.0.1.evil.test','192.168.0.10','localhost:99999']){
      const bad=await requestHost(header,'/api/auth/status');
      assert.equal(bad.status,421,header);
      assert.match(JSON.parse(bad.body).error,/localhost only/);
      const html=await requestHost(header,'/');
      assert.equal(html.status,421,'Static app also must fail closed');
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM operation_audit').get().n,0);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
