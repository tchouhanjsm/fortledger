# FortLedger V7 — One-click Windows code updates without repeated installation

## Why this exists

Before V7, an Inno Setup desktop installation could only **download another full EXE**. The verified Git fast-forward updater applied to developer/source checkouts, **not** installer-managed staff computers. A GitHub PR merge never changes an installed Windows executable, and a successful CI run is not proof of a restorable hotel ledger.

**V7 adds the bootstrap tray supervisor**. After one verified V7-or-newer installer upgrade, the **owner** can perform compatible future **code-only updates** from **My profile → Application updates → Check for updates → Apply code update & restart**. Staff still click the same desktop shortcut; no terminal, Git, CSV upload, new accounts, cloud, subscription, or repeated full EXE installation for compatible code-only releases.

## Strict operation

1. FortLedger reads a successful **main** Windows-installer workflow artifact and separately checks **Linux, Windows and Chromium checks on the exact same commit**. The updater compares the installed commit tree with the verified candidate.
2. **Only `src/` and `public/` app code/UI files can be patched.** If `package.json`, `package-lock.json`, the C# tray launcher, or backup-control PowerShell scripts differ, the update is **blocked as source-only** and shows the verified full installer fallback. No native SQLite binary, Node, startup shortcut, uninstall registry record, or Windows service is changed by a code patch.
3. The protected **encrypted backup on a physically separate drive/share must be recent and pass an isolated recovery verification including original owner credentials** before the owner can click Apply. Owner may create and test a new backup using the existing **Prepare protected backup** button.
4. The update request is **owner-authenticated on loopback only**. The HTTP app accepts a pinned 40-character Git SHA, rejects further money writes, finishes active HTTP requests and backup jobs, closes SQLite and prints a unique tray control line **only on successful drain**. It never downloads/extracts/runs code inside the live billing process.
5. The independent **Windows tray parent** waits for server process **exit code 0** and only then starts the code-only update helper. The helper rechecks the successful main release and complete commit trees, backup, local old-file hash and downloaded new-file Git blob hashes. No arbitrary archive extraction, Git checkout/reset, unaudited shell, custom URL or access to guest data is allowed. New files are staged outside the installed app. The updater replaces only changed app source files and records the new build identity **last**.
6. If a write fails, the helper restores the original application source files before reboot. If program-file consistency is **uncertain**, the tray **stays stopped** rather than booting mixed versions. It never tries to roll back database migrations after a later boot.
7. The desktop tray automatically restarts the local app after a successful compatible code update or a safely refused/rolled-back attempt; the owner reloads the browser and signs in. Existing hotel SQLite, authentication, backups, bill and invoice histories stay in their existing directory and are **never rewritten by the patch engine**.

## Boundaries and first bootstrap

**Current V6-and-earlier installers do not yet contain the tray code-update supervisor.** They cannot become self-updating just because this PR is merged. **One last reviewed V7 installer is needed to bootstrap the new mechanism on the Windows staff PC**, after protected encrypted backup verification. Then subsequent source/UI changes can use the in-app button until a native dependency/launcher/backup-script change requires another installer.

This is **not silent/background updates**. The owner chooses when to update between staff work; offline machines keep working without updates. A separately verified clean Windows workstation, off-device replacement-PC recovery, real Epson paper printer and accountant GST sign-off remain **human release gates**: [#135](https://github.com/tchouhanjsm/fortledger/issues/135). The software is still an unsigned engineering alpha.

The GitHub Actions installer continues to be published for fresh PCs, major native changes and recovery. The in-app button is not intended to bypass its own safeguards, the installer guard or physical acceptance.
