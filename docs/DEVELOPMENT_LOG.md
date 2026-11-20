# FortLedger — Development log
Append a dated entry for each meaningful implementation or business decision. Never record private guest data, account numbers or secrets here.

## 2026-11-20 — Repository initialization and first development increment
- Source: product discovery conversation, project blueprint.
- Decision: prioritize premium low-click UX equally with minimal/zero recurring cost.
- Scope: implement initial seven-room local booking and payment foundation first; further invoice/restaurant modules remain roadmap.
- Implemented: local Node/Express server, SQLite data tables and seed, searchable booking list, category/room allocation, GST-inclusive calculation and automatic balance, tests, readme and blueprint.
- Verified: GitHub Actions run 44740167582 completed `npm install` and `npm test` successfully on PR #1 (initial head 28f3b41). Follow-up guard and documentation changes require the latest PR head to pass checks again.
- Review finding and fix: after a booking exists, changing category inventory would invalidate previous capacity decisions; block room category changes in this initial release. Room names can still be edited. Revisit with an availability-aware inventory migration workflow.
- Review gates: run available automated tests; inspect PR diff and GitHub checks before merging.
- Not yet built in this increment: invoice PDFs, billing lifecycle, restaurant CSV, room charge settlement, Epson printing, backup/restore, real calendar timeline, auth.
- Important limitation: initial booking UI is not for actual production use until security, data validation, persistence recovery and financial compliance review are complete.

## 2026-11-20 — Invoice branding requirement and handoff update
- Confirmed: support uploading the hotel's existing logo in Settings; render it on every proforma and final tax invoice PDF with preserved aspect ratio. The actual logo asset has not been supplied and the PDF module is not yet built.
- Verified state: PR #1 was merged into `main` (squash merge `16ee650166ef57bff36338ae5b1962d28b8749eb`). The latest PR head's GitHub Actions run `44740381860` concluded successfully. Earlier entry refers to an intermediate head.
- Next work: implement a proper calendar, booking edits, payment UI and backups before invoice/PDF workflow; invoice logos belong to the PDF milestone. Keep production readiness restrictions in effect.

## 2026-11-20 — Milestone 2 incremental booking operations
- Added seven-day room-wise calendar with navigation and category reservations awaiting assignment, avoiding calendar-grid overbooking assumptions for unassigned stays.
- Added booking editing with transaction-scoped availability recheck; payment ledger inspection, additional payment entries and status controls.
- Added SQLite online backup download API, with cleanup after response. Restore workflow and encrypted off-device backups are still future tasks.
- Check-in/check-out remain half-open date ranges. Status changes are manual, and cancelled bookings cannot be reactivated in this release.
- Limitations: basic dialog-based payment workflow, no authentication, and not yet production-ready. Test and CI results recorded with PR before merge.

## 2026-11-20 — Verified offline restore follow-up
- Added a CLI restore tool to validate SQLite integrity, expected core tables and seven-room inventory before replacement.
- Restore requires an explicit confirmation flag, refuses active WAL files, and retains a copy of the previous database.
- Added tests for successful restore and rejection of invalid backup input.
- Scope restriction: stop the application before restoring; this is a manual recovery operation, not automatic scheduled backups.

## 2026-11-21 — First hotel proforma PDF increment
- Added immutable, one-per-booking proforma snapshots, deterministic number sequence with year prefix, and local PDF generation/download with fixed T&C and accommodation totals.
- Duplicate create requests return the existing invoice rather than incrementing the sequence. Saved advance is part of the issuance snapshot and does not change retroactively.
- Added invoices list and Proforma PDF action from each booking. No real tax invoice issuing, address/bank settings, logo upload or multiple accommodation item lines yet. The 5% breakdown is illustrative pending compliance verification.
- Must test and merge only after GitHub Actions checks succeed.

- PR #5 review correction: render the immutable Terms & Conditions from each saved invoice snapshot, not from a mutable module-level default. Added invoice ledger CSS layout. GitHub Actions checks must rerun on the final PR head before merge.

## 2026-11-21 — Multi-line proforma editor
- Added an invoice editor with guest/group heading, bill-to name/address, customizable room descriptions, room quantities, nights, GST-inclusive rate per accommodation line.
- Calculations are server-side integer paise, reverse-tax 5% illustrative, with payment snapshot retained. Issued proformas are immutable and idempotent.
- PDF now supports multiple lines and flows onto additional pages; company address shown when supplied.
- Tax invoice conversion, compliance verification, saved bank/UPI settings, brand logo, customer directory and restaurant remain pending. Review automated integration tests and GitHub CI before merging.

