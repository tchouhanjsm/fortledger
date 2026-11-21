import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';

test('sensitive API responses and app entry pages are not browser-cacheable',async()=>{
  const db=openDatabase(':memory:');
  const server=createApp(db,{authRecord:createPasswordRecord('strong-test-owner-secret')}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try{
    const base='http://127.0.0.1:'+server.address().port;
    const protectedPaths=['/','/index.html','/login.html','/api/auth/status','/api/rooms','/api/not-a-route'];
    for(const pathname of protectedPaths){
      const response=await fetch(base+pathname);
      assert.equal(response.headers.get('cache-control'),'no-store',pathname);
      assert.equal(response.headers.get('pragma'),'no-cache',pathname);
      assert.equal(response.headers.get('x-content-type-options'),'nosniff',pathname);
    }
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:'owner',password:'strong-test-owner-secret'})});
    assert.equal(login.status,200);
    assert.equal(login.headers.get('cache-control'),'no-store');
    assert.equal(login.headers.get('pragma'),'no-cache');
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const rooms=await fetch(base+'/api/rooms',{headers:{Cookie:cookie}});
    assert.equal(rooms.status,200);
    assert.equal(rooms.headers.get('cache-control'),'no-store');
    const icon=await fetch(base+'/fortledger-icon.svg');
    assert.equal(icon.status,200);
    assert.equal(icon.headers.get('x-content-type-options'),'nosniff');
    assert.notEqual(icon.headers.get('cache-control'),'no-store','Public static icons need not use sensitive-response policy');
  }finally{
    await new Promise(resolve=>server.close(resolve));
    db.close();
  }
});
