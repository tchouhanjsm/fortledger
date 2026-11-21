# Phase 7 — readiness, browser testing and low-click reception UX

## Completed changes in this batch
- **#53 Heritage Sky desk polish:** three primary booking actions visible; infrequent payments/refunds/proforma are in a native keyboard-accessible More actions disclosure. Explicit `[hidden]` rule prevents CSS from showing hidden role-protected views.
- **#54 Backup authenticity:** Doctor no longer trusts a recent encrypted filename alone; it verifies authentication, decrypted SQLite integrity and seven-room inventory in disposable isolated scratch. Reports corrupt or wrong-passphrase backups as failed. A local backup directory is not proof of a second drive.
- **#55 Real Chromium tests:** a development-only Playwright smoke test runs an isolated local app with synthetic SQLite data, covering booking creation, received-payment dialog, responsive navigation at 390/768/1440px and JavaScript errors. CI uses a pinned supported Ubuntu image. No production browser bundle or hosted service.

## Acceptance evidence levels
- Source-contract/unit tests and Linux/Windows CI establish code regressions.
- Chromium smoke establishes genuine headless-browser behavior in GitHub Actions, not actual guest-staff-device UAT.
- Physical Windows installation, independent external-drive backup, real Epson TM-T82 paper output, human keyboard/screen-reader audit and accountant-approved final tax invoice issuance are still **not verified**.
- The doctor’s verification does not guarantee recovery from the actual target device: complete a real offline restore rehearsal with separately managed admin credentials.

## Staff workflow manual checklist (not executed)
- [ ] Use seven real room names, including longest realistic category and booking guest names
- [ ] Confirm cash/UPI/card procedures against actual received funds, not assumed successful merchant payments
- [ ] Test advance, extra payment, cancellation with outstanding refund obligation and overpaid credit
- [ ] Test zero-due checkout and checkout with outstanding food room charges
- [ ] Test housekeeping dirty/cleaning/ready turnaround and maintenance/outage interlocks
- [ ] Test mouse, touch, keyboard, 200% zoom and screen reader on local hotel Windows hardware
- [ ] Perform encrypted external-drive backup, decrypt into fresh local candidate and restore after stopping app
- [ ] Verify Epson receipt actually printed before any reprint
- [ ] Obtain required final tax invoice/legal review before issuing statutory invoices

**Status:** Engineering alpha with stronger CI and diagnostics; do not claim production launch.
