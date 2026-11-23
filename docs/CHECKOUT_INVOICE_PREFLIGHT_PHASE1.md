# Phase 1: checkout invoice preflight — READ ONLY

## Operator workflow and source of truth

The hotel currently generates final PDFs through an external online invoice generator, keeps originals in a local folder, and shares copies manually by email. A recent example number reported by the operator is `invoice-123`; there is **no approved statutory numbering policy** yet. These are operator descriptions, not imported/verifiable records or authority to issue legal invoices.

**Open Bookings → Guest folio → Checkout invoice review.** The folio automatically shows a read-only preflight. Use Refresh to re-read the latest ledger. Owner, manager and front desk have access; cashier does not.

The preflight reads the **one existing SQLite source**, without money writes or migrations:

- Accommodation original booking contract, approved append-only adjustments, actual operator-recorded payments, due/overpayment. The original proforma is separately identified and a mismatch is flagged; it never replaces the live ledger.
- **Only** linked restaurant *room-charge* receipts, each with the saved price/tax snapshot and settlement state. Direct cash/UPI/card food receipts are **not billed to the guest again**.
- Total charge and operator-recorded payments are shown separately. Accommodation overpayments do **not** silently settle unpaid food; room receivables and recorded payments remain separate. No bank-verification claim.
- Local supplier field completeness is shown without exposing GSTIN to all front-desk roles.
- Required review blockers include unresolved historical online-generator PDFs/numbering series, lack of accountant-approved dated GST policy and **disabled statutory issuance**. External folder PDFs are never searched, imported or attached automatically.
- A cancelled booking or mismatched original proforma gets explicit blockers. Missing proforma, open balance, staff checkout state, current approved adjustments, and globally unmatched room bills get informational review notices, not automatic reconciliations.

**This does not approve GST rates, generate a final invoice/PDF, reserve a serial, send email, confirm payment, make any checkout status transition, or remove any legal blocker.** Physical checkout and legal invoice issuance remain independent states.

## API and acceptance criteria

`GET /api/bookings/:id/checkout-invoice-preflight` requires `invoices.read`. Any method besides GET is denied. It returns `ready_for_legal_issuance:false`, `financial_entries_written:false`, `pdf_issued:false`, and coded blockers/warnings. It never includes the supplier's actual GSTIN or credential secrets.

Automated tests exercise reconciled accommodation/food values, overpayments kept separate from food receivables, immutable existing proforma mismatch, zero database mutations, accountant/GST gate held, missing booking, and staff roles. The workflow uses the existing folio dialog instead of introducing another navigation page or a paid service.

## Next approved increments

1. Historical-document inventory on the hotel PC: **read-only PDF discovery first**, operator-reviewed, no guessing numbers from filenames and no uploading real PDFs to GitHub.
2. Durable checkout draft/blocked-case record triggered by a successful status transition, idempotent across retry/restart/concurrent staff. No legal issuance.
3. Recipient/allocation review and case-level source citations for the corporate/split billing path.
4. Only with written accountant-approved GST and series policy plus real historical archive reconciliation: separately reviewed legal issuance, authenticated original PDF storage, IRN gating if applicable, and controlled handoff/delivery evidence.

Keep [#147](https://github.com/tchouhanjsm/fortledger/issues/147) and physical acceptance [#135](https://github.com/tchouhanjsm/fortledger/issues/135) open. Installation remains manual/guarded; no update is installed automatically from a GitHub merge.
