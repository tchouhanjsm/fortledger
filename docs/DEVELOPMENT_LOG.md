# FortLedger — Development log
Append a dated entry for each meaningful implementation or business decision. Never record private guest data, account numbers or secrets here.

## 2026-11-20 — Repository initialization and first development increment
- Source: product discovery conversation, project blueprint.
- Decision: prioritize premium low-click UX equally with minimal/zero recurring cost.
- Scope: implement initial seven-room local booking and payment foundation first; further invoice/restaurant modules remain roadmap.
- Implemented: local Node/Express server, SQLite data tables and seed, searchable booking list, category/room allocation, GST-inclusive calculation and automatic balance, tests, readme and blueprint.
- Verified: GitHub Actions run 44740167582 completed `npm install` and `npm test` successfully on PR #1 (initial head 28f3b41). Follow-up guard and documentation changes require the latest PR head to pass checks again.
- Review finding and fix: after a booking exists, changing category inventory would invalidate previous capacity decisions; block room category changes in this initial release. Room names can still be edited. Revisit with an availability-aware inventory migration workflow.
- Review gates: run available automated tests; inspect PR diff and GitHub checks before merging.
- Not yet built in this increment: invoice PDFs, billing lifecycle, restaurant CSV, room charge settlement, Epson printing, backup/restore, real calendar timeline, auth.
- Important limitation: initial booking UI is not for actual production use until security, data validation, persistence recovery and financial compliance review are complete.

## 2026-11-20 — Invoice branding requirement and handoff update
- Confirmed: support uploading the hotel's existing logo in Settings; render it on every proforma and final tax invoice PDF with preserved aspect ratio. The actual logo asset has not been supplied and the PDF module is not yet built.
- Verified state: PR #1 was merged into `main` (squash merge `16ee650166ef57bff36338ae5b1962d28b8749eb`). The latest PR head's GitHub Actions run `44740381860` concluded successfully. Earlier entry refers to an intermediate head.
- Next work: implement a proper calendar, booking edits, payment UI and backups before invoice/PDF workflow; invoice logos belong to the PDF milestone. Keep production readiness restrictions in effect.

## 2026-11-20 — Milestone 2 incremental booking operations
- Added seven-day room-wise calendar with navigation and category reservations awaiting assignment, avoiding calendar-grid overbooking assumptions for unassigned stays.
- Added booking editing with transaction-scoped availability recheck; payment ledger inspection, additional payment entries and status controls.
- Added SQLite online backup download API, with cleanup after response. Restore workflow and encrypted off-device backups are still future tasks.
- Check-in/check-out remain half-open date ranges. Status changes are manual, and cancelled bookings cannot be reactivated in this release.
- Limitations: basic dialog-based payment workflow, no authentication, and not yet production-ready. Test and CI results recorded with PR before merge.

## 2026-11-20 — Verified offline restore follow-up
- Added a CLI restore tool to validate SQLite integrity, expected core tables and seven-room inventory before replacement.
- Restore requires an explicit confirmation flag, refuses active WAL files, and retains a copy of the previous database.
- Added tests for successful restore and rejection of invalid backup input.
- Scope restriction: stop the application before restoring; this is a manual recovery operation, not automatic scheduled backups.

## 2026-11-21 — First hotel proforma PDF increment
- Added immutable, one-per-booking proforma snapshots, deterministic number sequence with year prefix, and local PDF generation/download with fixed T&C and accommodation totals.
- Duplicate create requests return the existing invoice rather than incrementing the sequence. Saved advance is part of the issuance snapshot and does not change retroactively.
- Added invoices list and Proforma PDF action from each booking. No real tax invoice issuing, address/bank settings, logo upload or multiple accommodation item lines yet. The 5% breakdown is illustrative pending compliance verification.
- Must test and merge only after GitHub Actions checks succeed.

- PR #5 review correction: render the immutable Terms & Conditions from each saved invoice snapshot, not from a mutable module-level default. Added invoice ledger CSS layout. GitHub Actions checks must rerun on the final PR head before merge.

## 2026-11-21 — Multi-line proforma editor
- Added an invoice editor with guest/group heading, bill-to name/address, customizable room descriptions, room quantities, nights, GST-inclusive rate per accommodation line.
- Calculations are server-side integer paise, reverse-tax 5% illustrative, with payment snapshot retained. Issued proformas are immutable and idempotent.
- PDF now supports multiple lines and flows onto additional pages; company address shown when supplied.
- Tax invoice conversion, compliance verification, saved bank/UPI settings, brand logo, customer directory and restaurant remain pending. Review automated integration tests and GitHub CI before merging.

