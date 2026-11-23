# Restaurant correction cases — append-only internal review (A2)

**Implemented:** Save a manager/owner correction request with a stable request ID after reviewing the exact historic bill lines, quantities, inclusive prices and tax. Owner can record a single final internal disposition: **Needs accountant review** or **Dismissed (no adjustment)**. The original bill, printer record, room charge, folio, settlement, daily close, GST draft and all invoices remain unchanged. No payment refund, statutory credit note, financial reversal or bank verification is performed.

## Staff workflow

1. Manager/owner: **Restaurant management → Saved bills → Correction cases**. Select historic lines and correction quantities, write a clear reason (10–300 characters), and **Calculate impact**.
2. Review the original amount, proposed gross/tax and warnings. Choose **Record case for owner review**; this action creates a *review case only* with original snapshot and actor/time.
3. Open **View correction case history**. Managers can inspect the case and read the owner's status. The owner may select **Escalate for accountant review** or **Dismiss request**, with a reason. Neither state means the guest has been refunded.
4. If a network response to creating a case is missing, retry the unchanged intent. The UI retains its original `request_id` and checks durable lookup first. Never create a fresh case to recover an unknown response.

## API, access, migration

- `POST /api/restaurant/bills/:id/correction-preview` already estimates historic tax without writes.
- `POST /api/restaurant/bills/:id/correction-cases` creates a case with `{request_id, reason, lines:[{line_index,quantity}]}` (owner/manager).
- `GET /api/restaurant/bills/:id/correction-cases` returns history and owner disposition (owner/manager).
- `GET /api/restaurant/correction-cases/request/:requestId` finds an uncertain case outcome (owner/manager).
- `POST /api/restaurant/correction-cases/:caseId/review` stores one immutable owner decision with `{request_id, disposition:'needs_accountant'|'dismissed', note}` (owner only). A different request cannot replay an ID, and one case cannot be decided twice.

Two **new** additive SQLite support tables are created and structurally checked at startup. Both tables have idempotent SQLite UPDATE/DELETE refusal triggers, installed on fresh and existing v13 databases, so review evidence cannot be silently rewritten through accidental direct SQL. The application can still append new requests and one owner decision; this is not a substitute for protected encrypted off-device backups. No original bill, guest, accounting, printer or payment tables change, and `user_version` stays 13 to allow a source-only update rollback to read the previous schema. Every case creation and owner decision is auditable against the original bill in `operation_audit`. No external data submission, cloud dependency or installer/runtime change is needed.

## Unresolved accounting policy and legal gate

This is a **case-tracking milestone**, not a finished settlement-credit feature. The actual amount of any commercial credit, whether tax-inclusive or tax-exclusive, eligibility of partial refund, paid vs unsettled room charges and legal GST credit-note implications are **not automatically applied**. Keep [issue #139](https://github.com/tchouhanjsm/fortledger/issues/139) open. Do not close it until separate, accountant-authorised monetary correction entries reconcile with original bills, guest folios, daily collection history, GST documents and refund registers.

The owner may maintain supplier GST details locally in the FortLedger settings page; the portal does not verify GST registration or transmit returns. Regulatory/physical acceptance [#135](https://github.com/tchouhanjsm/fortledger/issues/135) and final tax-invoice issue [#147](https://github.com/tchouhanjsm/fortledger/issues/147) remain independent. No real guest, GSTIN or hotel private financial data belongs in GitHub.


## V8 source-linked triage inbox
The owner and manager can inspect the current globally pending saved-bill correction cases without opening individual receipts: **needs action**, **awaiting owner**, **escalated to accountant** and **all** filters. The SQL query reads existing immutable request/review rows, returns server-calculated counts and paginated case records, and never writes money or issues documents. Cashiers remain denied by RBAC. Open the original saved bill from each case for detailed review and the owner's existing immutable decision workflow. Refresh is manual/on-open, not a timer or automatic approval. Read-only status is *not* legal acceptance or a refund sent; historical receipts and folios stay unchanged.
