# V9 entity identity safety — deleted IDs cannot be recycled

**Audit FL-006:** SQLite `INTEGER PRIMARY KEY` may reuse the largest deleted row ID. Owner-only deletion preserves audit events, so a new guest or booking could inherit another person's history.

FortLedger v9 introduces a small additive `entity_id_counters` table containing the maximum allocated booking and guest IDs. Migration initializes each counter using the greater of currently stored IDs and **all historical operation-audit entity IDs**. New application booking and guest creations atomically allocate the next ID in the same transaction as their record and audit writes. No booked amount, room, payment, reservation ID, guest ID, or foreign key is rewritten.

SQLite triggers prevent a legacy/direct SQL insertion from **silently reusing** an ID with existing audit history; such an unsafe insert is rejected, not assigned another person's history. The application insertion path uses the counters and does not rely on SQLite's recycled ROWID allocation. On missing counter state the app fails rather than quietly discarding audit identity.

This migration increments `PRAGMA user_version` from 8 to 9, accepts valid older backups for restore, and retains the prior migration/foreign-key checks. Update a real hotel installation **only after an independently verified encrypted backup** and with the old server stopped; keep existing `FORTLEDGER_DATA_DIR` and restart using the existing setup. Do not hand-edit the counters or audit table.

Integration tests delete the highest-numbered unused booking and guest, create new entries and assert no old deletion audit follows; they also recreate a v8 disk-backed database with deleted IDs and migrate it to v9. It is not a license to delete financially used records.