## 2026-11-21 — Hotel payment/settings increment
- Implemented locally persisted hotel identity, optional GSTIN/address/contact and bank/IFSC/UPI settings with validation.
- New proforma snapshots preserve current business settings; PDFs show business name and payment details. Older snapshots fall back to the hotel name without requiring migration.
- Browser settings form added; no real bank or guest data in repository. Logo uploads and statutory invoice issuance still pending.
- Sensitive financial information must not be entered until authentication and local access controls are implemented and tested.

## 2026-11-21 — Restaurant menu and saved-billing foundation
- Added CSV menu import with quoted fields, configured integer tax rates, validation and transactional upsert.
- Added searchable menu, quick cart and local restaurant bill snapshots. Cash, UPI and card are supported as operator-recorded payments; room charge requires an existing checked-in booking.
- Financial snapshots are separate from accommodation invoices. **Room charge settlement and combined totals are not yet implemented**; do not double invoice these charges.
- Epson TM-T82 printing, offline cashier safety, tax-rate compliance and manually unmatched charges are future work. CI must pass on the PR head before merge.

## 2026-11-21 — Combined / separate guest folio settlement
- Added booking folio showing remaining accommodation balance, separately tracked room-charge restaurant bills, and combined due.
- A room charge can be settled individually; combined settlement records accommodation payment and each outstanding restaurant bill atomically, using immutable settlement group references.
- Duplicate bill settlement is prevented by unique restaurant bill settlement IDs; re-running a combined payment cannot charge already paid items.
- This is a payment workflow, not a final statutory tax invoice. Refunds, partial payment, tax invoices and merchant reconciliation remain pending.

## 2026-11-21 — Month-at-a-glance calendar
- Added month view showing room-night occupancy out of seven rooms, including category-held reservations and excluding cancelled bookings.
- Clicking a month date opens that date's seven-day room assignment view. Month navigation respects year boundaries.
- Date-only helpers have regression tests for checkout-day availability and category held inventory. No external calendar service or subscription.

## 2026-11-21 — PR verification and cross-chat checkpoint
All five increments completed in this development session were reviewed and merged:
- PR #6: multi-line proforma editor and PDF; GitHub Actions run `44809237028` passed.
- PR #7: hotel/payment settings and immutable branding snapshot; run `44809491799` passed.
- PR #8: restaurant CSV import, cash/UPI/card bills and checked-in room charges; run `44809826861` passed.
- PR #9: atomically recorded combined/separate guest folio settlement; run `44810094745` passed.
- PR #10: weekly/monthly calendar switch and month-room occupancy; run `44810377943` passed.
- Testing evidence is GitHub Actions unit/integration checks; no physical Epson test, tax/legal review, live-user test or rendered PDF visual approval has been performed.
- Prior dated log entries describe historical stage limitations; consult this checkpoint and source code for current state.
- **Next blockers:** local login/security, legally verified final tax invoices, Epson printer implementation and physical validation, automatic backups, manual charge review, refunds and app packaging. Do not mark production-ready.

## 2026-11-21 — Local administrator authentication
- Added first-use CLI password setup with scrypt salted hash in ignored local data file, no plain password in Git.
- Production startup refuses to serve business data without a configured password; browser uses HttpOnly SameSite=Strict session cookies and logs out.
- Protected all API routes, including backups; same-origin, JSON-only mutation checks and basic login throttling implemented.
- Test fixture constructors remain unauthenticated only for deterministic integration tests; production invocation explicitly requires auth.
- Pending: installation test on actual business device, password recovery process, penetration review, encrypted off-device backup, and role-based staff permissions.

## 2026-11-21 — Restaurant print-view fallback
- Added a thermal-width HTML receipt for each saved restaurant bill, including immutable item snapshots and current room-charge payment status.
- Receipts can be printed through the operating system's installed print driver and browser dialog, without hosted services.
- Not a statutory tax invoice; direct Epson TM-T82 LAN commands, hardware tests and failure/reprint audit trails remain pending. Output escapes guest/menu content to prevent HTML injection.

## 2026-11-21 — Authentication, receipt printing and legal review checkpoint
- PR #12 implemented local administrator password hashing/session authentication and was merged after GitHub Actions run `44811033034` passed.
- PR #13 implemented a browser-printable 80mm restaurant slip and was merged after GitHub Actions run `44811335974` passed. It uses the installed OS driver; no physical Epson TM-T82 print test.
- Government of India PIB (16 Sep 2025) clarified the 5% without-ITC hotel accommodation regime for value of supply up to INR 7,500 per unit/day. CBIC Rule 46 has tax-invoice requirements absent from current proformas. Documented sources and explicit final-tax-invoice release blockers in `docs/COMPLIANCE_REVIEW.md`.
- Current alpha is not production-ready. No browser or rendered-PDF visual QA or actual local-device install was performed; GitHub CI validates unit/integration tests only.

