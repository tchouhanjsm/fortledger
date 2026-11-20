# FortLedger

**Local-first hotel booking, invoicing and restaurant billing for Garh Jaisal.**

> **Status:** Initial booking foundation only. NOT production-ready. Do not enter real guest/payment data yet.

## Start locally
Requires Node.js 22+ and a local build toolchain for the SQLite native dependency.

```bash
npm install
npm test
npm start
```

Open **http://127.0.0.1:3000**. Data is stored in `data/fortledger.sqlite` (ignored by Git).

## First-use setup
The database creates **seven placeholder rooms** (Room 1–Room 7), all under category `Unassigned`. Rename them and set the real category in **Room Inventory** before adding genuine reservations. For safety in this initial release, set all seven room categories **before** booking: category changes are blocked after a booking exists, though names remain editable. The booking form accepts category-level holds or one specified room, agreed nightly GST-inclusive rate, dates, meal plan and advance. Search is available in the booking ledger.

## Implementation status
- ✅ Basic Node HTTP app and local SQLite storage.
- ✅ Seven configurable room placeholders.
- ✅ Simple booking entry, availability checks and searchable reservations.
- ✅ GST-inclusive 5% *illustrative business-rule* breakdown in the backend, ledgered initial advances and balance due.
- ✅ Seven-day room calendar including unassigned category reservations, booking edits, payment history/entry and SQLite backup download.
- ✅ Initial immutable proforma snapshot and local PDF download from booking records (no tax invoice issuance).
- ✅ Verified offline database restore CLI; full month overview and invoice editor still pending.
- ⏳ Restaurant billing, CSV import, room charging and Epson TM-T82 integration.

**Tax disclaimer:** The stated 5% GST rule is an agreed business example, not a verified tax determination. Validate lawful tax treatment and invoice requirements before production billing.

Read the [project blueprint](docs/PROJECT_BLUEPRINT.md) and [development log](docs/DEVELOPMENT_LOG.md) before starting a new development session. The blueprint records all decisions, scope, acceptance cases and the next milestones.

## Local backups and recovery (alpha)
Click **Download database backup** in the booking ledger and securely store the downloaded SQLite file outside your computer. This contains guest/payment information; treat it as sensitive.

To restore: stop the app, verify it is not running, and run:
```bash
npm run restore -- /path/to/fortledger-backup.sqlite ./data/fortledger.sqlite --confirm
```
The restore command validates SQLite integrity and expected schema, requires explicit confirmation, rejects active WAL files, and preserves the previous database as a timestamped `.before-restore-...` safety copy. **Do not restore while the app is running.** Test first with non-production data. An automated encrypted backup schedule is not yet implemented.

## Proforma PDF preview (alpha)
From a booking, choose **Proforma PDF** to create one immutable snapshot and download its PDF. Repeated clicks return the existing invoice without consuming a new number. The sequence begins at `GH-2026-001` and continues across calendar years. A PDF has the exact fixed T&C, booking figures, advance paid and separate illustrative 5% GST. **No tax invoices are issued yet.** Company addresses, bank details, uploaded hotel logo, custom accommodation lines and the legally compliant invoice workflow remain future milestones. Do not use these preview PDFs for statutory billing.

## Multiple accommodation lines (alpha)
The **Proforma PDF** action opens a pre-issue editor: guest/group name, bill-to recipient and optional billing address plus 1–20 independently priced accommodation lines (description, rooms, nights, negotiated GST-inclusive rate). Totals are recalculated in integer paise on the backend. Once issued the document is immutable and repeated requests return the saved original. Rates remain an illustrative 5% rule until statutory compliance is verified. The existing booking and payment ledgers are not changed by invoice editing.

## Business settings (alpha)
The **Hotel & payment settings** section stores hotel name, optional address/GSTIN/contact details and bank/IFSC/UPI information locally. New proforma PDFs snapshot the current settings, keeping previously issued invoices unchanged. Do not enter real account details until the local app has authentication and access controls; the repository remains public, although runtime database files are gitignored. Uploaded logo support remains pending.
