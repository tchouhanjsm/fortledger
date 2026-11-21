import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {updateBusinessSettings} from '../src/business-settings.js';
import {prepareTaxDraft,getTaxDraft} from '../src/tax-draft.js';
import {createProforma,getInvoice} from '../src/invoices.js';

function fixture(db,rate=4500){
  const b=db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
    VALUES('Synthetic Awaita','2026-12-01','2026-12-02',2,'Unassigned',?)`).run(rate*100);
  return createProforma(db,Number(b.lastInsertRowid));
}
test('review-only tax draft preserves the source and never reserves a legal tax invoice number',()=>{
  const db=openDatabase(':memory:');
  try{
    updateBusinessSettings(db,{hotel_name:'Sample Fort',address:'Sample street, Rajasthan',
      gstin:'08AAAAA0000A1Z5'});
    const proforma=fixture(db);
    const input={recipient_address:'Company sample address',signatory_name:'Sample Signatory',
      sac_codes:['996311']};
    const draft=prepareTaxDraft(db,proforma.id,input);
    assert.equal(draft.snapshot.kind,'tax_draft');
    assert.equal(draft.snapshot.readiness.ready,false);
    assert.ok(draft.snapshot.readiness.blockers.some(x=>x.includes('signature')));
    assert.equal(draft.snapshot.total_paise,900000);
    assert.equal(draft.snapshot.taxable_paise,857143);
    assert.equal(draft.snapshot.gst_paise,42857);
    assert.equal(draft.snapshot.cgst_paise+draft.snapshot.sgst_paise,42857);
    assert.equal(draft.snapshot.lines[0].sac,'996311');
    assert.equal(draft.snapshot.business.gstin,'08AAAAA0000A1Z5');
    const changed=prepareTaxDraft(db,proforma.id,{...input,sac_codes:['996312']});
    assert.equal(changed.id,draft.id);
    assert.equal(getTaxDraft(db,draft.id).snapshot.lines[0].sac,'996312');
    assert.equal(getInvoice(db,proforma.id).snapshot.kind,'proforma');
    assert.equal(db.prepare('SELECT last_number FROM invoice_sequence WHERE id=1').get().last_number,1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='tax_invoices'").get().n,0);
  }finally{db.close();}
});
test('tax preview warns for out-of-scope 5% rates and rejects invalid SAC codes',()=>{
  const db=openDatabase(':memory:');
  try{
    const high=fixture(db,9000);
    const draft=prepareTaxDraft(db,high.id,{sac_codes:['996311']});
    assert.ok(draft.snapshot.readiness.blockers.some(x=>x.includes('5% accommodation value threshold')));
    assert.ok(draft.snapshot.readiness.blockers.some(x=>x.includes('GSTIN')));
    assert.throws(()=>prepareTaxDraft(db,high.id,{sac_codes:['WRONG']}),/SAC/);
    assert.throws(()=>prepareTaxDraft(db,high.id,{sac_codes:[]}),/One SAC/);
    assert.throws(()=>prepareTaxDraft(db,high.id,{sac_codes:['996311'],recipient_gstin:'bad'}),/GSTIN/);
  }finally{db.close();}
});
test('authenticated application can download tax draft PDF; no issued-tax endpoint exists',async()=>{
  const db=openDatabase(':memory:'),app=createApp(db),server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const proforma=fixture(db);
    const created=await fetch(base+'/api/invoices/'+proforma.id+'/tax-draft',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({sac_codes:['996311'],signatory_name:'Sample'})
    });
    assert.equal(created.status,201);
    const draft=await created.json();
    const pdf=await fetch(base+'/api/tax-drafts/'+draft.id+'/pdf');
    assert.equal(pdf.status,200);
    assert.match(pdf.headers.get('content-type'),/application\/pdf/);
    assert.equal(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0,5)),'%PDF-');
    assert.equal((await fetch(base+'/api/tax-invoices',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,404);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
