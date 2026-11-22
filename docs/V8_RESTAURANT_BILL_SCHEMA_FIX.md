# FortLedger v8 — Restaurant bill request migration

## Observed production defect

A previously installed hotel database can report:

```
Bill was not saved: no such table: restaurant_bill_requests
```

**Cause:** the retry-safe restaurant bill request table was added to `ensureRestaurantSchema()`, which previously ran only on new/pre-versioned databases. A live version-7 SQLite database skipped the setup and retained the older schema. The restaurant endpoint then queried a table that did not exist. Creating a test database from scratch could never reproduce this migration defect.

## Fix implemented

- **Schema v8** adds a transactional upgrade for every existing database at version 7 (and older): run the idempotent restaurant schema initializer and validate the columns required by the idempotent request ledger before publishing schema version 8.
- The migration creates missing restaurant request/print/settlement support tables without deleting or backfilling historical bills or duplicating payments.
- Incorrect or incompatible schema objects cause a startup error with rollback; they do **not** silently mark version 8.
- Database diagnostics expect v8, and backup verification accepts both older valid snapshots and v8 databases.
- Regression tests start with a **persisted** seven-room version-7 database, remove the missing table, preserve previously saved restaurant bills, bookings and payments, then reopen and verify save/replay over a real HTTP request. Future-schema rejection and rollback tests remain.

## Mac deployment and safe update

**Do not change the live database by hand or create an empty replacement.** A running server still has the old database connection and application code until restarted.

1. Finish open bills and bookings, and stop the existing FortLedger server using its normal Mac startup method.
2. From the **existing checkout with the exact same `FORTLEDGER_DATA_DIR` / `FORTLEDGER_DB` / authentication and backup configuration** run `npm run mac:preflight` and `npm run doctor`. The old doctor can report the missing request table; that is the symptom. Verify that the paths point to your actual hotel data, not an accidentally created second database.
3. Verify an independent encrypted backup and credential recovery copy **before** applying the migration. Do not delete or manually copy only the SQLite main file while it has active WAL/shm files. If verification or paths are uncertain, stop and inspect the installation.
4. With the old process stopped and your independently verified backup available, update code with `git pull --ff-only origin main` and install dependencies with `npm install --no-audit --no-fund`.
5. Run `npm test`, then start the app **using its normal startup configuration**. `openDatabase()` upgrades schema v7 to v8 in one transaction.
6. Run `npm run doctor` and verify `Schema v8 confirmed`, `Application schema: Expected tables present` and the existing seven-room records. Test one **synthetic** new restaurant bill, verify exactly one saved bill and re-open its receipt. Do not retry an uncertain real payment without first reviewing the saved ledger and original request ID.

This patch does not certify tax invoices, printer paper, data restoration on another Mac or hotel-network isolation. Existing safety gates remain unchanged. Do not perform a manual `DROP TABLE`, SQL `CREATE TABLE`, forced git reset, deletion of WAL files or destructive reinstall as a workaround.
