# V3 Phase 5 — Incremental booking cards, complete local ledger

## Evidence and priority

The synthetic Phase 4 baseline measured /api/bookings p95 at 1.64 ms for 28 bookings and 13.69 ms for 700 on a GitHub Ubuntu runner. This **does not prove a browser rendering problem**, but the old frontend unconditionally created an entire group of complex interactive buttons/forms for every matching historical booking, even on a seven-room hotel whose reception typically needs only a few current reservations at a time.

The lowest-risk response is to bound **DOM presentation**, retaining the complete data and all booking status, calendar, invoice, payment and financial logic. This is not SQL pagination and does not remove or reorder saved bookings.

## Scope and safety

- The first 40 matching bookings render as cards. **Show 40 more bookings** loads subsequent cards into the DOM. The button disappears when the match set is exhausted.
- Search, role-based work queues and filters apply to all fetched booking records **before** the card limit. Search finds older entries that are not initially rendered. Changing a query, status or queue resets to the first page.
- The status area says displayed cards / matching records, with total saved count when filtered.
- A refresh keeps the chosen visible count for the same filters and recomputes the current match set. No new HTTP endpoints, SQL migrations, background polls, caching of guest data, persistent paging cursors or financial writes.
- The existing protected server APIs remain the authoritative ledger; no money, check-in, room allocation, proforma or restaurant logic has changed.
- On 390px Chromium, a disposable test seeds 95 synthetic historical bookings, checks 40/80/95 card counts, global search for booking 94, filter reset, and preservation of all 95 saved records.

## Verification boundary

Tests and CI are synthetic; actual staff device p50/p95, 200% zoom, keyboard navigation and acceptance must still be checked on-site. This change is reversible by reverting the view helper, one button and presentation code, leaving the SQLite schema/data untouched. Do not claim measured faster pages without real browser before/after traces.
