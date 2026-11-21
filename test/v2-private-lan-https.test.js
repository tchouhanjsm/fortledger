import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {isPrivateLanIp,localListenerSettings,requireConfiguredHost,readLanTlsCredentials} from '../src/network-policy.js';

const lan=()=>localListenerSettings({
  FORTLEDGER_LAN_ENABLED:'1',FORTLEDGER_HOST:'192.168.21.12',PORT:'3000',
  FORTLEDGER_TLS_CERT:'/local/staff-cert.pem',FORTLEDGER_TLS_KEY:'/local/staff-key.pem'
});

test('private LAN network policy requires deliberate HTTPS configuration',()=>{
  for(const ip of ['10.0.0.1','172.16.0.2','172.31.255.254','192.168.1.8'])
    assert.equal(isPrivateLanIp(ip),true,ip);
  for(const ip of ['0.0.0.0','127.0.0.1','169.254.1.2','172.32.1.5',
    '192.167.1.5','8.8.8.8','::1','localhost','10.0.0.1.evil.test'])
    assert.equal(isPrivateLanIp(ip),false,ip);
  assert.deepEqual(localListenerSettings({}),{host:'127.0.0.1',port:3000});
  assert.deepEqual(lan(),{mode:'lan',host:'192.168.21.12',port:3000,
    certPath:'/local/staff-cert.pem',keyPath:'/local/staff-key.pem'});
  assert.throws(()=>localListenerSettings({FORTLEDGER_HOST:'192.168.21.12'}),/Unsafe FORTLEDGER_HOST/);
  assert.throws(()=>localListenerSettings({FORTLEDGER_LAN_ENABLED:'1',FORTLEDGER_HOST:'0.0.0.0',
    FORTLEDGER_TLS_CERT:'a',FORTLEDGER_TLS_KEY:'b'}),/private IPv4/);
  assert.throws(()=>localListenerSettings({FORTLEDGER_LAN_ENABLED:'1',
    FORTLEDGER_HOST:'192.168.1.10'}),/requires FORTLEDGER_TLS_CERT/);
  assert.throws(()=>localListenerSettings({FORTLEDGER_LAN_ENABLED:'maybe'}),/must be 0 or 1/);
  assert.throws(()=>localListenerSettings({FORTLEDGER_TLS_KEY:'x'}),/explicitly enabled LAN mode/);
  assert.throws(()=>readLanTlsCredentials({mode:'lan',certPath:'/not/a/cert.pem',
    keyPath:'/not/a/key.pem',host:'192.168.1.8'}));
});

test('HTTPS LAN request guard rejects fake Host and plaintext transport',()=>{
  const policy=requireConfiguredHost(lan());
  const invoke=(host,encrypted)=>{
    let status=null,message=null,continued=false;
    const req={headers:{host},socket:{encrypted}};
    const res={setHeader:()=>{},status(code){status=code;return this;},json(value){message=value;}};
    policy(req,res,()=>{continued=true;});
    return {status,message,continued};
  };
  assert.equal(invoke('192.168.21.12:3000',false).status,421);
  assert.equal(invoke('wrong.example:3000',true).status,421);
  assert.equal(invoke('192.168.21.12:3000',true).continued,true);
});

test('LAN guard refuses unauthenticated application startup and HTTP downgrade',async()=>{
  const db=openDatabase(':memory:');
  assert.throws(()=>createApp(db,{network:lan()}),/requires configured authentication/);
  const server=createApp(db,{network:lan(),authRecord:createPasswordRecord('strong-lan-test-owner-password')})
    .listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try{
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/auth/status');
    assert.equal(response.status,421);
    assert.match((await response.json()).error,/HTTPS/);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
