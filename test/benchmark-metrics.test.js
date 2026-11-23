import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeSamples} from '../src/benchmark-metrics.js';

test('latency quantiles are stable, ordered, non-mutating nearest-rank values',()=>{
  const values=[9,1,3,8,7,5,4,2,6,10],copy=[...values];
  assert.deepEqual(summarizeSamples(values),
    {count:10,p50_ms:5,p95_ms:10,max_ms:10});
  assert.deepEqual(values,copy);
  assert.deepEqual(summarizeSamples([0]),{count:1,p50_ms:0,p95_ms:0,max_ms:0});
});
test('benchmark refuses invalid samples instead of displaying misleading figures',()=>{
  for(const input of [[],[Infinity],[NaN],[-1],[1,undefined],null])
    assert.throws(()=>summarizeSamples(input),/Finite nonnegative benchmark samples/);
});
test('benchmark never opens the real hotel data path or performs financial writes',()=>{
  const script=readFileSync(new URL('../scripts/benchmark-readonly.mjs',import.meta.url),'utf8');
  assert.match(script,/openDatabase\(':memory:'\)/);
  assert.match(script,/\.listen\(0,'127\.0\.0\.1'\)/);
  assert.match(script,/EXPLAIN QUERY PLAN/);
  assert.match(script,/\/api\/documents\/register/);
  assert.match(script,/\/api\/restaurant\/bills/);
  assert.match(script,/proforma\.run/);
  assert.match(script,/held\.run/);
  assert.doesNotMatch(script,/process\.env\.FORTLEDGER_DATA_DIR|databasePath\(/);
  assert.doesNotMatch(script,/fetch\([^\n]+method:\s*['"]POST['"]/);
});
