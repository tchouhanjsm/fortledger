# V2 Restaurant manual room charge reconciliation (audit FL-004)

A manual restaurant food bill remains **unmatched** until an authenticated staff member deliberately links it to a **currently checked-in booking**. The original typed room and guest labels are preserved.

## Matching rule

1. Read the original guest and room written on the manual receipt and compare them with the selected booking's guest name and actual allocated room names.
2. Exact names match after case/whitespace normalization. Cashiers and other authorized staff can link matching entries with one confirmation. A pending bill is never silently auto-linked by name alone.
3. When **either** guest or room differs—or allocation information is missing—the link is denied by default. An **owner or manager** must provide an explicit override and a reason of at least ten characters. No cashier or front-desk override is allowed merely by editing an API request.
4. Every successful link creates an immutable `restaurant_bill.linked` audit event in the **same SQLite transaction**, including original manual labels, selected booking, actual assigned rooms, actor username/role, match decisions, and override reason.
5. The app keeps the original manual labels unchanged, the link is single-use, and no new restaurant bill, payment or settlement is created by this action. Corrections/reversal of an incorrect *already-linked* charge remain a separately reviewed workflow, not an unaudited edit.

Tests deliberately create **guest A / room 2** and attempt to attach the bill to **guest B / room 1**, first as cashier (denied), then manager without justification (denied), then manager with recorded review (accepted). The HTTP endpoint repeats the block/override path. Real front-desk matching, guest signatures and paper evidence still require physical acceptance.

This is a conservative policy for a seven-room hotel; it requires operator review when a manually entered nickname or shorthand differs from the booking's official name. No kitchen-order process or new database table.
