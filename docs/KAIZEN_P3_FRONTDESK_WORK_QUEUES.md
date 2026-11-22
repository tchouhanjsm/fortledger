# Kaizen batch 3 — receptionist arrivals, in-house and departures

## Source-level finding

The reception ledger already supports status, guest/room, dates, payments, safe booking transitions, room assignment and arrival/departure work queues. But its quick filters were All / Arrivals / Departures / Unassigned / Balances: there was no **In-house** work queue, despite the real daily workflow requiring Arrivals → In-house → Departures → All. The existing dashboard distinguishes physical check-in from reservations; the new queue keeps that distinction.

## Implemented

- Four primary tab-style quick filters: **Arrivals**, **In-house**, **Departures**, **All bookings**, followed by quieter exception controls for room assignment and unpaid balances. A matching in-house option is also present in the existing select filter.
- **In-house means status = checked_in**, not merely allocated or reserved. This intentionally includes overdue departures until a real checkout is recorded. Departures filter still shows checked-in stays due or overdue. A checked-out guest is never shown in-house.
- The booking row shows a concise next-action hint: room allocation/room readiness before arrival, folio review for departures, overdue stay attention, separate refund action for cancellation, and housekeeping after checkout. These hints are guidance, **not** server-authoritative permission, financial settlement or physical room-state assertions.
- Existing role-based controls, booking/payment/folio actions, server-side date guards, room readiness checks and immutable proforma workflows remain unchanged.
- No new dependencies, cloud services, kitchen workflow or schema migration.

## Verification

Unit tests prove an overdue checked-in guest remains visible, reserved/cancelled/checked-out entries are never misclassified, and the actual UI exposes all four main work queues and safe hints. Full Linux/Windows/Chromium regression remains required; physical-device tests are separate.