## 2026-11-21 — Multi-room assignment review correction
- Added separate physical room allocation records per booking. Backfills existing single-room bookings on startup without deleting original booking data.
- Users can assign 0–N physical rooms to a category booking, where N is the booked room quantity; partial allocations retain unassigned category capacity.
- Availability engine detects conflicts across all assigned room IDs and unassigned category holds; weekly calendar and unassigned list show partial allocation correctly.
- Regression tests and PR CI required before merge. This closes a gap found during deeper review of the original one-room-only allocation model.

## 2026-11-21 — Refund and financial audit ledger
- Created append-only refund records linked to individual original payments, requiring a reason and cash/UPI/card/bank method.
- Refund records preserve originals and use a unique request ID for retry-safe idempotency, with server-side over-refund protection inside a transaction.
- Booking list, folio, and new proforma issuance use **net payments** (receipts minus recorded refunds); prior issued proformas remain immutable snapshots.
- A recorded refund is **NOT** a transfer initiated through the bank or payment gateway. Operator must execute and verify the actual refund separately.
- Tests cover refund bounds, repeated requests, cancelled stays and unchanged historical invoice snapshots.

## 2026-11-21 — Automatic encrypted SQLite backups
- Added opt-in encrypted SQLite snapshots at application startup and every 24 hours while running, configurable with an absolute external backup path and a separately managed passphrase.
- Uses scrypt-derived AES-256-GCM encryption, random salt and IV, authenticated payload, atomic rename, and retention of most recent 30 snapshots.
- Added decrypt-to-new-file CLI and integrity validation for recovery without modifying a running database; the existing stop-app restore command remains the only live restoration path.
- Remaining operational requirement: secure OS key management, verified second-drive storage, test actual device recovery, and monitor backup failures. No background service runs when the application is stopped.

## 2026-11-21 — Epson TM-T82 LAN transport (experimental)
- Implemented opt-in private IPv4 ESC/POS receipt delivery over TCP, using already-saved restaurant transactions only.
- Print state and attempt count are persisted; uncertain delivery never silently retries. Reprints require explicit operator confirmation.
- No physical Epson TM-T82 model/network validation. Successful TCP write does not prove paper output. Model-specific cutters, receipt width and firmware behavior remain release blockers.

## 2026-11-21 — Manual room-charge review and restaurant UI regression
- Fixed missing Restaurant Billing section in main HTML despite existing restaurant JavaScript/API; added test that checks all required restaurant UI IDs are present.
- Manual food charges save original room identifier and guest name without assigning a booking, explicitly pending operator review.
- Reviewer can link an unmatched charge once to a currently checked-in booking, at which point it becomes visible in the correct guest folio without creating a duplicate restaurant bill.
- Original manual fields remain stored, linking is transactional and rejected on repeated attempts. No automatic fuzzy matching of guest names is allowed.

## 2026-11-21 — GST tax draft and issuance gate
- Added a per-proforma draft preparation module (distinct from legally issued invoices), recipient details and per-accommodation-line SAC review.
- Generates a prominently watermarked PDF that separates illustrative 2.5% CGST + 2.5% SGST, shows supplier and buyer details, and lists compliance blockers.
- Enforces that SAC codes are explicitly selected (996311 hotel/guest-house, 996312 campsite) and flags accommodation units outside the supported 5% value band.
- **Statutory invoice issuance remains disabled**; drafts do not consume final tax invoice numbers, do not represent a signed invoice, and can be revised without changing original proformas.
- Source: official CBIC Rule 46, PIB September 2025 clarification, and GST Council SAC classification. A professional signoff and issuer credentials remain required.

## 2026-11-21 — Hotel logo upload, immutable branding and PDF updates
- Added locally persisted PNG/JPEG hotel logo assets with size/header checks and a selected active-logo pointer. Assets remain stored in the SQLite database, not in the Git repository.
- New proforma snapshots reference the logo active when issued; PDFs resolve that historical asset even after later branding changes. Tax draft PDFs use the logo selected at draft preparation.
- Added Settings upload/preview UI, authenticated logo file API, and fallback to hotel name when no logo exists. Image aspect ratio is maintained.
- Actual Garh Jaisal logo artwork has not yet been provided, so precise visual branding approval remains pending.

