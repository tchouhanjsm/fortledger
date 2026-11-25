import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

test('manual refresh is read-only and old load response cannot overwrite newer records',()=>{
  assert.match(html,/id="refresh-workspace"/);
  assert.match(html,/id="refresh-message"[^>]*role="status"/);
  assert.match(app,/const revision=\+\+workspaceLoadRevision/);
  assert.match(app,/if\(revision!==workspaceLoadRevision\)return false/);
  assert.match(app,/const snapshot=await Promise\.all/);
  assert.match(app,/\[rooms,bookings,invoices,businessSettings,menu,restaurantBills,restaurantTables,maintenanceIssues,guests,backupStatus,closeAttention\]=snapshot/);
  assert.ok(app.indexOf('if(revision!==workspaceLoadRevision)return false')<
    app.indexOf('[rooms,bookings,invoices,businessSettings,menu,restaurantBills,restaurantTables,maintenanceIssues,guests,backupStatus,closeAttention]=snapshot'));
  assert.match(app,/\$\('#refresh-workspace'\)\.onclick=async\(\)=>/);
});
test('saved restaurant bills remain searchable without creating new bills',()=>{
  assert.match(html,/id="restaurant-history-search"/);
  assert.match(html,/id="restaurant-history-more"/);
  assert.match(app,/matched\.slice\(0,restaurantHistoryLimit\)/);
  assert.match(app,/restaurantHistoryLimit\+=20/);
  assert.match(app,/link\.href='\/api\/restaurant\/bills\/'/);
  assert.match(app,/Payment was recorded manually/);
  assert.match(app,/saved once\. '\+savedMessage/);
});
