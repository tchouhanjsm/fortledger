// Accountant handoff register of owner-reported historical PDF identifiers.
// This is NOT an accountant certification or a tax return, and it never
// reads PDF bytes into the export or issues a legal invoice.
const LIMIT=10000;
const HEADERS=[
  'Archive ID','Original filename','SHA256','Imported UTC',
  'Owner-reported invoice number (UNVERIFIED)','Owner-reported issue date (UNVERIFIED)',
  'Reported Indian FY','Possible booking ID (UNVERIFIED)',
  'Other PDFs with matching FY number','Serial format review',
  'Original identifier entry ID','Audit status'
];
function records(db){
  const count=db.prepare('SELECT COUNT(*) AS n FROM external_invoice_originals').get().n;
  if(count>LIMIT)throw new Error('Archive exceeds reviewed CSV size limit; export in approved batches');
  return db.prepare(`SELECT e.id AS original_id,e.original_filename,e.sha256,e.imported_at,
    h.id AS identification_id,h.reported_number,h.number_key,h.reported_issue_date,
    h.reported_financial_year,h.booking_candidate_id
    FROM external_invoice_originals e
    LEFT JOIN historical_pdf_identifications h ON h.id=(
      SELECT MAX(prev.id) FROM historical_pdf_identifications prev
      WHERE prev.original_id=e.id)
    ORDER BY e.id ASC`).all();
}
function annotate(rows){
  const counts=new Map();
  for(const row of rows){
    if(!row.identification_id)continue;
    const key=row.reported_financial_year+'\u0000'+row.number_key;
    counts.set(key,(counts.get(key)||0)+1);
  }
  return rows.map(row=>{
    const key=row.reported_financial_year+'\u0000'+row.number_key;
    const duplicates=row.identification_id?Math.max(0,(counts.get(key)||0)-1):0;
    const badFormat=row.identification_id&&(
      row.reported_number.length>16||!/^[A-Za-z0-9/-]+$/.test(row.reported_number));
    return {
      ...row,other_matching_fy_number:duplicates,
      serial_format_review:!row.identification_id?'missing':
        badFormat?'format_review':'no_obvious_format_flag',
      status:'OWNER_REPORTED_UNVERIFIED_NOT_TAX_ISSUED'
    };
  });
}
export function historicalPdfInventory(db){
  const rows=annotate(records(db));
  const reported=rows.filter(row=>row.identification_id);
  const collisions=rows.filter(row=>row.other_matching_fy_number>0);
  const flagged=rows.filter(row=>row.serial_format_review==='format_review');
  return {
    kind:'accountant_historical_pdf_inventory',
    label:'OWNER-REPORTED HISTORY — NOT VERIFIED GST INVOICES',
    total_imported_originals:rows.length,
    transcribed_originals:reported.length,
    missing_number_or_date:rows.length-reported.length,
    potential_duplicate_originals:collisions.length,
    possible_format_issues:flagged.length,
    inventory_complete:false,
    external_folder_scanned:false,
    accountant_approved:false,
    statutory_issuance_enabled:false,
    note:'CSV is a reconciliation worksheet only. The app cannot confirm that every old online-generator invoice has been imported or that transcribed details match PDF contents.'
  };
}
function csvCell(value){
  let text=String(value??'');
  // Excel/LibreOffice will interpret formula-like cell prefixes even in a
  // quoted CSV field. Neutralize at the cell level, not by altering the DB.
  if(/^[=+\-@\t\r\n]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
export function historicalPdfInventoryCsv(db){
  const rows=annotate(records(db));
  const output=[HEADERS, ...rows.map(row=>[
    row.original_id,row.original_filename,row.sha256,row.imported_at,
    row.reported_number||'',row.reported_issue_date||'',
    row.reported_financial_year||'',row.booking_candidate_id??'',
    row.other_matching_fy_number,row.serial_format_review,
    row.identification_id??'',row.status
  ])].map(line=>line.map(csvCell).join(','));
  return '\uFEFF'+output.join('\r\n')+'\r\n';
}
