# V8 accountant readiness — owner-only review (not issuance)

## Problem
The existing PDF inventory (#159) only reports archived historical originals; checkout cases and restaurant correction decisions remain in separate screens. The accountant needs a single source-linked list of review exceptions without a second financial ledger.

## Implementation
- Owner-only `GET /api/accountant/readiness` reuses the saved historical inventory and supplier GST readiness; it reports missing local supplier data, printed PDF identifiers, potential same-FY number collisions, printed serial formatting issues, held checkout cases and unresolved restaurant correction cases.
- Every exception is linked to a source kind and ID with an explicit operator/accountant next action; hotel business date and *owner-reported* historical PDF issue date are distinguished.
- The register never includes payment/revenue totals; it does not aggregate document sources, approve tax rates, declare banks verified, issue invoices or file returns.
- For safety, the server caps returned issues, reports truncation, keeps owner-only access in both `access.js` and the API handler, and sends no PDFs to the browser.
- Frontend extends **Invoices** with an owner-only expandable panel. No new dashboard, schema version, native dependency or cloud service.

## Compatibility and acceptance
Source-only V7 eligible subject to supervisor, pinned CI and independent encrypted recoverable backup. Existing v13 tables are read without writes. Tests ensure exception links, same-FY collisions, non-issuance, DB read-only integrity and direct manager authorization denial. Browser and CI validation required before merge.

## Next phase
Checkout review outcomes stay held until a separate append-only case-review PR. The owner-only CSV expansion follows that and cannot be mistaken for a GST return. Legal issuance #147 and real hardware/recovery acceptance #135 remain blocked.

## Source-linked exception CSV (phase 3)
The owner may download `/api/accountant/readiness.csv` from the same Invoices panel. This export contains source type and numeric ID, issue code, explicit date meaning, next action, and `NOT GST APPROVED` classification—no guest names, paid amounts, invoice PDFs, GSTIN, or operator notes. Formula cells are escaped at CSV output, the source database is not changed, and a truncated result refuses export rather than silently presenting incomplete evidence. Reviewed checkout cases retain accountant-signoff-pending status, never statutory approval. GST issuance, return filing and bank reconciliation remain out of scope.
