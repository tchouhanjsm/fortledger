import {checkoutInvoicePreflight} from './checkout-invoice-preflight.js';
import {recordAudit} from './financial-audit.js';

// One durable *review work item* per successful physical checkout.
// It is not a statutory invoice, receivable, email, booked tax, refund, or PDF.
export function ensureCheckoutDocumentCaseSchema(db){
 db.exec(`CREATE TABLE IF NOT EXISTS checkout_document_cases(
   id INTEGER PRIMARY KEY,
   booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
   version INTEGER NOT NULL DEFAULT 1 CHECK(version=1),
   state TEXT NOT NULL CHECK(state='held_for_review'),
   snapshot_json TEXT NOT NULL,
   actor_username TEXT NOT NULL,
   hotel_business_date TEXT NOT NULL,
   created_at TEXT NOT NULL DEFAULT (datetime('now'))
 );
 CREATE INDEX IF NOT EXISTS idx_checkout_document_cases_recent
   ON checkout_document_cases(id DESC);
 CREATE TRIGGER IF NOT EXISTS checkout_case_guard_update
   BEFORE UPDATE ON checkout_document_cases
   BEGIN SELECT RAISE(ABORT,'Checkout document case snapshots cannot be modified'); END;
 CREATE TRIGGER IF NOT EXISTS checkout_case_guard_delete
   BEFORE DELETE ON checkout_document_cases
   BEGIN SELECT RAISE(ABORT,'Checkout document case snapshots cannot be deleted'); END;`);
}
function materialize(row){
 if(!row)return null;
 const {snapshot_json,...withoutSnapshot}=row;
 return {...withoutSnapshot,snapshot:JSON.parse(snapshot_json),
  final_tax_invoice_issued:false,statutory_number_reserved:false,
  document_pdf_created:false,email_delivered:false};
}
export function getCheckoutDocumentCase(db,bookingId){
 if(!Number.isSafeInteger(bookingId)||bookingId<1)throw new Error('Invalid booking ID');
 const row=db.prepare('SELECT * FROM checkout_document_cases WHERE booking_id=?').get(bookingId);
 return materialize(row);
}
export function listCheckoutDocumentCases(db,{q='',offset=0,limit=30}={}){
 if(typeof q!=='string'||q.length>100||!Number.isSafeInteger(offset)||
    offset<0||offset>20000||!Number.isSafeInteger(limit)||limit<1||limit>50)
   throw new Error('Invalid checkout case search');
 const query=q.trim();
 const count=db.prepare(`SELECT COUNT(*) AS count FROM checkout_document_cases c
   JOIN bookings b ON b.id=c.booking_id
   WHERE instr(lower(b.guest_name),lower(?))>0`).get(query).count;
 const rows=db.prepare(`SELECT c.*,b.guest_name,b.company_name,b.checkout AS stay_checkout
   FROM checkout_document_cases c JOIN bookings b ON b.id=c.booking_id
   WHERE instr(lower(b.guest_name),lower(?))>0
   ORDER BY c.id DESC LIMIT ? OFFSET ?`).all(query,limit,offset);
 return {total:count,offset,limit,items:rows.map(materialize)};
}
export function recordCheckoutDocumentCase(db,bookingId,actor,hotelBusinessDate){
 if(!Number.isSafeInteger(bookingId)||bookingId<1)
   throw new Error('Invalid booking ID');
 if(!actor||typeof actor.username!=='string'||!actor.username)
   throw new Error('Checkout document case needs an authorized actor');
 if(typeof hotelBusinessDate!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(hotelBusinessDate))
   throw new Error('Checkout case needs a business date');
 // This function is called *inside* the booking status transition transaction.
 // A missing table/disk error rolls back the checkout status and room cleaning too.
 const existing=getCheckoutDocumentCase(db,bookingId);
 if(existing)return {...existing,already_recorded:true};
 const booking=db.prepare('SELECT status FROM bookings WHERE id=?').get(bookingId);
 if(booking?.status!=='checked_out')
   throw new Error('Only completed checkout can create a document case');
 let preflight=null,exception=null;
 try{preflight=checkoutInvoicePreflight(db,bookingId);}
 catch{
   // Physical checkout may complete even if document sources fail validation,
   // but a durable blocked case MUST survive; no legal document is prepared.
   exception={code:'source_preflight_unavailable',
     message:'Invoice source reconciliation could not complete; owner/manager must inspect the folio before any document'};
 }
 const snapshot={version:1,kind:'checkout_invoice_review_case',
   label:'PREPARATION CASE — NOT A GST TAX INVOICE',
   trigger:'booking_checked_out',
   booking_id:bookingId,hotel_business_date:hotelBusinessDate,
   preflight,exception,ready_for_legal_issuance:false,
   external_invoice_series_reconciled:false,manual_email_delivery_confirmed:false,
   final_invoice_number:null,final_tax_invoice_issued:false};
 const insert=db.prepare(`INSERT INTO checkout_document_cases
   (booking_id,version,state,snapshot_json,actor_username,hotel_business_date)
   VALUES(?,1,'held_for_review',?,?,?)`).run(
   bookingId,JSON.stringify(snapshot),actor.username,hotelBusinessDate);
 const id=Number(insert.lastInsertRowid);
 recordAudit(db,actor,'checkout_document_case.created','booking',bookingId,{
   case_id:id,case_kind:'nonstatutory_review',preflight_complete:!exception,
   gst_issued:false,financial_effect:'none'
 });
 return {...getCheckoutDocumentCase(db,bookingId),already_recorded:false};
}
