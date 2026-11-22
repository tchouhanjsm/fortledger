# Automatic encrypted hotel backups and complete owner recovery

FortLedger stores **one authoritative SQLite hotel ledger** on the Windows computer. Its database contains bookings, room allocations, payments, saved restaurant bills, staff accounts, operational notes and audit records. The **owner sign-in hash** is a separate file, `admin-auth.json`, in the same private application-data folder.

## When and where do backups run?

If the hotel owner has configured the separately protected backup drive and a secret using **FortLedger tray → Configure encrypted backups (owner)**, the running Node app makes a consistent encrypted SQLite snapshot:

- when FortLedger starts;
- every **24 hours while FortLedger stays running**;
- retaining the newest **30 database backups** (and their matching credential companions).

If the program is shut down, the scheduled backup **does not run**. Check **My Profile → Protected backups → Verify latest backup** periodically; a recent file timestamp alone is not proof of a restorable ledger. Rehearse recovery on a replacement device and keep a copy on an **independent encrypted disk or protected share**. The recovery passphrase must be stored **outside** the hotel PC; the Windows CurrentUser-DPAPI settings file does not transfer between accounts or machines.

## New paired encrypted backups

Starting with this version, when the original owner file exists, the app creates a pair of independently AES-256-GCM encrypted artifacts with the same timestamp and random suffix:

```text
fortledger-<timestamp>-<suffix>.flbk  # complete SQLite ledger, including staff accounts
fortledger-<timestamp>-<suffix>.flba  # original owner credential hash only
```

Both files use independent random salts and nonces, and are authenticated with the configured passphrase. The `.flba` file does **not** contain the owner password in plaintext. Neither artifact contains an unencrypted hotel record. The backup scheduler removes an expired matching pair together when retention applies.

**Protect both files together.** A legacy `.flbk` created by an older FortLedger version remains readable, but it does **not** include the original owner's separate credential. The new owner Backup Health check flags such a backup as incomplete for replacement-device account recovery. Do not rename a legacy `.flbk` or invent a companion; take a new verified backup after installing the newer application.

### How to recover

1. Stop the app and complete a protected pre-restore snapshot of whatever remains on the PC. Never overwrite an active SQLite or manually remove its WAL files.
2. Copy the matching `.flbk` and `.flba` from independent encrypted storage into a private recovery area. Have the owner supply the separately retained passphrase.
3. The `src/encrypted-recovery-drill.js` helper now tests **both** encrypted artifacts in disposable scratch storage without modifying the live hotel ledger. It reports whether the original owner hash is recoverable.
4. The separate owner credential companion can be decrypted by the reviewed `decryptEncryptedCredentialCompanion` recovery helper **only to a new, nonexisting destination**. Reconcile the existing data path and owner file before moving verified recovery artifacts into a stopped application's persistent data folder. Do not automatically restore over live hotel accounts.
5. On a **different Windows PC**, the original CurrentUser DPAPI configuration will not decrypt. Re-enter the separately stored backup passphrase, reconfigure the new backup drive and verify historic invoices/guest records before reopening for business.

**Safety boundaries:** The schedule and encrypted-auth pair are software mechanisms, not a guarantee of drive survival or physical off-device recovery. A separate-drive path still needs actual encryption and router/Windows permission checks. Bank card information and identity scans must not be stored in operational note fields. Automatic updates must not skip independent restore proof just because today's backup succeeded.
