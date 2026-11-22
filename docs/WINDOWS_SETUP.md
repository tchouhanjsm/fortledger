# FortLedger on Windows — initial installation, startup, and safe updates

**Stage:** initial alpha setup with synthetic/test data only. Statutory final GST invoice and hardware certification are not complete. This guide is for Windows 10/11 with PowerShell 5.1 or later, one local computer, and **Node.js 22.x**.

## Quick path: new Windows installation (no previous hotel records)

1. Install **Git for Windows** and **Node.js 22.x**, then open a fresh PowerShell window.
2. Run `git clone https://github.com/tchouhanjsm/fortledger.git C:\\FortLedger\\app` (or a folder you own), then open `C:\\FortLedger\\app` in File Explorer.
3. **Double-click `Install FortLedger.cmd`**. It checks the trusted Git origin, runs pinned dependencies and Node tests, and prompts you to create the local owner password. It also offers external encrypted backup setup; choose a folder on a separate protected drive, not the live `C:` drive.
4. **Double-click `Start FortLedger.cmd`**. Keep the server window open. Go to `http://127.0.0.1:3000` and sign in as `owner`. A truly new installation creates its initial seven-room ledger on first startup.
5. **Double-click `Diagnose FortLedger.cmd`** after first startup and review the warnings. A fresh encrypted snapshot is scheduled on startup if backup settings are valid. Independently test recovery before using real guest details.

Create Windows desktop shortcuts to `Start FortLedger.cmd`, `Update FortLedger.cmd`, `Diagnose FortLedger.cmd` and `Configure FortLedger Backups.cmd` for ongoing use. These files stay in your checked-out Git folder and are updated with application code.

**Already have guest bookings on your Mac?** Do **not** run fresh owner setup and start creating empty Windows records. First secure a **consistent SQLite snapshot plus the existing `admin-auth.json`** and use the separate reviewed transfer runbook; live `*-wal` or `*-shm` files must never be manually copied. The `.flbk` encrypted SQLite artifact alone does **not** contain your owner password file.

**Encryption and recovery:** The one-time backup wizard stores the external backup folder and a Windows **CurrentUser DPAPI-encrypted passphrase** in `%LOCALAPPDATA%\\FortLedger\\backup-settings.json`. Startup and update scripts unlock it only for the same Windows account. The backup files remain separately AES-GCM encrypted. The backup passphrase must also be recorded **outside this PC**; DPAPI settings are not transferable to a replacement Windows machine. Do not regard same-user DPAPI as protection from malware already running as that user.

## 1. Install software, once
- Install **Git for Windows** from https://git-scm.com/install/windows .
- Install **Node.js 22.x LTS Windows x64 MSI** from https://nodejs.org/en/download/archive/v22 . Choose the appropriate architecture for your computer. Keep **Add to PATH** enabled. Other Node major versions are not yet validated with the repo's current `better-sqlite3` dependency.
- Open a **new PowerShell terminal** after installing both, then verify:

```powershell
git --version
node --version
npm.cmd --version
```

Node must display `v22.*`. On Windows, use `npm.cmd` if PowerShell blocks the `npm.ps1` wrapper.

## 2. Clone the code, once

Choose a permanent app-code folder. Example:

```powershell
New-Item -ItemType Directory -Force C:\FortLedger | Out-Null
Set-Location C:\FortLedger
git clone https://github.com/tchouhanjsm/fortledger.git app
Set-Location .\app
```

If Windows denies permission under `C:\`, use a folder you own, e.g. `$HOME\FortLedger\app` (the scripts work from either location). Avoid OneDrive-syncing the **live SQLite database** or putting it inside the tracked Git repo.

## 3. First install / administrator password

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-setup.ps1
```

The script checks the official Git remote and `main` branch, verifies Node 22 and that no server is running, creates `%LOCALAPPDATA%\\FortLedger\\data`, runs reproducible `npm ci --no-audit --no-fund` and `npm test`, and prompts for a **local 12+ character admin password** only if a new installation has no existing credentials. It refuses to replace a lost existing owner password. It offers to configure a separately protected encrypted backup drive.

