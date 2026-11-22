import { randomUUID,createHash } from 'node:crypto';
import { bookingTotals } from './finance.js';
import { NET_PAYMENTS_SQL } from './payment-ledger.js';
import {recordAudit} from './financial-audit.js';

/** v10: the write and its response marker commit together; old settlements are
 * never backfilled or inferred from an unrelated historical group UUID. */
export function ensureFolioSettlementRequestSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS folio_settlement_requests(
    request_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('combined','room_bill')),
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    fingerprint TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}
function executeOnce(db,{requestId,kind,bookingId,billId,method,accommodationMethod,reference},write){
  if(requestId!==undefined&&
    (typeof requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)))
    throw new Error('Invalid folio settlement request ID');
  const fingerprint=requestId?createHash('sha256').update(JSON.stringify({
    kind,booking_id:bookingId,bill_id:billId??null,method,
    accommodation_method:accommodationMethod??null,bank_reference:reference??''
  })).digest('hex'):null;
  return db.transaction(()=>{
    if(requestId){
      const prior=db.prepare('SELECT fingerprint,response_json FROM folio_settlement_requests WHERE request_id=?').get(requestId);
      if(prior){
        if(prior.fingerprint!==fingerprint)
          throw new Error('Folio settlement request ID already used with different details');
        return {...JSON.parse(prior.response_json),already_recorded:true};
      }
    }
    const result=write();
    if(requestId)db.prepare(`INSERT INTO folio_settlement_requests
      (request_id,kind,booking_id,fingerprint,response_json) VALUES(?,?,?,?,?)`)
      .run(requestId,kind,bookingId,fingerprint,JSON.stringify(result));
    return {...result,already_recorded:false};
  })();
}
const METHODS=['cash','upi','card'];
function validMethod(method){if(!METHODS.includes(method))throw new Error('Choose cash, UPI, or card');return method;}
function getBooking(db,id){
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Invalid booking ID');
  const booking=db.prepare(`
    SELECT b.*, ${NET_PAYMENTS_SQL} AS paid_paise
    FROM bookings b WHERE b.id=?`).get(id);
  if(!booking)throw new Error('Booking not found');
  return booking;
}
/** Existing issued snapshots are immutable. Detect historic mismatches explicitly
 * rather than pretending the current booking receivable agrees with an old PDF. */
