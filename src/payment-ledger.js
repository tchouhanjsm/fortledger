import { toPaise } from './finance.js';
import {recordAudit} from './financial-audit.js';

/**
 * Refunds are locally recorded events; the operator must separately execute
 * the actual bank/cash/UPI refund. Original payments remain immutable.
 */
export function ensureRefundSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_refunds (
      id INTEGER PRIMARY KEY,
      booking_id INTEGER NOT NULL REFERENCES bookings(id),
      payment_id INTEGER NOT NULL REFERENCES payments(id),
      amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
      method TEXT NOT NULL CHECK(method IN ('cash','upi','card','bank')),
      reason TEXT NOT NULL CHECK(length(reason) BETWEEN 3 AND 300),
      request_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_payment_refunds_payment ON payment_refunds(payment_id);
    CREATE INDEX IF NOT EXISTS idx_payment_refunds_booking ON payment_refunds(booking_id);
  `);
}
export const NET_PAYMENTS_SQL = `
  COALESCE((SELECT SUM(p.amount_paise) FROM payments p WHERE p.booking_id=b.id),0)
  - COALESCE((SELECT SUM(r.amount_paise) FROM payment_refunds r WHERE r.booking_id=b.id),0)
`;

export function paymentHistory(db,bookingId){
  const booking=db.prepare('SELECT id FROM bookings WHERE id=?').get(bookingId);
  if(!booking)throw new Error('Booking not found');
  const payments=db.prepare(`
    SELECT p.id,p.amount_paise,p.method,p.note,p.created_at,
      COALESCE((SELECT SUM(r.amount_paise) FROM payment_refunds r WHERE r.payment_id=p.id),0) AS refunded_paise
    FROM payments p WHERE p.booking_id=? ORDER BY p.id
  `).all(bookingId);
  const refunds=db.prepare(`SELECT id,payment_id,amount_paise,method,reason,request_id,created_at
    FROM payment_refunds WHERE booking_id=? ORDER BY id`).all(bookingId);
  return {payments,refunds,net_paid_paise:payments.reduce((sum,p)=>sum+p.amount_paise-p.refunded_paise,0)};
}
export function recordRefund(db,bookingId,paymentId,input,actor=null){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid refund details');
  if(!Number.isSafeInteger(bookingId)||bookingId<1||
     !Number.isSafeInteger(paymentId)||paymentId<1)throw new Error('Invalid payment ID');
  const requestId=input.request_id;
  if(typeof requestId!=='string'||!(/^[A-Za-z0-9_-]{16,80}$/).test(requestId))
    throw new Error('A unique refund request ID is required');
  const method=String(input.method||'');
  if(!['cash','upi','card','bank'].includes(method))throw new Error('Choose a refund method');
  const reason=String(input.reason||'').trim();
  if(reason.length<3||reason.length>300)throw new Error('Refund reason must be 3–300 characters');
  const amount=toPaise(input.amount);
  if(amount<=0)throw new Error('Refund amount must exceed zero');
  return db.transaction(()=>{
    const existing=db.prepare('SELECT * FROM payment_refunds WHERE request_id=?').get(requestId);
    if(existing){
      if(existing.booking_id!==bookingId||existing.payment_id!==paymentId||existing.amount_paise!==amount||
        existing.method!==method||existing.reason!==reason)
        throw new Error('Refund request ID is already used for different details');
      return {...existing,already_recorded:true};
    }
    const payment=db.prepare('SELECT id,amount_paise FROM payments WHERE id=? AND booking_id=?')
      .get(paymentId,bookingId);
    if(!payment)throw new Error('Payment not found for this booking');
    const refunded=db.prepare('SELECT COALESCE(SUM(amount_paise),0) AS total FROM payment_refunds WHERE payment_id=?')
      .get(paymentId).total;
    if(amount>payment.amount_paise-refunded)throw new Error('Refund exceeds remaining original payment');
    const result=db.prepare(`INSERT INTO payment_refunds
      (booking_id,payment_id,amount_paise,method,reason,request_id)
      VALUES(?,?,?,?,?,?)`).run(bookingId,paymentId,amount,method,reason,requestId);
    if(actor)recordAudit(db,actor,'refund.recorded','refund',Number(result.lastInsertRowid),
      {booking_id:bookingId,payment_id:paymentId,amount_paise:amount,method,reason});
    return {id:Number(result.lastInsertRowid),booking_id:bookingId,payment_id:paymentId,
      amount_paise:amount,method,reason,request_id:requestId,already_recorded:false};
  })();
}