A committed `package-lock.json` is now present. The setup and update scripts use `npm ci` to install the tested dependency versions. If an older checkout has an untracked local lockfile, preserve it outside the repository before a reviewed first update; the updater now refuses such conflicts.

## 4. Start and sign in

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-start.ps1
```

Keep this terminal open. On the **same computer only**, open **http://127.0.0.1:3000** in a browser, log in and verify the seven rooms. Press **Ctrl+C** in the PowerShell window to shut down the app. A double-click `Start FortLedger.cmd` shortcut opens this same supervised server. The first startup unlocks your saved Windows-user DPAPI backup settings (when configured), allowing the protected backup scheduler and verified updater to work without entering the passphrase at every launch.

**Important:** Always launch via `windows-start.ps1`, not bare `npm start`, because the launcher sets the persistent Windows data location. Bare `npm start` without the environment variable may instead create another empty database inside the app folder.

Persistent data stays at:
- `%LOCALAPPDATA%\FortLedger\data\fortledger.sqlite`
- `%LOCALAPPDATA%\FortLedger\data\admin-auth.json`
- SQLite may temporarily use `.sqlite-wal` and `.sqlite-shm` while the app is running. Never manually delete them.

This folder is **outside `C:\FortLedger\app`**, and cannot be replaced by `git pull` or `npm install`. Proformas, reservations, prices, receipts, refunds, menu, uploaded logo and settings reside in SQLite. Your local admin password hash lives in `admin-auth.json`, also outside the repo.

## 5. Update when we merge a new feature

**Owner Update Center:** Sign in as owner and open **My Profile → Application updates → Check for updates**. The check reports the local and GitHub revisions. When the installed Windows app is running under the dedicated supervisor, the encrypted backup is recent on a separate protected drive, and the exact main commit has passed Ubuntu/Windows/Chromium CI, an **Install verified update & restart** action appears. Owner confirmation rejects new financial writes, allows existing requests to finish, then the separate supervisor verifies the backup, installs the exact tested commit, runs Node tests and restarts the server. Without the supervisor or protected backup it is a read-only check. Cashier, front desk and manager cannot access it.

**Windows one-double-click upgrade (after stopping the app):** Open the trusted installed FortLedger folder in Windows Explorer, then double-click **`Update FortLedger.cmd`**. Create a desktop shortcut to that file once if you prefer. It requires a recent encrypted off-device backup and a successful restore drill, then runs the normal safe updater and opens a new server window. The app must be stopped first; running transactions are **never** forcibly interrupted. It cannot bypass protected backups, a dirty Git checkout, invalid Git origin, or a database mismatch. Details: [Update Center safety contract](UPDATE_CENTER.md).

**Manual fallback:**

1. Finish the current booking / sale and **stop FortLedger with Ctrl+C**.
2. In PowerShell, return to the existing checkout (`Set-Location C:\FortLedger\app` if using that path).
3. Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-update.ps1
```

