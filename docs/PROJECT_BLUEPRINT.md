# FortLedger — Project blueprint and cross-chat handoff
_Last updated: 2026-11-21. Source of truth for product intent; update this document whenever a decision changes._

## Goal
Build a premium, fast, low-click, **local-first** Node.js application for Garh Jaisal hotel and restaurant operations. **Ease of use and minimal/zero recurring software cost are equally important.** Own our records and avoid third-party invoice APIs, mandatory cloud hosting, or unnecessary subscription services.

## Confirmed operating workflow
1. **Hotel invoices:** Bill To is an individual or company; company address is optional/mostly used for company billing. Guest/group name appears as a heading above room line items. Room descriptions are searchable predefined entries, but can be edited. Lines can be different accommodation types, nights and independently negotiated rates (season, company and guest). No fixed tariff. Meal plan labels include CP/CPAI/MAP/MAPI/EP/AP.
2. **Room prices:** Quoted room/night rate includes GST. Nights × number of rooms × GST-inclusive nightly rate gives agreed amount. The business has stated 5% for its hotel use case; separately show the reverse-calculated taxable base and GST on PDFs. **Never silently assume this is statutorily valid for every date, item or invoice. Verify and configure tax treatment before live tax issuance.** Round in paise; preserve final quoted total. Worked acceptance example: Awaita, 2026-12-01 check-in, 2026-12-02 check-out, 2 rooms × 1 night × INR 4,500 = INR 9,000 gross, INR 8,571.43 base, INR 428.57 GST, INR 4,500 received, INR 4,500 due.
3. **Invoice types:** Both proforma and final tax invoices. Normally convert a proforma to a tax invoice without re-entry. Keep originals and links, with no duplicate issued document. Invoice number requested: `GH-2026-001` and increment globally without annual reset (e.g. `GH-2027-004` after 2026's `003`). The new sequence begins at 001. Tax invoice sequencing and statutory compliance must be reviewed, particularly if other invoices exist under the same registration. Treat invoice type and lifecycle separately and never reuse cancelled numbers.
4. **Payments:** Enter amount paid; automatically compute remaining balance. Track deposits/payments once, reuse in bookings and invoices, and handle overpayments as credit, not negative due. Multiple payments require a ledger, not overwriting totals.
5. **PDFs:** Original branding and polished layout; **hotel logo uploaded and stored locally in Settings, printed in the header of every proforma and final tax invoice PDF, preserving aspect ratio and providing a clear fallback if no logo exists**; full hotel/company details, invoice details, line items, separate tax calculation, amounts paid and due, saved bank account and UPI details (optionally QR), and **fixed T&C copied exactly below**. User downloads PDF and sends it manually in private email conversations; no email integration required.
6. **Calendar/bookings:** There are **7 physical rooms** in total. Bookings are manually entered with check-in/check-out, guest/group name, optional company, number of rooms, meal plan, nightly price including tax, advances and balance. Nights calculated from dates. Sometimes assign specific room; sometimes reserve by category then allocate later. Prevent conflicts, including category-held capacity. In-house guest list for restaurant room charges. Simple statuses: reserved/checked-in/checked-out/cancelled. No full PMS.
7. **Restaurant:** Existing optional reference project is `tchouhanjsm/garhjaisal-cafe` (FloCafe fork) but was not deployed. Instead implement a smaller CSV menu import (name/category/price/tax metadata), fast search/add/quantity, local bills, immediate cash/UPI/card settlement, and charge-to-room. Support combined or separate settlement at checkout without duplicate tax or revenue accounting. In-house lookup plus manual room/guest entry; unmatched manual charges must be reviewed. Epson **TM-T82 network printer** (Wi-Fi/Ethernet), target 58/80mm ESC/POS printing as verified for the exact variant. Persist bill before printing, support reprints, recover printer failures.
8. **Search/records:** Searchable local bookings, customers, payments, invoices and restaurant bills. Saved issued documents remain immutable; adjustments have audit trails. Local backup/export/restore with recovery tests. No actual guest data belongs in Git.
9. **Delivery:** No automatic emailing; download invoice PDF and attach manually.

## Fixed Terms & Conditions (verbatim)
All guests must abide by local laws and regulations. Guests must present a valid government-issued ID at check-in.
Cancellation: Cancellations made more than 30 days before arrival are free of charge; applicable bank charges will be
deducted from refunds. Cancellations within 30 days, no-shows, early departures, and last-minute booking changes
may incur charges.
Special Dates: During long weekends, Christmas, New Year, and other designated peak periods, bookings may require
a non-refundable advance and be subject to separate cancellation terms.
For enquiries or special requests, contact us at mukeshkila@yahoo.com or +91-7727-047-567.
Garh Jaisal reserves the right to apply the applicable booking terms communicated at the time of reservation.

## Architecture and guardrails
- One Node.js backend on localhost, one SQLite database, free/open-source UI and document generation libraries; avoid hosting expenses and third-party invoice API dependencies. Secure local access and backup files. Never expose backend on a public network by default.
- Monetary values stored as **integer paise**. Financial documents should snapshot names, tax rules, prices, descriptions and T&C at issuance rather than read from mutable settings.
- Date intervals are half-open: checkout day is available for a new arrival. Preserve date-only calendar semantics.
- Protect against overlapping specific-room and category reservations. Physical inventory is initially seven unnamed placeholders; configure actual names and categories before operational use.
- Keep guest data out of repository, logs, test fixtures and screenshots. Use synthetic data for automated tests.
- Version migrations, idempotent writes, reprint markers, status transitions, payment ledger and recoverable backups are expected as modules mature.
- Use GitHub feature branches and PRs; run tests, inspect diff, check CI, log results before merging. Never claim tests or hardware verification not performed.

## Incremental implementation roadmap
- **Milestone 1 (initial development):** Local Node server, SQLite schema, seven configurable rooms, basic booking form/history, revenue/advance/GST calculations, overlap safety, tests, documentation and logs. **Not production ready.**
- **Milestone 2:** Weekly calendar timeline and category-held reservation visibility, booking edits, basic status and payment ledger UI, SQLite backup download (initial increment); continue with monthly overview and better payment UI; online backup export and manually verified offline CLI restore are now provided in the initial implementation.
- **Milestone 3:** Company/customer directory, accommodation line-item editor, invoice numbers and lifecycle, saved PDFs, brand template including configurable hotel logo in PDF header with exact T&C, GST compliance review, invoice QA.
- **Milestone 4:** Restaurant CSV import, cashier UI, local restaurant billing and payments, in-house room charge link and settlement reconciliation.
- **Milestone 5:** Epson TM-T82 discovery and print tests, ESC/POS printing, print retry and status, operational testing, security hardening and installation instructions.

## Verified project state — 2026-11-21
Merged PRs #1–#10. Booking calendar includes room-wise week and aggregate month views; initial proforma editor supports multi-line accommodation pricing; PDF includes configurable business/bank details and fixed Terms; restaurant offers CSV menu and saved itemized bills; guest folio supports separate or combined payment settlement; SQLite backups have a tested offline restore path.

**NOT built / NOT production-ready:** statutory final tax invoice lifecycle and compliant numbering, guest/customer directory, logo upload (deliberately deferred to late-stage polish), Epson TM-T82 driver/receipt test, local authentication, robust input and CSRF security, automated external backups, refund/adjustment workflow, unmatched manual room charges, transactional audit log beyond existing payment records, and operational installation/QA. Avoid entering real guest, hotel account or payment information until security and tax compliance are verified. Repo was last observed PUBLIC.

**Next engineering order:** refine recently added local authentication and perform security QA; business invoice details/legal tax verification and final conversion; menu tax verification; Epson printing/receipt queue and physical printer test; manual unmatched room-charge review; automated backup and restoration drill; visual QA on PDFs/calendar; packaging and installation. Record new work in the development log.

## Invoice branding decision (2026-11-20)
- A hotel logo is mandatory as a supported **feature**, but the logo asset itself is not yet supplied. Provide upload/change/preview in business Settings; validate accepted image types, size and safe storage. Persist local logo and use it consistently on proforma/final tax PDFs.
- Never use the FortLedger application mark as a substitute for the hotel's actual logo; show hotel name as the fallback until its logo is uploaded. Do not commit private hotel assets unless explicitly authorized.

## Acceptance scenarios
- Awaita booking example produces exactly INR 9,000 inclusive and INR 4,500 balance.
- Multiple accommodation lines have different nights, rates and meal plans.
- Category-held rooms reduce availability before physical room assignment.
- Duplicate/overlapping rooms cannot be sold accidentally; back-to-back stays may share checkout/check-in day.
- An advance appears only once across calendar and invoice; food charge is not taxed or charged twice.
- Conversion to final tax invoice does not silently overwrite or duplicate the proforma.
- Invalid CSV or failed printer cannot corrupt a saved sale.
- Full offline local use, reliable backup recovery and no mandatory paid service.

## Tax compliance gate
See [COMPLIANCE_REVIEW.md](COMPLIANCE_REVIEW.md) for verified government references, the 5% accommodation-rate scope, Rule 46 final invoice requirements and release blockers. Proforma PDFs and restaurant slips remain non-statutory documents; do not enable final tax invoices until the checklist is complete.

## Work log and handoff
See [development log](DEVELOPMENT_LOG.md) for the latest implemented items, verification evidence, blockers and next actions. A new chat should read this blueprint, the development log, then inspect the GitHub repository and open PRs before continuing. The blueprint is intent; **only source code/tests establish what is implemented**.
