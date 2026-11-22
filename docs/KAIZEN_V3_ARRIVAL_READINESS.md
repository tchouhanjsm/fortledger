# V3 Phase 3 — Explainable arrival-readiness and exception navigation

## Root-cause finding

The existing Today cards count dirty rooms and arrivals separately; staff can miss that a particular reserved arrival has a named room still dirty, cleaning, inactive or blocked by maintenance. The existing server check-in gate correctly refuses those conditions at transition time, but the dashboard should explain the likely blocker *before* reception attempts check-in.

## Read-only workflow

- Uses the already-fetched booking, room and (when role allows) open maintenance data; no new HTTP, SQL, remote service, persistent task table or schema migration.
- For reserved arrivals due today, overdue with a currently unexpired booked stay, or tomorrow, compares actual assigned room IDs against live room readiness. Incomplete assignments continue to use the existing separate allocation alert.
- For a current-day arrival, reports the room API's current-day out-of-service flag. **Never** interprets that flag as evidence of tomorrow's maintenance state.
- When authorized maintenance data is present, compares each assigned room's unresolved blocking maintenance against the **entire booking stay interval**, matching the server's existing transactional check-in restriction.
- Groups room reasons in one alert per booking, with direct keyboard-focus navigation to the exact existing room record. Today's housekeeping, tomorrow's maintenance and physically completed check-in remain independent conditions.
- Unmatched restaurant food bill alerts now show the operator-recorded room identifier (when provided) and focus the specific source bill after filtering, without marking it paid or linked.
- Backup alerts use an allowlisted state-based reason (missing, stale, unconfigured, invalid, unavailable, same-PC-only), never display filesystem paths or assert restore certification. Owner opens existing My Profile backup controls; managers are directed to existing hotel settings.

## Safety and test boundaries

All output is client-side explanatory text. Backend role permissions, check-in readiness, maintenance, folio and payment invariants remain unchanged. Front desk never writes through the handover action; cashier cannot obtain booking or room data. No guest-note contents are copied into the handover.

Tests cover role restrictions, date/checkout boundaries, duplicate source records, missing/inactive rooms, cleaning/dirty states, maintenance overlap, tomorrow-date claims, distinct backup states, exact room and bill navigation. Chromium 390px smoke uses synthetic in-memory database and confirms clicking the alert focuses the room without changing its physical state.

A physical hotel staff test still must confirm the room before updating housekeeping to Ready. No unsigned installer or release gate is silently bypassed.
