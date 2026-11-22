# FortLedger Windows desktop installer — owner and staff guide

**Status: unsigned alpha / physical Windows acceptance pending.** This is a separate distribution channel from the developer Git checkout. The installer does **not** require Git, Node.js, npm, PowerShell commands or a development terminal on the receptionist's computer.

## Staff workflow

1. The **owner** downloads the trusted `FortLedger-Setup-*.exe` from the repository's successful **Windows Installer (unsigned alpha)** GitHub Actions run. The .exe is a build artifact, not a file to generate on the reception PC. Verify the source and SHA-256 reported in the Actions build log. GitHub Actions artifact downloads may require a GitHub login; the owner can transfer the same verified .exe to the hotel's PC via a trusted channel.
2. Finish hotel operations and close any running FortLedger. Double-click the installer. It installs only app files into this Windows user's `%LOCALAPPDATA%\Programs\FortLedger`, without admin privileges.
3. An icon named **FortLedger** appears in the Desktop and Start Menu. On a new *empty* hotel computer, double-click it. A one-time private owner password dialog is shown. Choose and confirm a 12–256 character owner password; the password is sent via local stdin, never a command-line parameter. An initial seven-room SQLite ledger is created only if BOTH the database and the original owner credential file are absent.
4. The same click opens the browser at **http://127.0.0.1:3000**, with FortLedger's normal login. The staff sign in with their own assigned role accounts. Staff do not see a Node/PowerShell console.
5. Closing the browser does not stop the local app. Use the **FortLedger icon in the Windows notification area/system tray** to open it again; double-clicking the desktop shortcut also reopens the browser. At the end of hotel operations, **FortLedger tray → Close FortLedger safely**, after finishing open bills/bookings. The launcher sends a shutdown request via private stdin and waits for active HTTP requests to finish. It does not force-kill financial transactions.

A menu action **Configure encrypted backups (owner)** opens the existing guarded external-drive setup for the owner. This is initial administrative setup, not an everyday staff task.

## Where hotel data lives

- **Code and bundled Node runtime:** `%LOCALAPPDATA%\Programs\FortLedger`. These are replaceable program files.
- **Hotel ledger and owner credential:** `%LOCALAPPDATA%\FortLedger\data\fortledger.sqlite` and `admin-auth.json`. These are **never packaged into the installer** and are **not deleted on uninstall**.
- **Protected backup configuration:** `%LOCALAPPDATA%\FortLedger\backup-settings.json` (Windows CurrentUser-DPAPI protected). Encrypted `.flbk` backups stay on a separate protected drive/share configured by the owner. The passphrase also needs a separate offline record for new-PC recovery.

For an **existing Mac hotel**, migrate the consistent SQLite snapshot **and** original `admin-auth.json` with the reviewed [handover procedure](WINDOWS_HANDOVER_IMPORT.md), **before launching the new Windows app**. Never start with a blank hotel ledger if real bookings already exist on the Mac. The current handover tool itself requires a technical owner once; that is different from the staff's ongoing one-icon workflow. Do not dual-write the Mac and Windows copies.

## Installing a newer version

The **installer-managed** build does not have a Git checkout. Its owner-only Update Center checks the official GitHub Windows Installer workflow for a **newer successful `main` push**, requires Linux/Windows/Chromium CI for the **same commit**, and verifies that a genuine unexpired installer artifact exists. When it finds one, the owner sees **Download verified Windows update**. This button opens the official GitHub artifact download, not an installer executable or a command runner. It never silently restarts active hotel operations. The developer's Git supervisor belongs to a separate Git-based installation and is **not** used by this package. Older installed builds without an embedded build number can still see a candidate, but must be reviewed as an unknown version.

For a desktop upgrade:

1. Finish all reservations, restaurant bills and payments, and close the tray application safely.
2. Ensure the **last 36-hour encrypted backup** exists on a separate drive and was successfully tested. Keep the original backup passphrase outside the PC.
3. Run the newer verified `FortLedger-Setup-*.exe`. Before replacing any executable, the installer refuses a listening application on port 3000, a half-present database/password, an absent separate-drive backup, or an encrypted-backup restore drill that fails.
4. After installation, open the FortLedger shortcut. The original database and owner password are reused. Verify seven rooms, prior bookings, invoice numbers, food bills and stored payments; if any mismatch occurs, stop making new financial records and investigate the backup.

**Uninstall does not remove guest records or backups**, by design. Do not assume reinstalling deletes hotel records; never intentionally delete the persistent data folder as a repair step.

## Build and trust limitations

The builder runs on GitHub's Windows runner, bundles exactly the installed Node 22 executable, production-only npm dependencies including native Windows SQLite, public assets and app source, and compiles a small .NET Framework 4 Windows Forms launcher. It runs packaged first-run, login and graceful-exit smoke tests before Inno Setup creates a per-user Windows x64 installer. The GitHub workflow retains the `.exe` artifact for 30 days.

