# V4 engineering audit — adaptive navigation and staff sign-in

Reviewed **main**: `3f84f4436c9db6c9f9e260228b51f65b9b27f230`, 23 November 2026. Reviewed as sequential engineering perspectives (product, frontend, backend/data, security, QA/operations); **not** a real staff interview, penetration test or hotel device trial.

## Ground truth: implemented, not to build again

- Seven physical rooms, assigned and category holds, accommodation folios, proformas, tax **review drafts only**.
- Staff roles, password sign-in, revocable sessions, owner/manager/front-desk/cashier permissions: `src/auth.js`, `src/staff.js`, `src/access.js`.
- Restaurant draft review/edit **before save**, immutable saved bills, matched/unmatched room charges, manual settlement, printer retry workflow; CSV menu import and manager availability controls.
- Restaurant event reconciliation/export: `src/restaurant-reconciliation.js` and `public/app.js` `restaurant-reconciliation`; do **not** propose another copy.
- Shift handover, room readiness alerts, reconciliation preparation, synthetic performance baseline, 40-card incremental booking rendering, and owner release evidence view (#129–#136).
- Mac/Windows local operation, signed/hashed existing passwords, encrypted backups, Windows installer and protected update/download; **these still require physical acceptance**.

## Multi-perspective findings

| Priority | Classification | Source evidence | Operator impact | Proposed action |
| --- | --- | --- | --- | --- |
| Release blocker | Verified unfinished acceptance | `README.md`, `docs/PHASE8_RELEASE_GATES.md`, Issue #135 | Cannot safely certify real money/printing/legal issuance | Physically verify replacement-device credential+ledger restore, Epson paper/reprint, staff LAN, staff UAT, separate-drive secrets, accountant review |
| P1 security design gap | Feature absent | `public/login.html` sends only username/password; `src/auth.js` has password-only login | Password re-entry at shared reception PC is cumbersome | Opt-in **trusted-device quick unlock** with six digits, not network-accessible weak primary password |
| P1 security risk for any future PIN | Source-supported weakness, not exploited bug | `src/auth.js` uses in-memory `failures` map keyed by IP+username; `scryptSync` on failed existing-account attempts | Server restarts reset rate counters; IP changes circumvent per-IP limits; synchronous KDF consumes event loop | Before PIN, add persistent per-account/device throttling, lockout and async KDF; generic errors, strict user-agent/cookie origin rules |
| P1 UI maintainability | Verified cascade conflict / design debt | `public/styles.css` declares 900/650px sidebar, `public/heritage-sky.css` overrides with 1100/700px and a second mobile navigation | Tablet widths and phone headers rely on rule order; height not considered | One authoritative responsive block using viewport height, 701px mobile boundary, labelled links and keyboard Escape behavior |
| P1 workflow gap | Not found in current restaurant endpoints | Saved bill endpoints support receipt, print/print-status, room matching and settlement; no audited saved-bill reversal/credit workflow in `src/restaurant.js` | An incorrectly saved receipt has no first-class safe correction | Design append-only correction/credit with tax, payment and owner/manager review; **never overwrite an issued snapshot** |
| P2 workflow gap | Absent from `src/server.js` menu PATCH endpoints | Menu API supports availability and CSV import/preview, not single-item price or tax edit | Price adjustments require importing CSV | Audited manager-only item editor: current version, explicit GST/rate review, 409 drift conflict |
| P2 UX improvement | Existing dashboard / `public/app.js` | Owner sees operational tasks plus accounting controls; `public/app.js` remains ~149 KB | More dense navigation/discovery for nontechnical staff | Role-specific progressive disclosures, no new pages unless workflows justify them, refactor frontend modules once measured |
| P2 diagnostic/documentation debt | README still describes Mac primary while user moved to Windows; docs written before later V3 changes | Confusion over primary runtime and migration | Clarify authoritative Windows data directory, install type, release channel, backup verification, Mac only if active |
| P2 performance hypothesis | `src/auth.js` uses `scryptSync`; `public/app.js` large | Concurrent failed logins can delay local server; browser navigation may get costly | Load-test synthetic authentication without actual credentials, instrument p95 navigation and event-loop lag before optimizing |

No current-main GitHub CI failure observed: both Checks and Windows Installer runs for `3f84f44` completed successfully. That **does not** mean actual printer, backups, bank settlement, GST or hotel device behavior is working. Do not assert a defect without reproducing it. Already fixed transient post-merge Chromium placeholder race (#136).

## Sidebar design decision: three sizes, one information architecture

1. **>= 1101px desktop:** 216–272px dynamic width via `clamp()`; warm navy rail, 20px icon + permanent text, 44–54px hit area, 10–14px radius, flex automatic height distribution; own scroll if short display.
2. **701–1100px tablet / laptop:** labelled 206–224px compact sidebar at narrow widths; never hide labels behind icon-only clues; content takes remaining flexible width.
3. **<=700px phone:** tiny identity bar + existing bottom Today / Bookings / Rooms / Restaurant / More. The More sheet is scrollable on short devices, Escape closes and returns focus. No duplicate horizontal top menu.
4. **All widths:** brand first, frequent operations together; Settings/Profile last; only authorized links rendered; `aria-current` active, visible keyboard focus, touch targets >=44px, safe-area insets and reduced-motion preferences.

This focused PR changes only presentation, menu order and keyboard handling; role routes/finance/server/auth unchanged. Validate 320, 360, 390, 768, 1024, 1280, 1440, 1920 CSS widths using actual Chromium DOM geometry and real navigation. Real 200% zoom and assistive technology still need staff testing.

## Six-digit quick PIN: secure engineering design (NOT implemented by sidebar PR)

**A PIN on its own is only 1,000,000 possibilities / ~20 bits. Never simply lower the existing 12-character password minimum or accept `POST /api/auth/login {password:"123456"}`.** NIST's distinction between a PIN used as a **device-local authenticator activation** and a weak remote password is important; device binding and server-side throttling are non-negotiable. See NIST SP 800-63B-4 and OWASP Authentication Cheat Sheet.

### Proposed UX

```
Staff opens FortLedger on approved Windows computer
→ Choose "Staff quick sign-in" (default first is password)
→ Username + six-digit PIN, numeric keypad with individual input focus
→ Verified *registered device secret* + PIN + staff active/role checks
→ Original authorized workspace; no separate duplicate staff profile
→ After several errors, require full password / owner reset
```

The **owner always uses a strong password**. As a first conservative release, offer quick unlock to front-desk and cashier roles only on a *registered local Windows workstation*. Manager gets password and maybe OS-based WebAuthn/passkey later; managers can approve payments/refunds and should not have standalone low-entropy login on unknown devices. A staff LAN phone needs a separate tested TLS/device-enrollment design.

### Minimum security contract before turning on

- **Enrollment:** Only a staff member with a currently authenticated **password session** may register that browser/device, re-enter their full current password, create a PIN twice and acknowledge that others sharing the physical station must not know the PIN. Require owner policy switch for the deployment; never auto-enroll an existing staff user.
- **Second factor / device binding:** Generate a cryptographically random per-device high-entropy secret, store only its hashed verifier in SQLite and its actual value in a scoped HttpOnly, SameSite=Strict, Secure-on-HTTPS browser cookie. Avoid localStorage for PIN/device secret. Cookie + PIN are jointly required; unknown device falls back to password. Browser cookie is **not** hardware-bound; for stronger assurance prefer WebAuthn/Windows Hello when origin/RP is compatible.
- **PIN storage:** Six-digit regex `^[0-9]{6}$` (leading zero allowed); store a salted, slow KDF record protected by a key outside SQLite (e.g. a separately protected local credential file). Never store the plaintext PIN, reuse the normal password field, or commit the pepper/key. A stolen SQLite-only database must not enable trivial offline brute force. Plan paired backup of recovery material, password rotation, restoration and key invalidation.
- **Online guessing:** Persistent per-account attempts across IP addresses and server restarts. At most five failures before disable/long cooldown; exponential delays and staff/owner recovery. Rate limit PIN and password modes; do not reveal which username, device, or method is registered.
- **Session:** Independent random session token, short PIN-authenticated idle/absolute lifetime, normal RBAC recheck, logout and staff-disable revocation; require strong-password reauthentication for sensitive profile, backup, update, security and staff administration. Account/password reset and device revocation clear PIN credentials/sessions.
- **Transport:** Localhost trusted workstation first. TLS-verified segregated LAN only after threat review; never public port forwarding. Avoid shoulder-surfing by not revealing digits and by restricting browser autofill.
- **Audit and recovery:** Audit enroll, disable, reset, wrong-attempt lockout, device revoke and login method **without secrets**. Protected backup migration and restore, old install downgrade incompatibility, degraded internet and deterministic retry tests are mandatory.

### Phased tests / deployment

1. Security RFC and threat model, decide whether WebAuthn/Windows Hello is feasible before introducing custom server PIN auth.
2. Isolated credentials/throttle with explicit versioned migration, source-backed encrypted backup + owner credentials recovery, randomized device challenges and constant-time verification.
3. Full password enrollment plus PIN login UX, accessibility on desktop, small laptop and phone; clear fallback and logout. Explicit owner enable/disable default OFF.
4. Abuse tests: 1000 wrong attempts from rotating IPs, app restart, parallel requests, DB copied without pepper, stolen cookie, wrong-device sign-in, disabled cashier, role changes, password reset, full restore, CSRF/origin and 200% zoom. Only then limited physical rollout.

**Important:** quick PIN should shorten *staff sign-in*, never authorize unsigned updates, payment reversal, owner functions or final GST issuance. Default production alpha remains NOT RELEASED.
