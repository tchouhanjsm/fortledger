import { bookingTotals } from './finance.js';
import { FIXED_TERMS } from './terms.js';
import { normalizeInvoiceInput } from './invoice-lines.js';
import { NET_PAYMENTS_SQL } from './payment-ledger.js';
import { getBusinessSettings } from './business-settings.js';

export function createProforma(db,bookingId,input={}){
  if(!Number.isSafeInteger(bookingId)||bookingId<1)throw new Error('Invalid booking ID');
  return db.transaction(()=>{
    const existing=db.prepare("SELECT * FROM invoices WHERE booking_id=? AND kind='proforma'").get(bookingId);
    if(existing)return {...existing,snapshot:JSON.parse(existing.snapshot),already_existed:true};
    const booking=db.prepare(`
      SELECT b.*,r.name AS room_name,
      ${NET_PAYMENTS_SQL} AS paid_paise
      FROM bookings b LEFT JOIN rooms r ON r.id=b.room_id WHERE b.id=?
    `).get(bookingId);
    if(!booking)throw new Error('Booking not found');
    if(booking.status==='cancelled')throw new Error('Cannot invoice a cancelled booking');
    const details=normalizeInvoiceInput(input,booking);
    const totals=bookingTotals(booking);
    const paid_paise=totals.paid_paise;
    const next=db.prepare('UPDATE invoice_sequence SET last_number=last_number+1 WHERE id=1 RETURNING last_number').get().last_number;
    const year=new Date().getFullYear();
    const number='GH-'+year+'-'+String(next).padStart(3,'0');
    const snapshot={
      number,kind:'proforma',issued_on:new Date().toISOString().slice(0,10),
      ...details,business:getBusinessSettings(db),company_name:booking.company_name,
      category:booking.category,room_name:booking.room_name,
      rooms_count:booking.rooms_count,meal_plan:booking.meal_plan,
      nightly_rate_paise:booking.nightly_rate_paise,nights:totals.nights,
      paid_paise,due_paise:Math.max(0,details.total_paise-paid_paise),
      credit_paise:Math.max(0,paid_paise-details.total_paise),
      terms:FIXED_TERMS
    };
    const result=db.prepare("INSERT INTO invoices(booking_id,kind,number,snapshot) VALUES(?,'proforma',?,?)")
      .run(bookingId,number,JSON.stringify(snapshot));
    return {id:Number(result.lastInsertRowid),booking_id:bookingId,kind:'proforma',number,snapshot,already_existed:false};
  })();
}

export function getInvoice(db,id){
  const row=db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
  return row?{...row,snapshot:JSON.parse(row.snapshot)}:null;
}

export function listInvoices(db){
  return db.prepare("SELECT id,booking_id,kind,number,created_at,snapshot FROM invoices ORDER BY id DESC").all()
    .map(row=>({...row,snapshot:JSON.parse(row.snapshot)}));
}
