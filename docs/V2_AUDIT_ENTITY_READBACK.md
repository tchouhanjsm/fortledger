# Audit readback invariant (FL-009)

FortLedger records immutable operation events to the local `operation_audit` table. Every supported entity type accepted by `recordAudit()` must also be readable through `auditEvents()` and the existing authorized `GET /api/audit/:entity/:id` endpoint.

Before this fix, daily cash-close events could be written but a manager could not retrieve their audit history because the audit writer and reader maintained different hardcoded entity lists. Both operations now share `AUDIT_ENTITY_TYPES`, including `daily_close`.

This change does not modify old events, cash totals, permissions, or daily-close corrections. The existing owner/manager audit-read permission remains authoritative, and the immutable close remains marked stale when later transactions affect its day. A separate reviewed correction process remains pending. Tests explicitly cover every event type and read back a daily-close event over HTTP.
