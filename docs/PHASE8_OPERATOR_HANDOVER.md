# Phase 8 — Garh Jaisal operational handover (NOT production certification)

**Audience:** owner, local Windows technician, reception manager, cashier and accountant.
**Stage:** engineering alpha. Execute the steps with **synthetic data** until statutory invoice and physical-device sign-offs are complete. Never put guest identities, bank details, passwords, or backup files in GitHub issues, logs or screenshots.

## 1. Protect the current installation before any change

1. Record the installed build and commit on the hotel PC. For a packaged installation, open `installer-build.json` in the program folder (default `%LOCALAPPDATA%\Programs\FortLedger`) and record `version`, `build_number`, and `sha`. For a source checkout, run `git rev-parse HEAD`. If the identity file is absent, record the Windows Installed Apps version and mark the commit unknown.
2. Confirm the matching `.flbk` ledger and `.flba` owner companion are on independently protected storage. Retrieve the passphrase separately and run the rehearsal below. Keep the source machine and its `%LOCALAPPDATA%\FortLedger\data` directory intact. Use FortLedger's backup command to capture a running ledger.
3. Finish active reservations and restaurant sales. The packaged installation uses the local owner's [Windows update procedure](WINDOWS_UPDATE_NO_REINSTALL_AND_PORT_3000.md). For a source checkout, stop the app using Ctrl+C, confirm no FortLedger instance is serving port 3000, and use `scripts/windows-update.ps1` for its verified pre-update snapshot and update.

## 2. Rehearse the actual encrypted backup without replacing live data

Open PowerShell in the recovery checkout with dependencies installed. On a replacement PC, the rehearsal can use the encrypted pair directly before any local ledger or owner account has been created. Fetch the matching `.flbk` and `.flba` from independent storage and supply the separately retained passphrase when prompted.

```powershell
$backupSecret = Read-Host 'Backup passphrase' -AsSecureString
try {
  $env:FORTLEDGER_BACKUP_PASSPHRASE = [Net.NetworkCredential]::new('', $backupSecret).Password
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-recovery-rehearsal.ps1 -ReplacementDevice -BackupFile 'E:\FortLedgerBackups\fortledger-example.flbk'
} finally {
  Remove-Item Env:\FORTLEDGER_BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
  $backupSecret.Dispose()
}
```

Replace the example file with the **actual absolute backup path**. The helper restores the candidate into disposable private storage, checks all table rows, and authenticates the matching owner companion. A missing or tampered companion fails the replacement-device check. On the source PC, omit `-ReplacementDevice` to also check for the existing local ledger and owner credential file. This rehearsal cleans up its scratch files and leaves both the hotel installation and backup pair untouched. A successful rehearsal checks the encrypted artifacts. Verify the original owner login during the physical restore below.

**Required human evidence:** date, device, source storage description, backup filename (not guest data or secret), approximate age, recovered seven-room count, and whether synthetic invoices/restaurant records are present. Never record the passphrase.

## 3. Real replacement-Windows restoration — must happen physically

1. On a **different Windows 10/11 computer** with Node 22, install FortLedger using `docs/WINDOWS_SETUP.md`. Keep the app stopped; do not create real new bookings before restoration.
2. Obtain an independent copy of the encrypted backup, a *separate* secure copy of `admin-auth.json`, and the passphrase. Confirm the original/source hotel computer and its data have not been changed.
3. Decrypt into a **new candidate path**, never an existing live SQLite path:

```powershell
$env:FORTLEDGER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'FortLedger\data'
$env:FORTLEDGER_BACKUP_PASSPHRASE = Read-Host 'Backup passphrase'
npm.cmd run backup:decrypt -- 'E:\FortLedgerBackups\fortledger-example.flbk' 'C:\FortLedgerRecovery\candidate.sqlite'
```

4. With FortLedger **stopped**, restore via the existing explicit `--confirm` command, pointing to the intended persistent data location:

```powershell
npm.cmd run restore -- 'C:\FortLedgerRecovery\candidate.sqlite' "$env:FORTLEDGER_DATA_DIR\fortledger.sqlite" --confirm
```

