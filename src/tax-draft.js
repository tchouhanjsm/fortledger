import {getBusinessSettings} from './business-settings.js';
import {getInvoice} from './invoices.js';
import {getActiveLogoId} from './hotel-logo.js';

export function ensureTaxDraftSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS tax_invoice_drafts(
    id INTEGER PRIMARY KEY,
    proforma_id INTEGER NOT NULL UNIQUE REFERENCES invoices(id),
    snapshot TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}
const gstin=/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/;
function clean(value,max=200){
  if(value===undefined||value===null)return '';
  if(typeof value!=='string'||value.length>max)throw new Error('Invalid or oversized text field');
  return value.trim();
}
export function prepareTaxDraft(db,proformaId,input={}){
  if(!Number.isSafeInteger(proformaId)||proformaId<1)throw new Error('Invalid proforma ID');
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid draft options');
  const source=getInvoice(db,proformaId);
  if(!source||source.kind!=='proforma')throw new Error('Proforma invoice not found');
  const original=source.snapshot;
  const business=getBusinessSettings(db);
  const recipient_gstin=clean(input.recipient_gstin,15).toUpperCase();
  if(recipient_gstin&&!gstin.test(recipient_gstin))throw new Error('Recipient GSTIN format invalid');
  const recipient_address=clean(input.recipient_address??original.bill_to_address,500);
  const signatory_name=clean(input.signatory_name,120);
  const sourceLines=Array.isArray(original.lines)&&original.lines.length?original.lines:[{
    description:(original.category||'Accommodation')+' - '+(original.meal_plan||'CP')+' basis',
    rooms:original.rooms_count,nights:original.nights,rate_paise:original.nightly_rate_paise,total_paise:original.total_paise
  }];
  const sacCodes=input.sac_codes;
  if(!Array.isArray(sacCodes)||sacCodes.length!==sourceLines.length)
    throw new Error('One SAC code is required for every accommodation line');
  const blockers=[];
  if(!gstin.test(business.gstin||'')||!business.gstin.startsWith('08'))
    blockers.push('Rajasthan supplier GSTIN (08) must be configured and verified');
  if(!business.address)blockers.push('Registered supplier address is required');
  if(!recipient_address&&(recipient_gstin||original.total_paise>=5000000))
    blockers.push('Recipient address required for registered or higher-value recipient');
  if(!signatory_name)blockers.push('Authorized signatory name not provided');
  blockers.push('Actual signature, e-invoice applicability, and hotel tax treatment require professional verification before issuance');
  const lines=sourceLines.map((line,i)=>{
    const sac=clean(sacCodes[i],6);
    if(!['996311','996312'].includes(sac))throw new Error('Select hotel room or campsite SAC for every line');
    const taxableUnit=Math.round(line.rate_paise*100/105);
    if(taxableUnit>750000)blockers.push('Line '+(i+1)+' exceeds the 5% accommodation value threshold; rate must be reviewed');
    const taxable_paise=Math.round(line.total_paise*100/105);
    return {...line,sac,taxable_paise,gst_paise:line.total_paise-taxable_paise};
  });
  const total=lines.reduce((sum,line)=>sum+line.total_paise,0);
  if(total!==original.total_paise)throw new Error('Proforma line totals are inconsistent');
  const taxable_paise=Math.round(total*100/105),gst_paise=total-taxable_paise;
  const cgst_paise=Math.round(gst_paise/2),sgst_paise=gst_paise-cgst_paise;
  const snapshot={
    kind:'tax_draft',label:'DRAFT - NOT A GST TAX INVOICE',
    proforma_id:source.id,proforma_number:source.number,prepared_on:new Date().toISOString().slice(0,10),
    business,logo_asset_id:getActiveLogoId(db),recipient_name:original.bill_to,recipient_address,recipient_gstin,signatory_name,
    place_of_supply:'Rajasthan (08)',reverse_charge:false,
    guest_name:original.guest_name,checkin:original.checkin,checkout:original.checkout,
    lines,total_paise:total,taxable_paise,gst_paise,cgst_paise,sgst_paise,
    paid_paise:original.paid_paise,due_paise:Math.max(0,total-original.paid_paise),
    terms:original.terms,readiness:{ready:false,blockers}
  };
  return db.transaction(()=>{
    db.prepare(`INSERT INTO tax_invoice_drafts(proforma_id,snapshot) VALUES(?,?)
      ON CONFLICT(proforma_id) DO UPDATE SET snapshot=excluded.snapshot,updated_at=datetime('now')`)
      .run(proformaId,JSON.stringify(snapshot));
    const row=db.prepare('SELECT id FROM tax_invoice_drafts WHERE proforma_id=?').get(proformaId);
    return {id:row.id,proforma_id:proformaId,snapshot};
  })();
}
export function getTaxDraft(db,id){
  const row=db.prepare('SELECT * FROM tax_invoice_drafts WHERE id=?').get(id);
  return row?{...row,snapshot:JSON.parse(row.snapshot)}:null;
}
