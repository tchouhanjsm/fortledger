# Tax and operational compliance gate — review before live invoicing

_Last reviewed 2026-11-21. This is a research checklist, not a tax opinion. Confirm with the hotel's accountant and current law before enabling statutory tax invoices._

## Verified public sources
- Government of India Ministry of Finance / PIB, 16 Sep 2025 FAQ Q6–Q7: https://www.pib.gov.in/Pressreleaseshare.aspx?PRID=2167151&lang=2&reg=48
  - Hotel accommodation at **value of supply at or below INR 7,500 per accommodation unit per day** is subject to a mandatory **5% GST without ITC** rate in the described regime.
  - Do not apply the 5% calculation indiscriminately to higher-value stays or other hospitality/restaurant services.
- CBIC GST tax invoice rules / Rule 46: https://cbic-gst.gov.in/gst-invoice-rules.html
  - Statutory tax invoices require seller identity and GSTIN, applicable recipient information, unique financial-year serial identifier, date, item description, taxable value, applicable tax rates and amounts, supply-place details where required, and applicable declaration/signature details.
  - The consecutive tax-invoice identifier must not exceed 16 characters and be unique within the financial year under Rule 46. Confirm the business's other issued invoice series before choosing a new legal series.
- CBIC tax invoice guidance: https://cbic-gst.gov.in/pdf/e-version-gst-fliers/tax-invoice-efliers.pdf

## FortLedger current treatment
- Only *proforma* PDFs are issuable. They are explicitly marked **Not a GST tax invoice**.
- The agreed example INR 4,500 per room/night and 5% reverse-GST calculation is implemented. This is an illustrative business rule; proforma GST currently cannot be assumed correct for all tariffs.
- Restaurant food bill slips are payment receipts, explicitly marked **Not a tax invoice**. The menu contains operator-entered tax rates and has no certified automated rate lookup.
- Hotel proforma numbers currently begin GH-YYYY-NNN and use a global sequence; a **separate legally acceptable final tax-invoice series/lifecycle** must be designed and reviewed to prevent collisions with historical issued invoices.
- No automatic email, e-invoice/e-waybill integration, registered-signature functionality, credit notes, refunds or tax reports.

## Release-blocking checklist
- [ ] Verify hotel GST registration, legal supplier name/address, PAN/GSTIN, location/state, and invoice issuer.
- [ ] Verify tariff-based accommodation rate rules, meal-plan bundling, treatment of each accommodation line, place of supply, intra/interstate CGST/SGST/IGST calculations, and ITC eligibility with tax professional.
- [ ] Verify restaurant tax treatment including whether premises fall under special hotel restaurant categories.
- [ ] Confirm tax-invoice series, legal time of supply, hotel and restaurant document requirements, mandatory recipient fields, SAC/HSN and applicable e-invoice threshold.
- [ ] Implement and test statutory final tax-invoice conversion with immutable snapshots, distinct numbering, issue/cancel/credit lifecycle, audit trail, and no duplicate levies for pre-invoiced restaurant bills.
- [ ] Validate printed PDFs visually, page overflow, exact fixed T&C, bank and logo placement, currency/text handling and number precision.
- [ ] Test login/security and restoration on the intended business device; implement automated encrypted external backups and a documented password recovery procedure.
- [ ] Physically verify Epson TM-T82 model/network configuration, receipt width, offline retries, and duplicate prevention before relying on printer integration.

## Acceptance example
Awaita, 1 Dec to 2 Dec 2026, two rooms at INR 4,500 gross per room/night:
Gross INR 9,000; base at illustrative 5% INR 8,571.43; GST INR 428.57; paid INR 4,500; due INR 4,500.
This test is **not** proof that the same rate applies to any other booking.

## Implemented review-only draft (2026-11-21)
- A proforma can produce a separately persisted, editable draft PDF with recipient GSTIN/address, SAC per accommodation line, and an illustrative intra-Rajasthan CGST/SGST 2.5% split.
- Drafts include explicit warnings for incomplete supplier registration/address, signatory and thresholds; they are visibly marked **NOT A TAX INVOICE** and never consume legal invoice numbers.
- Official service classification source: https://gstcouncil.gov.in/sites/default/files/2024-02/scheme_of_classification_of_services_amended.pdf (996311 hotel accommodation, 996312 campsite services).
- **No statutory issuance is enabled** until supplier/e-invoice applicability, signatures, credit notes, and full Rule 46 verification are addressed.
