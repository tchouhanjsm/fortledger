# Heritage Sky — validation ledger (staged, not production certification)

## Scope and status
The redesign is split into PR #42 (offline design foundation), #43 (room overview/bookings), #44 (room operations), #45 (finance/POS), and the current quality-gate increment. These are intentionally stacked feature branches, not yet production releases.

## Verified in code
- Existing Node.js/Express/SQLite/PDFKit architecture stays intact, no frontend framework added.
- The UI displays only existing role-authorized views and existing API response data; primary server RBAC remains authoritative.
- Room board separates confirmed check-in, reserved nights, housekeeping readiness and maintenance outage.
- A checked-in guest stays visible even if their originally scheduled checkout date has passed. The visual board does not authorize check-in.
- Room actions retain staff confirmation when changing a room to Ready.
- Cash close labels the immutable server record and warns when it became stale.
- No final GST issuance enabled.

## Automated test scope
`test/heritage-sky-contract.test.js` checks source-level invariants for offline styles, visible navigation, filtered booking views and stale close messaging. It is **not** a substitute for browser interaction tests or accessibility inspection. Execute `npm test` and inspect both Windows and Linux jobs on GitHub Actions.

## Manual acceptance checklist — not yet executed
- [ ] Keyboard: all authorized sidebar links, booking filter and critical form controls visible and focusable
- [ ] Screen reader: menu links, room cards, closing alert and confirmation prompts
- [ ] Mobile: 360 and 390 px; tablet 768 and 1024 px; desktop 1280, 1440 and 1920 px
- [ ] Browser zoom at 200%, long guest names, large INR amounts and empty states
- [ ] Owner/manager/front-desk/cashier permissions, especially guest details and finance
- [ ] Arrival, delayed check-out, maintenance block, housekeeping dirty→ready confirmation
- [ ] Restaurant sale and guest folio settlement without duplicates
- [ ] External-drive backup restore and successful new login on physical Windows hardware
- [ ] Epson TM-T82 physical print, uncertain delivery, reprint handling
- [ ] Accountant-reviewed final GST invoice requirements and legal numbering
- [ ] Genuine before-and-after screenshots of the application

## Risk policy
No automated/signed final tax invoices, no bank-verified cash close, no unreviewed financial corrections, and no production-ready claim until external verification. Keep existing data and immutable records unchanged.
