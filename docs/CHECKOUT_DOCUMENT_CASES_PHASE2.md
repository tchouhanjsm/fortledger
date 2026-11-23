# Checkout document work cases — durable Phase 2, no legal issuance

## Business outcome and trigger

On the **authoritative** `checked_in → checked_out` SQLite status transition, the application now creates exactly one **held for review** nonstatutory checkout document case *inside the same transaction*. The case preserves the booking ID, actor, hotel business date, and versioned source snapshot from the approved read-only checkout preflight.

This does **not** automatically issue a tax invoice, generate a PDF, reserve a GST serial, refund anyone, send an email, or change a payment. It is a durable owner/accountant work item and a historical record of what the **operator-recorded ledger** looked like when checkout completed. Separate payment receipt, bank verification, and legal issuance states are not conflated.

## Operational states and exceptions

- Success: physical checkout, housekeeping dirty state, booking audit event **and** held document case commit together.
- Repeated checkout (staff double-click, lost response, same or different staff, restart): `status===checked_out` returns unchanged; `UNIQUE(booking_id)` prevents a second case. No statutory serial allocator is called.
- Legal GST policy and external series still unapproved: physical checkout is allowed under the existing operator acknowledgment of any outstanding balance, while the case remains `held_for_review`.
- Read-only preflight data missing/invalid after booking status update: store `source_preflight_unavailable` exception with explicit manual follow-up. Do **not** silently discard the task or block physical checkout solely because a document cannot be prepared.
- Critical database write/constraint failure: the entire checkout transaction rolls back; no case-less completed checkout, ghost dirty-room update or partial audit event.
- Later restaurant settlements, accommodations, payment/refund events or other source changes must **not** overwrite the original checkout snapshot. Operators can inspect the current live folio separately.
- Do not automatically create cases for older bookings already checked out before this feature. Their legal external originals and statuses must be reconciled manually.

## UI and API

- **Invoices → Checkout invoice reviews:** search by guest, view immutable checkout cases in recent order, see historic charge/recorded receipt/due values and **View live guest folio**. All statements emphasize `NOT ISSUED`.
- `GET /api/checkout-document-cases?q=...&offset=...` lists review cases to staff permitted `invoices.read`.
- `GET /api/bookings/:id/checkout-document-case` returns the one frozen snapshot or null, not a legal document. Owner, manager and front desk only; cashier excluded.
- All write methods to the case-register API are absent/denied; there is no approve/reissue/issue/tax endpoint. Underlying table has no-update and no-delete triggers.
- Source of truth remains the single local SQLite DB (integer paise). New table is additive, no existing records rewritten and v13 remains compatible with a previous-code rollback. Existing encrypted backups capture cases.

## Tests and remaining legal gate

Node tests cover exactly-once transition, repeated transition/restart, original vs later-paid snapshots, missing-document-source fallback, atomic rollback if case ledger missing, held-vs-issued semantics and authenticated role access. Browser checks cover front desk review at 390 and 1440px.

**Remaining:** manually reconcile prior online-generator PDFs and `invoice-` series, determine statutory document recipient and split allocation, written accountant-approved dated GST classification and supplier identity, IRN if applicable, and one legally signed immutable original PDF/archive. [#147](https://github.com/tchouhanjsm/fortledger/issues/147) and physical acceptance [#135](https://github.com/tchouhanjsm/fortledger/issues/135) stay OPEN. Actual supplier GSTIN, real guest data and raw PDFs stay out of GitHub. Use the existing owner-guarded update process; merging does not install code on a live Windows workstation.
