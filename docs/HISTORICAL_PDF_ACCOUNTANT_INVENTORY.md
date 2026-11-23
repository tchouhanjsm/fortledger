# Historical external invoice inventory — accountant review handoff (P2c)

## Goal

The hotel has pre-FortLedger PDFs from an online invoice generator, locally saved and shared manually by email. The owner now has a single worksheet for the accountant to **review** the known historical documents before choosing a lawful future FY serial policy.

This feature does not auto-scan the Windows folder, assert that the archive is complete, verify OCR/PDF content, certify an invoice, create or reserve a GST serial, or upload anything to a GST portal.

## Owner steps

1. Open **Invoices → Historical invoice PDFs** and explicitly import verified original PDF copies (no automatic drive scanning).
2. Open each saved original and record its **printed** number/date and optional candidate booking with a short note. Earlier observations are never overwritten.
3. The archive shows totals: imported PDFs, transcribed number/date, still untranscribed, number collisions within the reported Indian financial year, and possible Rule 46 serial-format issues. These are **review counters**, not certifications.
4. Select **Download unverified inventory CSV**. This is a local browser download, which the owner can share manually and securely with the accountant. It contains the original filename, SHA-256 hash, import timestamp, latest reported number/date/FY, optional booking candidate, collision/format flags and clearly marked unverified status. It excludes PDF bytes, guest names, tax IDs, payment totals and operator free-text notes.
5. Accountant and owner compare the CSV with the full external original folder and confirm which invoices were *actually legally issued*, whether records are missing, the legal FY series, GST rate by taxable supply, and e-invoice applicability before requesting implementation of final statutory issue. **Even a CSV without warnings does not prove completion.**

## Security, consistency and limitations

- `GET /api/external-invoice-originals/inventory` returns read-only statistics; `GET /api/external-invoice-originals/inventory.csv` returns the owner-only sensitive worksheet, with no-store, forced attachment and CSV formula neutralization. Manager, cashier and front-desk roles cannot access either even by direct URL.
- All summaries query the latest operator-entered transcription for each imported PDF, comparing normalized FY+number keys. Same FY and same reported number across different originals gets a warning. Older corrected transcriptions remain in the permanent history but no longer count as current collisions.
- An unannotated archived PDF gets an explicit `missing` state in the CSV; a date/number longer than Rule 46's usual 16-char limit gets a `format_review` warning, **not** an auto-renumber.
- This is a pure read-only export without schema migration, financial writes, invoice generation, legal serial reservation, external API, new package dependency or Windows installer changes. Existing protected SQLite backup/archive and guarded code-update process remain intact.
- The CSV may reveal customer names if a local filename already contains them. Treat the exported file as sensitive, share only with the appropriate accountant and delete unnecessary exported copies.

**Remaining gates:** [#147](https://github.com/tchouhanjsm/fortledger/issues/147) accountant-approved statutory invoice/credit lifecycle; [#135](https://github.com/tchouhanjsm/fortledger/issues/135) real hotel Windows phone/printer/backup physical acceptance. No automatic GST issuance until both are explicitly reviewed.
