# V2 daily closing: reviewed after-close changes (FL-013)

Daily closes are **immutable financial snapshots**. When a payment/refund/restaurant settlement or expense is recorded against an already closed business date, FortLedger compares the live transaction totals to the original closing hash and marks that closing `stale`. That is intentional: history must not be silently rewritten.

This batch adds an **append-only** owner/manager review action to the existing `operation_audit` ledger, with reviewer identity, human reason and disposition (`acknowledged` or `investigate`). The event contains the fingerprint of the *currently observed ledger*. A further change makes the old review inapplicable; unresolved and investigating close dates appear as Today alerts and can be opened in the existing Financial Close panel. Acknowledged discrepancies remain marked `stale` against the original snapshot and retain the original signed/count values.

Real bank/cash verification remains manual; an acknowledged change is **not** proof that bank balances match. If necessary, post an explicit documented correction in the existing ledger rather than changing the original close record. Access: owner/manager; cashier/front desk are denied. No new database table or monetary mutation is introduced by the review itself.
