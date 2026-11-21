# FortLedger V2 — Phase 0 verified repository audit

Date: 2026-11-21. Scope: GitHub main after PR #67. This is an evidence-based gap inventory, **not** an operational release approval. The owner currently develops on **macOS**; Windows installation scripts remain available but are not evidence of their deployed OS.

## Architecture and current inventory

| Area | Verified current implementation | V2 gap / risk | Existing evidence |
| --- | --- | --- | --- |
| Architecture | Node 22 / Express / better-sqlite3 / vanilla HTML/CSS/JS; one local SQLite database, schema v7, WAL | No supported staff-LAN HTTPS deployment or mobile client update coordination | `src/server.js`, `src/database.js`, `package.json` |
| Booking and rooms | Seven default room records; date/capacity/maintenance conflicts and room allocation checks; request ID + duplicate-payment protection; status transitions | Real-device simultaneous operator conflicts and latency/UX testing needed | `test/booking-create-idempotency.test.js`, `test/multi-room-allocations.test.js`, `test/booking-transitions.test.js` |
| Staff access | Owner, manager, front desk and cashier authorization; password hashes and short-lived sessions; owner-only unused-entry deletion | Loopback-only origin assumption, no LAN HTTPS / proxy trust model, session store in server memory | `src/auth.js`, `src/access.js`, `test/staff-rbac.test.js` |
| Restaurant | CSV import preview of all rows; paid restaurant bills and checked-in room charge; unmatched manual-room-charge review; LAN Epson receipt print attempt state | **No separated open order → KOT → preparing → ready → served lifecycle**; no kitchen tablet queue, split settlement not established | `src/restaurant.js`, `src/printer.js`, `test/restaurant.test.js`, `test/printer.test.js` |
| Invoices and finance | Immutable booking-linked proformas; review-only GST draft; paise financial calculations; expenses; daily cash close | Legal tax issuance intentionally blocked pending accountant evidence | `src/invoices.js`, `src/tax-draft.js`, `src/daily-close.js`, `test/invoices.test.js` |
| Frontend | Heritage Sky stylesheet layers, mobile responsive rules, role-aware workspace views, browser smoke at 390/768/1440 px | Mobile touch workflows at all requested widths, connection alerts, installable PWA, full WCAG coverage **not demonstrated** | `public/app.js`, `public/styles.css`, `public/heritage-sky*.css`, `browser-tests/smoke.mjs` |
| Backup / recovery | Encrypted backup and restore drills, operator handover, diagnostic and release readiness commands | Offsite credential/backup isolation, actual machine recovery, power loss and device evidence outstanding | `src/encrypted-backups.js`, `src/release-readiness.js`, `docs/PHASE8_OPERATOR_HANDOVER.md` |
| Physical printing | Epson local TCP transport and explicit uncertain delivery/reprint protection | Real paper delivery and printer outage acceptance unverified | `src/printer.js`, `docs/EPSON_PHYSICAL_ACCEPTANCE.md` |

## Baseline evidence

- Latest merged `main` before V2 Phase 0 was GitHub Actions run **44891889218**, which reported successful Linux Node tests, Windows Node tests and Chromium smoke.
- Those runs execute on disposable hosted environments, **not** on the operator's Mac or hotel Epson printer. Local macOS `npm test` and actual-device acceptance remain **not executed/verified** in this phase.
- The existing `npm run release:check` intentionally returns **NOT RELEASED**, pending explicit physical/accountant/recovery proof.

## Risk-prioritized implementation

1. **Phase 0 / first security increment — this PR.** Fail closed on unexpected HTTP Host headers and unsafe `FORTLEDGER_HOST` configurations. Tests ensure normal loopback work, and malicious Host values cannot reach even unauthenticated/static paths. No DB migration, no new external dependency, no LAN enabled.
2. **Phase 1:** Design and test secure HTTPS private staff-LAN ingress, explicit device/network allowlists and CSRF/origin/cookie behavior. Preserve loopback as default. Do not bind arbitrary addresses until auth/proxy review and actual staff network validation. Test concurrency and stale writes before staff multi-device writes.
3. **Phase 2:** Mobile-first booking/rooms/POS navigation, offline/connection indicator, controlled PWA static-only caching with no offline financial mutations; measured responsive and accessibility tests.
4. **Phase 3:** Separate **order** from finalized **bill** with additive schema migration, explicit KOT states, kitchen queue, authorised transitions, idempotent submissions, printer failure-state tests and reconciliation. Preserve existing restaurant bills and financial snapshots.
5. **Phase 4:** Read-only actionable exceptions dashboard across arrivals/rooms, unmatched restaurant charges, printer attempts and closing/backup freshness. No auto-confirmed payments or housekeeping changes.
6. **Phase 5:** Targeted performance/a11y, Mac + hotel OS + phones + Epson device QA, independent recovery, GST accountant review and final human release gate.

## Phase 0 change and safety

- Adds `src/network-policy.js` and a fail-closed HTTP Host-header guard ahead of static files and API routes.
- Explicit local `FORTLEDGER_HOST` configuration is limited to `127.0.0.1` or `localhost`; attempting `0.0.0.0`, a LAN IP or DNS name fails with an actionable exception.
- Host headers must match `localhost` or `127.0.0.1` with a valid optional port. This blocks DNS-rebinding requests to the local process, but **does not itself deliver HTTPS or safe staff LAN access**.
- No schema or financial write changes. Existing backup/restore and release gates unchanged.
- Tests: `node --test test/v2-network-boundary.test.js`, `npm test`, `npm run test:browser` when Chromium installed. The PR's GitHub Actions run is the authoritative baseline verification for this change.

## macOS operating notes

On the existing Mac checkout, preserve the actual `FORTLEDGER_DATA_DIR` setting and back up the SQLite and authentication files before any update. Update only a clean `main` via `git pull --ff-only origin main`, run `npm install --no-audit --no-fund && npm test`, and restart with the established startup method. Local URL remains `http://127.0.0.1:3000`. **Do not set** `FORTLEDGER_HOST=0.0.0.0`, forward router ports, or enable guest-Wi-Fi access. Do not claim release readiness based on CI.

## Next deliverable acceptance gate

Next PR must document a concrete trust boundary, cookie/CSRF security policy for HTTPS, and a tested rollback path before enabling any private-Wi-Fi listener. Staff mobile devices must not get a separate SQLite database. Actual LAN, mobile, printer and GST operational acceptance is human-verified.
