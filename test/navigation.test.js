import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {VIEWS,viewForHash} from '../public/navigation.js';

const html=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'../public/index.html'),'utf8');
test('five focused modules have valid bookmarkable sidebar routes and real page sections',()=>{
  assert.deepEqual(Object.keys(VIEWS),['bookings','rooms','invoices','restaurant','business-settings']);
  for(const [name,definition] of Object.entries(VIEWS)){
    assert.equal(viewForHash('#'+name),name);
    assert.ok(definition.title&&definition.subtitle);
    assert.match(html,new RegExp('href="#'+name+'"'));
    for(const section of definition.sections){
      assert.match(html,new RegExp('id="'+section+'"'),'Missing section '+section);
    }
  }
});
test('invalid routes return to bookings and workspace headings exist',()=>{
  assert.equal(viewForHash(''),'bookings');
  assert.equal(viewForHash('#unexpected'),'bookings');
  assert.equal(viewForHash('#__proto__'),'bookings');
  assert.match(html,/id="workspace-title"/);
  assert.match(html,/id="workspace-subtitle"/);
  assert.match(html,/id="new-booking"/);
});