**No code-signing certificate is configured.** Windows SmartScreen may flag the unsigned executable. Staff should not bypass unexpected security warnings or download installers from untrusted senders: the owner must verify the release source and SHA-256 and decide deployment. No actual Windows PC, printer, backup drive, staff Wi-Fi or accountant GST review is certified by GitHub CI. This remains **ACTIVE ALPHA — NOT RELEASED**.

## Backup health and update acceptance

Automatic encrypted backups use the separately protected directory selected in **Configure encrypted backups** from the Windows tray. With valid CurrentUser-DPAPI settings available to the installed Windows account, the app makes a snapshot at startup and every 24 hours while the app is running, keeping the latest 30 files; backups do **not** run when the program is closed. Keep the external drive connected. The standalone `.flbk` files contain the SQLite ledger and staff account hashes in SQLite, **not the separate owner `admin-auth.json`**; protect an independently encrypted copy of that file too, and keep the passphrase offline.

The owner can now open **My Profile → Protected backups → Verify latest backup**. This explicitly decrypts the newest `.flbk` into disposable private storage and checks the seven-room SQLite structure. The result never exposes a private path, passphrase or guest name. A successful local test is not an off-device restore, and the `independent_drive` result checks drive roots, not encryption/recoverability. Rehearse a full replacement-device restore before permitting a live hotel upgrade.

The **Download verified Windows update** action appears only when the official artifact and exact-main-commit checks succeed, and only for an authenticated owner on the local PC. After downloading, finish forms, safely stop the tray application, verify backups and run the new `.exe` with the existing installer guard. **A push alone is not a software release**; a fully tested build with a retained artifact is required. The EXE is still unsigned alpha; this is a safe notification+download workflow, **not an unattended one-click install**.

## Optional HTTPS access on hotel staff phones

Owner/IT can configure a private IPv4 listener using **FortLedger tray → Private hotel Wi-Fi HTTPS (owner/IT)**, which requires UAC approval, a certificate with the exact IP SAN, and a staff-subnet firewall allow rule. The phone then accesses `https://<hotel-PC-private-IP>:3000` only when on the staff Wi-Fi, with the issuer explicitly trusted. The Windows tray offers a separate action to return to strictly localhost-only. The original C# and Node app stays local-first and offline-capable. See [private staff-network guide](WINDOWS_STAFF_WIFI.md); do **not** bypass certificate warnings or expose the port to guest Wi-Fi or the internet.

## Automatic same-PC emergency backups without setup

If the Windows owner has **not** yet configured a separately protected backup drive, a newer FortLedger desktop launcher automatically creates encrypted emergency snapshots under `%LOCALAPPDATA%\\FortLedger\\local-backups`, with a stable **CurrentUser-DPAPI-sealed random secret** under `%LOCALAPPDATA%\\FortLedger\\local-backup-settings.json`. The owner will see a **one-time warning** that these are *not disaster-safe*. FortLedger creates one on startup and once per 24 hours while it runs, retaining the newest 30 database backups. After the paired-credential version is installed, new snapshots also carry the encrypted original owner credential companion.

These snapshots are **only recoverable within the original Windows user context** while its DPAPI key is intact. They are on the **same drive as the live ledger**, so ransomware, disk loss, profile corruption or hardware failure may destroy both the data and its only decryption key. They are not independent replacements for the owner's separate encrypted backup drive, separate passphrase record or off-device restore rehearsal. The owner dashboard explicitly continues to show **backup attention** for local-only copies; automatic updates still require a verified separate-drive backup.

When the owner later completes **FortLedger tray → Configure encrypted backups**, the app loads those external settings on the next startup and uses the owner-managed off-device storage. Existing local emergency snapshots are not overwritten or deleted. If the old local backup files remain but their DPAPI key file is missing/corrupt, startup **refuses to generate a new unrelated key**, rather than silently orphaning the old encrypted files. Keep the original Windows account and encrypted backup folder protected.

## Quiet owner-only release indicator

On the local Windows PC, FortLedger performs a **read-only release check after owner sign-in** and checks again no more than once every six hours while the app remains open. When a newer verified installer (or, for a developer Git checkout, a newer revision) is found, a small **New update** action appears in the workspace header. Clicking it opens **My Profile → Application updates** for a deliberate review. Cashiers, front desk and managers cannot see it or make those update requests; staff phones on private Wi-Fi do not receive update controls.

This indicator does **not** install, restart or migrate anything. The desktop-installed version still presents **Download verified Windows update** only when the official main-branch push passed the Linux, Windows and browser checks and the installer artifact exists. The owner must finish all money/booking operations, close from the tray, verify independent backups, then run the verified `.exe`. Merely pushing a PR is not an installable release; a completed tested main build is required.
