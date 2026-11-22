# FortLedger V3 — Kaizen current-state and decision record

Observed source: main commit 428d0022164cfa34a92ced08c206c24618f1f40f (2026-11-22). This is a source review, **not** physical hotel certification. The one authoritative database remains local SQLite.

## Phase 0: Source-backed current state

| Status | Capability / finding | Evidence |
| --- | --- | --- |
| Implemented, automated checks present | Auth roles and permissions | src/access.js; test/staff-rbac.test.js |
| Implemented, automated checks present | Today attention counts, front-desk queues | public/today-attention.js; public/booking-work-queue.js; test/v2-today-attention.test.js |
| Implemented, automated checks present | Checkout marks allocated rooms dirty, readiness requires staff confirmation | src/booking-transitions.js; src/housekeeping.js; test/housekeeping.test.js |
| Implemented, automated checks present | IST collections, immutable close with later review of changed snapshot | src/daily-collections.js; src/daily-close.js; test/daily-close.test.js |
| Implemented, automated checks present | Read-only restaurant event CSV reconciliation | src/restaurant-reconciliation.js; test/restaurant-reconciliation-export.test.js |
| Implemented, automated checks present | Update indicator with throttling, owner restriction and safe navigation | public/update-notice.js; test/owner-update-notice.test.js; merged #127 |
| Implemented, not physically validated | Windows installer, local emergency and off-device backup mechanisms, staff private-LAN option | docs/WINDOWS_DESKTOP_INSTALLER.md; docs/WINDOWS_STAFF_WIFI.md; PRs #121–#125, #128 |
| Partially implemented | Human shift handover: Today totals lack a compact event-level briefing and direct source details | public/today-attention.js; public/app.js |
| Pending human release gate | Real Windows installer update, independent restore, LAN permissions, Epson paper, hotel workflow and GST accountant acceptance | README.md; docs/PHASE8_RELEASE_GATES.md |
| Deferred by product constraint | KOT, cloud database sync, auto-payment settlement, AI forecasting and unattended tax invoice issuance | docs/PROJECT_BLUEPRINT.md |

The existing source does **not** prove real-device reliability, uninterrupted operation, or financial compliance. No new defect is asserted without reproduction.

## PR overlap decision

Open PR #126 duplicated the core owner-only verified installer header notice from merged PR #127; #126 used another four-hour polling flow while #127 already has a six-hour controller and stale-request protections. The remaining LAN read-only update-check change in #126 expands a deliberately loopback-only security boundary. Decision: **close #126 as superseded**, retain #127. Do not merge two owners of the same behavior. The LAN change, if ever needed, requires a separate security review.

## Five-perspective review (sequential, not invented independent agents)

1. **Operations:** Priority is seeing the identity and reason behind an existing Today alert, plus relevant pickup/stay notes before a shift handover. Do not create a second task list.
2. **UI craftsmanship:** The dashboard already has useful counts and jump actions. A single collapsed, role-scoped detail area is smaller and less disruptive than a new page.
3. **Finance/data:** Handover must derive from the authoritative booking, housekeeping, maintenance, restaurant, close, and backup read models. Never store a parallel payment or alter a folio.
4. **Reliability/security:** No timers or scheduled jobs for this first increment. Recompute when existing authenticated workspace data refreshes. Staff should see only sources their role may already read.
5. **Performance/QA:** Reuse already loaded arrays, no extra HTTP requests, table, migration, poll, DOM virtualization or background CPU cost. Actual navigation and latency measurements still require test instrumentation.

**Disagreement:** Acknowledged persistent tasks would help shifts, but introduce mutable parallel state, concurrency semantics, and migration risk. Start with read-only alerts and source links. Assignments/acknowledgments are deferred until staff validate their practical value.

## Ranked opportunities

