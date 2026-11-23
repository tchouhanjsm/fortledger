// Read-only operational correction estimate for immutable restaurant receipts.
// This is NOT a credit note, GST adjustment, refund, settlement or authorised
// correction. Source amounts come exclusively from the saved bill snapshot.
export function previewRestaurantCorrection(db,billId,input={}){
  if(!Number.isSafeInteger(billId)||billId<1)
    throw new Error('Invalid saved restaurant bill ID');
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('Invalid correction review');
  if(typeof input.reason!=='string'||input.reason.trim().length<10||input.reason.length>300)
    throw new Error('A correction reason of 10–300 characters is required');
  if(!Array.isArray(input.lines)||input.lines.length<1||input.lines.length>50)
    throw new Error('Choose the saved bill lines and quantities to review');

  const bill=db.prepare(`SELECT b.id,b.payment_method,b.booking_id,b.total_paise,
      b.tax_paise,b.items_snapshot,b.created_at,
      s.method AS settlement_method,s.created_at AS settled_at
    FROM restaurant_bills b LEFT JOIN restaurant_settlements s
      ON s.restaurant_bill_id=b.id WHERE b.id=?`).get(billId);
  if(!bill)throw new Error('Saved restaurant bill not found');
  const original=JSON.parse(bill.items_snapshot);
  if(!Array.isArray(original)||original.length<1)
    throw new Error('Saved bill item snapshot is incomplete');
  const ids=new Set();
  let creditGross=0,creditTax=0;
  const selected=input.lines.map(choice=>{
    if(!choice||typeof choice!=='object'||Array.isArray(choice)||
       !Number.isSafeInteger(choice.line_index)||choice.line_index<0||
       choice.line_index>=original.length||ids.has(choice.line_index))
      throw new Error('Select each original bill line exactly once');
    ids.add(choice.line_index);
    const line=original[choice.line_index];
    if(!Number.isSafeInteger(line.quantity)||line.quantity<1||
       !Number.isSafeInteger(line.unit_price_paise)||line.unit_price_paise<0||
       !Number.isSafeInteger(line.total_paise)||line.total_paise<0||
       !Number.isSafeInteger(line.tax_paise)||line.tax_paise<0||
       line.tax_paise>line.total_paise||
       line.total_paise!==line.unit_price_paise*line.quantity)
      throw new Error('Saved bill line amount is inconsistent; stop and reconcile manually');
    if(!Number.isSafeInteger(choice.quantity)||choice.quantity<1||
       choice.quantity>line.quantity)
      throw new Error('Correction quantity exceeds the original saved quantity');
    const gross_paise=line.unit_price_paise*choice.quantity;
    // Prorate the ACTUAL saved line tax, not the current menu tax/rate.
    // Full reversal returns the precise original stored tax, including rounding.
    const tax_paise=choice.quantity===line.quantity?line.tax_paise:
      Math.round(line.tax_paise*choice.quantity/line.quantity);
    if(!Number.isSafeInteger(gross_paise)||!Number.isSafeInteger(tax_paise)||
       tax_paise<0||tax_paise>gross_paise)
      throw new Error('Unsafe saved bill tax allocation');
    creditGross+=gross_paise;creditTax+=tax_paise;
    return {line_index:choice.line_index,menu_item_id:line.menu_item_id,
      name:line.name,original_quantity:line.quantity,
      correction_quantity:choice.quantity,original_tax_rate:line.tax_rate,
      gross_paise,tax_paise,taxable_paise:gross_paise-tax_paise};
  });
  if(!Number.isSafeInteger(creditGross)||!Number.isSafeInteger(creditTax)||
     creditGross>bill.total_paise||creditTax>bill.tax_paise)
    throw new Error('Correction exceeds the original saved bill');
  const sourceGross=original.reduce((sum,line)=>sum+line.total_paise,0);
  const sourceTax=original.reduce((sum,line)=>sum+line.tax_paise,0);
  if(sourceGross!==bill.total_paise||sourceTax!==bill.tax_paise)
    throw new Error('Saved bill snapshot and ledger differ; stop and reconcile manually');
  const method=bill.settlement_method||bill.payment_method;
  return {
    kind:'restaurant_correction_review',label:'ESTIMATE ONLY — NOT A GST CREDIT NOTE',
    source_bill_id:bill.id,source_bill_date:bill.created_at,
    source_payment_method:bill.payment_method,settlement_method:bill.settlement_method,
    source_booking_id:bill.booking_id,
    reason:input.reason.trim(),lines:selected,
    source_total_paise:bill.total_paise,source_tax_paise:bill.tax_paise,
    proposed_gross_paise:creditGross,proposed_tax_paise:creditTax,
    proposed_taxable_paise:creditGross-creditTax,
    remaining_gross_paise:bill.total_paise-creditGross,
    requires_payment_reconciliation:method!=='room',
    requires_room_folio_review:bill.payment_method==='room',
    gst_credit_note_issued:false,refund_sent:false,settlement_changed:false,
    saved_bill_changed:false,
    blockers:[
      'No statutory GST tax invoice reference exists for this restaurant receipt; accountant must decide the lawful document treatment',
      'Tax components, original invoice linkage, return reporting and eligibility require accountant verification',
      'Refund, payment and room folio adjustments must be separately authorised and reconciled'
    ]
  };
}
