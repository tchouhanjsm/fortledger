import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('physical Epson checklist leads with Mac npm command and never claims simulated printing is proof',()=>{
  const doc=readFileSync(new URL('../docs/EPSON_PHYSICAL_ACCEPTANCE.md',import.meta.url),'utf8');
  assert.match(doc,/hotel \*\*Mac\*\*/);
  assert.match(doc,/npm run printer:test-slip -- 192\.168\.1\.50 9100 --confirm/);
  assert.match(doc,/explicit `--confirm` flag is required/);
  assert.match(doc,/successful TCP connection is \*\*not\*\* proof of paper output/i);
  assert.match(doc,/Leave the release gate pending/);
  assert.match(doc,/no duplicate sale or payment/i);
});