## 2026-11-21 — Read-only operational diagnostics and release checkpoint
- Added `npm run doctor` to verify administrator password configuration, SQLite integrity/foreign keys/schema, seven active rooms, pending manual charges and uncertain printing jobs.
- Diagnostics check encrypted backup freshness and printer configuration without displaying guests, bank details or secrets; output is always labeled pre-production.
- Remaining external blockers: real Epson model verification/printing, legally complete signed tax invoice issuance with accountant review, actual hotel logo artwork/visual acceptance, recovery drill on target computer, and production installation/QA.

## 2026-11-21 — Focused module navigation and mobile access
- Replaced the stacked multi-module landing experience with five hash-addressable operational views. Booking KPIs, calendar, and reservation ledger stay together; restaurant, invoices, inventory, and settings each have their own focused workspace.
- Active navigation and page heading now reflect the selected module. Mobile navigation stays visible and horizontally scrollable instead of disappearing below 650 px.
- Added pure navigation mapping tests to prevent inaccessible routes; no new frontend framework or subscription required.

## 2026-11-21 — Financial precision hardening
- Replaced float multiply-and-round monetary input conversion with an exact decimal-string-to-integer-paise parser using BigInt internally.
- Amounts with more than two decimal places, scientific notation, negatives, nonnumeric values, NaN/Infinity and values exceeding safe integer paise are explicitly rejected instead of silently rounded.
- Added unit tests for INR 4,500.50, one-paisa precision, zero, invalid inputs and unsafe bounds. Existing GST-inclusive and refund calculations still use integer paise.

## 2026-11-21 — Windows first installation and data-safe updates
- Added `docs/WINDOWS_SETUP.md` with guided Windows clone, Node.js 22 + Git installation, initial `npm install`, local password and normal startup.
- Added `scripts/windows-setup.ps1`, `windows-start.ps1` and `windows-update.ps1` for an app-directory-independent install, focused startup, and explicit Git fast-forward upgrades.
- Windows persistent SQLite database and administrator hash use `%LOCALAPPDATA%\\FortLedger\\data`, independent of the tracked Git code folder. Existing non-Windows defaults continue working.
- `src/backup-before-update.js` uses SQLite's consistent backup API and verifies the snapshot **before** Git changes, with a private copy of the local password hash for emergency recovery.
- Update stops if the live app is running on its default port, tracked code has modifications, the Git remote is unexpected, or a verified backup is unavailable. Never runs `git reset --hard` and never deletes business data.
- CI now tests the full suite on Windows and Linux (Node.js 22). Windows packaging as an MSI / background service is future scope.

## 2026-11-21 — Restaurant menu CSV root-cause fix
- Found strict fixed-order header requirement caused failure on Excel/Numbers exports. Added BOM-insensitive, aliases/reordered columns and extra-column support, with explicit GST tax-rate validation and row-specific errors.
- Added a nonmutating preview API, sample downloadable template, dedicated inline feedback and confirmed import action.
- Regression tests cover typical exported headers, atomic rejection of invalid files and preview behavior. No silent guessing of tax rates.

## 2026-11-21 — Staff profiles and role-based API access
- Added SQLite staff accounts, individual salted scrypt passwords, owner-only staff creation and disabling, and a personal profile view. Existing single-admin password remains the owner's login; owner username defaults to `owner`.
- Roles: owner, manager, frontdesk, cashier. All production API routes authorize by server-side permission, not only hidden UI. Cashier sees restaurant functions and minimal checked-in guest information, but not bookings ledger, backups, bank settings or hotel invoices.
- Revoked/deactivated users lose access on the next request; role changes are dynamically applied to existing sessions. Staff password hashes stay in SQLite and are never included in API responses.
- UI loads only endpoints that the logged-in role can access, with owner-only team management in My Profile. RBAC regression tests cover endpoint denials and revocation.
- Remaining: audit event log, staff change-password UI and dedicated production security review; existing owner hash file is preserved for upgrades.

## 2026-11-21 — Role-aware first-screen UX improvement
- Reviewed actual Mac screenshots: booking calendar dominated the landing screen; empty invoice view was a dead end; restaurant menu import was visually buried behind a generic error.
- Added a personalized Dashboard with focused actions, occupancy/arrival/outstanding indicators or cashier-facing food sales/menu/pending charges. User-specific data obey existing RBAC permissions.
- Added contextual invoices CTA and made menu import more discoverable when the menu is empty; retitled duplicated restaurant section to 'New food bill'.
- Added responsive dashboard styles, navigation regression tests and no extra hosted analytics dependencies.

