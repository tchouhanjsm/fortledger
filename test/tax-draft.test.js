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
    const bytes=Buffer.from(await pdf.arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.subarray(0,5)),'%PDF-');
    const pages=(bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;
    assert.equal(pages,1,'Ordinary tax review drafts must fit on one A4 page with terms');
    assert.equal((await fetch(base+'/api/tax-invoices',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,404);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});

test('review-only draft supports a separately selected 18% accommodation illustration',()=>{
  const db=openDatabase(':memory:');
  try{
    const proforma=fixture(db,9000);
    const draft=prepareTaxDraft(db,proforma.id,{
      sac_codes:['996311'],tax_rates:[18],signatory_name:'Synthetic reviewer'});
    assert.equal(draft.snapshot.total_paise,1800000);
    assert.equal(draft.snapshot.taxable_paise,Math.round(1800000*100/118));
    assert.equal(draft.snapshot.gst_paise,1800000-draft.snapshot.taxable_paise);
    assert.equal(draft.snapshot.tax_breakdown.length,1);
    assert.equal(draft.snapshot.tax_breakdown[0].tax_rate,18);
    assert.equal(draft.snapshot.lines[0].tax_rate,18);
    assert.equal(draft.snapshot.readiness.ready,false);
    assert.ok(draft.snapshot.readiness.blockers.some(x=>x.includes('REVIEW ONLY')));
    assert.equal(getInvoice(db,proforma.id).snapshot.tax_rate,5,
      'Existing proforma presentation must not be rewritten by a tax review');
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='tax_invoices'").get().n,0);
    assert.throws(()=>prepareTaxDraft(db,proforma.id,{sac_codes:['996311'],tax_rates:[12]}),/5% or 18%/);
    assert.throws(()=>prepareTaxDraft(db,proforma.id,{sac_codes:['996311'],tax_rates:[]}),/required per proforma line/);
  }finally{db.close();}
});

test('mixed 5 and 18 percent draft independently reconciles every rate bucket',()=>{
  const db=openDatabase(':memory:');
  try{
    const booking=db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
      VALUES('Synthetic mixed-tax guest','2026-12-01','2026-12-02',2,'Unassigned',450000)`).run();
    const source=createProforma(db,Number(booking.lastInsertRowid),{lines:[
      {description:'Synthetic standard room',rooms:1,nights:1,rate:4500},
      {description:'Synthetic second room',rooms:1,nights:1,rate:4500}
    ]});
    const draft=prepareTaxDraft(db,source.id,{sac_codes:['996311','996311'],tax_rates:[5,18]});
    const snap=draft.snapshot;
    assert.equal(snap.tax_breakdown.length,2);
    assert.deepEqual(snap.tax_breakdown.map(x=>x.tax_rate),[5,18]);
    assert.equal(snap.tax_breakdown[0].taxable_paise,Math.round(450000*100/105));
    assert.equal(snap.tax_breakdown[1].taxable_paise,Math.round(450000*100/118));
    assert.equal(snap.total_paise,900000);
    assert.equal(snap.taxable_paise+snap.gst_paise,snap.total_paise);
    assert.equal(snap.cgst_paise+snap.sgst_paise,snap.gst_paise);
    assert.equal(snap.lines.reduce((sum,line)=>sum+line.taxable_paise,0),snap.taxable_paise);
    assert.equal(snap.lines.reduce((sum,line)=>sum+line.gst_paise,0),snap.gst_paise);
    assert.ok(snap.readiness.blockers.some(x=>x.includes('18% at or below')));
    assert.equal(snap.readiness.ready,false);
  }finally{db.close();}
});
