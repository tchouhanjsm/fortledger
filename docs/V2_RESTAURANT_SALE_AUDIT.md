# FortLedger V2 — Restaurant sale accountability (audit FL-005)

An authenticated restaurant bill creation now writes `restaurant_bill.created` to the existing `operation_audit` table inside **the exact same database transaction** as the saved bill and any retry marker. The event records the logged-in staff username/role, payment method, associated booking (if any) and integer-paise amount. It does not log guest names, menu contents, payment tokens or secrets.

An unchanged retry with the original request ID returns the already-saved bill without creating another sale or duplicate audit event. If audit writing fails, the whole transaction rolls back, including the sale and request marker. Historical bills are not backfilled with invented cashier identities; only new HTTP bills receive current operator attribution. Legacy internal callers may still omit an actor for fixture compatibility; the HTTP endpoint always supplies the current authenticated actor.

This is **not** an overhaul of restaurant billing. There is no kitchen ticket, offline write, extra database or paid service. A separate audited review workflow is still needed for manually entered room-charge matching (audit FL-004).
