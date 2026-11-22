# Restaurant bills — review and edit before saving or printing

Restaurant cashier workflow for Garh Jaisal (bill-only, no kitchen orders):

1. Add menu items to **Current bill**, change quantities with + and −, or use **Remove** to delete an entire line.
2. Choose cash, UPI, card or room charge. Room charges require a checked-in booking or original manual guest/room for later verification.
3. Click **Review bill**. The review is **unsaved** and shows item names, quantities, rates, line totals, inclusive tax and grand total, plus the selected payment destination.
4. While the review is open, use the cart controls to increase/decrease quantities or remove an item, and use the menu to add additional items. The review totals update instantly. **Continue editing** returns to the editable draft without posting any sale.
5. Click **Confirm & save bill** only after inspecting the final lines and amount. The same explicit confirmation states that cash/UPI/card is a staff-recorded payment, not an externally verified bank transfer.
6. Only after confirmation does the original retry-safe `POST /api/restaurant/bills` create an immutable saved bill. Staff can then **Open saved receipt**, use the separate saved-bill print action, or look up history. Nothing is printed automatically during review.
7. If the network response is lost, the app preserves the original bill/request ID and prevents editing that uncertain submission. It can retrieve a confirmed saved bill or retry the exact same intent. Never submit a different bill to work around an uncertain result.

**Saved bills are not mutable financial drafts.** Once a bill has been saved or settled, its original item snapshot and recorded payment must not be silently changed. Corrections to an already-issued bill will need a separately audited adjustment/reversal process and, if applicable, tax-accountant guidance. This change specifically supports freely correcting the **unsaved** bill before it is committed and printed.

Browser regression checks remove, re-add, modify quantities and return to editing during the review, assert zero saved bills before confirmation, and simulate a lost response after saving to prove there is exactly one saved bill. Existing print/reprint protection and room-charge matching remain unchanged.
