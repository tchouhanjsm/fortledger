import { randomUUID } from 'node:crypto';
import { bookingTotals } from './finance.js';
import { NET_PAYMENTS_SQL } from './payment-ledger.js';
import {recordAudit} from './financial-audit.js';

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
  const bills=roomBills(db,bookingId);
  const restaurant_due_paise=bills.filter(x=>!x.settlement_id).reduce((sum,x)=>sum+x.total_paise,0);
  return {booking_id:bookingId,guest_name:booking.guest_name,status:booking.status,
    accommodation,bills,restaurant_due_paise,
    combined_due_paise:accommodation.due_paise+restaurant_due_paise};
}
export function settleRoomBill(db,bookingId,billId,method,actor=null){
  validMethod(method);
  return db.transaction(()=>{
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
  })();
}
export function settleCombined(db,bookingId,method,actor=null){
  validMethod(method);
  return db.transaction(()=>{
    const folio=getGuestFolio(db,bookingId);
    if(folio.status==='cancelled')throw new Error('Cancelled booking cannot be settled');
    if(folio.combined_due_paise===0)throw new Error('No outstanding amount');
    const group=randomUUID();
    const amount=folio.accommodation.due_paise;
    if(amount>0){
      const payment=db.prepare('INSERT INTO payments(booking_id,amount_paise,note,method) VALUES(?,?,?,?)')
        .run(bookingId,amount,'Combined checkout settlement '+group,method);
      if(actor)recordAudit(db,actor,'payment.recorded','payment',Number(payment.lastInsertRowid),
        {booking_id:bookingId,amount_paise:amount,method,settlement_group:group});
    }
    let count=0;
    const insert=db.prepare(`INSERT INTO restaurant_settlements(restaurant_bill_id,method,settlement_group)
      VALUES(?,?,?)`);
    for(const bill of folio.bills.filter(b=>!b.settlement_id)){
      insert.run(bill.id,method,group);count++;
      if(actor)recordAudit(db,actor,'settlement.recorded','restaurant_settlement',bill.id,
        {booking_id:bookingId,amount_paise:bill.total_paise,method,settlement_group:group});
    }
    return {booking_id:bookingId,settlement_group:group,method,
      accommodation_paid_paise:amount,restaurant_paid_paise:folio.restaurant_due_paise,
      total_paid_paise:folio.combined_due_paise,restaurant_bills_settled:count};
  })();
}
