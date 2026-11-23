# Historical PDF identification — operator transcription ledger (P2b)

**Scope:** FortLedger preserves imported originals from the old online PDF generator. Owners can now manually transcribe an invoice's **printed number**, **printed issue date**, optional **candidate booking ID**, and review note after opening the exact original PDF. Nothing is read automatically from the PDF, and the transcription has **not** been verified against its content by software or accountant.

## Staff workflow

1. As **owner**, open **Invoices → Historical invoice PDFs**. Search the archived PDF filename and select **Download saved original** to inspect the original with a trusted PDF reader.
2. Open **Record printed number and date** for that exact archive row, type the number **as printed** (for example, `invoice-123`), select the date written in the PDF and, if known, supply the existing FortLedger booking ID. Enter a meaningful note describing where you read it or why a previous entry was corrected.
3. Select **Save reported details**. A new, permanently auditable transcription is stored. The PDF bytes and the source hotel booking remain unchanged.
4. If an earlier entry was mistyped, open **Review / correct reported number and date** and save a new entry. Old versions remain visible. The latest entry is the current *operator claim*, not a replaced legal invoice.
5. A duplicate-number warning appears if another PDF's **latest** transcription has the same normalized number in the **same Indian financial year**, including across case/spacing variants. This is a possible collision, not proof that an invoice violates law. An unusually long reported number or characters needing Rule 46 review are shown, but never silently edited.
6. **Billing & Documents** owner search can now locate the archived PDF by the latest reported number as well as by filename. Manager/front desk/cashier still cannot search or download owner-only originals.

## Technical and accounting boundaries

- New additive `historical_pdf_identifications` table (SQLite v13 compatible), immutable update/delete triggers, actor/time, SHA-256 fingerprint, exact-once `request_id`, indexes for original/financial-year/number, optional checked booking candidate. The original archived-PDF table is never changed.
- `GET /api/external-invoice-originals/:id/identifications`: owner-only history and latest possible duplicate count.
- `POST /api/external-invoice-originals/:id/identifications`: owner-only transcription; replaying the same request is safe, mismatched retry IDs are rejected, and every new request is retained even if it repeats the same content.
- `GET /api/external-invoice-originals/identifications/request/:requestId`: owner-only durable outcome lookup after an uncertain response.
- Existing `GET /api/external-invoice-originals` now contains a lightweight per-original latest transcription summary; raw PDF bytes are not included.
- The separate read-only document register searches a reported serial **only for the owner**, never interpreting it as a verified statutory series.
- No final tax invoice, number reservation, IRN, GST calculation, payment/folio modification, refund, email, legal-number claim, accountant certification or automatic return filing is created. An owner-entered booking candidate is **not** a verified invoice-to-guest relationship.
- No external API, paid service, dependency or native Windows launcher change. The existing encrypted DB backup and code-only updater cover the additive metadata, subject to the current supervised backup-and-rollback gates. Actual replacement-device restore and physical staff UAT are still outstanding.

## Remaining legal gates

A complete, audited inventory of previously issued PDFs is needed; an annotation on one PDF **does not** establish completeness or uniqueness of the old legal series. Accountant approval must establish registered identity, fiscal-year serial policy, dates, 5%/18% legal classification (as applicable), and e-invoicing/IRN rules before issuing final tax documents. Legal issuance remains disabled under [#147](https://github.com/tchouhanjsm/fortledger/issues/147); physical acceptance remains open under [#135](https://github.com/tchouhanjsm/fortledger/issues/135). Never publish real guest/GST or PDF data to GitHub.
