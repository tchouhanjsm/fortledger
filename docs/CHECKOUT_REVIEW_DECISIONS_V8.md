# V8 checkout document review — append-only staff decisions

## Confirmed gap
Checkout #155 writes one durable immutable `held_for_review` case, but staff cannot record source-review outcomes. A case can be acted on without becoming a statutory invoice.

## New workflow
- Owner/manager in existing **Invoices → Checkout invoice reviews** may record **Needs source review** or **Source reviewed — send to accountant**, with a reason (10–300 characters).
- Forwarding explicitly requires a checkbox confirming the staff member inspected original source evidence. This **never** constitutes accountant approval, bank confirmation, GST validation or permission to issue.
- Every decision is an immutable, append-only event in a new table. The original `checkout_document_cases.state`, snapshot JSON, booking, folio and financial amounts remain unchanged.
- `review_status` and `latest_review` are derived at read time; historical `state` remains `held_for_review`. This distinction deliberately prevents older code from treating a review decision as statutory issuance.
- POST `/api/checkout-document-cases/:caseId/reviews` owner/manager only, GET allowed to existing case viewers. Stable 16–80-character request IDs, SHA-256 fingerprints, strict replay and no same-status duplicate events.
- Schema adds one v13-compatible support table with SQLite UPDATE/DELETE refusal triggers. Original case uniqueness and checkout transaction unchanged.

## Testing and release
Synthetic DB tests cover state changes, rejection, replay, immutable source, restart and v13 compatibility; authenticated role tests include cashier/front desk denials. Require Linux/Windows Node and Chromium, installer checks, independent encrypted backup and V7 supervisor compatibility. **Final tax invoice issuance remains disabled** pending #147 and physical acceptance #135.

Future legally approved issuer states and numbering must use separate accountant-reviewed statutory events; never rename this internal review to `approved`.

## Real-browser and SHIZUKA polish (V8 QA)
The existing 390px/1440px checkout Chromium smoke now exercises the **actual owner review controls**, including selecting the accountant handoff status, entering a note, checking source evidence and saving the request. It confirms the immutable original case snapshot stays identical and no legal invoice is created. Review controls use a responsive single-column grid, full-width inputs, readable action height and visible keyboard focus. This is browser acceptance on disposable synthetic records, **not** accountant signoff or physical Windows acceptance.
