# Optional pickup and stay notes — booking operations

## Why this is separate from price and invoice

Hotel staff sometimes need arrival instructions, station/airport pickup reminders, arrival-time changes, accessibility help or other stay arrangements. They must not force the operator to use the invoice's free text, change a quoted room rate, or create transport payments accidentally.

## Implemented contract

- **Two optional text fields**, not additional required booking clicks: *Pickup / arrival details* (500 characters) and *Other stay instructions* (1,000 characters). A single collapsed **Pickup & stay notes (optional)** block in New/Edit booking keeps the default workflow fast. Existing rows show small *Pickup noted* / *Stay notes* cues, without exposing note text in the entire ledger.
- **Separate booking Notes action** under More actions. Available even after a proforma has been issued or after a guest checks out, when the normal financial-contract Edit action is locked. Authorized booking staff can view, correct or clear notes without modifying room allocations, room rate, advances, invoice snapshots, payments or status.
- **Schema v12**, additive and transactional, fills historical bookings with empty strings. The regular booking-create request fingerprint includes *only nonblank* notes, keeping old empty-note replay fingerprints compatible while rejecting the reuse of a request ID with altered nonempty notes. Old clients updating a booking that omit either field preserve its previous notes.
- **Audited** `PATCH /api/bookings/:id/operational-notes` with existing `bookings.write` permission. The audit identifies changed fields, actor and lengths but **does not duplicate note text** in the audit payload. The booking read endpoint already uses `bookings.read` RBAC; cashier access is denied.
- **Privacy**: the operator should use only practical arrival/transfer information, never identity scans, full payment-card details or sensitive personal secrets. No travel company is contacted, no reminder is scheduled, no transport fare is invoiced and notes are not copied to GST documents by default.

## Deliberately not added

No separate pickup CRM, driver dispatch, WhatsApp automation, fare ledger or public guest-facing notes form. If transport becomes a major operation, a later explicit transfer-reservation module may add date/time, origin, vehicle and staff-assigned status *without mixing fare and accommodation*.

## Verification and rollout

Node migrations (v11→v12), idempotent create/replay, ownership/role guard, invoice immutability, note-only audit and Chromium mobile create/edit/after-proforma tests. Existing Mac checkout at PR #83 does not contain this update: a protected backup and a stopped-server Git sync are still required. Older v11 or v8 data migrates only on next startup of the new code. Release remains **ACTIVE ALPHA — NOT RELEASED**.
