# Billing & Documents — read-only, source-aware register (Phase 4 foundation)

This phase makes existing FortLedger documents easier to find **without** issuing an invoice, merging financial ledgers, declaring an email sent or mislabeling review drafts as GST tax invoices.

## Operator workflow

Open **Invoices → Billing & Documents**. Search by saved number, guest, company or imported PDF filename, choose a document type, optionally filter by the **recorded/imported IST date**, and open the appropriate source action. A user sees only sources their account is allowed to read.

| Source | Document status | Retrieval/action | Access |
| --- | --- | --- | --- |
| Saved proforma | Saved proforma; NOT GST final tax invoice | Download PDF rendered from immutable saved proforma snapshot | Owner, manager, front desk |
| Checkout document case | Held for accountant review; NOT issued | Open current guest folio; case keeps original checkout snapshot | Owner, manager, front desk |
| Saved restaurant receipt | Receipt only; NOT tax invoice | Open the restaurant's receipt view (HTML) | Owner, manager |
| Imported historical external PDF | Byte-exact archived original; original legal details UNVERIFIED | Download the original PDF bytes from SHA-256-checked SQLite archive | Owner only |

**No cashier access** to the register. Restaurant staff retain their dedicated POS and saved-bill history; the front desk sees authorized guest folio only, not the restaurant management register or private external PDF metadata. No GSTIN searches on unverified originals, and no file content scanning.

## Technical contract

`GET /api/documents/register?q=...&kind=...&from=YYYY-MM-DD&to=YYYY-MM-DD&offset=...`

- Server builds a source-specific, permission-filtered UNION from existing SQLite tables and performs bounded `LIMIT 30` pagination and a count query. It never fetches PDF BLOBs, parses original document contents or totals cross-source amounts.
- Date range filters operate on the **local hotel IST recorded/imported timestamp**, not the legally applicable date of supply or presumed invoice issue date.
- `GET` only, `invoices.read` authorization and owner-only inclusion of the historical-original source. The source-document route separately enforces its own role checks.
- All items explicitly report `legally_issued_by_fortledger:false`, `bank_verified:false`, `delivery_confirmed:false`. Legal issuance has no writable endpoint.
- Existing proforma list, tax review and source-specific case/archive tools remain functional; their details stay available without duplicating statutory document state.
- No schema migration, package dependency, cloud access or change to saved financial records. Safe source-only Windows patch if the deployment satisfies V7 backup/CI supervisor gates.

## Follow-up

Prioritize actual staff search-speed measurements, recent/error states, verified archive restoration and accountant CSV exports after physical testing. Statutory final issuance is blocked by [#147](https://github.com/tchouhanjsm/fortledger/issues/147) until registered identity, historical numbering, dates/rates/IRN and signoff are established; physical acceptance [#135](https://github.com/tchouhanjsm/fortledger/issues/135) remains open. No automatic GST-portal or email integration.

## V8 search refinement
The existing register adds optional server-side filters: exact booking ID, guest, company, number/title and nonstatutory review state. The existing broad search, type and recorded/imported IST date filters remain. New filters are grouped behind **More filters**, with a one-click clear action. Historical owner-reported identifiers are not treated as verified statutory serials or automatically associated with booking IDs. Owners alone see protected historical sources even if other roles forge type/status filters. No financial sum or invoice issue path is added.
