# FortLedger — Kaizen product audit and implementation record

**Scope:** current `main` as reviewed on 22 November 2026, seven-room Garh Jaisal local-first Node.js/Express/SQLite hotel + **simple restaurant billing only**. Source, docs, schema and tests were inspected with connected GitHub tools. This audit is source-level and GitHub Actions/browser-test backed; **no real hotel Mac, Epson paper, private staff network, physical backups, or genuine guest ledger were inspected.** The app remains **ACTIVE ALPHA — NOT RELEASED**.

## Design intent

Apply practical Japanese-inspired engineering, not visual motifs:

- **Kaizen**: each confirmed defect gets a small reviewable PR and a regression
- **Kanso**: reuse the current task page, minimize navigation and admin clutter
- **Ma**: leave financial review content room to breathe; prioritize next action
- **Poka-yoke**: validate room, price, CSV, actor and payment intent *server-side*
- **Omotenashi**: arrivals, in-house, departures, pending folio and housekeeper prompts at point of work
- **Jidoka**: stop uncertain payment or changed-price saves; tell the operator how to recover
- **Shokunin**: consistent Heritage Sky design, clear text statuses, focus, legible rupee totals, 44+ px touch controls

No Japanese decorations; preserve the hotel's Indian hospitality identity and use local date `Asia/Kolkata`.

## What exists already (do not duplicate)

| Workflow | Source | Verified existing behavior |
| --- | --- | --- |
| Reservation creation / safe retries | `src/booking-create.js`, `src/server.js`, PR #65 | Stable request IDs and read-only recovery after lost HTTP response |
| Proforma directly from Invoices | `src/invoices.js`, `public/app.js`, PR #66 | Direct booking choice/new guest and single-page A4 PDF; previously issued snapshot immutable |
| Room board / housekeeping | `src/housekeeping.js`, `src/maintenance.js`, `public/app.js` | Physical occupancy, readiness and maintenance are distinct states |
| Restaurant bill flow | `src/restaurant.js`, PRs #105–#106 | Editable **unsaved** draft, review → save → receipt, search, safe reprint, room-charge history |
| Entire CSV preview | `src/restaurant.js`, PR #67 | 500-row-capable parser and full review, not a 5-row teaser |
| Financial ledgers / roles | `src/financial-audit.js`, `src/access.js`, `src/folio.js` | Immutable receipt snapshots, real payment records, refunds, role gates, exact retry |
| Accommodation commercial changes | `src/accommodation-adjustments.js`, PR #104 | Separate reviewed charge/credit after proforma, without editing the historical contract |
| Private Mac release evidence | `src/release-readiness.js`, PR #103 | Six human acceptance gates, never automated production certification |

## Prioritized findings, evidence and disposition

| Priority | Classification | Evidence / affected source | Outcome |
| --- | --- | --- | --- |
| P0 | Confirmed defect | `public/app.js` accepted an old async CSV preview after a File selection changed | **Resolved #107:** File identity + generation guard, stale response ignored |
| P0 | Confirmed defect | `src/restaurant.js` preview not compared to current price/GST; `/import` accepted raw changes | **Resolved #107:** signed exact-state diff, new/updated/unchanged/suspicious, mandatory approval |
| P0 | Operational risk | `src/restaurant.js` saved at current DB price even when the cashier reviewed an older menu | **Resolved #110:** authenticated per-line expected price/GST, 409 drift rejection and safe replay |
| P1 | Confirmed authorization defect | `src/access.js` gave `restaurant.write` both sale creation and menu import | **Resolved #110:** manager/owner-only `menu.manage` for imports |
| P1 | Confirmed navigation defect | `public/app.js` daily-close warning jumped to Hotel Settings; form actually on Dashboard | **Resolved #107:** correct dashboard date and review target |
| P1 | Confirmed interaction defect | Several hash switches scrolled before target was visible, then render reset scroll | **Resolved #108:** shared route-aware focus/scroll handoff |
| P1 | Design issue | No primary in-house front-desk queue; statuses otherwise available in generic filter | **Resolved #109:** arrivals / in-house / departures / all, overdue stays retained |
| P1 | Design issue | Bill review caused a focused button to disappear with no replacement focus | **Resolved #111:** focus review heading, return to menu search, announce/focus receipt result |
| P2 | Operational risk | A saved and paid food receipt cannot be amended with attributable reversal | **Pending:** design append-only correction/credit with accountant and audit controls |
| P2 | Design issue | No operator UI to pause or restore an individual dish | **Resolved #112:** manager-only, audited per-item availability with stale-state rejection; historical snapshots preserved |
| P2 | Design issue | Single-item price or GST edits still require CSV | **Pending:** small manager-only price editor with explicit price/tax review and confirmation |
| P2 | Operational need | No dedicated method-by-method restaurant export with close reconciliation | **Pending:** lightweight read-only CSV/report, not a second ledger |
| P0 release gate | Unverified physical requirement | Mac backup/restore, Epson paper, HTTPS staff network, actual staff signoff, GST | **Pending physical / professional acceptance**, not verifiable in CI |