## 2026-11-21 — Phase 1A: payment methods and actor attribution
- Identified missing structured payment method in legacy hotel advances and additional receipts; previously only restaurant settlements had method detail.
- Additive migration adds payments.method with default `unrecorded` for historic records rather than inventing the original payment method. New booking/payment UI asks for Cash/UPI/Card/Bank and highlights unrecorded historic methods in payment history.
- Added `operation_audit` table for actor-attributed booking create/edit/status, hotel payment and refund, and folio settlement actions. Audit events are stored with server-resolved username, role and limited non-sensitive action metadata.
- Existing bookings, restaurant bills, payments, refunds and invoice snapshots are preserved. No destructive migration. The audit ledger is new; historic actions are not fabricated.
- Added migration/integration tests; release remains pre-production and requires audited recovery, strict status transitions and reconciliation follow-up.

## 2026-11-21 — Phase 1B: safe stay transitions and proforma integrity
- Replaced permissive direct status PATCH with a transaction-scoped transition policy: reserved → checked-in or cancelled; checked-in → checked-out; closed states terminal. Idempotent replays do not create duplicate audit events.
- Check-in requires assignment of every physical room, preventing an in-house guest from existing as an unallocated category hold.
- Checkout with an outstanding accommodation/restaurant folio requires explicit operator acknowledgment; the debt remains recorded and is not automatically forgiven. Cancellation with a positive deposit emits an explicit refund/credit follow-up warning.
- Issued proforma bookings cannot be silently edited until an audited amendment/revision flow is implemented. Payments continue independently and original PDF snapshots remain unchanged.
- Added staff UI transitions and tests for forbidden reversals, multi-room assignment, acknowledged unpaid departures and immutable issued proformas.

## 2026-11-21 — Phase 1C: daily collections reconciliation (read-only)
- Added local business-day reconciliation in Asia/Kolkata, explicitly separating hotel payment receipts, direct restaurant receipts, settled room-charge receipts and refund records by payment method.
- Pending/uncleared room charges do not count as collected money. Legacy hotel payments with unknown methods remain under `unrecorded` and are flagged for manual review. Refunds are locally recorded events, not proof of bank transfers.
- Manager/owner-only API and understated dashboard summary; no financial daily-close action, accounting journal, expense module or tax report is claimed.
- Tests prove India-time boundary, no double-counting of room-charged meals, method breakdown, pending charges and cashier RBAC; no schema migration needed.

## 2026-11-21 — Phase 1D: idempotent hotel payment posting
- Found repeated POST /api/bookings/:id/payments could create duplicate receipts when a network request was retried.
- Added nullable `payments.request_id` and a unique partial SQLite index, preserving all existing payment entries without inventing IDs. New UI supplies a random request ID to each confirmed receipt.
- Repeat request with identical booking/method/amount/note returns the original receipt; mismatched reuse is rejected; audit event is written only on first payment.
- Existing integrations without request IDs remain compatible for now but do not receive retry protection. Restaurant bill and refund replay handling remain unchanged.
- Integration tests verify idempotency, historic-null keys, exact balances and absence of duplicate audit events; no production finance approval claimed.

## 2026-11-21 — Phase 2A: schema versioning and recovery safety
- Existing SQLite bootstrap and idempotent feature upgrades previously ran on every application startup, without a recorded version. Introduced schema baseline v1 using SQLite `PRAGMA user_version` and a single transactional legacy migration.
- Existing databases with version 0 are upgraded in place without deleting or rebuilding booking/payment/invoice/staff records. Version 1 opens without repeating schema mutations; newer unknown versions fail closed to prevent an older binary editing upgraded data.
- FK integrity is verified before migration commit. Failed migrations roll back and do not increment `user_version`.
- Recovery validation now rejects future schema versions and foreign-key corruption before copying into a live location. Restore CLI path handling now uses a cross-platform file URL conversion.
- Regression tests simulate pre-versioned populated ledgers, incompatible future versions, corrupt legacy FK records and repeated startup.
- **Remaining:** This v1 baseline is a migration foundation, not proof of production safe restore. Before each future migration, perform an external verified backup and full Windows recovery drill.

## 2026-11-21 — Phase 2B: automated isolated recovery rehearsal
- Implemented `npm run recovery:drill` to use a consistent SQLite backup, exercise the existing offline restore into an isolated temporary directory, and cryptographically compare every restored table and value to the snapshot.
- The verification also tests copying the local administrator authentication file without printing the credential or private guest data. The temporary restored data is removed afterward; the live database remains untouched.
- Regression tests cover bookings, payments, issued proforma, menu, food bills, staff, branding and missing credential files. This is **not** a verified external-drive disaster recovery and does not certify Windows installation hardware.

