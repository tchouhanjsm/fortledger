# Existing Mac hotel → Windows handover (verified, no replacement ledger)

**ACTIVE ALPHA / NOT RELEASED.** This is a deliberate operator handover, not automatic replication. Never use the Mac and Windows copies to accept new bookings, payments or restaurant bills at the same time. A single live ledger must remain authoritative.

## What is being moved?

The current SQLite hotel ledger contains the seven rooms, bookings, saved proformas, restaurant bills, menu, payments, note fields and audit/finance records. The separate **`admin-auth.json`** contains the original owner password hash, required to sign in after copying. **An encrypted `.flbk` file by itself does not include that authentication file.**

The importer accepts only a **consistent FortLedger pre-update snapshot folder** with:

```text
verified-snapshot-folder/
    fortledger.sqlite
    admin-auth.json
    RECOVERY.txt
```

The snapshot must be transferred privately on a suitably encrypted external drive. The folder contains **plaintext** hotel records and password hashes while mounted; never email it, upload it publicly, or commit it into GitHub. Keep your old Mac and independently protected backups intact throughout the operation.

## On the original Mac

1. Finish/stop new hotel transactions. Confirm the correct existing FortLedger `data` path; the earlier Mac preflight printed it. Do not delete, drag-copy or rename a live SQLite `-wal` or `-shm` file.
2. Attach an encrypted external drive, unlock it, create a private destination folder outside the running application data directory, and run **the already available** snapshot helper from the Mac project folder:

   ```bash
   cd /Users/home/Documents/Projects/fortledger
   node src/backup-before-update.js "/Volumes/YOUR-ENCRYPTED-DRIVE/FortLedger-Transfer"
   ```

   Replace `YOUR-ENCRYPTED-DRIVE` with the real mounted drive; do not blindly use this literal example. If the Mac uses `FORTLEDGER_DATA_DIR`, run the command using exactly the same environment configuration as the app.
3. Confirm it prints **VERIFIED BACKUP**, seven rooms, and the expected approximate booking count; inspect the new `update-...` directory for all three files. Keep this folder on the encrypted drive. Its `RECOVERY.txt` marker is a format sanity check, not a digital signature.
4. After validation, fully stop the Mac app and leave its database and original owner password file untouched as the recovery source.

**Important for older Mac checkouts (including PR #83):** the revised snapshot helper finalizes a standalone SQLite backup so no `-wal` or `-shm` companions are needed. A snapshot made with older code may be refused. First finish the Mac's separately verified encrypted-backup and safe code-update procedure; then **create a new snapshot** using the current helper. Never delete WAL/shm sidecars from an older backup to force it through the importer.

## On the new Windows machine — BEFORE first setup

1. Install Git for Windows and Node.js **22.x**, then create and clone the official repo as described in [Windows setup](WINDOWS_SETUP.md). Do **not** run `Install FortLedger.cmd` or `Start FortLedger.cmd` yet.
2. Connect and unlock the encrypted transfer drive. Open the cloned FortLedger folder in File Explorer. Double-click **`Import Existing FortLedger Data.cmd`**.
3. Enter the absolute Windows path to the snapshot **directory** (for example `E:\FortLedger-Transfer\update-2026-11-22-...`), not to `.flbk`, `.sqlite` or the Mac `data` folder. The tool checks official Git origin, Node 22, stopped port 3000, and refuses if `%LOCALAPPDATA%\FortLedger\data` already exists.
4. The script installs pinned dependencies, runs all regression tests, verifies SQLite integrity, foreign keys and seven-room inventory, verifies the original admin credential file, and prints only counts (no guest names). Read the preview.
5. Type **`IMPORT`** only if this is the correct existing hotel snapshot. It copies both files into a temporary folder and checks their checksums and integrity before **one atomic directory rename**. If any destination file already exists, the import is refused; nothing is overwritten.
6. Double-click **`Install FortLedger.cmd`**. It should preserve the imported `admin-auth.json` and must **not** ask you to replace the old owner's password. Configure the new PC's protected backup drive.
7. Double-click **`Start FortLedger.cmd`** and sign in using the **original Mac owner password**. Verify historic booking counts, invoice numbers, restaurant room charges, payment records and new/old schema compatibility. Double-click **`Diagnose FortLedger.cmd`**, then perform a separate external-backup restore drill.

## What to do when blocked

- **Data destination exists:** stop and inspect it; do not delete a database/password file to bypass the refusal. Even an empty folder is deliberately not overwritten automatically.
- **Original owner file missing:** do not create a new hash for the transferred database. Recover `admin-auth.json` from the original Mac's secure offline snapshot.
- **WAL/shm found:** the transfer contains live database working files. Stop and produce a consistent SQLite snapshot using the helper.
- **Old Mac cannot open after moving?** The import does not touch or migrate its data; protect it as an offline safety copy and do not run both as a dual-write system.
- **Encrypted `.flbk` only:** the importer does not decrypt it and cannot restore credentials from it. Obtain a verified independent owner-auth copy. The separate encrypted-recovery drill can validate `.flbk` artifacts without overwriting the live ledger.
- **Import succeeded but an HTTP or Windows first-run check failed:** do not start creating new bookings or run `setup-auth`. Preserve both datasets and inspect diagnostics.

This feature protects software file transfer and avoids accidental replacement. It does **not** establish lawful tax invoice compliance, printer paper acceptance, secure staff-network operations, or independently certified replacement-device disaster recovery.
