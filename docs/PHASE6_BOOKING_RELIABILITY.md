# Phase 6 — booking safety and operational journey acceptance

## Engineering decision
Use the same philosophy: **Understand first → Improve second → Automate third**. Hotel staff must confirm check-in, checkout, cleaning and money received. No unattended financial or occupancy transitions.

## PR #50 — retry-safe creation
- Problem: an already-committed booking and initial advance could be re-created after an HTTP response was lost.
- Additive SQLite v7 request ledger stores the original response and a canonical payload fingerprint for a supplied request ID. No old guest/finance records modified.
- A retry with the same ID and equivalent details returns the original booking (HTTP 200) even if room inventory is now booked or the booking was subsequently amended.
- A reused ID with changed details is rejected. The booking, room allocations, initial advance, audit and idempotency marker are committed together or rolled back together.
- Existing clients without a request ID still work but cannot guarantee idempotency; staff must review ledger before retry.
- Browser keeps the same request ID for unchanged details until success or form edit.

## PR #51 — lifecycle UI safety
- Prevent repeated status submissions while the first change is in flight.
- Require explicit consequences for cancellation; cancellation does not itself move money.
- Distinguish a confirmed status change from a failed view refresh.

## PR #52 — integrated synthetic guest journey
- A disposable local SQLite fixture exercises two back-to-back room bookings, repeat booking POST, initial advance, check-in, room-charge restaurant bill, combined folio settlement, physical checkout, housekeeping dirty state, cleaning confirmation, and next guest check-in.
- Tests assert exact counts, amounts and immutable payments. No production guest records or external services used.

## Remaining release gates
- Actual hotel-device validation on Windows, browser keyboard / 200% zoom and screen-reader testing, and real seven-room staff walkthrough.
- Epson TM-T82 physical printing, external encrypted-backup restore to replacement device, and accountant-approved final GST invoice process.
- Do not represent the completed automated fixture as physical hardware verification or a production launch.
