# Kaizen batch 6 — audited menu availability for seven-room restaurant billing

## Verified gap

The existing CSV importer changes menu prices and reactivates previously inactive items, but there is no operator-friendly way to pause a sold-out dish without preparing and importing an entire CSV. The cashier only needs the active sale menu; owner and manager need an auditable visibility control.

## Implementation

- In the existing collapsible **Menu management** area, owner and manager can search active and inactive dishes and temporarily mark any item unavailable or available again. This is not a KOT, stock/inventory system, or new POS.
- GET /api/restaurant/menu remains **active-only** for all restaurant operators. GET /api/restaurant/menu/all and PATCH /api/restaurant/menu/:id/availability require **menu.manage** (owner or manager); cashier and front desk are denied server-side.
- Every PATCH must include an explicit Boolean `active` and `expected_active`. A stale screen receives HTTP 409 and must refresh, preventing competing managers from silently undoing each other's change.
- Every effective state change writes an actor-attributed operation audit in the same SQLite transaction. No migration is required: the existing `menu_items.active` column is used, with an added audit entity type.
- Saved bills and past prices remain unchanged; item IDs stay stable. A newly submitted bill referencing a newly inactive dish is rejected before payment or request-ledger mutation. An unchanged retry of an already-saved bill still replays the historical result.
- The new manager controls use the existing Heritage Sky styles, are keyboard-focusable, preserve focus following a change, provide live feedback, and require confirmation before mutating.

## Verification

New Node tests cover manager/cashier authorization, stale state rejection, unavailable item sale rejection, unchanged retry replay, audit attribution and past receipt immutability. The existing Linux/Windows/Chromium CI is required before merging.

## Remaining

- Single-item price/GST editing needs explicit old/new price display, suspicious-change review and comparable optimistic conflict protection. The existing signed CSV flow remains the safe authorized price-edit mechanism.
- Saved-bill correction/credit, daily payment reconciliation export, Epson physical paper, Mac restore and GST accountant acceptance remain separate tasks.
- Release verdict: **ACTIVE ALPHA — NOT RELEASED**. No production Mac data or physical hardware was accessed by this change.
