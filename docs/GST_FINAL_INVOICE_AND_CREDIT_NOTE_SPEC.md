# Final GST invoices and credit notes — FortLedger implementation contract

**Status: engineering specification, NOT approved tax issuance.** Verified against CBIC Rule 46/Rule 53, CGST Act sections 31/34, the September 2025 GST-rate notification and the government's invoice registration portal. Validate the rules in effect on the actual supply date, and obtain the Garh Jaisal accountant's written sign-off. The application MUST NOT emit or mark a document as a statutory tax invoice/credit note merely because a PDF was generated.

## Required hotel information — supplied outside GitHub

1. Registration category and valid **legal entity name, GSTIN, PAN, registered address and state code**; verify on the GST portal. Hotel trade name alone is not automatically the registered seller name.
2. GST registration status and exact invoice issuer. Historical **already issued** legal invoice and credit-note numbers across all systems for the current financial year; choose unique serial prefixes, max 16 characters per Rule 46, with sequence policy approved by the accountant. Never reuse cancelled/voided numbers.
3. Applicable GST classification and rate per **supply date**, **per accommodation unit per day**, valuation of discounted and bundled meal plans; verify hotel SAC (normally 996311), service time-of-supply and place of supply. The hotel is in Rajasthan, but guests from other states do not automatically create an inter-state accommodation supply.
4. Accountant determination for restaurant status as **specified premises**, taking preceding-financial-year accommodation values and declarations into account, and whether 5% without ITC or 18% with ITC is correct. The provisional 5% on the bundled menu is not legal approval.
5. Aggregate annual turnover and e-invoice eligibility; the ₹5 crore threshold applies to covered B2B transactions based on any relevant preceding FY. If covered, IRN and signed QR from an authorised IRP must be obtained before representing an invoice as issued under the e-invoicing regime. ₹10 crore+ suppliers have an additional 30-day IRP reporting limit effective 1 April 2025. Do not invent an IRN or QR.
6. How to authenticate each legal document (authorized human signature/digital authentication and any applicable electronic signature exception), preserve an immutable PDF/data snapshot, retain records, and reconcile GSTR-1/GSTR-3B.
7. Written credit-note policy including partial reductions, taxpayer return impact, recipient ITC adjustment where required, reporting cutoff, cash/card/UPI refund status and existing guest folio settlement. A cancelled booking, operational refund, price concession or proforma revision does not automatically qualify as a statutory GST credit note.

## Invoice data contract (CBIC Rule 46)

Supplier GSTIN/name/address, FY-unique serial and issue date; recipient name/address/GSTIN when applicable, unregistered recipient details when thresholds require them; line SAC/HSN and service description/quantity, room/night and food components without double-counting; list price, discounts, taxable base, GST rate and separate CGST/SGST/IGST/cess as applicable; place of supply and state, reverse-charge disclosure; authenticated signature or approved alternative. Keep taxable values and tax in **integer paise** and ensure line, bucket and document totals reconcile.

**Important:** The September 22, 2025 rate change introduced 5% without ITC for accommodation value at or below ₹7,500 per unit per day; higher-value accommodation generally remains at 18%. The value-of-supply threshold is not simply a flat tax on the total booking or the printed GST-inclusive rack rate. Always use legally determined rate effective on the actual supply date.

## Credit/debit note data contract (CBIC Rule 53 / CGST section 34)

Own FY-unique serial and date; the original **issued** tax invoice number and date; supplier/recipient identity and GSTIN as required, reason, taxable amount/rate/tax adjusted, signature and return reporting. Separate outward tax reporting from actual refunds and outstanding guest balance. No hard delete, edit or renumber of an issued source invoice.

A restaurant **receipt is not an issued GST invoice** in current FortLedger. Therefore a receipt correction estimate MUST NOT generate a GST credit-note number or reduce reported output tax. If the original legal invoice was issued in another system, that source must be imported/reconciled under an accountant-reviewed policy before creating a statutory credit note.

## Engineering delivery in stages

- **A1 — now:** manager/owner read-only original-receipt correction estimate at `POST /api/restaurant/bills/:id/correction-preview`. Request `{reason:"...", lines:[{line_index:0,quantity:1}]}`. Display original saved gross/tax, proposed gross and attributable historic tax, room/settlement flags and blockers. No writes, new tables, refunds, invoice numbers, tax adjustments or fiscal credits. Review-only; no GST invoice linking exists.
- **A2 — later:** reviewed, actor-attributed and replay-safe correction request ledger, with separate accountant-authorised effects and original immutable snapshots; treat existing settled bills, room allocations and daily closing as blockers until reconciliation semantics pass regression tests.
- **B1 — implemented:** Business settings now distinguish trade name and registered legal supplier name without modifying saved proformas. Owner/manager can use a read-only GST readiness checklist; staff cannot access it. Tax review draft warns if legal name is missing. No statutory issuance.
- **B2 — implemented:** Optional per-accommodation-line 5% or 18% illustrative rate selection in review-only tax drafts. Each rate bucket rounds and reconciles independently, with explicit threshold conflict warnings; PDF labels the selected rate. Defaults to existing 5% for older clients. Never treats the selected rate as legally verified, and does not alter the proforma, ledger, or statutory series.
- **B3 — later:** versioned dated tax policy table, seller/legal recipient registry and per-line Rule 46 validation, held behind an explicit accountant-approved disabled-by-default issuance gate; independent statutory invoice FY sequence and business-date timing.
- **C — later:** signed/approved non-editable legal PDF and optional compliant IRP integration *only if applicable*; receipt/proforma remain separate, and no double taxation of room-charged food.
- **D — later:** statutory credit/debit lifecycle linked to truly issued invoices, e-invoice/reporting requirements, GSTR reconciliation and printing/recovery tests.

No zero-cost cloud service or bank verification is presumed. Keep all real GSTINs, hotel records, credential secrets and guest/finance PDFs out of GitHub.

## Official reference links

- Invoice rules (Rule 46, Rule 53): https://cbic-gst.gov.in/gst-invoice-rules.html
- CGST sections 31/34: https://cbic-gst.gov.in/hindi/CGST-bill-e.html (older HTML must be compared with latest amendments)
- 2025 rate notification 15/2025-CTR: https://taxinformation.cbic.gov.in/view-pdf/1010459/ENG/Notifications (see central-tax counterpart)
- Government GST Council September 2025 press release: https://gstcouncil.gov.in/sites/default/files/2025-09/press_release_press_information_bureau.pdf
- E-invoicing threshold: https://einvoice6.gst.gov.in/content/einvoice-mandate/
- IRP reporting time: https://einvoice6.gst.gov.in/content/revised-time-limit-for-e-invoice-reporting-for-businesses-with-aato-of-%E2%82%B910-crores-above/
