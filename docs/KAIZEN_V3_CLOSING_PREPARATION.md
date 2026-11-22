# V3 Phase 2 — Read-only daily closing preparation

## Existing source of truth

This improvement does not create a second daily ledger, change daily_closes, or introduce a new financial API. It reads the existing GET /api/finance/daily?date=YYYY-MM-DD, derived in src/daily-collections.js from hotel payment events, restaurant direct receipts, room bill settlements, refunds and expenses.

The existing GET /api/finance/closing and immutable POST /api/finance/closing remain authoritative for recorded daily closing. The new preview belongs inside the current End-of-day cash closing disclosure and opens **only on request**.

## Staff flow

    Owner/manager opens End-of-day cash closing
      → Existing read-only IST daily ledger GET for selected date
      → Check method totals against source breakdown
      → Show separate hotel, restaurant, refund, expense and net receipt amounts
      → Flag unmatched/unpaid room charges and legacy unrecorded methods
      → Staff independently counts cash and verifies bank/UPI/card deposits
      → Existing explicit confirmation / immutable closing workflow (unchanged)

Every amount is integer paise until display. Net cash movement is operator-recorded receipts minus recorded expenses, **not** profit. The closing preview does not independently verify any payment in a bank. Outstanding room charges are receivables, not cash. Cross-total mismatches show an error rather than an auto-correction. Refund-heavy days with negative net recorded receipts remain legitimate.

## Automation safety

| Dimension | Rule |
| --- | --- |
| Trigger | Staff opens closing disclosure or selects a different business date |
| Authority | Existing daily collections API and role-scoped finance.read authorization |
| Time zone | Asia/Kolkata business date |
| Database writes | None |
| Persistence / IDs | None; no shadow tasks or saved transaction |
| Retry | Reopen the disclosure to request a fresh read-only snapshot |
| Duplicate/restart behavior | Nothing scheduled; app reads current durable data after restart |
| Concurrency | Ignore stale HTTP responses when date or disclosure changes |
| Errors | Stop preview; show error; never fabricate totals or close automatically |
| Audit | Existing closing and review audit events remain the only write side effects |
| Human boundary | Count physical cash and review electronic bank receipts before using unchanged closing form |

## Acceptance and release

test/daily-close-preparation.test.js covers deterministic method reconciliation, separate room-charge receivables, input immutability, negative net receipt days, mismatch failure and UI permission boundary. Continue running complete Ubuntu, Windows and Chromium CI suites. Device, backup recovery, network, printer and accountant approvals in docs/PHASE8_RELEASE_GATES.md remain outstanding.

**Rollback:** Revert frontend module, presentation and tests. No migration or ledger rollback is involved.

**No measured speed gain is claimed.** On-demand loading avoids adding new read-only financial requests to the closed dashboard on ordinary staff navigation. For performance evidence, record the selected day's API p50/p95 using synthetic data and repeat after future optimizations.