## 2026-11-21 — Hotel payment/settings increment
- Implemented locally persisted hotel identity, optional GSTIN/address/contact and bank/IFSC/UPI settings with validation.
- New proforma snapshots preserve current business settings; PDFs show business name and payment details. Older snapshots fall back to the hotel name without requiring migration.
- Browser settings form added; no real bank or guest data in repository. Logo uploads and statutory invoice issuance still pending.
- Sensitive financial information must not be entered until authentication and local access controls are implemented and tested.

## 2026-11-21 — Restaurant menu and saved-billing foundation
- Added CSV menu import with quoted fields, configured integer tax rates, validation and transactional upsert.
- Added searchable menu, quick cart and local restaurant bill snapshots. Cash, UPI and card are supported as operator-recorded payments; room charge requires an existing checked-in booking.
- Financial snapshots are separate from accommodation invoices. **Room charge settlement and combined totals are not yet implemented**; do not double invoice these charges.
- Epson TM-T82 printing, offline cashier safety, tax-rate compliance and manually unmatched charges are future work. CI must pass on the PR head before merge.

## 2026-11-21 — Combined / separate guest folio settlement
- Added booking folio showing remaining accommodation balance, separately tracked room-charge restaurant bills, and combined due.
- A room charge can be settled individually; combined settlement records accommodation payment and each outstanding restaurant bill atomically, using immutable settlement group references.
- Duplicate bill settlement is prevented by unique restaurant bill settlement IDs; re-running a combined payment cannot charge already paid items.
- This is a payment workflow, not a final statutory tax invoice. Refunds, partial payment, tax invoices and merchant reconciliation remain pending.

## 2026-11-21 — Month-at-a-glance calendar
- Added month view showing room-night occupancy out of seven rooms, including category-held reservations and excluding cancelled bookings.
- Clicking a month date opens that date's seven-day room assignment view. Month navigation respects year boundaries.
- Date-only helpers have regression tests for checkout-day availability and category held inventory. No external calendar service or subscription.

## 2026-11-21 — PR verification and cross-chat checkpoint
All five increments completed in this development session were reviewed and merged:
- PR #6: multi-line proforma editor and PDF; GitHub Actions run `44809237028` passed.
- PR #7: hotel/payment settings and immutable branding snapshot; run `44809491799` passed.
- PR #8: restaurant CSV import, cash/UPI/card bills and checked-in room charges; run `44809826861` passed.
- PR #9: atomically recorded combined/separate guest folio settlement; run `44810094745` passed.
- PR #10: weekly/monthly calendar switch and month-room occupancy; run `44810377943` passed.
- Testing evidence is GitHub Actions unit/integration checks; no physical Epson test, tax/legal review, live-user test or rendered PDF visual approval has been performed.
- Prior dated log entries describe historical stage limitations; consult this checkpoint and source code for current state.
- **Next blockers:** local login/security, legally verified final tax invoices, Epson printer implementation and physical validation, automatic backups, manual charge review, refunds and app packaging. Do not mark production-ready.

## 2026-11-21 — Local administrator authentication
- Added first-use CLI password setup with scrypt salted hash in ignored local data file, no plain password in Git.
- Production startup refuses to serve business data without a configured password; browser uses HttpOnly SameSite=Strict session cookies and logs out.
- Protected all API routes, including backups; same-origin, JSON-only mutation checks and basic login throttling implemented.
- Test fixture constructors remain unauthenticated only for deterministic integration tests; production invocation explicitly requires auth.
- Pending: installation test on actual business device, password recovery process, penetration review, encrypted off-device backup, and role-based staff permissions.

## 2026-11-21 — Restaurant print-view fallback
- Added a thermal-width HTML receipt for each saved restaurant bill, including immutable item snapshots and current room-charge payment status.
- Receipts can be printed through the operating system's installed print driver and browser dialog, without hosted services.
- Not a statutory tax invoice; direct Epson TM-T82 LAN commands, hardware tests and failure/reprint audit trails remain pending. Output escapes guest/menu content to prevent HTML injection.

## 2026-11-21 — Authentication, receipt printing and legal review checkpoint
- PR #12 implemented local administrator password hashing/session authentication and was merged after GitHub Actions run `44811033034` passed.
- PR #13 implemented a browser-printable 80mm restaurant slip and was merged after GitHub Actions run `44811335974` passed. It uses the installed OS driver; no physical Epson TM-T82 print test.
- Government of India PIB (16 Sep 2025) clarified the 5% without-ITC hotel accommodation regime for value of supply up to INR 7,500 per unit/day. CBIC Rule 46 has tax-invoice requirements absent from current proformas. Documented sources and explicit final-tax-invoice release blockers in `docs/COMPLIANCE_REVIEW.md`.
- Current alpha is not production-ready. No browser or rendered-PDF visual QA or actual local-device install was performed; GitHub CI validates unit/integration tests only.
