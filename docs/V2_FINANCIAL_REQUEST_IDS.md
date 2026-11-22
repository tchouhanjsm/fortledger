# Required financial request identities (FL-007)

Authenticated FortLedger hotel APIs now **require** a caller-supplied `request_id` with 16–80 safe characters for:
- `POST /api/bookings` (including an initial advance);
- `POST /api/bookings/:id/payments`;
- `POST /api/restaurant/bills`.

The existing browser client supplies stable UUIDs and preserves the same request ID on an uncertain response. A retry with an unchanged payload returns the prior stored result, while a changed payload with the same key fails. The server **never invents a new ID** to suppress a missing one, because that would defeat retry safety. Existing stored bookings, payments and bills are not backfilled or changed.

Older custom clients that omit `request_id` will now get HTTP 400 and must be updated before attempting new financial writes. This deliberate breaking API change is safer than silently accepting duplicate receipts. Owner should verify third-party/manual clients and protect an independently verified backup before updating the hotel Mac. Financial reads and historical ledger rows remain available.

**Test-fixture compatibility only:** unauthenticated in-memory `createApp(db)` harnesses continue accepting historical no-key calls so existing offline synthetic tests can validate prior datasets. The actual `npm start` refuses to run without configured authentication; those authenticated servers enforce IDs. The new regression explicitly logs in through the authenticated HTTP API to verify missing-key rejection. Do not use an unauthenticated test harness for real hotel data.
