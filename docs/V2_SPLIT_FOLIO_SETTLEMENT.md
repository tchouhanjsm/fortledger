# FortLedger V2 — mixed accommodation/restaurant settlement (FL-017)

The combined folio settlement can now record **different methods** for the accommodation and restaurant components in a single SQLite transaction. For example, the guest may pay accommodation by bank transfer and settle food charges by UPI.

- The accommodation method selector allows cash, UPI, card and bank transfer.
- Bank transfer requires a nonempty 5–80 character UTR/reference. The reference is saved in the accommodation payment note and audit; staff must verify funds arrived separately.
- The food room-charge settlement selector remains cash, UPI, card; there is no undocumented bank settlement against restaurant bills.
- Existing combined settlement calls with only `{method:'upi'}` behave as before. New calls may add `accommodation_method:'bank'` and `bank_reference:'...'`.
- Accommodation payment and food settlements commit atomically. The resulting folio balance must reach zero without duplicate payments.

This implementation does not perform bank verification, collect bank account credentials or issue a statutory tax invoice. Record only the transaction reference, never sensitive access secrets. Independent payment reconciliation and human operational acceptance remain required.
