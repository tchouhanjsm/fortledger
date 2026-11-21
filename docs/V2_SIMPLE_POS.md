# V2 restaurant scope: simple bills only

The owner explicitly rejected kitchen order tickets, open-order queues and preparation states. **Do not implement KOT, kitchen display, order-state machines or split tender workflows without a new requirement.**

## Staff path

1. Open **Restaurant**, search menu, add items and adjust quantities.
2. Select **Cash**, **UPI**, **Card**, or **Charge to room**.
3. For a room charge, select a checked-in guest. If identity is uncertain, use existing manual unmatched charge review; do **not** automatically assign it to a folio.
4. Confirm the bill once. For cash/UPI/card, staff must manually verify actual receipt of funds; recording a UPI payment is not bank verification.
5. Print the saved receipt using browser print or configured Epson LAN. Sending bytes to Epson does **not** prove paper printed.

## Uncertain network behavior

A request now carries a 16–80 character unique UUID. SQLite stores the snapshot and the request ledger inside one atomic transaction. A retry with identical details returns the original receipt, without another bill, even if menu prices or the guest's occupancy status change after the original save. Reusing the UUID with changed details is rejected. The browser checks the recorded request ID when a POST response is lost; if the server is down it preserves the original request for later retry. No offline financial submission is enabled.

Additive table `restaurant_bill_requests` is created using existing idempotent schema initialization. Existing restaurant bills are unchanged and are **not** backfilled. The table must be kept with the rest of SQLite during backup/recovery. No paid service, external payment verification, extra server or second database is introduced.

## Acceptance

CI Linux/Windows, authenticated role tests and Chromium UI must remain green. Actual Mac bill creation, checkout reconciliation and Epson physical print remain human acceptance gates. The product remains **NOT RELEASED** until the original recovery/hardware/accountant gates have evidence.