5. Restore `admin-auth.json` from its verified separately protected copy **only on the replacement machine**, with access restricted to the hotel owner. Do **not** run setup-auth to overwrite a working original credential hash. Delete only disposable candidate files after inspection; never delete safety copies blindly.
6. Run `npm.cmd run doctor`, launch with `scripts/windows-start.ps1`, and verify login, seven physical rooms, a synthetic reservation, proforma, payment history, restaurant folio and permissions. Note actual restore time and who verified it.
7. **If anything differs:** stop. Do not start new hotel operations or replace the original. Record the fault privately and keep both copies of data.

An automated scratch rehearsal cannot prove this real replacement-device step.

## 4. Epson TM-T82 receipt-paper acceptance — physical only

Use a saved **synthetic** restaurant bill and the real Epson printer on the permitted private LAN.

- Verify actual model, paper width, LAN IP, port and printer readiness with the technician; record device model only, not passwords.
- From the restaurant UI, choose the saved bill's LAN print action. Inspect **the actual paper**: receipt number, quantity, tax wording, line amounts and total. The network state `sent_unverified` only means bytes were sent.
- Repeat with printer off/disconnected. The attempt must be reported uncertain; no duplicate sale or payment may appear.
- Inspect the printer before an explicit reprint. The existing code never retries an uncertain print automatically. A stale `sending` state may be retried only after ten minutes and explicit staff confirmation.
- Test staff role permissions and reprint acknowledgment; confirm no unexpected second paper slip.
- Failure means the Epson release gate remains pending. Browser print is a separate fallback, not proof that LAN printing works.

## 5. Reception and accessibility acceptance — physical devices

On real Windows front-desk computer, tablet/mobile and keyboard-only navigation, verify: new booking; seven-room allocation; actual guest check-in; restaurant room charge; folio collection; checkout; cleaning status; the next arrival; cancellation and refund obligations; 200% browser zoom; focus order and readable controls. Capture **only synthetic** screenshots and keep any device-level accessibility failures in a private checklist. Staff must confirm physical occupancy and real money received.

## 6. GST final-invoice sign-off — accountant required

Final tax invoice issuance remains **disabled**. Present `docs/COMPLIANCE_REVIEW.md`, `src/tax-draft.js`, proforma sample and proposed legal series to the hotel's authorized accountant. Obtain written decisions about applicable accommodation/restaurant tax rules, SAC, place of supply, supplier/recipient data, numbering, invoice/credit-note lifecycle and signature/e-invoice requirements. Do not interpret proforma or restaurant receipt as a lawful statutory tax invoice. Do not enable issuance from CI alone.

## 7. Go/no-go and recovery decision

Use `npm.cmd run release:check -- --json` for **machine diagnostics**, never as a physical certification. The command intentionally returns nonzero and `NOT RELEASED` until independent approval mechanisms exist.

Record one manual private acceptance sheet containing **date, tested device, operator, pass/fail, evidence reference and corrective action** for each gate: Windows replacement restore, Epson paper output, GST accountant sign-off, real-device staff UX and independent encrypted-backup storage. The hotel owner keeps this sheet offline/private. **Any missing or failed gate means NO-GO.**

### If an update is faulty (safe rollback decision)

- Stop the app and do not create new transactions. Identify the pre-update SHA and verified backup directory printed by `scripts/windows-update.ps1`.
- **Do not blindly git-reset or downgrade a migrated live database.** A new schema may be incompatible with older code; first decide with the technician whether rolling forward with a fix is safer.
- For a reviewed offline rollback, preserve a copy of the *current* database and credential file, validate the pre-update snapshot and ensure any post-backup bookings/payments are reconciled before deciding to restore. An old snapshot necessarily omits activity after it was taken.
- Restore only to the approved target while FortLedger is stopped, using `npm.cmd run restore -- <validated-snapshot> <target-database> --confirm`. Keep its automatically made `before-restore` safety copy. Restore credentials only from the matching verified backup and verify login; do not erase newer records by trial and error.
- If recovery cannot be demonstrated, remain offline and use a separately approved manual process; do not claim the software is production-ready.

**Release status stays:** `NOT RELEASED` until actual external-device evidence and accountant approval have been completed.

## Live build sync and read-only hotel verification

After approving GitHub `main`, use the two-stage [Windows live sync and test guide](LIVE_SYNC_ACCEPTANCE.md): the existing stopped-app `windows-update.ps1` creates a verified pre-update backup and fast-forwards the code, then `windows-live-check.ps1` checks the running local service and diagnostics without changing guest records. A pass is not production certification.
