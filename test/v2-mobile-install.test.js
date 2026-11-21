import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manifest=JSON.parse(readFileSync(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'));
const icon=readFileSync(new URL('../public/fortledger-icon.svg',import.meta.url),'utf8');

test('mobile install metadata is local, in-scope, and never launches a remote origin',()=>{
  assert.equal(manifest.id,'/');
  assert.equal(manifest.start_url,'/');
  assert.equal(manifest.scope,'/');
  assert.equal(manifest.display,'standalone');
  assert.match(manifest.name,/FortLedger/);
  assert.ok(manifest.icons.some(icon=>icon.src==='/fortledger-icon.svg'&&icon.type==='image/svg+xml'));
  for(const value of [manifest.id,manifest.start_url,manifest.scope,...manifest.icons.map(icon=>icon.src)])
    assert.ok(value.startsWith('/')&&!value.startsWith('//'),value);
});

test('both entry screens expose install metadata and a local SVG icon',()=>{
  for(const path of ['index.html','login.html']){
    const html=readFileSync(new URL('../public/'+path,import.meta.url),'utf8');
    assert.match(html,/<link rel="manifest" href="\/manifest.webmanifest">/);
    assert.match(html,/<link rel="icon" type="image\/svg\+xml" href="\/fortledger-icon.svg">/);
    assert.match(html,/<meta name="theme-color" content="#22324b">/);
  }
  assert.match(icon,/<svg\s/);
  assert.match(icon,/viewBox="0 0 192 192"/);
});

test('install foundation does not register a service worker or permit offline financial submissions',()=>{
  const frontend=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const login=readFileSync(new URL('../public/login.html',import.meta.url),'utf8');
  assert.doesNotMatch(frontend,/serviceWorker\.register\s*\(/);
  assert.doesNotMatch(login,/serviceWorker\.register\s*\(/);
  assert.equal(Object.hasOwn(manifest,'serviceworker'),false);
});
