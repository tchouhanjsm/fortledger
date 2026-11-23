# Historical external invoice PDFs — protected local original register (P2a)

**Status:** archive/inventory implementation only. This does **not** issue, validate, approve, number, email or file a GST invoice. Current hotel practice: an online generator produced previous PDFs; originals are stored on the hotel computer and shared by email. Numbering and legal identity of those existing files are not proven. We must not infer an invoice series from filenames.

## Owner journey

1. Open **Invoices & Proformas → Historical invoice PDFs** as the **owner**. Manager, front desk and cashier cannot access the archive API or the UI.
2. Choose multiple existing PDF files with the OS file picker; a clear preview of count/size is shown **before any copy**. The app does not scan the whole drive, see unselected files or access arbitrary server paths.
3. Select **Import selected original copies** and explicitly confirm. A local HTTPS/loopback session uploads each chosen PDF to the same local FortLedger server; the original file remains untouched. Each complete original is stored, byte-for-byte, as an immutable SQLite BLOB with SHA-256 digest, original filename, size and import actor/time. Files over 8 MiB are refused. No PDF content is parsed for GSTIN/recipient or document identity.
4. Identical bytes automatically return the first persisted record, even after lost-response retries or process restart. If a network response is missing, the browser checks the durable digest. If status is uncertain, repeat the same selection; no duplicate data is written.
5. Search saved original *filenames*, page through results and download **the saved identical original**, not a re-rendered PDF. A damaged BLOB/hash fails rather than being distributed.

## Data, security, backups and recovery

- New `external_invoice_originals` table contains exact PDF bytes; DB triggers prevent UPDATE/DELETE on imported originals. No existing `invoices`, proforma sequence, guest, payment, restaurant, booking or GST series is touched. Schema v13 remains compatible with a source-only rollback. No native installer dependencies.
- Owner authorization checked on every list/import/hash lookup/download endpoint, and the document is forced to download as an attachment, with `no-store` and `nosniff`. The server checks PDF header and trailer/size. Operator still must treat downloaded external files as untrusted.
- Encrypted SQLite backups now **contain imported PDF bytes** with the rest of the one authoritative ledger. This increases backup size/duration; ensure enough capacity on the protected off-device drive and perform a **real replacement-device restore** before operational release. A successful synthetic SQLite backup test is not physical proof.
- Imported files remain `historical_unverified_original`: no verified document number, booking link, recipient, supply date or statutory status, and they never reserve a future invoice number. Accountant/local owner must reconcile the original PDF register and historical series separately before the statutory issuer is enabled.
- No guest PDF content, credentials, paths, tax IDs, or hotel finance data should ever be committed to GitHub. Tests use invented small PDFs only.

**Next:** durable post-checkout *blocked/draft case* (not a legal invoice), followed by manually reviewed archival reconciliation and a unified document search. [Legal gate #147](https://github.com/tchouhanjsm/fortledger/issues/147), [physical acceptance #135](https://github.com/tchouhanjsm/fortledger/issues/135).