| Rank | Improvement | Benefit | Risk/cost | Decision |
| --- | --- | --- | --- | --- |
| 1 | Event-level handover from Today/room/restaurant data | Faster shift briefing, fewer forgotten actions | Low | Implement read-only V3 phase 1 |
| 2 | Explainable closing preparation from existing daily collections | Fewer arithmetic/reconciliation errors | Low-to-medium | Next focused PR; do not automate payment |
| 3 | Reconcile update/release evidence | Avoid misleading notifications | Low | Close #126, retain merged #127 |
| 4 | Optional housekeeping follow-up acknowledgment | Better cleaning traceability | Medium | Defer; checkout already marks rooms dirty |
| 5 | Unified search across private records | Potential navigation savings | Medium privacy/UX cost | Measure first |
| 6 | Automated guest messages | Convenience but consent/privacy risk | High | Do not automate sending |
| 7 | AI anomaly/forecast system | Unclear seven-room benefit | High | Reject |

## Shift handover safety contract

- **Trigger:** Authenticated dashboard load / explicit existing workspace refresh, no background scheduler.
- **Sources:** Existing authorized read-only workspace data from /api/bookings, /api/rooms, /api/maintenance, /api/restaurant/bills, existing closing attention and backup status.
- **Business date:** Asia/Kolkata, passed explicitly from the existing hotel clock.
- **Roles:** Data is gated by existing permission checks before and during handover derivation. Cashier cannot see booking, guest, room, finance or backup details without the corresponding role permission.
- **Output:** One stable key for each source condition; details explain the reason. Notes are indicated but their contents remain behind the existing booking notes dialog.
- **Writes:** None. No idempotency keys or retries are needed because no new event is recorded.
- **Duplicate/recovery:** Repeated source records deduplicate by kind plus record ID. Recompute on refresh, including after restart or downtime; conditions disappear when underlying source state changes.
- **Failure:** Existing workspace error/connection states remain authoritative. No warning is shown as a confirmed transaction, and no synthetic alert triggers a financial change.
- **Audit:** Actions in their original booking, maintenance, restaurant and housekeeping screens retain their original audit mechanism. Merely viewing a handover does not write an audit event.
- **Human boundary:** Checkout, room inspection, assignment, bill matching, closing review and backup recovery are always operator-controlled.

### Workflow

    Authenticated staff signs in
      → Existing role-checked data loading
      → Deterministic handover derivation (no writes)
      → Compact optional briefing with exact source reason
      → Staff opens existing source screen
      → Existing authorization and confirmation controls apply
      → Explicit refresh recomputes the briefing

## Measurements and remaining evidence

Baseline source review only. **Not measured in this environment:** page-load and navigation p50/p95, SQLite EXPLAIN plans, browser render timing, idle CPU/RAM, real Windows installer behavior, PDF speed, backup creation/recovery timing, or real-device screenshot comparisons. Do not claim a performance improvement without reproducible before/after numbers. The change adds no API requests and runs on the already fetched dashboard snapshot; the CI unit and Chromium suites are necessary but not substitutes for local measurements.

For the next performance pass: run npm test and npm run test:browser, then profile browser dashboard navigation with synthetic seven-room plus unusually large historical bookings; compare read-only API latencies and memory before/after using the same fixtures. Investigate bottlenecks before modularizing public/app.js.

## Release and rollback

This work adds only a public pure helper, UI disclosure, styles and tests. No schema version, financial ledger, backup format, installer or network policy changes. A rollback can revert the feature commits without touching the local database. Do not change a live installation before verified separate-drive encrypted restoration and physical acceptance. Existing installer-managed Windows machines require a separately produced reviewed installer; they do not automatically receive PR changes.

Next three focused PRs after handover:
1. Read-only daily closing preview (IST by method, hotel/restaurant source split, unverified bank disclaimer, stale-close exceptions); test no ledger writes and role restrictions.
2. Deterministic exception reasons and source navigation for unresolved room charges and backup freshness, without duplicate persistent task tables.
3. Instrument synthetic browser navigation and SQLite slow query plans; only change actual bottlenecks, then run responsive/keyboard/200% zoom regression.

Do not auto-merge finance, security, installer, backup or migration changes. Physical release gates remain incomplete.
