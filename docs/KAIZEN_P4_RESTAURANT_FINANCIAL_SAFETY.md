# Kaizen batch 4 — restaurant payment confirmation and menu-price authority

## Confirmed safety issues

1. An authenticated cashier has `restaurant.write` for routine food sales. Before this batch, that single permission also authorized importing a CSV, which can change every menu price or GST rate. That is not appropriate for day-to-day cashier operations.
2. The **Review bill** panel shows current menu price and tax, but the server previously recalculated amounts at the moment of saving. If menu administration changed a price between review and click, a different total could have been committed without staff confirmation.
3. While a bill POST response was uncertain, cart editing was locked but the payment method and manual room/guest inputs could still be changed, which made the visual state inconsistent with the retained immutable retry intent.
4. The payment selector did not clearly distinguish **recorded money received now** from an unpaid **room charge**.

## Changes

- Added the distinct `menu.manage` authorization for owner and manager. Cashiers keep `restaurant.read` and `restaurant.write` to create bills, inspect the menu, review, save, and print. They cannot preview/import/update prices through crafted API requests and no longer see CSV management controls.
- An authenticated restaurant bill POST must contain exact previously reviewed `unit_price_paise` and `tax_rate` for every item. The backend compares both against the currently active menu inside the existing SQLite bill-create transaction, **before** recording sale/payment or the idempotency marker. A changed price/tax rejects with HTTP 409 and instructs the operator to refresh and review.
- The exact same request ID and payload can still recover a previously saved bill after menu prices change, because the durable idempotency lookup is performed **before** drift verification. A different intent cannot reuse the same ID. The bill snapshot and historical tax totals remain immutable.
- Frontend now sends the reviewed line prices and taxes and locks payment/room/guest inputs whenever the save outcome is ambiguous. Confirmed server rejection unlocks editing; uncertain network failures keep the same request identity for recovery.
- Payment options explicitly distinguish cash/UPI/card *already received* from a room charge *settle later*. FortLedger does not collect electronic payments automatically or verify bank receipt.
- Existing synthetic unit-test billing helper retains legacy calls without expected price fields; actual authenticated hotel deployments enforce the stricter contract. Custom authenticated API clients must include reviewed prices and tax for each line.

## Verification

Authenticated API tests check manager-only menu changes, cashier bill creation, stale-price conflict, zero bills posted on mismatch, exact replay after another menu price change, immutable item snapshots and no second payment. Chromium checks the cashier's actual menu administration visibility and bill submission. Existing Linux, Windows and browser suites must all pass before merge.

## Remaining

Saved-bill correction/reversal remains a separate, audited accounting feature rather than silently mutating a paid receipt. On-site Epson, Mac and accountant acceptance are still required; release status stays **NOT RELEASED**.
