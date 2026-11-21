# V2 reliability batch — workspace synchronization and saved receipts

The Mac operator requested simple, reliable booking/room/POS workflows. This iteration introduces no new schema, APIs, payment processing, private LAN listener, or kitchen order states.

## Workspace synchronization
- The **Refresh** action fetches current rooms, bookings, folios, invoice list, restaurant bills and other role-authorized records using existing GET endpoints. It does not replay a POST, payment, booking or print attempt.
- Every refresh has a revision number. If an earlier network response finishes after a newer refresh started, the outdated snapshot is discarded **before modifying the visible hotel record lists**.
- If refresh fails, the previous screen stays visible with an explicit warning that records may be outdated. Operators should check the ledger before acting on an uncertain transaction.
- Refresh is manual. No automatic server write, network reconnect replay or offline transaction queue is introduced.

## Saved restaurant receipt
- The Saved restaurant bills section supports searching by saved bill ID, payment method and manually captured guest/room information. The original immutable saved receipt opens from the list.
- It displays 15 rows initially and expands 20 at a time; all bills returned by existing server API remain searchable.
- After confirmation of a single saved restaurant bill, including after a lost POST response, the confirmation message contains a direct link to **the original receipt ID**, independent of whether the subsequent workspace refresh succeeds.
- This does **not** verify a UPI/card/bank transfer and does not prove Epson printer paper physically emerged.

## Acceptance and limits
- Existing server room/booking allocation, housekeeping permissions and financial idempotency rules remain authoritative.
- Unit regression checks the revision guard and UI controls; Chromium checks creating one saved food bill after a deliberately lost response, receipt lookup/search, and a read-only refresh.
- Linux, Windows and Chromium CI are necessary, not sufficient; actual Mac/browser/phone/physical Epson acceptance is still pending.
- FortLedger remains an alpha, NOT RELEASED.
