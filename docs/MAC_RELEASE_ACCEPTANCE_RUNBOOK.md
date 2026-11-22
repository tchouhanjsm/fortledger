# Mac release acceptance and evidence register

**Current status: NOT RELEASED.** Automated tests cannot inspect Epson paper, independently verify a replacement Mac restoration, prove guest-Wi-Fi isolation, or approve statutory GST issuance.

## Safe Mac update before onsite acceptance

1. Stop the old app after finishing pending financial work. In the existing checkout, run `git status --short`, `npm run mac:preflight` and `npm run doctor` using the original data environment. Confirm the live database and auth file locations; stop if unexpected.
2. Confirm an independent encrypted backup, credentials copy and passphrase, and run `npm run recovery:encrypted-drill -- /absolute/path/to/actual-backup.flbk` using the privately configured passphrase. Never manually copy just an open WAL-mode database, remove WAL files or post secrets to GitHub.
3. With the old process stopped and backup verified, run `git pull --ff-only origin main`, `npm ci --no-audit --no-fund`, `npm test`; then start FortLedger using its original environment settings. Startup performs additive v10 migrations when necessary.
4. Run `npm run doctor`, `npm run mac:preflight`, and `npm run release:check`; check seven active rooms, current schema, booking/restaurant/folio request-ledger tables, backup status and a complete **synthetic** booking → bill → checkout journey.

## Private evidence register

Store human review records **outside the source repository**:

    mkdir -p "$HOME/FortLedger-Private-Release"
    npm run release:check -- --template > "$HOME/FortLedger-Private-Release/evidence.json"

For each of the six gates, enter `result: passed` only after actually observing the test, then specify `performed_on` as YYYY-MM-DD, `performed_by`, `reviewed_by` (a different reviewer), and `reference` to independently stored proof (at least eight characters). A failed check should use `result: failed`. Keep the full photos, certificates, guest records, printer details, backups, bank credentials and secrets outside this JSON and GitHub. The register contains **references only**.

Check progress with the same environment as the server:

    export FORTLEDGER_RELEASE_EVIDENCE_FILE="$HOME/FortLedger-Private-Release/evidence.json"
    npm run release:check -- --json

The report shows proof references and completion counts, but **remains NOT RELEASED**. This computer cannot authenticate operator signatures or verify the references; the owner must independently inspect signed originals and authorize the launch in writing. No auto-release CLI flag exists.

## Six required proofs, suggested order

1. Independent encrypted backup + separately stored recovery credentials: owner.
2. Full replacement Mac or supported device restore with real sign-in and history: owner + technician.
3. Staff-only HTTPS, private Wi-Fi isolation, denied guest Wi-Fi, device revocation: network technician.
4. Real Epson paper output, network loss and uncertain reprint: cashier + technician.
5. Supervised staff booking, room allocation, restaurant bill, proforma, safe retry, settlement, refund and checkout at normal and 200% zoom: reception manager.
6. Accountant's written GST/SAC/rate/numbering/place-of-supply/tax-document/credit-note signoff; statutory issuance remains disabled until professionally accepted.

Finally retain a dated owner **go/no-go** decision listing permitted features, disabled features, reviewers, backups, exceptions and rollback steps. A review entry alone does not certify physical evidence or statutory compliance. Do not switch to live accounting simply because CI is green.