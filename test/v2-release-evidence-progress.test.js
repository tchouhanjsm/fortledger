import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PHYSICAL_RELEASE_GATES,releaseReadiness} from '../src/release-readiness.js';
import {evidenceTemplate,inspectEvidenceManifest,loadReleaseEvidence} from '../src/release-evidence.js';
import {openDatabase} from '../src/database.js';
import {diagnose} from '../src/doctor.js';
import {savePasswordRecord} from '../src/auth.js';

const diagnostics={checks:[{name:'SQLite integrity',status:'pass',detail:'ok'}],
  summary:{passed:1,failed:0,warnings:0}};
const now=new Date('2026-11-22T08:00:00Z');
function attested(){
  const template=evidenceTemplate(PHYSICAL_RELEASE_GATES);
  for(const [id,entry] of Object.entries(template.gates)){
    Object.assign(entry,{result:'passed',performed_on:'2026-11-21',
      performed_by:'Hotel Technician',reviewed_by:'Independent Reviewer',
      reference:'private acceptance log '+id});
  }
  return template;
}
test('evidence defaults to pending without fabricating a physical release',()=>{
  const manifest=evidenceTemplate(PHYSICAL_RELEASE_GATES);
  assert.equal(manifest.schema_version,1);
  assert.equal(Object.keys(manifest.gates).length,6);
  assert.ok(PHYSICAL_RELEASE_GATES.every(g=>manifest.gates[g.id].result==='pending'));
  const result=releaseReadiness({diagnostics,evidenceFile:null,now});
  assert.equal(result.verdict,'NOT RELEASED');
  assert.equal(result.evidence.attested,0);
  assert.equal(result.physical_gates.length,6);
  assert.ok(result.physical_gates.every(g=>g.status==='PENDING HUMAN VERIFICATION'));
});
test('all six reviewed proofs remain human assertions and cannot auto-certify launch',()=>{
  const base=attested();
  const inspected=inspectEvidenceManifest(base,PHYSICAL_RELEASE_GATES,{now});
  assert.equal(inspected.valid,true);
  assert.equal(Object.values(inspected.entries).filter(x=>x.status.startsWith('OPERATOR ATTESTED')).length,6);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-proof-'));
  try{
    const file=path.join(dir,'release.json');fs.writeFileSync(file,JSON.stringify(base));
    const result=releaseReadiness({diagnostics,evidenceFile:file,now});
    assert.equal(result.evidence.attested,6);
    assert.equal(result.evidence.valid,true);
    assert.equal(result.verdict,'NOT RELEASED');
    assert.equal(result.production_ready,false);
    assert.match(result.next_step,/independent owner release review/);
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE GUEST|account_number/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('future-dated, single-person, missing and malformed release claims never count',()=>{
  const future=attested();
  future.gates.epson_paper_output.performed_on='2035-01-01';
  future.gates.gst_accountant_signoff.reviewed_by='Hotel Technician';
  future.gates.replacement_device_restore.reference='';
  const validated=inspectEvidenceManifest(future,PHYSICAL_RELEASE_GATES,{now});
  assert.equal(validated.valid,false);
  assert.equal(Object.values(validated.entries).filter(x=>x.status.startsWith('OPERATOR ATTESTED')).length,3);
  future.gates.staff_lan_security.result='approved';
  future.gates.stranger={result:'passed'};
  assert.equal(inspectEvidenceManifest(future,PHYSICAL_RELEASE_GATES,{now}).valid,false);
  assert.equal(inspectEvidenceManifest({schema_version:99},PHYSICAL_RELEASE_GATES,{now}).valid,false);
});
test('a private absolute file is required; missing path and source checkout references fail safely',()=>{
  assert.equal(loadReleaseEvidence('relative.json',PHYSICAL_RELEASE_GATES).valid,false);
  assert.equal(loadReleaseEvidence('/nonexistent/fortledger/release.json',PHYSICAL_RELEASE_GATES).valid,false);
  assert.equal(loadReleaseEvidence(path.join(process.cwd(),'release.json'),
    PHYSICAL_RELEASE_GATES).valid,false);
});
test('doctor detects missing v10 settlement table, not just obsolete v8 restaurant tables',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fortledger-doc-v10-'));
  let db;
  try{
    const file=path.join(dir,'hotel.sqlite'),auth=path.join(dir,'auth.json');
    db=openDatabase(file);
    savePasswordRecord(auth,'synthetic doctor owner password 1234');
    assert.equal(diagnose({databaseFile:file,authFile:auth,env:{}}).checks
      .find(x=>x.name==='Application schema').status,'pass');
    db.exec('DROP TABLE folio_settlement_requests');
    const status=diagnose({databaseFile:file,authFile:auth,env:{}}).checks
      .find(x=>x.name==='Application schema');
    assert.equal(status.status,'fail');
    assert.match(status.detail,/folio_settlement_requests/);
  }finally{db?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
