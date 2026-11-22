# FortLedger finance invariant — booked stay, proforma and folio

**Audit finding FL-001 (P0) — corrected in this batch.**

An immutable proforma is a display/snapshot of the contracted booking amount. Custom line descriptions and splits remain possible **only if the exact total in integer paise equals** `bookingTotals(booking).total_paise`. Previously the invoice could independently claim INR 8,000 when the booking and folio charged INR 9,000. That would leave an unresolvable difference once the proforma locked the booking rate.

## Current policy (alpha)

- Booking rate × room count × nights is the one accommodation receivable until a reviewed, audited adjustment/versioning process exists.
- New proforma issuance rejects mismatched accommodation totals **before** allocating an invoice sequence number or writing the snapshot.
- Existing proformas remain immutable. For a historical mismatch, `GET /api/bookings/:id/folio` includes an `invoice_discrepancy` object with invoice number, booked amount and archived proforma amount.
- Combined settlement and physical checkout fail closed for historical mismatches, even if the operator acknowledges an outstanding balance. The UI displays the discrepancy when attempting checkout. **Do not edit historical documents or live SQLite manually.**
- Regular standalone restaurant room-bill settlements are left unchanged; the mismatch affects accommodation contract reconciliation.
- A deliberate manager/owner-reviewed accommodation amendment or credit workflow remains **not implemented**, so an already-issued mismatched historic document needs separate professional operational review. The system does not silently rewrite existing charges.

## Reproduction and acceptance

`node --test test/v2-invoice-folio-contract.test.js` exercises a 2-night × ₹4,500 booking, rejects a proposed ₹8,000 proforma, verifies no sequence number consumed, permits a matching two-line ₹9,000 snapshot, and compares it against the folio. It also simulates a previously issued mismatched proforma and proves combined payment and checkout cannot proceed while preserving its original data. CI still runs the existing PDF and invoice history tests.

No database migration, financial deletion, tax-invoice enablement, or new dependency. Legal GST tax rules and actual staff procedures remain subject to professional acceptance.
