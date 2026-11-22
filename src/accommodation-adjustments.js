import {toPaise,bookingTotals} from './finance.js';
import {recordAudit} from './financial-audit.js';

/** Append-only commercial adjustment, not an issued GST invoice or rewrite of
 * a signed reservation proforma. A credit and a new charge are distinct events. */
export function ensureAccommodationAdjustmentSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS accommodation_adjustments(
    id INTEGER PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    amount_paise INTEGER NOT NULL CHECK(amount_paise != 0),
    kind TEXT NOT NULL CHECK(kind IN ('charge','credit')),
    reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 300),
    reference TEXT NOT NULL DEFAULT '',
    request_id TEXT NOT NULL UNIQUE,
    actor_username TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_accommodation_adjustments_booking
    ON accommodation_adjustments(booking_id,id);`);
}
export function listAccommodationAdjustments(db,bookingId){
  return db.prepare(`SELECT id,booking_id,amount_paise,kind,reason,reference,request_id,actor_username,created_at
    FROM accommodation_adjustments WHERE booking_id=? ORDER BY id`).all(bookingId);
}
export function adjustedAccommodation(db,booking,base=bookingTotals(booking)){
  const adjusted_paise=db.prepare(`SELECT COALESCE(SUM(amount_paise),0) AS amount
    FROM accommodation_adjustments WHERE booking_id=?`).get(booking.id).amount;
  const total=base.total_paise+adjusted_paise;
  if(!Number.isSafeInteger(total)||total<0)throw new Error('Invalid accommodation adjustment balance');
  return {...base,contract_total_paise:base.total_paise,adjustments_paise:adjusted_paise,
    total_paise:total,due_paise:Math.max(0,total-base.paid_paise),
    credit_paise:Math.max(0,base.paid_paise-total)};
}
export function recordAccommodationAdjustment(db,bookingId,input,actor){
  if(!Number.isSafeInteger(bookingId)||bookingId<1)throw new Error('Invalid booking ID');
  if(!actor||!['owner','manager'].includes(actor.role))throw new Error('Only owner or manager can approve accommodation adjustments');
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid adjustment');
  const {request_id,kind}=input;
  if(typeof request_id!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(request_id))
    throw new Error('Unique adjustment request ID required');
  if(!['charge','credit'].includes(kind))throw new Error('Choose accommodation charge or credit');
  const value=toPaise(input.amount);
  if(value<=0||value>100000000000)throw new Error('Adjustment must be between INR 0.01 and INR 1,000,000,000');
  const amount_paise=kind==='credit'?-value:value;
  if(typeof input.reason!=='string'||input.reason.trim().length<10||input.reason.trim().length>300)
    throw new Error('Accommodation adjustment reason must be 10–300 characters');
  const reason=input.reason.trim(),reference=typeof input.reference==='string'?input.reference.trim():'';
  if(reference.length>120)throw new Error('Adjustment reference too long');
  return db.transaction(()=>{
    const prior=db.prepare('SELECT * FROM accommodation_adjustments WHERE request_id=?').get(request_id);
    if(prior){
      if(prior.booking_id!==bookingId||prior.amount_paise!==amount_paise||
         prior.kind!==kind||prior.reason!==reason||prior.reference!==reference)
        throw new Error('Adjustment request ID already used with different details');
      return {...prior,already_recorded:true};
    }
    const booking=db.prepare('SELECT * FROM bookings WHERE id=?').get(bookingId);
    if(!booking)throw new Error('Booking not found');
    if(!['reserved','checked_in'].includes(booking.status))
      throw new Error('Cannot adjust completed or cancelled booking');
    if(!db.prepare("SELECT id FROM invoices WHERE booking_id=? AND kind='proforma'").get(bookingId))
      throw new Error('Issue the proforma first; prior to issuance edit the booking directly');
    const balance=adjustedAccommodation(db,{...booking,paid_paise:0});
    if(balance.total_paise+amount_paise<0)throw new Error('Credit exceeds outstanding contracted accommodation value');
    const row=db.prepare(`INSERT INTO accommodation_adjustments
      (booking_id,amount_paise,kind,reason,reference,request_id,actor_username)
      VALUES(?,?,?,?,?,?,?)`).run(bookingId,amount_paise,kind,reason,reference,request_id,actor.username);
    const id=Number(row.lastInsertRowid);
    recordAudit(db,actor,'accommodation.adjusted','booking',bookingId,{
      adjustment_id:id,amount_paise,kind,reason,reference,request_id,
      resulting_total_paise:balance.total_paise+amount_paise
    });
    return {...db.prepare('SELECT * FROM accommodation_adjustments WHERE id=?').get(id),
      already_recorded:false};
  })();
}