**Unverified hypotheses:** staff task speed, 200% real-device zoom, printer behavior under a cut network and operator comprehension still need on-site timed sessions. Do not present these as measured wins.

## Information architecture and end-to-end operator journeys

1. **Receptionist — arrivals:** Dashboard attention → Arrivals queue → verify guest/stay/assigned room → check readiness → physical check-in. In-house includes genuinely checked-in guests (even if overdue). Departures → inspect the actual guest folio and payment state → checkout → cleaning required. Always distinguish a future booking from a person physically present.
2. **Restaurant cashier — paid bill:** Search/filter menu → add quantities → review all lines/prices/tax → manually confirm actual cash/UPI/card receipt → immutable save with UUID → print/view original receipt. If a price changes or response is uncertain, **stop**, refresh or recover the same request ID, never assume payment failed.
3. **Restaurant cashier — room charge:** Choose checked-in guest and correct room, or create explicitly unmatched manual charge → review unpaid status → save immutable room charge → manager-approved linking if original name/room differs → later settle from folio. An unpaid room charge is never counted as collected cash.
4. **Manager — CSV:** Select actual file → server compare & preview every row → search/category/change-only filters → review old/new price and GST → acknowledge flagged differences → transactional import bound to exact file and unchanged menu state. Manager can import; cashier cannot.
5. **Housekeeping:** See physical room occupancy, cleaning and maintenance separately → mark cleaning/ready only for authorized physical work; a vacant room is not automatically ready.
6. **Owner — finance and control:** Dashboard exception → target closing/room/backup work → inspect actual ledger + immutable audit → review discrepancy. Backup, printer and GST live verification require independent signoff.

## Coherent design system specification

Existing `public/heritage-sky.css` is **the source of truth**, not a new theme to replace. `public/heritage-sky-operations.css`, `public/heritage-sky-rooms.css` and `public/heritage-sky-finance.css` are incremental task-specific layers.

| Intent | Existing token / specification |
| --- | --- |
| Structure | `--hs-ink:#17263e`, warm deep navy; sidebar `#192b42` |
| Background and surfaces | `--hs-ivory:#faf7f2`; `--hs-surface:#fffefa` |
| Positive state | `--hs-sage:#207e6c`, always accompanied by explicit wording |
| Heritage accent | `--hs-gold:#b7824f`, sparingly on selected controls |
| Focus | `--hs-focus:#245da8`, 3 px visible outline for keyboard interactions |
| Errors / warnings | `--hs-danger:#a12837`, `--hs-warning:#8d531b` and text action/recovery |
| Typography | System `Inter` fallback; Georgian-style serif headings where currently used; tabular numeric amounts |
| Spacing | Target an 8 px rhythm for new layouts; avoid restyling every existing pixel in one PR |
| Controls | Min approx. 42–48 px, visible labels, no color-only statuses, accessible focus and polite messages |
| Responsive | Existing 360/390/768/1024/1280/1440/1920 px browser smoke and mobile/desktop task flow |
| Motion | Respect existing `prefers-reduced-motion` setting; no animation added |

These are source values/standards, **not a verified WCAG 2.2 AA certification**. Contrast, keyboard-only complete journeys and screen reader semantics require continued real-device/assistive-technology testing.

## Delivery and verification matrix

- **#107 correctness:** stale CSV race, exact signed diff, flagged price/GST approvals, closing link, regression and Chromium file-switch race.
- **#108 shared UI:** one route/focus-aware navigation utility, permission and same/cross-route tests.
- **#109 front desk:** true in-house/overdue queue, plain-language next action, work-queue and browser regressions.
- **#110 restaurant/payment:** manager-only price changes, reviewed menu price/GST invariant, original bill replay after price update, cashier browser role tests.
- **#111 quality/documentation:** actual keyboard focus for draft/review/save and operator-centered source audit.
- **#112 menu availability:** manager-only searchable active/inactive items, optimistic version check, audit events, accurate disabled-item cart recovery, real browser role/task journey.

Every PR was reviewed against current `main` and merged only after its Ubuntu Node tests, Windows Node tests, and Chromium smoke jobs were green. This is genuine **synthetic test evidence**, not hotel production acceptance. No screenshots of actual hotel guest data have been created, published or claimed; before/after human visual walkthrough remains a physical-device task.

## Next priority after these batches

1. Audited post-save restaurant correction/credit with precise tax/accounting effects and owner/manager boundaries.
2. Manager-only single-item price/GST editor with safe signed preview; #112 already added item visibility/availability and search.
3. Read-only daily reconciliation export aligned to financial closing.
4. Mac staff test, Epson print, backup restore on replacement Mac, staff network isolation, accountant signoff, owner go/no-go.

**Release verdict remains NOT RELEASED.** Local-first, zero recurring service cost and a simple bill-only restaurant experience take priority over extra screens, framework rewrites or enterprise modules.

## Post-audit Kaizen follow-up

PR #112 adds per-item pause/restore controls and tests the manager's mobile-width journey. Saved-bill corrections and reconciliation export are not included. The original source-audit results remain scoped to the 22 November 2026 main snapshot; practical live Mac, staff, printer and accountant verification remain outstanding.
