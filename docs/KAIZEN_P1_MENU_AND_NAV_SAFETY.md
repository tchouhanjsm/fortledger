# Kaizen batch 1 — restaurant CSV safety & correct operational navigation

## Confirmed source defects

- The old async CSV preview handler stored a response into `validatedMenuCsv` after network round-trips without verifying that the selected input file still matched. An older response could therefore authorize the wrong CSV for import.
- Server preview previously described rows but did not compare them to the existing menu; import upserted every row directly, including material price increases and GST changes.
- Dashboard's daily-close discrepancy action navigated to `#business-settings` even though `#daily-close-form` sits inside `#dashboard`. The target was invisible.
- Dashboard unmatched restaurant charge action navigated to the restaurant but did not select the `Needs linking` filter.

## New fail-closed workflow

1. Cashier/manager selects a UTF-8 CSV file (up to 65 KB and 500 rows), clicks **Check file**, and sees ALL rows with source row numbers, previous/current inclusive prices, GST changes, and one of **new / updated / unchanged / needs review**. Search, category and change filters work without modifying the database.
2. The backend compares names and categories using the existing SQLite `COLLATE NOCASE` identity rule, preserving historical menu IDs and saved receipt snapshots. Ambiguous legacy case-duplicate rows are rejected.
3. Prices differing by at least **30% and ₹50**, and any change to the supplied GST rate, are **flagged**. This is an operational warning threshold, **not** an assertion that a price or tax rate is legally wrong.
4. The running server issues an HMAC-SHA256 preview token for the **exact CSV bytes and the complete current menu state**, using a volatile private key that changes on restart. Import requires that token, `confirm_import:true` and `approve_suspicious:true` when any rows are flagged. The server checks the current state and imports in one SQLite transaction. Wrong bytes, stale menu state, failed review or restart require a new preview; no rows are partially written.
5. In the browser, a changed file invalidates the old approval immediately. Responses are only applied when their generation counter and original File object still match. Import is disabled while no current approval exists and the selected file cannot change during the actual import request.
6. After uncertain network outcomes, do not claim that the menu update failed: refresh the existing menu, then preview again. Import updates future menu prices only, never previously saved bills.
7. Dashboard closing alerts now open the actual Dashboard closing review and pick the flagged date; unmatched restaurant charges route to the filtered history.

## Compatibility and limitations

- HTTP `POST /api/restaurant/menu/import` **now requires preview_token and explicit confirmation flags**. Old custom CSV-import scripts calling the raw endpoint must first call `/preview` and pass the returned token and selected file bytes unchanged.
- The internal `importMenuCsv(db,csv)` function remains supported for test setup and controlled development imports; production-like user workflows go through the guarded HTTP route.
- Token expires when menu state changes or the server restarts, intentionally. This is not a financial or GST approval; operators remain responsible for legitimate rates.
- No new dependencies, paid services, kitchen workflows, or database schema changes. An exact transactional import preserves existing IDs and immutable restaurant receipt snapshots.

## Verification required

- Unit tests cover mismatch, concurrent menu updates, changed prices, GST-rate warnings, stale tokens, missing acknowledgment, case-duplicate safety, and original bill snapshot preservation.
- Chromium regression checks the deliberate old-file response race, 500-row-ready filtered preview UI, and actual reviewed import through the server.
- CI must pass Linux, Windows, and Chromium before merging. Actual hotel Mac and staff testing remain separate release gates.