function invoiceContractMismatch(db,bookingId,contractTotal){
  const issued=db.prepare("SELECT id,number,snapshot FROM invoices WHERE booking_id=? AND kind='proforma'").get(bookingId);
  if(!issued)return null;
  let total;
  try{total=JSON.parse(issued.snapshot).total_paise;}catch{total=null;}
  if(total===contractTotal)return null;
  return {invoice_id:issued.id,invoice_number:issued.number,
    proforma_total_paise:Number.isSafeInteger(total)?total:null,
    booking_total_paise:contractTotal};
}
function roomBills(db,bookingId){
  return db.prepare(`
    SELECT b.id,b.total_paise,b.tax_paise,b.created_at,s.id AS settlement_id,s.method AS settlement_method,
      s.created_at AS settled_at
    FROM restaurant_bills b LEFT JOIN restaurant_settlements s ON s.restaurant_bill_id=b.id
    WHERE b.booking_id=? AND b.payment_method='room' ORDER BY b.id`).all(bookingId);
}
export function getGuestFolio(db,bookingId){
  const booking=getBooking(db,bookingId);
  const accommodation=bookingTotals(booking);
  const invoice_discrepancy=invoiceContractMismatch(db,bookingId,accommodation.total_paise);
  const bills=roomBills(db,bookingId);
  const restaurant_due_paise=bills.filter(x=>!x.settlement_id).reduce((sum,x)=>sum+x.total_paise,0);
  return {booking_id:bookingId,guest_name:booking.guest_name,status:booking.status,
    accommodation,bills,invoice_discrepancy,restaurant_due_paise,
    combined_due_paise:accommodation.due_paise+restaurant_due_paise};
}
export function settleRoomBill(db,bookingId,billId,method,actor=null,{request_id}={}){
  validMethod(method);
  return executeOnce(db,{requestId:request_id,kind:'room_bill',bookingId,billId,method},()=>{
    const booking=getBooking(db,bookingId);
    if(booking.status==='cancelled')throw new Error('Cancelled booking cannot be settled');
    const bill=roomBills(db,bookingId).find(b=>b.id===billId);
    if(!bill)throw new Error('Room bill not found for booking');
    if(bill.settlement_id)throw new Error('Room bill already settled');
    const group=randomUUID();
    db.prepare(`INSERT INTO restaurant_settlements(restaurant_bill_id,method,settlement_group)
      VALUES(?,?,?)`).run(billId,method,group);
    if(actor)recordAudit(db,actor,'settlement.recorded','restaurant_settlement',billId,
      {booking_id:bookingId,amount_paise:bill.total_paise,method,settlement_group:group});
    return {restaurant_bill_id:billId,settled_paise:bill.total_paise,method,settlement_group:group};
  });
}
export function settleCombined(db,bookingId,method,actor=null,{
  accommodation_method=method,bank_reference='',request_id
}={}){
  // Restaurant settlement remains cash/UPI/card. Accommodation can use an
  // independently reconciled bank transfer, with a mandatory human reference.
  validMethod(method);
  if(!['cash','upi','card','bank'].includes(accommodation_method))
    throw new Error('Choose an accommodation settlement method');
  if(typeof bank_reference!=='string'||bank_reference.length>100)
    throw new Error('Invalid bank transfer reference');
  const reference=bank_reference.trim();
  if(accommodation_method==='bank'&&!/^[A-Za-z0-9/_ .-]{5,80}$/.test(reference))
    throw new Error('Bank transfer needs a reference (5–80 characters) for reconciliation');
  return executeOnce(db,{requestId:request_id,kind:'combined',bookingId,method,
    accommodationMethod:accommodation_method,reference},()=>{
    const folio=getGuestFolio(db,bookingId);
    if(folio.status==='cancelled')throw new Error('Cancelled booking cannot be settled');
    if(folio.invoice_discrepancy)throw new Error('Proforma and booking totals disagree; manager review required before combined settlement');
    if(folio.combined_due_paise===0)throw new Error('No outstanding amount');
    const group=randomUUID();
    const amount=folio.accommodation.due_paise;
    if(amount>0){
      const payment=db.prepare('INSERT INTO payments(booking_id,amount_paise,note,method) VALUES(?,?,?,?)')
        .run(bookingId,amount,'Combined checkout settlement '+group+
          (accommodation_method==='bank'?' · Bank ref: '+reference:''),accommodation_method);
      if(actor)recordAudit(db,actor,'payment.recorded','payment',Number(payment.lastInsertRowid),
        {booking_id:bookingId,amount_paise:amount,method:accommodation_method,settlement_group:group,
          ...(accommodation_method==='bank'?{bank_reference:reference}:{})});
    }
    let count=0;
    const insert=db.prepare(`INSERT INTO restaurant_settlements(restaurant_bill_id,method,settlement_group)
      VALUES(?,?,?)`);
    for(const bill of folio.bills.filter(b=>!b.settlement_id)){
      insert.run(bill.id,method,group);count++;
      if(actor)recordAudit(db,actor,'settlement.recorded','restaurant_settlement',bill.id,
        {booking_id:bookingId,amount_paise:bill.total_paise,method,settlement_group:group});
    }
    return {booking_id:bookingId,settlement_group:group,method,accommodation_method,
      accommodation_paid_paise:amount,restaurant_paid_paise:folio.restaurant_due_paise,
      total_paid_paise:folio.combined_due_paise,restaurant_bills_settled:count};
  });
}
