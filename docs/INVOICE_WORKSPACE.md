# FortLedger invoice workspace — proforma and review-only GST draft

**From Invoices, no navigation to Bookings is required.**

1. Choose a non-cancelled reservation in **Choose an existing reservation** and click **+ Create proforma**. Review the recipient and editable accommodation lines in the same workspace, then save. Existing immutable proformas open directly as PDFs; a booking is not charged again.
2. If no booking exists, click **+ New guest & proforma** in Invoices. Complete the same regular reservation form; after saving, the proforma editor opens automatically. This preserves the seven-room availability checks, booking/payment idempotency and financial audit trail. **It does create a real booking record**, so avoid inventing room inventory to make an invoice.
3. Click **Tax draft** beside an existing proforma to prepare the **GST review draft** with recipient fields and SAC classifications. It is watermarked **NOT A LEGAL TAX INVOICE** and is not statutory issuance. Only a licensed accountant and hotel owner can authorize any future final tax-invoice workflow.
4. Download either PDF from the Invoices list. One or a few accommodation rows and the existing terms fit on **one A4 page** in the redesigned layouts. Exceptionally long custom line lists may require continuation pages rather than hiding or clipping money/terms.
5. Invoice snapshots and their numbering are immutable once created. There is no delete/reissue of payment, tax, or proforma history under the owner deletion controls.

## Mac developer workflow

Run FortLedger using the same existing data-directory environment variable and backup arrangement you already use on macOS. Before changing code, stop the app and verify a consistent SQLite snapshot and administrator credential backup. Update via fast-forward only on a clean `main` checkout, install dependencies and run `npm test`, then restart using your existing command. Do **not** run Windows PowerShell setup scripts or start with a different data directory.

## Limits

Standalone proformas without a reservation are not issued: this edition intentionally links every immutable proforma to a validated booking to preserve its folio/guest trail. Final statutory GST tax invoices remain gated until external compliance review. The 5% tax breakdown in proforma snapshots is illustrative, not a tax determination.
