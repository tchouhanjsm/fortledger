# Heritage Sky — staged implementation and acceptance

## Verified baseline (2026-11-21)
- Node.js 22+, Express, SQLite/better-sqlite3, PDFKit and vanilla HTML/CSS/JavaScript; no frontend build pipeline.
- Existing role-aware hash navigation: dashboard, bookings, rooms, guests, proformas, restaurant, settings and profile. These are views over existing markup, **not independent routes**.
- Current owner/manager analytics explicitly shows **booked**, GST-inclusive ADR/RevPAR, not net earned revenue. Financial closes are immutable and can become stale; expenses are immutable; housekeeping requires real staff confirmation.
- PRs #34–#38, #39–#41 are merged. Schema is version 6.
- Prior mobile CSS hid navigation and prior tablet CSS erased nav labels: addressed in this phase.
- Last completed main workflow was successful; app-level device and visual acceptance are **not** established here.

## Phase 1 — Design foundation (PR #42)
Files: new `public/heritage-sky.css`, updated `public/index.html`, this document.

Semantic palette, system-font fallback, content spacing, offline assets, color-independent states, keyboard-visible focus and reduced motion. Mobile retains accessible real navigation destinations. No changes to API, financial formulas or persistence.

**Unverified gates:** physical keyboard and screen-reader navigation, contrast audit, long translated labels, text zoom and actual screenshots at requested viewport widths.

## Phase 2 — Dashboard and booking usability
Review before implementation: `renderDashboard`, `renderBookings`, `renderCalendar`, `openNew`, `openEdit` in `public/app.js`; the existing room, booking and folio API contracts.

- Show a read-only seven-room board using the existing room and checked-in booking records. Keep housekeeping readiness distinct from occupancy and maintenance outage.
- Improve action priority for bookings; keep backend transition and permission checks authoritative.
- Preserve the category-hold and named-room conflict checks; do not invent a new occupancy algorithm.
- Add responsive booking details and keyboard-friendly dialogs; test real permission boundaries.

## Phase 3 — Room turnover
Review `renderRooms`, `renderMaintenance` and PRs #37/#39. Surface Ready / Needs cleaning / Cleaning and out-of-service as *separate* states. Only authorized staff can update them. Confirm physically ready explicitly. Verify simultaneous arrival / checkout date edge cases.

## Phase 4 — Finance, restaurant and security
Review PRs #36/#38/#35/#34 and existing modules. Give expense-entry, immutable close and stale close status clear task hierarchy. Do not create frontend-only cash calculations or suggest bank reconciliation is automatic. Improve menu and folio speed without writing duplicate bills. Preserve password-change session revocation and read-only backup visibility; a recovery rehearsal is not external recovery.

## Phase 5 — Stabilization
- Run `npm test` on supported Linux and Windows environments. Inspect actual CI results.
- Verify 360, 390, 768, 1024, 1280, 1440 and 1920 px plus 200% zoom. Inspect focus order, screen-reader status and contrast to WCAG 2.2 AA.
- Capture **real application** before/after screenshots. No fabricated records or static mockups.
- Exercise booking lifecycle, room conflicts, checkout turnover, expense replay, stale close, cashier access restrictions and local offline restart.
- Physically test Epson TM-T82, external-drive recovery and statutory invoice process separately before release.

## Non-negotiable release blockers
Final GST invoices must stay disabled until independent compliance review and signed issuance design. Offline recovery on actual Windows hardware and physical printer behavior remain unverified. A green automated test suite alone is not a production release.

## Engineering method
**Understand first → Improve second → Automate third.** For each incremental PR record scope, current behavior, exact changed files, migration impact, tests executed, manual checks and outstanding risks. No mandatory cloud, no redesign-driven backend rewrite, no irreversible financial automation.
