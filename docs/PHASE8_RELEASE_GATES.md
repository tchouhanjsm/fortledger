# Phase 8 — Garh Jaisal release gates and device acceptance

**Status: engineering alpha; not authorised for live financial/tax issuance.**
This is an operating procedure for seven rooms, not a compliance certificate. Never upload real guest, financial or credential data to GitHub issues, PRs or CI.

## 1. Machine checks (safe to automate)
From the installed FortLedger folder, run `npm run doctor`, `npm run recovery:drill` and `npm run release:check`. The release check intentionally returns a failure exit code while physical and accountant release gates are pending; do not turn this exit code off merely to make CI green. For a JSON status without private guest rows, use `npm run release:check -- --json`.

## 2. Test recovery from actual encrypted backup
1. Copy the encrypted `.flbk` from the **separate external drive** to an offline verification location and confirm the original drive is safely retained. Do not use the sole copy of backups.
2. Supply the backup passphrase via `FORTLEDGER_BACKUP_PASSPHRASE` in the local shell; never include it in CLI args, commits or screenshots.
3. With the original administrator credential file present in the correct external data location, run:
   `npm run recovery:encrypted-drill -- "/absolute/path/to/fortledger-backup.flbk"`.
4. The drill authenticates the supplied encrypted artifact, performs a **temporary restore**, verifies every SQLite table/row by fingerprint and confirms credential-copy consistency. It automatically removes temporary recovered copies.
5. This rehearsal **does not** replace a real fresh-Windows-machine drill. On a separate Windows device, install Node.js 22+, copy the app and authenticated backup, decrypt to a new candidate file, use the documented stop-the-app restore process and actually sign in as an authorised account. Verify room names, ledger, restaurant payments, printed PDF and staff permissions. Use a synthetic backup when training new staff.
6. Preserve proof of the actual external-drive and replacement-machine test **outside GitHub**, signed by the responsible hotel operator. No real secrets or guest names in the proof.

## 3. Epson TM-T82 — real hardware checklist
- Confirm exact printer model, ESC/POS mode, private IPv4 address, port and installed paper width with technician.
- Save a harmless synthetic restaurant bill, send once and check the **paper itself**: full receipt, quantity, rate, total, tax label, date, cutoff, legibility and no cropped lines.
- Test printer offline, timeout and power loss. A TCP send state of `sent_unverified` does not prove paper output; before any reprint, staff must inspect the printer to prevent duplicates.
- Confirm correct receipt is **NOT A TAX INVOICE**; no legal tax invoices may be issued under the experimental receipt workflow.
- Record date, device model, firmware, test operator and outcome locally, omitting guest data.

## 4. Actual hotel staff UAT
Run on the hotel Windows PC and the operator's phone/tablet at 100% and 200% zoom. Check keyboard focus, visible routes and no clipped buttons. Create seven-room synthetic bookings with partial assignments, check-in, maintenance conflict, food room charge, cash/UPI/card received-payment recording, folio settlement, refund-warning and checkout with dirty-to-ready housekeeping turnover. Verify role restrictions for owner, manager, reception, housekeeping and cashier.

### Staff timing and friction check

Use the same synthetic records on the hotel Windows PC on both the installed build and the candidate. Record the build, staff role, device and browser for each run. Time each journey three times and record the median, click or tap count, any repeated entry, and the step where staff had to wait or ask for help.

| Journey | Start | Finish |
| --- | --- | --- |
| Reception booking | Open the booking workspace | Confirm the saved booking and optional pickup note in readback |
| Restaurant bill and print | Open a new restaurant draft | Confirm one saved bill and inspect its paper receipt |
| Checkout | Open an in-house booking with a room charge | Confirm the checkout status and reconcile the displayed balance and linked charge |

Record operator time and printer wait separately if the receipt is slow. Test interrupted saves and printing separately from normal timing. Record suspected duplicates and balance discrepancies as open defects. Keep results with the local release evidence and share only synthetic outcomes in GitHub.

## 5. GST accountant authorisation (blocking)
Current proforma and review-only tax drafts are **not statutory invoices**. Written accountant review must approve registered supplier identity, accommodation and restaurant rate applicability, SAC/HSN, legal FY series (including historical sequence), place of supply, CGST/SGST/IGST, ITC, e-invoice applicability, signed PDFs, credit notes and refund treatment **before any final numbered tax-invoice implementation is enabled**. See `docs/COMPLIANCE_REVIEW.md`. Do not infer legal readiness from an illustrative 5% proforma calculation.

## Exit criteria
- Physical backup and Windows replacement restore completed and witnessed.
- Real Epson paper receipt and failure/reprint safety verified.
- Staff/device accessibility walkthrough signed off.
- GST requirements reviewed and compliant statutory issuance implemented, tested and approved.
- Machine checks green, no uncertain printer state or broken encrypted backups.
- All critical exceptions resolved or explicitly deferred before a controlled go-live.

**No self-certification:** `release:check` always reports PENDING until a separate authorised release governance workflow exists; passing Node, Chromium and Windows CI is not an operational launch approval.


## Use the existing password-protected hotel Wi-Fi for phones
A second staff SSID is **not required**. The Windows PC may be on router Ethernet and an authorized phone on the same router's password-protected Wi-Fi, connecting over authenticated HTTPS to the PC's private IP. The security gate still requires real phone TLS trust, individual account and role verification, firewall restricted to the intended subnet, owner/device revocation, **denied outside-LAN access** and no public port forwarding. Shared Wi-Fi permits anyone with the password to reach the sign-in page; it is **not proof of guest isolation**. Use separate guest Wi-Fi or router controls if guest devices should not be able to reach the login screen.
