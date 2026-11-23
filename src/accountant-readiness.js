import {historicalPdfInventory} from './historical-pdf-inventory.js';
import {gstReadiness} from './gst-readiness.js';
import {getBusinessSettings} from './business-settings.js';

// Source-linked review exceptions, not financial totals or a GST filing.
// Owner-only route authorization is enforced independently in access/server.
export function accountantReadiness(db,{limit=80}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>15000)
    throw new Error('Invalid accountant readiness limit');
  const inventory=historicalPdfInventory(db);
  const supplier=gstReadiness(getBusinessSettings(db));
  const issues=[];
  const add=(source,source_id,code,next_action,date_value='',date_semantics='')=>{
    issues.push({source,source_id,code,next_action,date_value,date_semantics,
      statutory_invoice_issued:false});
  };
  for(const check of supplier.checks){
    if(!check.complete)add('supplier_settings',null,'missing_'+check.key,
      'Owner: complete the local supplier field, then request independent accountant verification');
  }
  const originals=db.prepare(
    "SELECT e.id,h.reported_number,h.number_key,h.reported_issue_date,h.reported_financial_year "+
    "FROM external_invoice_originals e LEFT JOIN historical_pdf_identifications h ON h.id=("+
    "SELECT MAX(p.id) FROM historical_pdf_identifications p WHERE p.original_id=e.id) ORDER BY e.id"
  ).all();
  const collisions=new Map();
  for(const original of originals){
    if(!original.number_key)continue;
    const key=original.reported_financial_year+'\u0000'+original.number_key;
    collisions.set(key,(collisions.get(key)||0)+1);
  }
  for(const original of originals){
    if(!original.reported_number){
      add('historical_original',original.id,'printed_identifier_missing',
        'Owner: compare the actual PDF and enter its printed number and issue date');
      continue;
    }
    const key=original.reported_financial_year+'\u0000'+original.number_key;
    const date=original.reported_issue_date;
    if((collisions.get(key)||0)>1)add('historical_original',original.id,
      'possible_historical_number_collision',
      'Accountant: compare each original PDF and reconcile its legal FY number',date,
      'owner_reported_pdf_issue_date_unverified');
    if(original.reported_number.length>16||
       !/^[A-Za-z0-9/-]+$/.test(original.reported_number))
      add('historical_original',original.id,'historical_serial_format_review',
        'Accountant: inspect the printed original; do not change historic numbering automatically',
        date,'owner_reported_pdf_issue_date_unverified');
  }
  const cases=db.prepare(
    "SELECT c.id,c.hotel_business_date,c.snapshot_json,"+
    "(SELECT r.status FROM checkout_case_review_events r WHERE r.case_id=c.id "+
    "ORDER BY r.id DESC LIMIT 1) AS review_status "+
    "FROM checkout_document_cases c ORDER BY c.id DESC LIMIT 1000"
  ).all();
  const checkoutCount=db.prepare('SELECT COUNT(*) AS n FROM checkout_document_cases').get().n;
  for(const c of cases){
    let code='checkout_held_unreviewed';
    try{
      const snapshot=JSON.parse(c.snapshot_json);
      if(snapshot.exception||snapshot.preflight?.blockers?.some(b=>
        b.code==='proforma_contract_mismatch'))code='checkout_source_review_required';
      else if(!snapshot.preflight?.billing_recipient?.confirmed)
        code='checkout_recipient_unconfirmed';
    }catch{code='checkout_snapshot_unreadable';}
    if(c.review_status==='reviewed_for_accountant')code='checkout_accountant_signoff_pending';
    else if(c.review_status==='needs_source_review')code='checkout_source_review_required';
    add('checkout_case',c.id,code,
      c.review_status==='reviewed_for_accountant'?
        'Accountant: independently check dated tax policy, recipient, original PDF series and authority; NOT approved':
        'Owner/manager: inspect frozen checkout and live folio evidence; do not issue a GST invoice',
      c.hotel_business_date,'hotel_business_date_not_invoice_issue_date');
  }
  const corrections=db.prepare(
    "SELECT c.id,r.disposition FROM restaurant_correction_cases c "+
    "LEFT JOIN restaurant_correction_case_reviews r ON r.case_id=c.id "+
    "WHERE r.id IS NULL OR r.disposition='needs_accountant' ORDER BY c.id DESC LIMIT 1000"
  ).all();
  const correctionCount=db.prepare(
    "SELECT COUNT(*) AS n FROM restaurant_correction_cases c "+
    "LEFT JOIN restaurant_correction_case_reviews r ON r.case_id=c.id "+
    "WHERE r.id IS NULL OR r.disposition='needs_accountant'"
  ).get().n;
  for(const c of corrections)add('restaurant_correction',c.id,
    c.disposition==='needs_accountant'?'restaurant_accountant_review_pending':'restaurant_owner_review_pending',
    c.disposition==='needs_accountant'?
      'Accountant: determine whether a commercial credit/refund or tax treatment is required':
      'Owner: inspect the original saved receipt and record a review decision');
  // Global legal gates cannot be auto-cleared by operator-entered data.
  add('legal_policy',null,'historical_series_unverified',
    'Accountant: reconcile the complete external issued-PDF folder and historical FY series');
  add('legal_policy',null,'dated_tax_policy_unapproved',
    'Accountant: approve versioned supply-date GST rules, invoice authority and IRN obligations');
  const counts={
    missing_historical_identifiers:inventory.missing_number_or_date,
    possible_historical_collisions:inventory.potential_duplicate_originals,
    possible_historical_format_issues:inventory.possible_format_issues,
    checkout_review_cases:checkoutCount,
    checkout_staff_reviewed_cases:db.prepare(
      "SELECT COUNT(*) AS n FROM checkout_document_cases c WHERE ("+
      "SELECT r.status FROM checkout_case_review_events r WHERE r.case_id=c.id ORDER BY r.id DESC LIMIT 1)"+
      "='reviewed_for_accountant'").get().n,
    restaurant_corrections_pending:correctionCount,
    missing_supplier_local_fields:supplier.required_local_fields-supplier.completed_local_fields
  };
  return {
    kind:'accountant_readiness_v1',status:'review_only',statutory_issuance_enabled:false,
    accountant_approved:false,archive_completeness_verified:false,
    tax_policy_version_approved:false,financial_totals_included:false,
    counts,issues:issues.slice(0,limit),issue_count:issues.length+
      Math.max(0,checkoutCount-cases.length)+Math.max(0,correctionCount-corrections.length),
    truncated:issues.length>limit||checkoutCount>cases.length||correctionCount>corrections.length,
    note:'All source links are review candidates. Owner transcriptions and recorded payments are not proof of lawful invoice issuance, bank settlement or GST filing.'
  };
}
