# V11 — reviewed accommodation adjustments after an issued proforma

**Status: commercial correction records, NOT statutory invoices or GST credit notes.**

Once a proforma is issued, FortLedger locks the base booking dates, room quantity and nightly rate so the original PDF remains an immutable historic agreement. A change to the agreed monetary balance is now recorded as a **separate owner/manager-approved accommodation charge or credit**, without rewriting the original booking or proforma.

## Owner/manager workflow

1. Open the guest folio for a still reserved or checked-in booking with an issued proforma.
2. In Accommodation Adjustments choose **Additional charge** or **Credit**, enter the positive amount, a substantive 10–300-character explanation and an optional reference to a privately stored signed guest agreement. Confirm the action.
3. The app writes one append-only adjustment and an attributed booking audit event within one SQLite transaction. The original proforma PDF, invoice number, booking inventory and historical payments remain identical. Exact request-ID replays recover the original event; conflicting payloads fail.
4. The folio and booking dashboard show the **current adjusted receivable** separately from the **original contract total**. New combined settlement collects only the new outstanding balance, with the existing safe folio request IDs. Guest overpayments after a credit appear as a credit balance; any actual refund must be separately performed and recorded through the existing refund workflow.
5. Front-desk staff can read the updated folio but cannot approve an adjustment even using direct API requests; owner/manager role is checked both at authorization and in the business function.

## Scope and safeguards

- Changes to physical room assignments, arrival dates, checkout dates, guest identity or original nightly rates are **still locked after proforma issuance**. A separate fully versioned inventory amendment remains future work.
- The adjustment is not a reissued proforma, GST tax invoice, legal credit note, settlement or confirmed bank transfer. Do not treat it as a tax document; accountant compliance approval is still mandatory.
- Credits cannot make total commercial accommodation value negative. A completed/cancelled booking cannot receive a new adjustment.
- Use a signed paper/commercial agreement reference for meaningful changes; customer-facing legal treatment of changed supplies and GST must be reviewed by the accountant.
- The v11 schema is additive; do not backfill imaginary adjustments for existing records. Update the actual hotel Mac only with verified independent backup and unchanged environment configuration.

## Verification

Tests include separate charge + credit; contract/proforma immutability; exact-once replay; denied cashier/front-desk write; authenticated manager HTTP write and revised booking/folio balance; original and adjusted settlement; negative-total credit rejection; and v10-to-v11 on-disk upgrade.