## 2026-11-21 — Phase 2C: staff/owner password rotation and immediate revocation
- Existing staff profiles lacked self-service password change, and an owner-reset staff password did not revoke existing sessions.
- Added authenticated `POST /api/me/password` requiring the old password and a new 12+ character password. Owner credentials are written atomically to the existing local `admin-auth.json` and become effective immediately; staff credentials use a new salted hash in SQLite.
- Any successful password change removes all active user sessions, including other browser windows. A staff password reset or account deactivation by the owner also revokes active sessions.
- Added profile UI and tests for incorrect password, old-password rejection, owner file persistence, staff self-rotation and owner reset.
- No external email/password reset SaaS. Manual owner account recovery and on-device security audit remain pending.

## 2026-11-21 — Phase 3A: lightweight expense recording
- Added owner/manager-only expense ledger; deliberately avoided a general accounting system. Captures business date, category, amount, payment method, optional payee and reason, actor identity and unique request ID.
- Expenses are write-once. Matching request replay returns the existing record; mismatched reuse is rejected. No deletion or silent editing.
- Explicit SQLite schema migration v1→v2 adds expenses table and index; pre-existing bookings, payments, proforma invoices and restaurant records remain unchanged. Future-schema guard and offline backup validation now accept v2.
- Daily financial dashboard distinguishes received collections from paid expenses and labels the difference *net cash movement*, never profit or GST revenue. Staff cashier and front desk roles cannot view owner/manager expense records.
- Tests cover preservation across v1→v2 migration, permission denials, exact amounts, actor audit and duplicate prevention.
- Remaining: expense reversals, receipt attachments, reviewed end-of-day cash close, GST compliance approval and real machine validation.

## 2026-11-21 — Phase 3B: housekeeping linked to physical seven-room inventory
- Added small `room_housekeeping` table (SQLite schema v3), one record per physical room, seeded `ready` on migration with no booking/payment modifications.
- Staff role-aware inventory controls mark rooms ready/dirty/cleaning; only authenticated owner/manager/frontdesk can change states. Housekeeping changes are attributed and audited.
- Checkout automatically marks the assigned rooms dirty inside the booking-status transaction. Check-in requires fully assigned rooms, physically ready rooms and no other checked-in booking still occupying the room.
- Staff must explicitly confirm room readiness; the software never claims to have inspected or cleaned any room itself.
- Tests cover checkout turnover, second-arrival blocking, staff clearing the room, RBAC, audit history and v2→v3 migration.
- Maintenance out-of-service scheduling, cleaning assignments and mobile staff task lists remain future scope.

## 2026-11-21 — Phase 3C: human-confirmed daily cash close
- Added SQLite migration v4: immutable `daily_closes` records with business date, snapshot hash, opening float, expected cash, actual counted cash, discrepancy, staff identity and unique request ID. No changes to previous bookings, payments, invoices or expenses.
- Staff explicitly counts cash and acknowledges variances/unknown legacy payment methods. Closing snapshots are idempotent and cannot be silently edited or replaced.
- On retrieval, FortLedger recalculates the underlying business-date totals and flags any close as stale after subsequent financial ledger changes. This requires human reconciliation; the software does not approve bank balances or silently adjust them.
- Manager and owner only; cashier/front desk are blocked. Dashboard has a small closing review form and existing-status display.
- Regression tests include discrepancy acknowledgement, zero/unknown methods, duplicate closing requests, stale detection, RBAC and v3→v4 preserving old payments.
- **Remaining:** reviewed reversal/amendment workflow, documented safe correction procedure, physical Windows cash reconciliation and formal accounting sign-off.

## 2026-11-21 — Phase 3D: maintenance requests and inventory-safe out-of-service periods
- Added SQLite migration v5: an additive local maintenance issue ledger with room, priority, reason, created/resolved staff, and optional half-open date-scoped unavailability. Historic invoices, payments, bookings and seven-room inventory are untouched.
- Front desk can report nonblocking issues; owner/manager can block rooms and confirm resolution. Cashier cannot access maintenance. Actions are attributed in the existing operation audit ledger.
- Availability validation now subtracts rooms blocked by active maintenance per hotel-night, including category-only holds; assigned rooms cannot be used during their out-of-service period. Existing reservations cannot be silently displaced when staff proposes a block; the block is rejected with a conflict explanation.
- Check-in revalidates the assigned room against maintenance windows. The Room Inventory UI surfaces issues, planned outage dates and a manager-only resolve/release action.
- Regression tests cover seven-room capacity, assigned and unassigned reservations, date boundaries, role permissions, audit attribution, and v4→v5 migration preserving financial records.
- Physical maintenance verification, alternate-room rebooking, and full production sign-off still require staff and device testing.

