# FortLedger

**Local-first hotel and restaurant management for Garh Jaisal (seven physical rooms).**

**Release status: ACTIVE ALPHA — NOT RELEASED.** Designed to run on the hotel Mac with Node.js 22+, Express, SQLite, a built-in browser interface and no paid cloud dependency. Never put genuine guest/financial data into a new installation until device, security, financial and restore acceptance is signed off. This repository does **not** store your runtime database, hotel passwords, signed invoices or actual backups.

## Windows staff: download installer and click FortLedger

For nontechnical hotel staff, use the **Windows desktop installer**: the owner downloads the unsigned alpha `FortLedger-Setup-*.exe` from a verified [Windows Installer workflow](https://github.com/tchouhanjsm/fortledger/actions/workflows/windows-installer.yml), installs it once, and staff thereafter click the **FortLedger** desktop icon to start the local browser app. The package bundles Node.js and production dependencies and does not require Git, npm or terminal commands on the PC. A native Windows tray icon provides an Open option and a graceful **Close FortLedger safely** command. Original records are never bundled into or removed by the installer. See [installer and staff guide](docs/WINDOWS_DESKTOP_INSTALLER.md). The executable is **unsigned alpha**, not production-certified.

## Start and update on the Mac

On first use, from the existing project folder:

```sh
npm install --no-audit --no-fund
npm test
npm run setup-auth
npm start
```

Open `http://127.0.0.1:3000` on the Mac. The default listener is loopback only, and starting the production server requires owner authentication. Use **the same** existing `FORTLEDGER_DATA_DIR`, database, authentication and backup settings whenever you update or restart. Never create a second blank SQLite database to resolve a missing table.

For an existing installation, **stop the old server, verify an independent encrypted backup and original data path, then update code** using `git pull --ff-only origin main` and `npm install --no-audit --no-fund`; restart with the unchanged environment. Database upgrades are transactional, but running a newer version can migrate the database and should not be attempted before backup verification. Do not delete WAL files or reset the repository to work around data errors. Follow [Mac preflight](docs/MAC_RELEASE_PREFLIGHT.md), [database v8 billing repair](docs/V8_RESTAURANT_BILL_SCHEMA_FIX.md) and [v9 audit identity migration](docs/V9_MONOTONIC_ENTITY_IDS.md).

Windows is also supported for engineering/tests: [Windows installation and recovery guide](docs/WINDOWS_SETUP.md). Owner accounts have an **Update Center** under My Profile. On Windows, when started via the dedicated `windows-start.ps1` supervisor with a recent encrypted backup on a separate protected drive, the owner can inspect an exact CI-verified GitHub commit and explicitly start a supervised, graceful update. The parent supervisor waits for existing HTTP requests to finish before installing and restarting. The manual **`Update FortLedger.cmd`** remains a backup-first option after stopping the app. Mac updates remain manual. See [Update Center](docs/UPDATE_CENTER.md). Windows is not the hotel's primary workstation.

## What is actually available today

| Area | Available in alpha | Important limitation or review |
| --- | --- | --- |
| Bookings & inventory | Seven rooms, category reservations, physical allocations, booking edits, availability checks, calendar, search and status lifecycle | Physical room readiness/maintenance and [hotel-date exceptions](docs/V2_STAY_DATE_GUARDS.md) require actual staff confirmation; no automated channel manager |
| Guest directory & staff | Returning-guest profiles, explicit stay links, owner/manager/front-desk/cashier roles and role-specific workspaces | No ID scan/document storage, CRM campaign automation, or independent device approval |
| Accommodation documents | One immutable multi-line proforma per booking, downloadable single-page A4 PDF, saved branding and business settings | [Proforma must reconcile with booked value](docs/V2_INVOICE_FOLIO_CONTRACT.md); **final signed GST tax invoices are not enabled** |
| Restaurant | CSV menu import, owner/manager-controlled dish availability, quantity/cart, cash/UPI/card food bills, manual and assigned guest room charges, saved receipts, printing and retry reconciliation | Bill-only workflow: **no kitchen tickets, kitchen order states, or KOT**. Direct Epson network sending needs actual paper verification |
| Guest folio & money | Accommodation advances and payments, append-only refunds, food settlements, split bank accommodation + cash/UPI/card food settlement | All methods are operator-recorded, not bank-verified; stored transfer reference is not proof of settlement |
| Cash closing & analytics | IST daily collections, recorded expenses, immutable cash-close snapshots, stale-close review and booked room-night analytics | Reviewed exceptions never silently rewrite original closing; ADR/RevPAR are booked and gross, not recognized profit |
| Security | Password sessions, owner/staff RBAC, audit trails, retry-safe financial API on authenticated deployments, private LAN HTTPS foundation | Staff Wi-Fi isolation, certificate trust, device revocation and actual phone testing require on-site verification |
| Backups & recovery | Optional scheduled encrypted SQLite backups, authentication checks, pre-update backup, offline recovery drills, diagnostics | Independent off-device storage and a real replacement-Mac restore must be proven before release |
| Mobile | Responsive screens at seven tested widths and local install metadata | Requires a live server; **offline bookings and financial writes are not supported** |

**Financial invariants:** money uses integer paise; new financial API calls in authenticated deployments require a stable `request_id`; retries with an unchanged key replay the original record, not another charge. A proforma is a snapshot of the booking receivable, not an independent or unrecorded accommodation charge. Historical issued documents and audit events are not silently rewritten. See [financial request IDs](docs/V2_FINANCIAL_REQUEST_IDS.md), [restaurant staff audit](docs/V2_RESTAURANT_SALE_AUDIT.md) and [manual room charge matching](docs/V2_MANUAL_ROOM_CHARGE_REVIEW.md).

## Operational commands

```sh
npm test
npm run test:browser
npm run mac:preflight
npm run doctor
npm run recovery:drill
npm run recovery:encrypted-drill
npm run release:check
```

The release checker is **intentionally** expected to report `NOT RELEASED` until human certification is recorded. `npm run test:browser` is a synthetic Chromium smoke check; passing it does not certify actual hardware, the Mac's live configuration, or GST law. [Operator handover](docs/PHASE8_OPERATOR_HANDOVER.md), [release readiness](docs/PHASE8_RELEASE_GATES.md) and [Epson physical acceptance](docs/EPSON_PHYSICAL_ACCEPTANCE.md) give the on-site steps.

### Private staff LAN (optional, disabled by default)

Only enable after [private staff HTTPS preparation](docs/V2_PRIVATE_LAN_HTTPS.md): a dedicated RFC1918 IP actually assigned to the Mac, correctly trusted TLS certificate + private key, staff-only Wi-Fi segmentation, firewall rules, and **no public port forwarding**. Default localhost access remains unchanged. No cloud server or third-party subscription is required.

### Financial and legal scope

Proformas and GST **review drafts** can be prepared; they do **not** constitute issued tax invoices. This app does not send refunds or verify bank funds. GST rates, exemptions, SAC classification, invoice signing/e-invoicing, bank reconciliation and final invoice numbering must be validated by the hotel's accountant before live use. See [compliance review](docs/COMPLIANCE_REVIEW.md).

## Human certification still required

| Pending proof | Who/what must verify |
| --- | --- |
| Hotel Mac data-path, restart, permissions and diagnostics | Hotel operator on the actual Mac |
| Guest-Wi-Fi denial, staff-network HTTPS trust and revocation | Network technician + real authorized phones |
| Printed and reprinted Epson slip, timeout and no duplicate settlement | Hotel operator observing physical paper |
| Independent encrypted backup recovery on another Mac/drive | Operator restoring to an isolated replacement device |
| Real booking, billing, checkout, 200% zoom and accessibility journey | Front desk, cashier and manager |
| GST tax invoice treatment and lawful issuance | Qualified accountant |

**No software-only test can satisfy any of these gates.** If one is incomplete, the release verdict stays `NOT RELEASED`.

## Product architecture and development history

Favor simple, reversible, tested improvements rather than rebuilding a seven-room hotel app. The source of truth is local SQLite; history is append-only where money or identity is involved; staff UI prioritizes quick, accessible navigation. Review the [project blueprint](docs/PROJECT_BLUEPRINT.md), [chronological development log](docs/DEVELOPMENT_LOG.md), [private-LAN guide](docs/V2_PRIVATE_LAN_HTTPS.md), [mobile install limits](docs/V2_MOBILE_INSTALL.md) and [financial close review](docs/V2_DAILY_CLOSE_REVIEW.md). The source-level audit and its numbered findings are addressed by focused PRs and regression tests, not by declaring alpha production-ready.

### Windows one-double-click onboarding
After cloning, open the FortLedger folder in Windows Explorer. Use **`Install FortLedger.cmd`** once (Node.js 22.x and Git required), **`Start FortLedger.cmd`** to operate locally, **`Configure FortLedger Backups.cmd`** to save a DPAPI-protected separate-drive backup configuration, **`Diagnose FortLedger.cmd`** to inspect readiness, and the existing **`Update FortLedger.cmd`** after stopping the server for a manual update. The supervised owner Update Center can also restart safely when its checks pass. Never initialize a new Windows ledger to replace your Mac records; see [Windows setup](docs/WINDOWS_SETUP.md). All production acceptance gates remain in force.
