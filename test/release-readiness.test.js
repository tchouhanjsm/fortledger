import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseReadiness,PHYSICAL_RELEASE_GATES} from '../src/release-readiness.js';

test('automated diagnostics alone cannot certify real-device or statutory release',()=>{
  const report=releaseReadiness({diagnostics:{
    checks:[{name:'SQLite integrity',status:'pass',detail:'ok'}],
    summary:{passed:1,failed:0,warnings:0},healthy:true,production_ready:false
  }});
  assert.equal(report.verdict,'NOT RELEASED');
  assert.equal(report.production_ready,false);
  assert.equal(report.automated.failed,0);
  assert.equal(report.physical_gates.length,5);
  assert.ok(report.physical_gates.every(g=>g.status==='PENDING HUMAN VERIFICATION'));
  assert.ok(report.physical_gates.some(g=>g.id==='gst_accountant_signoff'));
  assert.ok(report.physical_gates.some(g=>g.id==='replacement_device_restore'));
  assert.ok(report.physical_gates.some(g=>g.id==='epson_paper_output'));
});
test('release report preserves failing diagnostics without sensitive payloads',()=>{
  const report=releaseReadiness({diagnostics:{
    checks:[{name:'Encrypted backup integrity',status:'fail',detail:'Cannot verify encrypted snapshot'},
      {name:'SQLite integrity',status:'pass',detail:'ok'}],
    summary:{passed:1,failed:1,warnings:0},healthy:false,production_ready:false
  }});
  assert.equal(report.production_ready,false);
  assert.equal(report.blocking_items.length,1);
  assert.equal(report.blocking_items[0].status,'fail');
  assert.deepEqual(PHYSICAL_RELEASE_GATES.map(g=>g.id),[
    'replacement_device_restore','epson_paper_output','gst_accountant_signoff',
    'frontdesk_device_qa','offsite_backup_isolation'
  ]);
});
