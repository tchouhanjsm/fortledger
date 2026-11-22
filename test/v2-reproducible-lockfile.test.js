import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
const workflow=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
test('the committed npm v3 lockfile matches the declared application and dependency tree',()=>{
  assert.equal(lock.name,pkg.name);
  assert.equal(lock.version,pkg.version);
  assert.equal(lock.lockfileVersion,3);
  assert.deepEqual(lock.packages[''].dependencies,pkg.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies,pkg.devDependencies);
  assert.ok(Object.keys(lock.packages).length>50);
  for(const [name,entry] of Object.entries(lock.packages))
    if(name&&entry.resolved)assert.ok(entry.integrity||entry.link,'Missing integrity for '+name);
});
test('CI installs from pinned lockfile, without temporary export job or floating npm install',()=>{
  assert.equal((workflow.match(/npm ci --no-audit --no-fund/g)||[]).length,2);
  assert.doesNotMatch(workflow,/npm install --no-audit --no-fund/);
  assert.doesNotMatch(workflow,/lockfile-export/);
});
