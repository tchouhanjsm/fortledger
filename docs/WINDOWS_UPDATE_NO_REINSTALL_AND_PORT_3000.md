# Windows updates — installer loop and orphaned port 3000 recovery

**Issue:** The hotel owner clicks **Update** and only sees **Download verified Windows update**. Running the newer setup says FortLedger is already running, even after ending `FortLedger.exe` in Task Manager.

## What the installed app actually supports

The installer-managed Windows app and local developer Git checkout have **different** update paths. A successful push/PR does not update an installed copy. A V7-or-newer Windows tray supervisor can apply **verified src/public source-only patches** without replacing `FortLedger.exe` or downloading a new installer, but **only** if all checks pass: exact current GitHub main Linux/Windows/Chromium CI, installed SHA ancestry, matching Git trees and blob hashes, a compatible supervisor, and a verified encrypted SQLite plus original owner-credential checkpoint. Since PR #179 the source channel does not require a Windows installer artifact. Since PR #180 eligible routine source/UI changes may use the existing trusted DPAPI-sealed local checkpoint; independent recovery is required for protected schema/storage/recovery changes and remains mandatory for installer upgrades and disaster-recovery acceptance.

**My Profile → Application updates → Check for updates** now prioritizes **Apply code update & restart** when eligible and hides the installer download in that case. If the in-place update is blocked (old tray V6 or earlier, native runtime/launcher/package change, missing independent protected backup, no valid build identity, unsupported platform, etc.), the app explains why and explains whether a native upgrade may need a verified installer. The source-only status response does not itself include an installer artifact URL; only an independently verified installer candidate may expose a download. This UI does not relax any cryptographic, access or backup checks.

## Solve the "running in background" installer block

1. **Finish all guest bookings, bills, payments and printer jobs.** Confirm a recoverable encrypted ledger **and original owner-credential companion** on an independent drive and keep the recovery passphrase separately.
2. While FortLedger is still running, use the Windows notification area/system tray icon **FortLedger → Close FortLedger safely**, and allow ongoing requests to finish. Closing the browser tab alone does not close the server.
3. Task Manager ending the `FortLedger.exe` tray parent **can leave the separate `node.exe` listener** running on TCP port 3000. The installer is right to refuse updating program files while the server may be operating. **Do not kill arbitrary `node.exe` processes**—other apps may use Node, and FortLedger may be writing financial data.
4. If the tray was already forcibly ended, **restart Windows normally**, **do not reopen FortLedger**, then try the trusted installer again. This clears an orphaned session without manually hunting and terminating financial operations.
5. If it still fails after restart, check what owns port 3000 **read-only** using PowerShell:

   ```powershell
   Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
     Select-Object LocalAddress, LocalPort, OwningProcess
   ```

   For an actual returned process ID `<PID>`, use:

   ```powershell
   Get-Process -Id <PID> | Select-Object Id, ProcessName, Path
   ```

   If the listener is not FortLedger, do **not** kill it. Have a technician inspect the conflict. You may share only the process name, PID and port result in a support discussion; **never** share a real hotel backup, guest record, credential or private key.
6. The updated installer guard now reports the listener PID/process name in its own error log, and the setup dialog tells the owner how to close the tray/restart safely. It **still refuses installation** until TCP 3000 is free *and* the old app's backup/credential recovery checks pass. An installer guard error can also indicate missing backup—not just a running app.

## No reinstall vs one-time bootstrap

- **Current V7 tray + eligible code-only release:** owner uses **Apply code update & restart**, no installer download. All hotel records remain in `%LOCALAPPDATA%\FortLedger\data`, separate from installed app files. The updater drains active requests, verifies a new paired checkpoint, closes SQLite, stages/validates changed source and rechecks recovery. If the displayed update SHA and readiness SHA differ, check again before applying.
- **V6-or-earlier tray:** the old native launcher has **no code-patch supervisor**. A new button in GitHub cannot create that native capability on your already-running PC. One verified, guarded **V7 installer upgrade** is required. This is an *upgrade over existing program files*, **not a data reset**.
- **Native/launcher/dependency change after V7:** the owner may again need one verified full installer. Code-only patches cannot replace native binaries.
- **Failed backups/unknown older installer:** never bypass the guard by deleting `fortledger.sqlite` or `admin-auth.json`, moving the data folder, running `taskkill`, forcing Git resets, or disabling the check. Restore independently verified backups first.

**What is NOT verified:** This work and CI do not diagnose your actual Windows process tree or run an update on your workstation. No hotel data was modified. Physical restore, network printer, staff phone and GST approval gates [#135](https://github.com/tchouhanjsm/fortledger/issues/135) and [#147](https://github.com/tchouhanjsm/fortledger/issues/147) remain open.


## Missing protected backup configuration — installer recovery path
The message `INSTALLER BLOCKED: Configure encrypted backups on a separate drive` means the installer successfully inspected an existing Windows hotel ledger but cannot confirm a configured independent encrypted backup for that Windows account. It **does not mean the app is still running**. The newer interactive setup offers an opt-in, bundled protected-backup setup assistant; configuration alone does not authorize installation. Connect an independently protected USB drive/share, set a private 16+ character passphrase and store it separately, open the old hotel app, prepare or verify a recent paired `.flbk` + `.flba` encrypted backup, then close the tray safely and retry. An earlier installer lacking the helper can use the existing app tray's **Configure encrypted backups (owner)** action. Never use the same C: volume or delete the hotel data to bypass this protection.
