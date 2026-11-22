# V3 Phase 6 — Owner-only release-readiness view (read-only)

## Goal

Nontechnical hotel operators should not need a Node terminal to understand what remains pending. FortLedger already has local `release:check`, six physical release gates, an off-repository evidence manifest and the owner Update Center. This increment **reuses those existing checks**; it does not add a second certification system.

## Workflow and safety contract

- **Trigger:** Only a signed-in owner on the local desktop explicitly clicks **My Profile → Review release readiness**. No background scan, scheduled task, server write or polling request.
- **Authorization:** Existing `system.update` permission plus owner role and loopback-only guard. Manager, front desk, cashier and private LAN phone sessions cannot read the endpoint.
- **Source of truth:** Existing `releaseReadiness()` and `diagnose()` functions and private external evidence file. No new database, file, clipboard or upload is created.
- **Output:** Six gate labels and redacted statuses, counts of local pass/warn/fail diagnostics, and diagnostic **names only**. The public shape excludes proof reference locations, filenames, passwords, real guest data, reviewer identity and private drive paths.
- **Failure:** Malformed results fail closed. `verdict` is hard-coded **NOT RELEASED** and `production_ready` remains false, even if six local evidence references exist.
- **No actions:** This page cannot create, approve, edit, attest, reject or erase physical checks; cannot issue a GST invoice; cannot install an EXE, change room readiness, export records or perform money operations. For evidence recording, continue to use private off-GitHub operator paperwork and independent review.
- **Concurrency:** One human-triggered GET, button disabled until completion. The source inspector may be expensive, so it never runs on a routine dashboard load.
- **Rollback:** Revert pure summary helper, owner-only GET, My Profile display and tests. No migrations or hotel data changes.

## Machine verification

Unit/integration tests exercise redaction, malformed verdicts, owner/non-owner API authorization, no database writes, and output structure. CI runs Ubuntu, Windows, Chromium and packaged Windows alpha installer checks. A successful CI does **not** prove the hotel PC, external restore device, staff Wi-Fi isolation, printer paper or accountant review. The six gates are documented in `docs/PHASE8_RELEASE_GATES.md`.

## Still not automatable from this environment

Operator and independent reviewer must test a replacement-device encrypted restore (including the original owner credential), check Epson physical paper and uncertain reprint behavior, verify the private staff-network TLS and guest-network denial, complete real staff/phone/accessibility UAT, and secure qualified accountant GST approval. FortLedger must continue to report **NOT RELEASED** until an independent release governance process is explicitly established.
