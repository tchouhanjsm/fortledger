# FortLedger

**Local-first hotel booking, invoicing and restaurant billing for Garh Jaisal.**

> **Status:** Active alpha with booking calendar, proformas, local business settings, restaurant billing and guest folios. NOT production-ready. Do not enter real guest, bank or payment details yet.

## Windows install and update (initial alpha)

For Windows 10/11, follow the complete [Windows installation and non-destructive update guide](docs/WINDOWS_SETUP.md). It covers Git clone, Node.js 22, `npm install`, local password setup, startup, verified pre-update backups and later `git pull`-based updates **without deleting reservations or invoices**. Use the Windows launch/update scripts; do not run bare `npm start` without the same persistent data environment. Current release is pre-production.

## Start locally
Requires Node.js 22+ and a local build toolchain for the SQLite native dependency.

```bash
npm install
npm test
npm run setup-auth  # first use; choose a strong local password
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
- ✅ Verified offline database restore, weekly/monthly calendar and multi-line proforma editor.
- ✅ Restaurant CSV import, saved bills, cash/UPI/card records, checked-in guest room charges and combined/separate settlement.
- ✅ Local password sessions, experimental Epson LAN transport, hotel logo upload, encrypted backup scheduling and read-only operational diagnostics.
- ⏳ Legally issued signed GST tax invoices, physical printer QA, customer directory, packaging and complete production review.

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

## Restaurant MVP (alpha)
Import a CSV with header `name,category,price,tax_rate` (GST-inclusive price, integer percent rate configured per menu item). Menu imports update matching name/category items without erasing historical bills. Search items, add quantities, settle by cash/UPI/card, or charge to a **checked-in booking**. Each bill preserves item, quantity, rate, tax and payment snapshots in SQLite. The restaurant module does not yet print to Epson, create statutory tax receipts or support manual unmatched room entries. Do not use for live trading until those and security safeguards are implemented.

## Guest folio and room-charge settlement (alpha)
Open **Guest folio** from a booking. The folio shows accommodation due, unsettled restaurant room charges, and combined due without adding restaurant charges into accommodation proforma totals. Mark an individual restaurant bill paid separately (cash, UPI, card), or settle all remaining accommodation and room charges in a single transaction. Each room bill has at most one settlement record and combined payments only add outstanding accommodation to the hotel payment ledger. This records payments; it is **not** a final GST invoice or receipt generator, and refunds/partial payments are not implemented.

## Calendar views
The booking calendar has two views: a seven-day room assignment grid and a monthly overview of occupied room counts out of seven physical rooms. Category-held unassigned bookings count as occupied capacity in the monthly overview. Click a date to jump to its week. Checkout date is excluded from occupied nights.

## Local administrator sign-in (alpha)
First-time setup requires `npm run setup-auth` in an interactive terminal. A strong password is hashed using Node.js scrypt and stored under the gitignored `data/admin-auth.json` (mode 0600); it is never sent to a cloud service. `npm start` refuses to start until a password has been configured. The browser signs in using an HttpOnly SameSite=Strict session cookie; sessions expire after eight hours or logout, and repeated failed attempts trigger a local cooldown. API requests are protected, including backup downloads, and mutations require JSON with same-origin checks. Existing automated integration tests use a deliberately unauthenticated in-memory app fixture; production startup enforces authentication. **Do not reuse banking or other passwords.** Security and physical-device deployment still require review.

## Browser-based restaurant receipt printing (alpha)
Every saved restaurant bill has a **Print receipt** button showing a compact 80-mm receipt with preserved item names, quantities, inclusive item totals, recorded tax, payment/room-charge status, and receipt number. Use the browser print dialog with a printer installed in the operating system, including an Epson network printer if correctly configured. **No direct Epson TM-T82 LAN/ESC-POS integration or physical hardware verification yet.** The slip is explicitly marked *Not a tax invoice*; statutory tax receipts require a separate compliant implementation.

## Statutory invoicing gate
The app **does not issue GST tax invoices**. Review [docs/COMPLIANCE_REVIEW.md](docs/COMPLIANCE_REVIEW.md) before enabling final invoices. Hotel accommodation 5% GST has a per-unit value condition under the official 2025 clarification; no blanket rate assumption is valid. The restaurant 80mm slip is a non-statutory payment receipt.

## Multi-room physical allocations
Bookings may reserve rooms by category, assign any number of physical rooms up to the booked quantity, or remain partially unassigned. A two-room booking can allocate two individual rooms without duplication. Availability validates both category-held capacity and physical-room conflicts on every occupied night, and legacy single-room assignments migrate to the allocation table automatically.

## Refund records (alpha)
The payment ledger supports **append-only refund records** against a specific original booking payment. Each record includes method, reason, amount, and retry-safe unique request ID; refunded amounts reduce outstanding paid balance across bookings and guest folios. Already-issued proformas remain unchanged; future proformas use the current net-paid balance. FortLedger **does not send money or trigger an external refund**; an operator must complete the actual bank/UPI/card/cash refund separately.

## Automated encrypted backups (alpha)
Optional local scheduled backup runs at startup and every 24 hours **while the application runs**, provided both environment variables are configured:
```bash
export FORTLEDGER_BACKUP_DIR=/absolute/path/to/separate-drive/fortledger-backups
export FORTLEDGER_BACKUP_PASSPHRASE='choose-a-unique-secret-of-16-or-more-characters'
npm start
```
The application writes AES-256-GCM encrypted SQLite snapshots using scrypt-derived keys and keeps the latest 30 backup files. Choose a **different disk/drive** or an independently synced encrypted folder; merely storing copies on the same disk will not protect against hardware failure. Do not check the passphrase into Git or shell history; set it through secure OS environment configuration. Decrypt onto a new candidate path with `npm run backup:decrypt -- /path/to/file.flbk /path/to/candidate.sqlite`, then stop the application and use the existing `npm run restore` command. Each encrypted file is integrity-authenticated; tampered files and wrong passwords fail decryption. The admin password file is outside the SQLite backup and needs its own secure recovery plan.

**Limitation:** Automated snapshots run only while the Node.js app is active; a stopped computer cannot run them. Full off-device recovery tests and a production scheduling/secret-management setup still need completion.

## Experimental Epson TM-T82 network printing
For a network-compatible ESC/POS TM-T82 printer, configure the real private IPv4 address and port in your local environment (the following address is an example only):
```bash
export FORTLEDGER_PRINTER_HOST=192.168.1.100
export FORTLEDGER_PRINTER_PORT=9100
npm start
```
The **LAN Print** button sends text-only ESC/POS to the configured printer. It never creates another bill. An audited row tracks attempts and statuses. **sent_unverified** means bytes reached the socket, not that paper printed; network errors are **uncertain**. Reprinting requires explicit confirmation to reduce duplicate slips. Browser-driver printing remains available. Hardware-specific cut commands and rupee glyphs remain deferred until the exact TM-T82 variant is physically tested. Epson ESC/POS command reference: https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/ .

## Manual restaurant room-charge review
If the guest is not yet on the checked-in list, choose **Charge to room → Manual room / guest entry**, supply the room identifier and guest name and save the restaurant bill. The bill is stored as **pending review** and is deliberately excluded from every guest folio until an operator verifies and links it to an active checked-in booking using **Link to guest**. Linking does not create another bill and cannot be repeated. The original manually entered details are preserved for audit. This is a safeguard against assigning food charges to the wrong guest.

## Draft GST invoice preparation (no legal issuance)
From an issued proforma, select **Tax draft** to prepare a watermarked, downloadable PDF that shows supplier/recipient details, per-line SAC classification, illustrative CGST/SGST split and compliance blockers. Room and campsite classifications must be reviewed explicitly (e.g. 996311 versus 996312). A separate `tax_invoice_drafts` table stores editable snapshots linked one-to-one to proformas; creating a draft **does not consume a GST tax-invoice serial number** and is **not** a statutory issuance. The preview checks the 5% hotel accommodation value condition and reports missing GSTIN, supplier address, recipient details or signature. Final legal issuance remains disabled until all compliance, signature, e-invoice and numbering obligations are implemented and validated.

## Hotel logo upload (alpha)
In **Hotel & payment settings**, select a PNG or JPEG logo (maximum 800 KB) and save it. The current logo is stored only in local SQLite as a validated image asset. Issued proformas store the specific logo asset ID used at issue time, so updating your logo will **not silently change old invoices**. New tax drafts use the currently active logo. The PDF header preserves image aspect ratio and falls back to the hotel name when there is no logo. Logo files never need to be committed to GitHub; they are included in encrypted SQLite backups. Actual hotel artwork is still needed for final visual QA.

## Local readiness diagnostics
Run `npm run doctor` from the project directory after setting up the administrator login and starting the app at least once. The tool uses read-only SQLite checks for integrity, foreign keys and expected schema, verifies the seven-room inventory, counts pending manual room charges and uncertain printer jobs, and checks whether encrypted backup files are recent. It reports configuration status without printing guest names, banking details or secrets. It **never** labels the app production-ready: signed final GST invoice issuance, physical Epson tests and a complete recovery drill are independent release gates.

## Focused module navigation
FortLedger now opens a single operational area at a time instead of stacking unrelated sections on one long page. The five navigation links show booking calendar/ledger, seven-room inventory, invoices, restaurant billing, or hotel settings. The current module is reflected in the URL fragment, so bookmarks work. On mobile, the navigation remains accessible via a horizontally scrollable menu. This improves first-screen clarity and reduces unnecessary scrolling without introducing client-side routing dependencies.

## Persistent data directory override
Set `FORTLEDGER_DATA_DIR` to keep both `fortledger.sqlite` and `admin-auth.json` outside the source checkout. Individual `FORTLEDGER_DB` and `FORTLEDGER_AUTH_FILE` overrides remain available for special cases. The Windows scripts use `%LOCALAPPDATA%\\FortLedger\\data` automatically. The code directory can be updated and dependencies reinstalled without overwriting that data location. The existing `.gitignore` also excludes the legacy `data/` folder.

## Staff profiles and RBAC (alpha)
The original single-administrator sign-in is now the **owner** account (username `owner`, existing password unchanged). The owner can create individual manager, front desk and restaurant cashier users under **My Profile**. Each staff member logs in with their own username and password. API-level RBAC restricts bank settings, backups, invoices, bookings and restaurant endpoints; merely knowing a URL cannot bypass roles. Disabling a staff user invalidates ongoing access on the next request. Staff records are stored in local SQLite and included in existing backups. Run `npm test` after updates. This remains alpha and must pass a separate on-device security review before live business use.

## Role-aware operations dashboard
The initial screen now shows **Dashboard**: personalized greeting, role-appropriate KPIs, quick actions and recent activity. Booking staff see arrivals, departures, occupied rooms and outstanding stays; restaurant cashiers see saved food sales, menu inventory and unmatched room charges. Everything is derived from existing local records; no analytics cloud subscription. Empty invoices link directly to bookings, and first-time restaurant users see the menu import panel expanded. My Profile continues to provide staff account management and permissions.
