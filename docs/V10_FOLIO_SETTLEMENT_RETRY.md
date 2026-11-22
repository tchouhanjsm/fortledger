# V10 — retry-safe folio settlements

**Why:** Hotel payment receipts and restaurant bills already had stable idempotency keys. Combined checkout and per-bill room-charge settlement did not. A lost HTTP response could leave staff uncertain whether money had been saved and a retry would fail with "No outstanding amount" or "already settled", without confirming the original receipt.

## Behavior

- Authenticated hotel deployments require a client-supplied `request_id` (16–80 safe characters) for both `POST /api/bookings/:id/folio/settle-combined` and `POST /api/bookings/:id/folio/room-bills/:billId/settle`. Old in-memory unauthenticated test harnesses retain legacy calls.
- The new additive `folio_settlement_requests` table stores the request fingerprint and exact original response in the **same SQLite transaction** as the payment and/or restaurant settlement. Unchanged retries return HTTP 200 and `already_recorded:true`, even if the booking was checked out subsequently. Modified intents with the same ID fail; a fresh ID cannot settle already-paid items.
- Browser folio actions retain the pending UUID and submitted payment choices after an ambiguous fetch error. Staff see an explicit *outcome not confirmed* warning and can retry unchanged details or inspect the folio before recording another payment. Only a confirmed response clears the pending key.
- Unique restaurant settlement constraints and existing ledger/audit history remain intact. Original payment amounts, invoices, receipt numbers and fiscal close records are not rewritten. The bank-transfer reference still **is not evidence that funds arrived**.

## Database and installation

Database schema increments from v9 to v10 using an additive transaction. Do **not** backfill old settlements as newly replayable requests: only new v10 transactions get request markers. For Mac upgrades, stop the old application, verify an independent encrypted backup and the unchanged data path, update code and dependencies, then start the app and run `npm run doctor`. A missing or incompatible new request table fails on startup rather than accepting financial writes without the expected protection.

Regression tests cover lost-response replays, distinct IDs, conflicting payloads, food-only/accommodation-only settlements, checked-out bookings, authenticated HTTP and an on-disk v9-to-v10 migration. Physical bank/paper and replacement-device recovery acceptance is still outstanding.
