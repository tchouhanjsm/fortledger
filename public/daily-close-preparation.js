/** Read-only day-close preparation derived from the authoritative daily ledger.
 * Figures are operator-recorded, never independently bank verified. */
export function prepareDailyClosing(report){
  if(!report||!/^\d{4}-\d{2}-\d{2}$/.test(String(report.business_date))||
     report.timezone!=='Asia/Kolkata'||!report.by_method)
    throw new Error('Valid IST daily ledger is required for closing preparation');
  const methods=['cash','upi','card','bank','unrecorded'];
  const cols=['hotel_paise','restaurant_paise','refund_paise','expense_paise','net_collected_paise'];
  const totals=Object.fromEntries(cols.map(k=>[k,0]));
  const lines=methods.map(method=>{
    const source=report.by_method[method];
    if(!source)throw new Error('Missing '+method+' closing ledger method');
    const line={method};
    for(const field of cols){
      const value=source[field];
      if(!Number.isSafeInteger(value)||(field!=='net_collected_paise'&&value<0))
        throw new Error('Invalid amount for '+method+' / '+field);
      line[field]=value;
      totals[field]+=value;
      if(!Number.isSafeInteger(totals[field]))
        throw new Error('Closing preparation amount exceeds supported range');
    }
    if(line.net_collected_paise!==line.hotel_paise+line.restaurant_paise-line.refund_paise)
      throw new Error('Method receipts do not reconcile: '+method);
    line.net_movement_paise=line.net_collected_paise-line.expense_paise;
    return line;
  });
  const checks=[
    ['hotel_received_paise','hotel_paise'],
    ['restaurant_received_paise','restaurant_paise'],
    ['refunds_recorded_paise','refund_paise'],
    ['expenses_paid_paise','expense_paise'],
    ['net_collections_paise','net_collected_paise']
  ];
  for(const [reported,computed] of checks){
    if(report[reported]!==totals[computed])
      throw new Error('Daily ledger mismatch: '+reported);
  }
  if(report.net_cash_movement_paise!==totals.net_collected_paise-totals.expense_paise)
    throw new Error('Daily ledger mismatch: net cash movement');
  if(report.unrecorded_method_paise!==lines[4].hotel_paise)
    throw new Error('Daily ledger mismatch: legacy unrecorded methods');
  const unmatched=report.current_unmatched_room_charges;
  const unpaid=report.current_unpaid_room_charges;
  if(!unmatched||!unpaid||!Number.isSafeInteger(unmatched.count)||
     !Number.isSafeInteger(unpaid.count)||unmatched.count<0||unpaid.count<0||
     !Number.isSafeInteger(unmatched.amount_paise)||
     !Number.isSafeInteger(unpaid.amount_paise)||
     unmatched.amount_paise<0||unpaid.amount_paise<0)
    throw new Error('Room-charge review totals unavailable');
  const warnings=[];
  if(unmatched.count)
    warnings.push(unmatched.count+' unmatched room charge(s) require guest verification');
  if(unpaid.count)
    warnings.push(unpaid.count+' unsettled room charge(s) remain receivables (not collected)');
  if(report.unrecorded_method_paise>0)
    warnings.push('Legacy payments with unrecorded method require staff review');
  return {
    business_date:report.business_date,timezone:report.timezone,methods:lines,totals,
    cash_net_movement_paise:lines[0].net_movement_paise,
    unmatched_room_charges:{...unmatched},unpaid_room_charges:{...unpaid},
    warnings,
    disclaimer:'All payment methods are operator-recorded, not bank-confirmed; this is not profit, statutory revenue or an issued GST invoice.'
  };
}
