import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {getBusinessSettings,updateBusinessSettings} from '../src/business-settings.js';
import {gstReadiness} from '../src/gst-readiness.js';
import {createApp} from '../src/server.js';
import {createPasswordRecord} from '../src/auth.js';
import {createStaff} from '../src/staff.js';
import {requiredPermission,may} from '../src/access.js';
import {createProforma} from '../src/invoices.js';
import {prepareTaxDraft} from '../src/tax-draft.js';

test('GST supplier checks never treat trade name as legal supplier or authorize issuance',()=>{
  const db=openDatabase(':memory:');
  try{
    const original=getBusinessSettings(db);
    assert.equal(original.hotel_name,'Garh Jaisal');
    assert.equal(original.legal_name,'');
    const missing=gstReadiness(original);
    assert.equal(missing.status,'review_only');
    assert.equal(missing.statutory_issuance_enabled,false);
    assert.equal(missing.completed_local_fields,0);
    assert.ok(missing.accountant_reviews.some(item=>item.includes('restaurant')));
    const partial=updateBusinessSettings(db,{legal_name:'Example Registered Partnership',
      gstin:'08AAAAA0000A1Z5',address:'Example registered address, Rajasthan'});
    assert.equal(partial.hotel_name,'Garh Jaisal');
    assert.equal(getBusinessSettings(db).legal_name,'Example Registered Partnership');
    const report=gstReadiness(partial);
    assert.equal(report.completed_local_fields,4);
    assert.equal(report.statutory_issuance_enabled,false);
    assert.equal(report.checks.find(check=>check.key==='legal_name').complete,true);
    const otherState=gstReadiness({...partial,gstin:'27AAAAA0000A1Z5'});
    assert.equal(otherState.checks.find(check=>check.key==='rajasthan_gstin').complete,false);
    assert.throws(()=>updateBusinessSettings(db,{legal_name:'x'.repeat(161)}),/oversized/);
  }finally{db.close();}
});

test('review-only tax draft clearly flags legal supplier absence; proforma stays unchanged',()=>{
  const db=openDatabase(':memory:');
  try{
    updateBusinessSettings(db,{hotel_name:'Example Hotel',gstin:'08AAAAA0000A1Z5',
      address:'Synthetic registered address, Rajasthan'});
    const booking=db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
      VALUES('Synthetic guest','2026-12-01','2026-12-02',1,'Unassigned',450000)`).run();
    const source=createProforma(db,Number(booking.lastInsertRowid));
    const draft=prepareTaxDraft(db,source.id,{sac_codes:['996311'],signatory_name:'Synthetic signer'});
    assert.equal(draft.snapshot.readiness.ready,false);
    assert.ok(draft.snapshot.readiness.blockers.some(x=>x.includes('legal supplier name')));
    assert.equal(db.prepare('SELECT count(*) AS n FROM invoices').get().n,1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='tax_invoices'").get().n,0);
  }finally{db.close();}
});

test('GET /api/tax/readiness is manager/owner only, no write or issuance route',async()=>{
  assert.equal(requiredPermission('GET','/tax/readiness'),'tax.review');
  assert.equal(requiredPermission('POST','/tax/readiness'),null);
  assert.equal(may('manager','tax.review'),true);
  assert.equal(may('cashier','tax.review'),false);
  assert.equal(may('frontdesk','tax.review'),false);
  const db=openDatabase(':memory:');
  const ownerPass='synthetic-gst-strong-owner-password';
  for(const role of ['manager','cashier','frontdesk'])
    createStaff(db,{username:'gst-'+role,display_name:'GST '+role,role,
      password:'synthetic-gst-'+role+'-password'});
  const server=createApp(db,{authRecord:createPasswordRecord(ownerPass)}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const call=(path,{method='GET',body,cookie}={})=>fetch(base+path,{method,
    headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
    body:body===undefined?undefined:JSON.stringify(body)});
  async function login(username,password){
    const resp=await call('/api/auth/login',{method:'POST',body:{username,password}});
    assert.equal(resp.status,200);
    return resp.headers.get('set-cookie').split(';')[0];
  }
  try{
    assert.equal((await call('/api/tax/readiness')).status,401);
    const owner=await login('owner',ownerPass);
    const manager=await login('gst-manager','synthetic-gst-manager-password');
    const frontdesk=await login('gst-frontdesk','synthetic-gst-frontdesk-password');
    const cashier=await login('gst-cashier','synthetic-gst-cashier-password');
    for(const cookie of [owner,manager]){
      const resp=await call('/api/tax/readiness',{cookie});
      assert.equal(resp.status,200);
      const readiness=await resp.json();
      assert.equal(readiness.statutory_issuance_enabled,false);
      assert.equal(readiness.status,'review_only');
    }
    for(const cookie of [frontdesk,cashier])
      assert.equal((await call('/api/tax/readiness',{cookie})).status,403);
    assert.equal((await call('/api/tax/readiness',{cookie:owner,method:'POST',body:{}})).status,404);
    assert.equal((await call('/api/tax-invoices',{cookie:owner,method:'POST',body:{}})).status,404);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
