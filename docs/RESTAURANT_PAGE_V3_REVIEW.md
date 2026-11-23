# Restaurant page V3 — Bill-only workspace review

## Source-level findings

The existing restaurant feature already supports CSV menu import, searching and filtering categories, editable unsaved carts, separate pre-save review, exactly-once saving, cash/UPI/card sales, checked-in and manual room charges, immutable receipts, guarded Epson printing, manual linking, and guest folio settlement. It **does not** require KOT, kitchen stages, open tabs or table-order infrastructure for this seven-room property.

The older presentation had an undifferentiated long page: menu and draft at the top, menu admin before receipt history, and each saved bill displayed only ID, payment type and amount. A cashier couldn't see which room charges were unpaid or what items a particular saved bill contained without opening a printable receipt. History search couldn't match item names. The same generic Print/LAN Print buttons dominated each row.

## Implemented, with no financial schema migration

- A compact read-only four-card overview: **bills today**, **collections recorded today**, **room bills not yet settled**, and **manual charges requiring guest linking**. Date grouping is explicitly Asia/Kolkata. Collections count direct cash/UPI/card sales on their creation date and room charges only on their actual settlement date—never unpaid room charges or unverified bank receipts.
- Explicit shortcuts to the live **New bill**, **Saved bills**, and collapsible **Menu management** areas; more relevant saved-bill history appears before CSV admin.
- A visually distinct two-column menu and draft with mobile single-column fallback, better touch targets, clear draft/review/save hierarchy and larger summary/totals. No new libraries or paid assets.
- Saved history cards show ID, hotel-local timestamp, amount, true paid/room-balance/needs-linking status, guest/booking reference where available, and an expandable immutable line-item snapshot with quantity/rate/total. All/paid/room-balance/needs-linking filters and item-name search. Save, actual receipt HTML, safe LAN-print and reprint protections are unchanged.
- Restaurant history read API joins the **existing** `restaurant_settlements` table to expose actual method and time. Reads do not modify source bills. Browser and Node regression tests check the categories and verify no unpaid room bill is labeled paid.

## Remaining genuinely missing features / future batches

1. **Audited saved-bill correction and reversal**: once a cash/card/UPI sale or charge-to-room is recorded, changing its original snapshot is not safe. A separate reasoned credit/replacement action with reconciliation, owner/manager permissions and appropriate accounting treatment is necessary. No direct UPDATE of historical bills.
2. **Manual menu activation/deactivation** and single-item price edits in the UI: CSV import can update prices/reactivate items, but no simple manager screen to mark an item temporarily unavailable. Keep historical sold-menu snapshots unchanged.
3. **Optional PDF-friendly daily restaurant reconciliation** and export of sales by method, date and unpaid folio liability, reconciled to daily close—not a second competing ledger.
4. **Actual Epson printer acceptance**, safe reprint under a dropped response, and UI/200% zoom tests on the hotel's Mac and staff phone.
5. **GST tax-document approval**, if statutory tax invoicing is required beyond current receipts explicitly marked non-tax invoices.

Do **not** add kitchen tickets, KOT, table reservations, preparation statuses, ingredient inventory, enterprise stock systems or a second cloud POS merely for presentation. FortLedger remains a simple local-first bill-only hotel app. Physical acceptance and accountant signoff remain unresolved.

## V8 post-save Ethernet print refinement
After a successfully saved restaurant bill, cashier staff now see a **Send to Ethernet printer** action alongside the existing browser receipt. It calls the same guarded LAN printing API already used by Saved bills and shows explicitly that paper was not verified. Printer configuration is checked before sending, a first print requires confirmation, and subsequent reprint is possible only after a separate physical-paper confirmation. The app never auto-prints on save, blindly retries an uncertain attempt or lets managers access cashier-only printing. No bill, menu, tax, settlement, native dependency or printer-port policy changes. Live Epson paper acceptance remains a separate human check (#135).


## V8 physical table setup (reviewed batch)
Owner or manager can add 1–30 explicitly entered real table labels in one preview/confirm operation; an optional numbered prefix merely prepares labels in the browser, never automatically creates inferred seating. Preview identifies missing, already active, and already hidden labels. The server hashes the exact requested list and current table state; changes between preview and confirmation fail closed. Apply is one transaction with a separate audit entry per new label. Existing labels are not renamed or reactivated; the receipt table snapshot remains immutable. Cashiers only select currently active labels. There is no table occupancy, open order, KOT, reservation, auto-settlement or automatic GST/refund issuance. Real physical table count still requires staff input.
