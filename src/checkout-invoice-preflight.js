import {getGuestFolio} from './folio.js';
import {getBusinessSettings} from './business-settings.js';
import {gstReadiness} from './gst-readiness.js';

// Checkout-document PREVIEW ONLY. No document issuance, payment changes,
// numbering reservation, historic PDF discovery, email or tax eligibility grant.
// All figures originate from current authoritative SQLite folio, never from
// menu pricing or an old proforma's displayed paid balance.
export function checkoutInvoicePreflight(db,bookingId){
  if(!Number.isSafeInteger(bookingId)||bookingId<1)
    throw new Error('Invalid booking ID');
  const booking=db.prepare(`SELECT id,guest_name,company_name,status,checkin,checkout,
    rooms_count,nightly_rate_paise FROM bookings WHERE id=?`).get(bookingId);
  if(!booking)throw new Error('Booking not found');
  const folio=getGuestFolio(db,bookingId);
  const row=db.prepare(`SELECT id,number,snapshot FROM invoices
    WHERE booking_id=? AND kind='proforma'`).get(bookingId);
  let proformaRecipient=null;
  if(row){
    try{
      const snapshot=JSON.parse(row.snapshot);
      proformaRecipient={name:snapshot.bill_to||'',address_present:Boolean(snapshot.bill_to_address),
        snapshot_total_paise:snapshot.total_paise};
    }catch{
      proformaRecipient={name:'',address_present:false,snapshot_total_paise:null};
    }
  }
  const supplier=gstReadiness(getBusinessSettings(db));
  const original=folio.accommodation;
  const bills=folio.bills.map(bill=>({
    bill_id:bill.id,source:'linked_restaurant_room_bill',
    total_paise:bill.total_paise,tax_included_paise:bill.tax_paise,
    payment_state:bill.settlement_id?'operator_recorded_settled':'room_receivable',
    settled_at:bill.settled_at||null
  }));
  const restaurant_gross_paise=bills.reduce((total,bill)=>total+bill.total_paise,0);
  const restaurant_received_paise=bills.filter(bill=>bill.payment_state==='operator_recorded_settled')
    .reduce((total,bill)=>total+bill.total_paise,0);
  const restaurant_due_paise=restaurant_gross_paise-restaurant_received_paise;
  const total_charges_paise=original.total_paise+restaurant_gross_paise;
  const total_recorded_paise=original.paid_paise+restaurant_received_paise;
  if(![restaurant_gross_paise,restaurant_received_paise,total_charges_paise,
    total_recorded_paise,original.total_paise,original.paid_paise].every(Number.isSafeInteger)||
    original.contract_total_paise+original.adjustments_paise!==original.total_paise||
    restaurant_due_paise!==folio.restaurant_due_paise||
    Math.max(0,total_charges_paise-total_recorded_paise)!==folio.combined_due_paise)
    throw new Error('Checkout source amounts cannot be reconciled; stop and inspect the ledger');
  const blockers=[];
  const warnings=[];
  if(booking.status==='cancelled')blockers.push({code:'booking_cancelled',
    message:'Cancelled reservations cannot issue a checkout tax invoice automatically'});
  if(folio.invoice_discrepancy)blockers.push({code:'proforma_contract_mismatch',
    message:'Issued proforma does not match the original accommodation booking contract'});
  if(!row)warnings.push({code:'proforma_missing',message:'No FortLedger proforma saved for this booking'});
  if(original.adjustments_paise!==0)warnings.push({code:'accommodation_adjustments',
    message:'Accommodation credits/charges must be reviewed separately from the original proforma'});
  if(original.credit_paise>0)warnings.push({code:'accommodation_overpaid',
    message:'Recorded accommodation payments exceed the current charge; review the credit separately'});
  if(folio.combined_due_paise>0)warnings.push({code:'balance_due',
    message:'Outstanding guest receivable remains; payment confirmation is separate from checkout'});
  if(booking.status==='reserved')warnings.push({code:'not_checked_in',
    message:'Guest has not been checked in; this review does not perform checkout'});
  if(booking.status==='checked_in')warnings.push({code:'physical_checkout_not_recorded',
    message:'Physical checkout is not yet recorded; this review does not change booking status'});
  if(!supplier.checks.every(check=>check.complete))blockers.push({
    code:'supplier_identity_unverified',message:'Registered supplier identity fields are incomplete or unverified'});
  // The hotel keeps pre-FortLedger legal PDFs in an external local folder.
  // These PDFs are NOT discoverable by this server; no serial uniqueness claim.
  blockers.push({code:'external_invoice_history_unreconciled',
    message:'Existing online-generator PDFs and invoice-123 numbering history are not linked or reconciled'});
  blockers.push({code:'gst_accountant_policy_missing',
    message:'5% room/food practice is operator-reported; dated GST classification and legal policy require accountant approval'});
  blockers.push({code:'statutory_issuance_disabled',
    message:'Final tax invoice numbering, original PDF archive and statutory issuance remain disabled'});
  const unmatchedCount=db.prepare(`SELECT COUNT(*) AS count FROM restaurant_bills
    WHERE payment_method='room' AND booking_id IS NULL`).get().count;
  if(unmatchedCount)warnings.push({code:'unmatched_room_charges_global',
    message:'There are '+unmatchedCount+' unlinked room bills across the hotel; staff must determine whether any belongs to this guest'});
  return {
    kind:'checkout_invoice_preflight',
    label:'READ-ONLY REVIEW — NOT A TAX INVOICE',
    booking_id:booking.id,booking_status:booking.status,
    stay:{checkin:booking.checkin,checkout:booking.checkout,rooms_count:booking.rooms_count},
    billing_recipient:{type_candidate:booking.company_name?'company':'individual',
      name:proformaRecipient?.name||booking.company_name||booking.guest_name,
      address_present:proformaRecipient?.address_present||false,
      confirmed:false},
    original_proforma:row?{id:row.id,number:row.number,
      snapshot_total_paise:proformaRecipient.snapshot_total_paise,
      original_contract_matches:!folio.invoice_discrepancy}:null,
    accommodation:{contract_total_paise:original.contract_total_paise,
      adjustments_paise:original.adjustments_paise,
      current_charge_paise:original.total_paise,
      recorded_payments_paise:original.paid_paise,
      due_paise:original.due_paise,credit_paise:original.credit_paise},
    restaurant_room_charges:bills,
    totals:{charges_paise:total_charges_paise,
      accommodation_charge_paise:original.total_paise,
      restaurant_room_charges_paise:restaurant_gross_paise,
      operator_recorded_paise:total_recorded_paise,
      restaurant_recorded_paise:restaurant_received_paise,
      due_paise:folio.combined_due_paise,
      bank_verified:false},
    gst:{status:'accountant_review_required',supplier_fields_present:
      supplier.completed_local_fields+'/'+supplier.required_local_fields,
      practice:'Operator-reported 5% food and room — NOT verified tax policy',
      legal_invoice_enabled:false},
    historic_pdf_archive:{location:'external_local_folder_not_imported',
      last_reported_number:'invoice-123',numbering_policy_approved:false,
      invoice_already_issued_for_booking:'unknown'},
    blockers,warnings,
    financial_entries_written:false,number_reserved:false,pdf_issued:false,
    delivery_confirmed:false,ready_for_legal_issuance:false
  };
}
