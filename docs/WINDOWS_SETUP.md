# FortLedger on Windows — initial installation, startup, and safe updates

**Stage:** initial alpha setup with synthetic/test data only. Statutory final GST invoice and hardware certification are not complete. This guide is for Windows 10/11 with PowerShell 5.1 or later, one local computer, and **Node.js 22.x**.

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

The script verifies Node 22, creates `%LOCALAPPDATA%\FortLedger\data`, runs `npm install --no-audit --no-fund` and `npm test`, and prompts for a **local 12+ character admin password** only if one does not exist.

On this repo there is currently **no tracked package-lock.json**, so we deliberately use `npm install` rather than `npm ci`. The script avoids generating a machine-local lock file. A committed lockfile is a future release improvement.

## 4. Start and sign in

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-start.ps1
```

Keep this terminal open. On the **same computer only**, open **http://127.0.0.1:3000** in a browser, log in and verify the seven rooms. Press **Ctrl+C** in the PowerShell window to shut down the app.

**Important:** Always launch via `windows-start.ps1`, not bare `npm start`, because the launcher sets the persistent Windows data location. Bare `npm start` without the environment variable may instead create another empty database inside the app folder.

Persistent data stays at:
- `%LOCALAPPDATA%\FortLedger\data\fortledger.sqlite`
- `%LOCALAPPDATA%\FortLedger\data\admin-auth.json`
- SQLite may temporarily use `.sqlite-wal` and `.sqlite-shm` while the app is running. Never manually delete them.

This folder is **outside `C:\FortLedger\app`**, and cannot be replaced by `git pull` or `npm install`. Proformas, reservations, prices, receipts, refunds, menu, uploaded logo and settings reside in SQLite. Your local admin password hash lives in `admin-auth.json`, also outside the repo.

## 5. Update when we merge a new feature

1. Finish the current booking / sale and **stop FortLedger with Ctrl+C**.
2. In PowerShell, return to the existing checkout (`Set-Location C:\FortLedger\app` if using that path).
3. Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-update.ps1
```

This safely performs **in order**:
1. Confirms Node 22, correct origin repository, clean tracked Git files and the `main` branch.
2. Checks the default local app port is not listening. Stop any custom-port instance manually too.
3. Creates and **validates an SQLite-consistent backup before touching code**, in `%LOCALAPPDATA%\FortLedger\update-backups\update-<timestamp>\`. Also preserves an admin-auth copy.
4. Fetches and fast-forwards `main` (no forced reset / no deletion of guest records).
5. Runs `npm install` and the full test suite.
6. Only after success, reports the new code is ready to start.

Then restart with the same `windows-start.ps1` command and confirm a **synthetic** old booking, invoice and room charge still look correct. For readiness:

```powershell
$env:FORTLEDGER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'FortLedger\data'
npm.cmd run doctor
```

On startup the Node application adds compatible missing SQLite tables/columns as needed. **Do not assume every future migration is reversible**: every release needs tested migrations, a verified snapshot, and a rollback plan before it is deployed.

**If the update fails:** Do not delete the data directory, run `git reset --hard`, or reinstall from scratch. The verified pre-update snapshot remains in `update-backups`. Stop and inspect the error or ask for a fix before restarting. The failed script prints the previous commit SHA, which is useful for recovery.

## 6. Disaster recovery / separate-drive backups

The pre-update backup protects upgrades, but **not a complete hard-drive failure** because by default it resides under the same Windows profile. For actual operations, set a separate encrypted-backup directory (for example, an external `E:\FortLedgerBackups` drive) and a long, separately stored backup passphrase. FortLedger supports startup and every-24-hours encrypted snapshots **while the app is running**. Do not put that passphrase in Git or in a shared `.ps1` file. See the README's encrypted-backup section. Perform a test restore onto a second folder/computer before relying on backups.

### Important current limits
- No MSI installer, Windows background service, auto-start or auto-update has been built yet. The above installation is a reliable developer/alpha workflow with no recurring software subscriptions.
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
