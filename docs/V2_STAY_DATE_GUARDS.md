# V2 hotel business-date rules for physical stay transitions (FL-003)

Date comparisons use the hotel's `Asia/Kolkata` business day, never a staff phone or server-local clock.

Normal **check-in** requires `checkin <= hotel business date < checkout`, full physical room allocation and ready rooms with no blocking maintenance. Early, expired or otherwise outside-date check-in fails before status or housekeeping changes.

Normal **checkout** is permitted on or after the booked checkout date and follows the existing folio/housekeeping protections. An **early checkout** requires an owner or manager exception with a reason of at least 10 characters. Checkout on the actual departure day requires no date exception. Legitimate exceptions for outside-date check-in also require owner/manager approval and reason, and the decision is recorded in the existing booking status audit event with hotel business day, booked dates and override flag. No tax, payment or issued proforma is edited.

The UI checks the same date before prompting for exceptional actions. The server enforces the rule independently; a cashier/front desk cannot bypass it by sending `date_override=true` directly. Test fixtures can inject a synthetic business-date clock into `createApp`; normal deployment does not use that injection.

Exception is deliberately rare. A real Mac with an inaccurate date must be corrected; date overrides must not be used to compensate for a clock misconfiguration. Existing historical statuses are not rewritten. Hotel owner must still define a detailed late-checkout charging policy and accountant-approved amendments separately.
