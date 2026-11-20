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
