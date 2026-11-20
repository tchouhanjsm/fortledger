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
- ⏳ Calendar timeline, detailed payment UI, backups, invoices and PDFs.
- ⏳ Restaurant billing, CSV import, room charging and Epson TM-T82 integration.

**Tax disclaimer:** The stated 5% GST rule is an agreed business example, not a verified tax determination. Validate lawful tax treatment and invoice requirements before production billing.

Read the [project blueprint](docs/PROJECT_BLUEPRINT.md) and [development log](docs/DEVELOPMENT_LOG.md) before starting a new development session. The blueprint records all decisions, scope, acceptance cases and the next milestones.
