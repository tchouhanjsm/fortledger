# Restaurant event reconciliation CSV (read-only)

## Operator workflow

In the Restaurant workspace, owner and manager can expand **Daily restaurant reconciliation — download CSV**, choose an IST hotel business date, and download `fortledger-restaurant-YYYY-MM-DD.csv`. A cashier can continue creating bills but cannot see or call this finance-only report. The file does not contain guest names, room names, notes or menu-item free text.

## What each row means

- `direct_bill_received`: a staff-recorded cash/UPI/card restaurant bill made on this IST date. It is **not independently bank-verified**.
- `room_charge_created`: a room charge opened on this date. It is **not a receipt**, even if later settled.
- `room_bill_settled`: a previously or currently opened room bill whose settlement was recorded on this date. Count it only as a recorded receipt **on the settlement date**, not again on creation.

Amounts are rupees to two decimals. `recorded_received_inr` and `room_charge_created_inr` can be totaled separately; `reference_bill_total_inr_not_to_sum` is a contextual bill amount repeated on settlement rows and **must not be summed**. No GST invoice is produced.

All dates use Asia/Kolkata regardless of server locale; SQLite event timestamps are UTC. The CSV is computed from existing immutable restaurant bills and settlement records, with no database writes. The total of recorded receipts must agree with the existing `dailyCollections(...).restaurant_received_paise` ledger report or export fails closed.

## Implementation evidence

- `src/restaurant-reconciliation.js`: single-source event queries, explicit classification, privacy-safe CSV serialization and reconciliation check.
- `src/server.js`: GET `/api/finance/restaurant/reconciliation.csv?date=YYYY-MM-DD`, protected by existing `finance.read` permission and no-store cache policy.
- `public/index.html`, `public/app.js`, `public/heritage-sky-finance.css`: small permission-gated manager download interface; no kitchen POS or billing workflow changes.
- `test/restaurant-reconciliation-export.test.js`: IST midnight boundary, multi-day settlement, no guest-data leakage, no DB mutation, cashier/front-desk denial.
- `browser-tests/auth-smoke.mjs`: authenticated manager download on a 390px Chromium viewport and cashier access denial.

## Explicit limits

This is a *reconciliation aid*, not automatic cash verification, proof of receipt, a GST sales return, a statutory invoice, or a certified bank statement. Financial operators must still compare recorded events to physical cash, UPI/card settlements, and payout statements. Corrections/credits to already-issued restaurant receipts remain a separate, not-yet-implemented transaction-design and accountant-review task. FortLedger remains ACTIVE ALPHA; live Mac and printer validation are outstanding.