## 2026-11-21 — Phase 4A: minimal returning-guest CRM
- Added SQLite schema v6: guest_profiles plus nullable bookings.guest_id and lookup indexes. Existing guest booking names, invoices, payments, restaurant records and room assignments remain untouched and no historical records are automatically linked.
- Owner/manager/front desk can create/update searchable profiles, review explicitly linked stays and prefill a new reservation. Search only returns authorized staff data; cashier cannot access profiles or contact fields.
- Reusing a guest profile is a conscious staff selection. Profile changes do not mutate booking contractual names, rates, issued invoice snapshots or financial entries.
- Added validation of contact fields and optional preference notes; no scanned IDs, passport documents or marketing campaign services.
- Integration regression tests cover privacy/RBAC, search, explicit linking/unlinking, historic-value preservation and v5→v6 migration. Physical user acceptance still pending.

## 2026-11-21 — Phase 4B: truthful room-night business analytics
- Existing home already showed arrivals/departures and booking outstanding, but not period occupancy/ADR/RevPAR. Added read-only owner/manager report for selectable hotel-night date ranges, up to 366 nights.
- Booking occupancy = noncancelled booked room-nights / active available room-nights. Gross ADR = GST-inclusive booked room value / booked room-nights. Gross RevPAR = GST-inclusive booked room value / active available room-nights. Future bookings remain *reservations*, not observed guest stays.
- Maintenance discounts one physical blocked room only once per night; checkout date is excluded. Unlike cash receipt reporting, this attributes quoted accommodation value to booked stay nights; tax-exclusive recognized revenue is NOT derived or claimed.
- Existing maintenance ledger holds open blocks, not a complete immutable historical inventory-time series: historical outage denominators must be interpreted cautiously.
- Backend access is owner/manager only. New tests cover two-room multi-night overlaps, cancelled stays, maintenance overlap, invalid dates, overcommitment detection and role denial.
- No schema migration; no third-party analytics subscription.

## 2026-11-22 — Owner Update Center and guarded Windows desktop launcher
- Confirmed the existing Windows updater already verifies the Git origin, clean tracked tree, stopped port, pre-update SQLite snapshot and tests, but has no installer UI and uses a now-obsolete `npm install` path.
- Added an owner-only, loopback-only, non-mutating remote version check in My Profile. Dirty/untracked checkouts (including the historical untracked lockfile), wrong branch/origin and offline remote fail visibly rather than claiming the latest code is installed.
- Added `Update FortLedger.cmd` and an external PowerShell quick updater. It refuses an active app, requires a recent independently protected encrypted backup *and* successful encrypted restore drill, reuses the verified Windows updater, and starts the normal persistent-data launcher only after tests pass. It never deletes live files or triggers a money write.
- Updated Windows setup/update to use the already-committed dependency lockfile via `npm ci`; updated older documentation. In-app update **installation** remains intentionally pending a safe supervisor rather than hiding a background process behind a payment-capable server.
- Physical Windows and Mac validation, replacement-device encrypted recovery, printer hardware, tax compliance and production release remain unfinished.

## 2026-11-22 — Optional pickup and stay notes, schema v12
- Add two optional text fields to the booking editor in a collapsed block so routine booking stays one-click/simple. The reservation list signals when notes exist without displaying their sensitive details by default.
- Authorized staff can view/edit notes through a standalone operational-only action even when an issued proforma locks contractual booking edits. Existing issued proforma PDF snapshots and all money remain unchanged.
- Version 12 adds columns transactionally with empty defaults; old booking request fingerprints for empty notes remain unchanged, while different nonempty notes are fingerprinted for safe retries.
- Note-only updates are actor-audited without duplicating guest text in the event log. No automatic pickup reservation, driver dispatch, transfer cost, or guest communications are implied.
- Mac/Windows physical acceptance and protected backup remain mandatory; see docs/BOOKING_OPERATIONAL_NOTES.md.

