const METHODS=['cash','upi','card','bank','unrecorded'];
const LOCAL_DATE="date(datetime(created_at,'+5 hours','+30 minutes'))";

function validateDay(value){
  if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)||
     !Number.isFinite(Date.parse(value+'T00:00:00Z'))||
     new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)
    throw new Error('Use a valid YYYY-MM-DD business date');
  return value;
}
function sourceAmounts(db,sql,date){
  return db.prepare(sql).all(date);
}
export function dailyCollections(db,date){
  date=validateDay(date);
  const sources={
    hotel_payments:sourceAmounts(db,`
      SELECT method,SUM(amount_paise) amount_paise,COUNT(*) count
      FROM payments WHERE ${LOCAL_DATE}=? GROUP BY method`,date),
    restaurant_direct:sourceAmounts(db,`
      SELECT payment_method method,SUM(total_paise) amount_paise,COUNT(*) count
      FROM restaurant_bills WHERE payment_method!='room' AND ${LOCAL_DATE}=?
      GROUP BY payment_method`,date),
    restaurant_settlements:sourceAmounts(db,`
      SELECT method,SUM(b.total_paise) amount_paise,COUNT(*) count
      FROM restaurant_settlements s JOIN restaurant_bills b ON b.id=s.restaurant_bill_id
      WHERE date(datetime(s.created_at,'+5 hours','+30 minutes'))=? GROUP BY method`,date),
    recorded_refunds:sourceAmounts(db,`
      SELECT method,SUM(amount_paise) amount_paise,COUNT(*) count
      FROM payment_refunds WHERE ${LOCAL_DATE}=? GROUP BY method`,date)
  };
  const by_method={};
  for(const method of METHODS)by_method[method]={
    hotel_paise:0,restaurant_paise:0,refund_paise:0,net_collected_paise:0,unverified_receipts:method==='unrecorded'
  };
  const knownSources=['hotel_payments','restaurant_direct','restaurant_settlements','recorded_refunds'];
  for(const source of knownSources){
    for(const row of sources[source]){
      if(!(row.method in by_method))throw new Error('Unknown ledger method requires review');
      const method=by_method[row.method];
      if(source==='hotel_payments')method.hotel_paise+=row.amount_paise;
      if(source==='restaurant_direct'||source==='restaurant_settlements')method.restaurant_paise+=row.amount_paise;
      if(source==='recorded_refunds')method.refund_paise+=row.amount_paise;
    }
  }
  for(const totals of Object.values(by_method))
    totals.net_collected_paise=totals.hotel_paise+totals.restaurant_paise-totals.refund_paise;
  const sum=key=>Object.values(by_method).reduce((total,m)=>total+m[key],0);
  const unmatched=db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(total_paise),0) AS amount_paise
    FROM restaurant_bills WHERE payment_method='room' AND booking_id IS NULL`).get();
  const unpaid=db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(b.total_paise),0) AS amount_paise
    FROM restaurant_bills b LEFT JOIN restaurant_settlements s ON s.restaurant_bill_id=b.id
    WHERE b.payment_method='room' AND s.id IS NULL`).get();
  return {
    business_date:date,timezone:'Asia/Kolkata',
    by_method,
    hotel_received_paise:sum('hotel_paise'),
    restaurant_received_paise:sum('restaurant_paise'),
    refunds_recorded_paise:sum('refund_paise'),
    net_collections_paise:sum('net_collected_paise'),
    unrecorded_method_paise:by_method.unrecorded.hotel_paise,
    current_unmatched_room_charges:unmatched,
    current_unpaid_room_charges:unpaid,
    notes:[
      'Cash/UPI/card/bank values are operator-recorded, not bank verified',
      'Refund events are recorded locally; actual transfer must be separately verified',
      'Unsettled room charges do not count as money collected',
      'This is a collections reconciliation, not a profit or GST revenue statement'
    ]
  };
}