This safely performs **in order**:
1. Confirms Node 22, correct origin repository, clean tracked **and untracked** Git files and the `main` branch.
2. Checks the default local app port is not listening. Stop any custom-port instance manually too.
3. Creates and **validates an SQLite-consistent backup before touching code**, in `%LOCALAPPDATA%\FortLedger\update-backups\update-<timestamp>\`. Also preserves an admin-auth copy.
4. Fetches and fast-forwards `main` (no forced reset / no deletion of guest records).
5. Runs reproducible `npm ci` and the full test suite.
6. Only after success, reports the new code is ready to start.

Then restart with the same `windows-start.ps1` command and confirm a **synthetic** old booking, invoice and room charge still look correct. For readiness:

```powershell
$env:FORTLEDGER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'FortLedger\data'
npm.cmd run doctor
```

On startup the Node application adds compatible missing SQLite tables/columns as needed. **Do not assume every future migration is reversible**: every release needs tested migrations, a verified snapshot, and a rollback plan before it is deployed.

**If the update fails:** Do not delete the data directory, run `git reset --hard`, or reinstall from scratch. The verified pre-update snapshot remains in `update-backups`. Stop and inspect the error or ask for a fix before restarting. The failed script prints the previous commit SHA, which is useful for recovery.

## 6. Disaster recovery / separate-drive backups

The pre-update backup protects upgrades, but **not a complete hard-drive failure** because by default it resides under the same Windows profile. For actual operations, use **`Configure FortLedger Backups.cmd`** and select a folder on a separately protected drive or share (for example, `E:\\FortLedgerBackups`). This stores the secret via Windows CurrentUser DPAPI outside Git and restores it at the next normal launch; keep a separate, independent record of the 16+ character backup passphrase for disaster recovery. FortLedger supports startup and every-24-hours encrypted snapshots **while the app is running**. Do not put that passphrase in Git or in a shared `.ps1` file. See the README's encrypted-backup section. Perform a test restore onto a second folder/computer before relying on backups.

### Important current limits
- No MSI installer, Windows background service, **silent update**, signed release-tag verification or production rollout has been built yet. The supervised launcher is an alpha process manager with an owner-confirmed browser handoff; a manual desktop shortcut is the fallback. Real Windows end-to-end update and replacement-device restore must be physically tested before relying on it. No subscription is required.
- **Updates are deliberate, not silent.** FortLedger keeps working offline; install only tested/merged commits when internet is available.
- No legal final GST invoices, physical Epson TM-T82 acceptance or complete production security verification yet.
- The GitHub repository is **public**. Keep real guest, financial and password data out of commits and only run non-production/sample data until the release gate is cleared.

## Troubleshooting

- `git` or `node` not recognized: close PowerShell, reopen it, verify PATH, and reinstall official tools if needed.
- `npm.ps1 cannot be loaded`: use `npm.cmd` (provided in this guide), not a permanent weakening of PowerShell execution policy.
- `better-sqlite3` / `node-gyp` install failed: confirm Node **22.x** and Windows x64. If no compatible binary exists, see the package's Windows troubleshooting instructions and install the necessary Visual Studio C++ build tools / Python only if required: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/troubleshooting.md .
- `EADDRINUSE:3000`: the app is probably already running; close the other FortLedger terminal.
- **Legacy data detected:** if the script reports an older `data\\fortledger.sqlite` inside the Git checkout, **stop**. The script refuses to initialize a new empty external database. Preserve the entire old `data\\` directory and contact the developer for a SQLite-consistent migration to `%LOCALAPPDATA%\\FortLedger\\data` (including `admin-auth.json`). Do not drag-copy the live database while FortLedger is open.
- Looks like the hotel data disappeared: **do not enter new data**. Verify `$env:FORTLEDGER_DATA_DIR`, confirm `%LOCALAPPDATA%\FortLedger\data\fortledger.sqlite` exists, and always start with the launcher script.
- Password hash was lost: do not overwrite SQLite or repeatedly run `setup-auth` to guess a fix. Restore `admin-auth.json` from a secure backup or follow a reviewed recovery procedure.

### Isolated recovery rehearsal (before live operations)
After the Mac and Windows development installation starts successfully, run the following **with the same environment settings as FortLedger**:
```powershell
$env:FORTLEDGER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'FortLedger\data'
npm.cmd run recovery:drill
```
The command works with an online database by creating a consistent snapshot and restores only to a private temporary path. It compares all table rows and an admin-credential copy without changing the live source. It does **not** substitute for physically restoring an off-device encrypted backup and signing in on the destination Windows machine.

## Phase 8 — operator acceptance before real guest use

For the **real encrypted backup artifact** and physical-device acceptance sequence, use [Phase 8 operator handover](PHASE8_OPERATOR_HANDOVER.md). A read-only-on-live-database Windows rehearsal helper is available:

```powershell
$env:FORTLEDGER_BACKUP_PASSPHRASE = Read-Host 'Backup passphrase'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-recovery-rehearsal.ps1 -BackupFile 'E:\FortLedgerBackups\fortledger-example.flbk'
Remove-Item Env:\FORTLEDGER_BACKUP_PASSPHRASE
```

Use the path to your **actual** separately protected backup. This only restores to disposable private scratch storage. It does **not** certify a physical replacement Windows device, an independent disk, Epson paper output or statutory GST invoice compliance. The actual rollout stays **NO-GO** until those human sign-offs are completed.