## 2026-11-22 — Windows supervised owner updates V2 (alpha)
- Added independent Windows parent supervisor `scripts/windows-supervisor.mjs` and changed the persistent Windows launcher to use it. Backend process and external updater communicate only over child-process IPC, never direct Git/PowerShell from a web request.
- Owner-only localhost Update Center now verifies an exact GitHub `main` commit's successful Ubuntu/Windows/Chromium push CI, backup freshness on a separate drive and supervisor readiness before enabling explicitly confirmed installation.
- The child server rejects new financial requests while draining and closes the HTTP listener gracefully. The parent waits for the clean drain message and child exit, revalidates CI and passes an exact 40-character commit to the Windows updater, which performs encrypted-backup restore drill, SQLite snapshot, verified fast-forward, `npm ci` and full Node tests. Restart is supervised.
- Failed/uncertain installs leave an update journal outside Git; the prior version is only restarted when the Git revision did not change. Migrations are not blindly rolled back.
- No signed releases, live Windows process/service integration test, off-device backup certification, Mac auto-updater or statutory invoice approval yet. These remain explicit production gates.

## 2026-11-22 — Windows one-double-click onboarding and DPAPI backup configuration
- Added Explorer-friendly Install, Start, Configure Backups and Diagnose launchers using the existing Windows setup/start scripts. They are convenience entrypoints, not an MSI, Windows service or silent update.
- Windows setup now verifies official Git origin/main, Node 22, idle server and existing administrator pairing before installing pinned dependencies. It refuses to create a new owner hash when an existing hotel database has lost its credential file.
- Optional backup wizard stores only encrypted CurrentUser-DPAPI passphrase data and a separately protected backup folder path outside Git. Startup, manual update and diagnostics load the secret into the current process environment so encrypted snapshots and the Windows supervisor do not require repeated manual input.
- The backup location guard requires a different Windows drive/share root from the live SQLite database. External-drive encryption, credentials recovery on a different Windows account/PC, physical Epson tests and statutory GST acceptance remain unverified.

## 2026-11-22 — Windows native desktop installer (unsigned alpha)
- Added a GitHub Windows build that packages the existing local Node/SQLite application, native SQLite addon, pinned production dependencies and Node 22 executable inside an Inno Setup per-user installer. A tiny .NET Framework Windows Forms tray shell supplies an ordinary FortLedger desktop/Start Menu icon, opens the browser and supports a graceful nonfinancial stop over private stdin. Staff need no Git/Node/npm/terminal.
- The native first-run owner password dialog communicates only over private stdin to a one-time initializer that refuses any existing SQLite or owner hash. The database and auth remain under `%LOCALAPPDATA%\\FortLedger\\data`, outside installed code.
- Installer upgrades run a pre-copy guard: no active listener, paired database/auth, recent protected separate-drive encrypted backup and verified isolated restore when the app was previously installed. Uninstall never deletes hotel data or backup settings.
- Installer mode reports installer-managed updates rather than attempting the Git-based Update Center. A GitHub Actions artifact is available for owner-managed distribution; digital signing, a stable GitHub release channel, a physical Windows GUI trial, external-drive recovery and legal/printing gates remain pending.

## 2026-11-22 — Quiet owner update notification for installed Windows systems
- Owner's localhost workspace checks read-only release status shortly after sign-in and at most every six hours while open. A discreet **New update** indicator opens My Profile → Application updates. Staff roles and private-Wi-Fi phone sessions never receive the indicator or its check.
- The button does not execute a Git pull, download/install unsigned code, migrate data or restart in-flight bills. Installer builds keep the existing official exact-main-CI and artifact download gate; operator-verified external backups and safe shutdown remain required before an installer upgrade.
- Existing automatic emergency DPAPI backups, external protected backups, and optional staff HTTPS LAN were audited rather than reimplemented. All three features require local configuration/hardware acceptance; signed release packages and tested one-click upgrade are future security tasks.

## 2026-11-22 — Upgrade Phase: guarded one-click protected backup preparation
- Implemented an owner-only, local-PC **Prepare safe update backup** operation in My Profile. Creates a fresh paired AES-GCM SQLite and original-owner credential artifact to the configured separate drive and performs a complete isolated restore rehearsal. It refuses same-PC emergency backups, missing drives, missing/invalid owner hash and unverified copies, returning no private paths or secrets.
- The route serializes repeated clicks and is awaited by the graceful desktop tray/supervisor shutdown so SQLite is not closed while the backup is in progress. The current installer still requires closed operations and a recent separately protected backup before program files can be changed; the operation does **not** run unsigned downloaded executables or perform migrations.
- Synthetic regression and authenticated owner/staff permission tests cover refusal paths and restore integrity. Physical external-drive and new-PC acceptance remain mandatory.
