# FortLedger V5 — Reception space, simple restaurant tables and staff quick sign-in

Source: one reviewed development PR on main's V4 foundation. **Alpha only; human release gates still apply.**

## What changed

### Sidebar, one click
- Desktop/tablet navigation now has an explicit **Minimise sidebar** button in the brand header.
- Compact sidebar is 76px wide, keeps its eight existing role-protected destinations as icons and accessible labels/tooltips, and preserves the preference in the current browser. Click **Expand sidebar** to restore 206–272px labelled navigation.
- Nothing about routes, permissions or financial writes changes; the existing phone bottom Today/Bookings/Rooms/Restaurant/More navigation stays visible.
- No automatic icon-only mode is forced on tablet users; this is an informed choice.

### Dining tables — just an optional identity on saved food bills
- The restaurant is still a **bill-only** tool. There is no open-table order, KOT, kitchen slip, kitchen status, automatic dining-table occupancy, reservation, or recurring cost.
- Owner or manager expands **Dining table names** in Restaurant and creates real names (e.g. T1, Courtyard 2) or temporarily hides names no longer in use. No physical table count is invented.
- The cashier optionally chooses a table before **Review bill**. Walk-in / no table remains valid.
- Final review includes the table name; one idempotent save snapshots the table label into `restaurant_bill_tables`. The original bill, receipt HTML, Epson ESC/POS slip and searchable history keep this label even if the table later becomes hidden.
- A table name is not a guest room number. Room charges still require the separate checked-in guest / manually unmatched guest flow.
- Historical bills, item snapshot, payment and tax remain immutable. Hiding a table never hides or changes historical receipts.

### Single-menu-item manager price edit
- Open Restaurant → Menu management → Temporarily hide / restore individual dishes.
- Choose **Edit price** on a current dish, review the GST-inclusive old price and GST %, enter both new values and a mandatory reason, then confirm. The server checks owner/manager role and the exact old price/GST in one transaction.
- If another operator changed the menu since review, the save is rejected and must be refreshed. Saved bills are never repriced, and an open draft must be reviewed again before saving.
- CSV bulk menu management continues unchanged; this is not a second menu database.

### Optional trusted-device PIN for busy reception
- **Disabled by default.** Only the owner signed in with a full password **on the local computer** may enable from My Profile → Staff quick PIN sign-in policy. Re-enter the owner password to change the policy.
- Front-desk and cashier staff enrolled with their own full password can register a **six-digit PIN on that local browser** under My Profile. Next login offers **Use staff PIN instead**. This mode requires a cryptographically random 256-bit HttpOnly SameSite=Strict device cookie **plus** the PIN. No PIN plaintext, device secret, or owner hash is stored in SQLite together.
- No quick PIN on a private LAN phone, unknown browser, manager or owner account. The original 12+ character password remains functional and is the recovery path.
- PIN guessing attempts are recorded per-account in persistent SQLite: five wrong PINs block PIN sign-in for 60 minutes, across process restarts and IP changes; password login continues. PIN sessions last two hours rather than eight. The owner can disable all PINs, and staff can revoke their own.
- Staff disable, role change, staff password reset, owner password rotation, or owner feature disable revoke PIN credentials and PIN sessions. A restored database without the original device cookie requires password sign-in and new enrollment.
- A browser cookie is **not equivalent to hardware-enforced Windows Hello/WebAuthn**. A compromised/unlocked shared PC can still be abused. A true device passkey is a future security improvement, not claimed here.

## Versioned migration and safety

This code upgrades the **existing** SQLite schema v12 to **v13**, adding only `restaurant_tables`, `restaurant_bill_tables`, `staff_pin_policy`, `staff_pin_credentials`, and `staff_pin_failures`. The migration is a single SQLite transaction, checks foreign keys, and validates table shapes before accepting new bills. No historical bill/payment/invoice snapshots change.

**Before any live Windows installer upgrade:** finish active operations, stop the running process from the tray, verify an independently protected encrypted backup together with the owner credential recovery material, and use only a reviewed Windows EXE whose exact commit passed installer and full tests. New GitHub code does not update an existing installer-managed app automatically. Do **not** downgrade onto a migrated v13 database; restore a properly verified earlier backup only if a supervised rollback is necessary.

## Test and release boundary

The test batch exercises 320/360/390/768/1024/1280/1440/1920 CSS widths, compact/sidebar storage, tables, receipts, server role checks, stale price/GST rejection, saved-bill replay safety, PIN enrollment, wrong device, wrong username, global lockout, staff role revocation, and full password fallback. Synthetic automated checks are not real hotel printer output, Windows OS device protection, Wi-Fi segmentation, backup restoration, staff walkthrough or GST sign-off.

Still pending as separate scope: a financially correct **post-save restaurant bill reversal/credit**. The app already supports editing draft food bills *before saving*. A saved paid bill cannot be rewritten safely. A linked append-only credit/refund event must be designed together with current-day collections, previously closed cash days, GST credit notes, and room folio settlement before enabling any financial reversal. Do not falsely implement this as destructive DELETE.

Physical human release gates remain [Issue #135](https://github.com/tchouhanjsm/fortledger/issues/135). Financial correction [Issue #139](https://github.com/tchouhanjsm/fortledger/issues/139) remains open pending accountant-reviewed correction policy.
