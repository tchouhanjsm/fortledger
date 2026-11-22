import {dailyCollections} from './daily-collections.js';

const IST_HOURS=5*60+30;
const LOCAL_DATE="date(datetime(created_at,'+5 hours','+30 minutes'))";
const METHODS=['cash','upi','card'];
function amount(paise){
  if(!Number.isSafeInteger(paise)||paise<0)throw new Error('Invalid restaurant ledger amount');
  return Math.floor(paise/100)+'.'+String(paise%100).padStart(2,'0');
}
function hotelTimestamp(utc){
  if(typeof utc!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(utc))
    throw new Error('Invalid restaurant ledger timestamp');
  const epoch=Date.parse(utc.replace(' ','T')+'Z');
  if(!Number.isFinite(epoch))throw new Error('Invalid restaurant ledger timestamp');
  return new Date(epoch+IST_HOURS*60000).toISOString().slice(0,19).replace('T',' ');
}
function csvCell(value){
  let cell=String(value??'');
  // Protect future free-text columns from spreadsheet formula execution.
  if(/^[\s]*[=+\-@]/.test(cell))cell="'"+cell;
  return '"'+cell.replace(/"/g,'""')+'"';
}
function csvRow(values){return values.map(csvCell).join(',');}

/** A read-only event export, not a receipt confirmation or statutory tax report.
 * Room charge creation never counts as cash collected. If settled, the separate
 * settlement event counts only on its own IST business day. */
export function restaurantReconciliation(db,businessDate){
  const ledger=dailyCollections(db,businessDate); // validates real calendar date
  const day=ledger.business_date;
  const billed=db.prepare(`SELECT id,booking_id,created_at,payment_method,total_paise
    FROM restaurant_bills WHERE ${LOCAL_DATE}=? ORDER BY created_at,id`).all(day);
  const settled=db.prepare(`SELECT s.restaurant_bill_id AS id,b.booking_id,s.created_at,
      s.method AS payment_method,b.total_paise
    FROM restaurant_settlements s JOIN restaurant_bills b ON b.id=s.restaurant_bill_id
    WHERE date(datetime(s.created_at,'+5 hours','+30 minutes'))=?
      AND b.payment_method='room' ORDER BY s.created_at,s.id`).all(day);
  const events=[];
  const totals={direct_received_paise:0,room_settled_paise:0,
    room_charges_created_paise:0,recorded_received_paise:0,
    by_method:{cash:0,upi:0,card:0}};
  for(const row of billed){
    const direct=row.payment_method!=='room';
    if(direct&&!METHODS.includes(row.payment_method))
      throw new Error('Unknown direct restaurant payment method');
    if(!direct&&row.payment_method!=='room')throw new Error('Invalid room charge');
    amount(row.total_paise);
    if(direct){
      totals.direct_received_paise+=row.total_paise;
      totals.by_method[row.payment_method]+=row.total_paise;
    }else totals.room_charges_created_paise+=row.total_paise;
    events.push({kind:direct?'direct_bill_received':'room_charge_created',
      occurred_at:row.created_at,occurred_at_ist:hotelTimestamp(row.created_at),
      bill_id:row.id,booking_id:row.booking_id,method:direct?row.payment_method:'room',
      received_paise:direct?row.total_paise:0,
      room_charge_paise:direct?0:row.total_paise,
      reference_bill_total_paise:row.total_paise,
      classification:direct?'operator_recorded_not_bank_verified':'room_receivable_not_payment'});
  }
  for(const row of settled){
    if(!METHODS.includes(row.payment_method))throw new Error('Unknown restaurant settlement method');
    amount(row.total_paise);
    totals.room_settled_paise+=row.total_paise;
    totals.by_method[row.payment_method]+=row.total_paise;
    events.push({kind:'room_bill_settled',
      occurred_at:row.created_at,occurred_at_ist:hotelTimestamp(row.created_at),
      bill_id:row.id,booking_id:row.booking_id,method:row.payment_method,
      received_paise:row.total_paise,room_charge_paise:0,
      reference_bill_total_paise:row.total_paise,
      classification:'folio_recorded_not_bank_verified'});
  }
  totals.recorded_received_paise=totals.direct_received_paise+totals.room_settled_paise;
  if(!Number.isSafeInteger(totals.recorded_received_paise)||
     totals.recorded_received_paise!==ledger.restaurant_received_paise)
    throw new Error('Restaurant reconciliation differs from the daily ledger; review before export');
  events.sort((a,b)=>a.occurred_at.localeCompare(b.occurred_at)||
    a.bill_id-b.bill_id||a.kind.localeCompare(b.kind));
  const columns=['business_date','occurred_at_ist','event_type','bill_id','booking_id',
    'method','recorded_received_inr','room_charge_created_inr',
    'reference_bill_total_inr_not_to_sum','classification'];
  const csv='\uFEFF'+csvRow(columns)+'\r\n'+events.map(event=>csvRow([
    day,event.occurred_at_ist,event.kind,event.bill_id,event.booking_id??'',
    event.method,amount(event.received_paise),amount(event.room_charge_paise),
    amount(event.reference_bill_total_paise),event.classification
  ])).join('\r\n')+(events.length?'\r\n':'');
  return {business_date:day,timezone:'Asia/Kolkata',
    filename:'fortledger-restaurant-'+day+'.csv',
    records:events,totals,csv,
    note:'Operator-recorded amounts only; unverified by bank, not profit or a GST invoice'};
}
