# One hotel business clock (FL-008)

All operational business dates use `Asia/Kolkata`, regardless of the Mac or phone's current timezone. UTC instants remain the stored historical timestamps. The `hotelBusinessDate()` helper owns the timezone conversion for server-created proforma and GST draft documents. The proforma sequence year and issue date are derived from the **same instant and business date**.

The Today dashboard now assigns restaurant sale timestamps to the hotel IST business date instead of converting them to the viewing device's timezone. SQLite daily collections already use the explicit +05:30 conversion. Existing issued invoices, audit events and sale timestamps are **not modified**. Dates are calendar dates with midnight IST as the boundary; a configurable night-shift cutoff is not yet implemented.

Regression tests check 31 December 18:29:59 UTC versus 18:30:00 UTC, the 2027 New Year boundary, issued invoice prefix consistency and dashboard grouping. Real Mac and staff-phone clock synchronization remain operator acceptance gates.
