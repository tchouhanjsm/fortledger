# FortLedger — macOS safe update and release preflight

**Current operator machine:** Mac. FortLedger remains local-first and **NOT RELEASED**; Windows setup is optional and must not be used as instructions for a Mac.

## Check the actual Mac installation before any update

Open Terminal in the existing FortLedger checkout, using the same environment configuration as the running app:

```bash
node --version
git status --short
npm run mac:preflight
npm run doctor
```

The new `mac:preflight` command reports the **effective database and administrator-authentication file paths**, the current local HTTP listener, whether those files exist, and key read-only diagnostic results. It does **not** create or migrate a database, take a backup, repair corrupted data, print secrets or issue payments. If the effective file paths do not match your existing hotel installation, **stop** rather than starting FortLedger with a different directory.

If local operations use `FORTLEDGER_DATA_DIR`, `FORTLEDGER_DB`, `FORTLEDGER_AUTH_FILE`, `FORTLEDGER_BACKUP_DIR` or `FORTLEDGER_BACKUP_PASSPHRASE`, retain those values exactly. The backup passphrase is not printed or sent to GitHub. Do not store credentials in source-control files.

## Verify backup and credentials before updating

1. Finish active billing and reservations. Identify the live database and auth paths from the preflight output. Do not delete `-wal` or `-shm` files, and do not copy only the main SQLite file while an app instance is writing.
2. Confirm the latest independently protected encrypted `.flbk` backup exists. `npm run doctor` checks authentication, integrity, schema, and encrypted-backup authentication when configured.
3. Run `npm run recovery:drill` to verify a consistent SQLite snapshot and isolated restoration of every table, including recovery of a copy of the administrator credential file. This does not replace off-device testing.
4. Optionally validate the actual stored encrypted backup, without modifying live data: `npm run recovery:encrypted-drill -- /absolute/path/to/fortledger-backup.flbk` after exporting the configured `FORTLEDGER_BACKUP_PASSPHRASE` privately.
5. Have a **separate** secured copy of the administrator credentials, backup passphrase and independent storage. An encrypted database alone is not sufficient to restore a login.

## Update the Mac checkout

With the process stopped and the data location verified:

```bash
git status --short
git pull --ff-only origin main
npm install --no-audit --no-fund
npm test
npm run mac:preflight
npm start
```

Use the existing local startup method if it sets environment variables (do not drop them by running bare `npm start`). If Git refuses a fast-forward update or the working tree contains modifications, **do not** force/reset without a reviewed backup and change reconciliation.

## Acceptance before live hotel use

- Complete one synthetic reservation on the real Mac; verify assigned physical room, advanced payment or zero deposit, check-in, restaurant charge, individual/combined settlement, checkout, room cleaning and next arrival.
- Confirm receipts and proforma PDFs visually, and verify actual Epson paper output if used. The printer's network-send acknowledgement is not physical paper proof.
- Verify Mac/phone keyboard and screen zoom, backup restore on a separate replacement device, and accountant-approved GST tax handling.
- `npm run release:check` intentionally returns **NOT RELEASED** even when automated tests pass. The application has no automatic production-certification switch.

## Changes in this batch

- Added `npm run mac:preflight` (read-only).
- Updated the release gate to refer to a **replacement device on the actual operator OS**, not falsely assume Windows.
- Doctor now checks both booking and restaurant request-replay tables needed to avoid duplicate financial records.
- Added a full HTTP booking/checkout/room charge/settlement/cleaning integration test.
- No new infrastructure, database migration, financial behavior change or kitchen-order features.

## Specific existing-database repair: restaurant bill requests (schema v8)

A bill failure reporting `no such table: restaurant_bill_requests` indicates an older initialized database whose restaurant support table was not migrated. Updating only the app's HTML cannot repair it. **Back up, confirm the live database path, stop the old Node process, update to a release containing schema v8, and restart with the unchanged data environment.** Then rerun `npm run doctor`, which must report schema v8 and the required request table. Do not run raw SQL against the live hotel database or overwrite its historical restaurant bills. Full steps: [v8 restaurant schema repair](V8_RESTAURANT_BILL_SCHEMA_FIX.md).
