# Live test and sync — hotel Windows computer

The GitHub `main` checks verify synthetic data on hosted Linux/Windows/Chromium machines. They do **not** sync the hotel computer or validate its actual devices. This workflow leaves live guest data untouched until the owner deliberately performs an upgrade.

## A. Safe sync of code (app must be stopped)

1. Finish the current reception/restaurant work. Stop FortLedger with Ctrl+C; never sync during a live booking/payment or when another instance is running.
2. Open PowerShell in the existing local FortLedger Git checkout. Run:
   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-update.ps1
   ```
3. This existing updater refuses dirty tracked files, unexpected Git origin, non-`main` checkout and an active local port 3000. It takes a consistent *pre-update* backup and a credential copy before Git fast-forward, then installs dependencies and runs tests.
4. **Never run `git reset --hard`, delete `data`, or use `npm start` to bypass the Windows persistent data environment.** If update fails, leave FortLedger stopped and preserve the backup and previous commit SHA printed by the updater. SQLite migrations may not be reversible.

## B. Live read-only smoke check (app must be running)

Open **PowerShell terminal 1** and start FortLedger from the existing checkout:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-start.ps1
```

Open **PowerShell terminal 2**, in the same checkout, and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-live-check.ps1
```

The new read-only check reports the installed Git revision, verifies the **existing** Windows SQLite database and admin credential file, runs `npm run doctor`, reads the local `/api/auth/status` endpoint and loads the HTML front page from `127.0.0.1:3000`. If any safety check fails it exits with an error. It never creates a booking, takes payment, edits the database, logs in or contacts a public endpoint. A configured backup passphrase may be necessary for the doctor to authenticate the backup; do not put that secret in Git or screenshots.

**Meaning of PASS:** basic locally running service, valid login gate, SQLite diagnostics. **Not proven:** staff login/password, correct physical room inventory, Epson paper, financial amounts, real backup restoration on a second Windows computer, accessibility or GST tax invoice legality.

## C. Human live acceptance (synthetic test entries only, until release approval)

- Log in on the real hotel computer and verify the seven actual room names, categories, booked/occupied/dirty distinction and staff permissions.
- Use a clearly named synthetic booking, test rates, test money entries and restaurant room-charge folio. Verify the booking was entered **only once**, including an uncertain-response retry scenario if safely reproducible.
- Check checkout and room cleaning status after payment reconciliation. Do not simulate a real received payment for a real guest.
- Follow `docs/EPSON_PHYSICAL_ACCEPTANCE.md` to print the standalone **NO SALE** test slip on Epson TM-T82. The TCP response cannot confirm physical paper.
- On a second Windows device, follow `docs/PHASE8_OPERATOR_HANDOVER.md` to rehearse actual independent encrypted-backup restoration and staff login.
- Have the hotel's tax professional approve `docs/COMPLIANCE_REVIEW.md` before enabling any statutory tax invoice.

## D. Sync/result report

Copy **only non-sensitive diagnostic results**: installed Git commit SHA; `doctor` passed/failed counts and check names (not data/paths/passphrases); whether `windows-live-check.ps1` passed; whether test paper actually printed; whether a replacement-computer restore and sign-in succeeded; and accountant sign-off status.

The authoritative release command `npm.cmd run release:check` intentionally reports **NOT RELEASED** and exits nonzero while physical and statutory gates remain unverified. Do not interpret successful GitHub CI or a live HTTP probe as production certification.
