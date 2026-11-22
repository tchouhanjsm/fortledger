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

The **installer-managed** build does not have a Git checkout, so its in-app Update Center honestly reports installer-managed updates rather than offering Git fast-forwards. The developer's Windows supervisor belongs to the separate Git-based installation and is **not** used by this package.

For a desktop upgrade:

1. Finish all reservations, restaurant bills and payments, and close the tray application safely.
2. Ensure the **last 36-hour encrypted backup** exists on a separate drive and was successfully tested. Keep the original backup passphrase outside the PC.
3. Run the newer verified `FortLedger-Setup-*.exe`. Before replacing any executable, the installer refuses a listening application on port 3000, a half-present database/password, an absent separate-drive backup, or an encrypted-backup restore drill that fails.
4. After installation, open the FortLedger shortcut. The original database and owner password are reused. Verify seven rooms, prior bookings, invoice numbers, food bills and stored payments; if any mismatch occurs, stop making new financial records and investigate the backup.

**Uninstall does not remove guest records or backups**, by design. Do not assume reinstalling deletes hotel records; never intentionally delete the persistent data folder as a repair step.

## Build and trust limitations

The builder runs on GitHub's Windows runner, bundles exactly the installed Node 22 executable, production-only npm dependencies including native Windows SQLite, public assets and app source, and compiles a small .NET Framework 4 Windows Forms launcher. It runs packaged first-run, login and graceful-exit smoke tests before Inno Setup creates a per-user Windows x64 installer. The GitHub workflow retains the `.exe` artifact for 30 days.

**No code-signing certificate is configured.** Windows SmartScreen may flag the unsigned executable. Staff should not bypass unexpected security warnings or download installers from untrusted senders: the owner must verify the release source and SHA-256 and decide deployment. No actual Windows PC, printer, backup drive, staff Wi-Fi or accountant GST review is certified by GitHub CI. This remains **ACTIVE ALPHA — NOT RELEASED**.
