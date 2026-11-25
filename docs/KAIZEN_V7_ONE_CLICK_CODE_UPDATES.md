# FortLedger V7 — One-click Windows code updates without repeated installation

## Why this exists

Before V7, an Inno Setup desktop installation could only **download another full EXE**. The verified Git fast-forward updater applied to developer/source checkouts, **not** installer-managed staff computers. A GitHub PR merge never changes an installed Windows executable, and a successful CI run is not proof of a restorable hotel ledger.

**V7 adds the bootstrap tray supervisor**. After one verified V7-or-newer installer upgrade, the **owner** can perform compatible future **code-only updates** from **My profile → Application updates → Check for updates → Apply code update & restart**. Staff still click the same desktop shortcut; no terminal, Git, CSV upload, new accounts, cloud, subscription, or repeated full EXE installation for compatible code-only releases.

## Strict operation — current V8 policy

1. FortLedger reads the current **main** SHA, proves installed ancestry and verifies **Linux, Windows and Chromium checks on the exact same commit**. No installer artifact is required for source updates. The updater compares the installed commit tree with the verified candidate. If the UI status and readiness target differ, recheck before applying.
2. **Only `src/` and `public/` app code/UI files can be patched.** If `package.json`, `package-lock.json`, the C# tray launcher, or backup-control PowerShell scripts differ, the update is **blocked as source-only** and requires a verified full installer instead. The source-only response itself contains no installer download URL. No native SQLite binary, Node, startup shortcut, uninstall registry record, or Windows service is changed by a code patch.
3. A recent encrypted ledger and original owner-credential pair must pass isolated recovery verification before Apply. The trusted existing DPAPI-sealed local folder is eligible only for routine source/UI changes; protected schema/storage/recovery changes require independent recovery. After drain, the server prepares and verifies a fresh pair automatically. Independent recovery remains mandatory for disaster recovery and native installer upgrades.
4. The update request is **owner-authenticated on loopback only**. The HTTP app accepts a pinned 40-character Git SHA, rejects further money writes, finishes active HTTP requests and backup jobs, closes SQLite and prints a unique tray control line **only on successful drain**. It never downloads/extracts/runs code inside the live billing process.
5. The independent **Windows tray parent** waits for server process **exit code 0** and only then starts the code-only update helper. The helper rechecks the successful main release and complete commit trees, backup, local old-file hash and downloaded new-file Git blob hashes. No arbitrary archive extraction, Git checkout/reset, unaudited shell, custom URL or access to guest data is allowed. New files are staged outside the installed app. The updater replaces only changed app source files and records the new build identity **last**.
6. If a write fails, the helper restores the original application source files before reboot. If program-file consistency is **uncertain**, the tray **stays stopped** rather than booting mixed versions. It never tries to roll back database migrations after a later boot.
7. The desktop tray automatically restarts the local app after a successful compatible code update or a safely refused/rolled-back attempt; the owner reloads the browser and signs in. Existing hotel SQLite, authentication, backups, bill and invoice histories stay in their existing directory and are **never rewritten by the patch engine**.

## Boundaries and first bootstrap

**Current V6-and-earlier installers do not yet contain the tray code-update supervisor.** They cannot become self-updating just because this PR is merged. **One last reviewed V7 installer is needed to bootstrap the new mechanism on the Windows staff PC**, after protected encrypted backup verification. Then subsequent source/UI changes can use the in-app button until a native dependency/launcher/backup-script change requires another installer.

This is **not silent/background updates**. The owner chooses when to update between staff work; offline machines keep working without updates. A separately verified clean Windows workstation, off-device replacement-PC recovery, real Epson paper printer and accountant GST sign-off remain **human release gates**: [#135](https://github.com/tchouhanjsm/fortledger/issues/135). The software is still an unsigned engineering alpha.

The GitHub Actions installer continues to be published for fresh PCs, major native changes and recovery. The in-app button is not intended to bypass its own safeguards, the installer guard or physical acceptance.


## V8 CI-approved source channel
The owner-only source patcher discovers the current `main` commit, verifies it descends from the exact installed commit, and checks GitHub's Linux, Windows and Chromium passes for that **exact main SHA**. No Windows installer artifact is needed. A native/dependency/backup-control change is still refused by the strict source-only allowlist. Both Git trees, installed file bytes and downloaded pinned blobs are revalidated by the tray helper after financial work is drained and SQLite is closed. The native installed build number remains unchanged for code-only patches, while the exact installed commit SHA advances. There is **no post-startup verification prerequisite** for applying a routine source patch; the existing tray restarts the service normally. PR #179 did not change the encrypted backup gate; PR #180 subsequently introduced the bounded local-checkpoint policy below.


## V8 automatic encrypted routine checkpoint
On a protected routine source/UI update the server first **stops accepting requests**, completes any in-flight transaction, waits for scheduled backups, creates a NEW AES-GCM SQLite + original owner credential pair and verifies an isolated restore while SQLite is still open. Only then does it close the database and signal the independent Windows source-patch helper. A new external USB setup is NOT needed for ordinary source/UI patches if the existing Windows DPAPI-sealed local emergency folder contains a verified encrypted paired backup. The helper verifies again after shutdown before changing code. Schema/storage/recovery core files remain blocked from local-only updates, and native launcher/dependency changes are not source patches. A local checkpoint protects against software update failures but **never counts as off-device disaster recovery**: a lost disk/profile can lose both data and decryption key. The hotel release/replacement-machine backup gate remains pending. There is no post-start verification prerequisite for the update.

## Local maintenance with hotel LAN enabled
A compatible packaged supervisor can serve the same app on the existing private-IP HTTPS listener and a separate strictly loopback HTTP socket on port 3000. On the hotel PC use `http://127.0.0.1:3000/#profile` and sign in as owner. A phone cannot authorize updates; its TLS session cannot be replayed on the maintenance socket. Both listeners drain before the single SQLite checkpoint and supervisor patch. No LAN settings are removed. Physical Windows acceptance is still required.

## Exceptional native upgrade
The source updater may show an installer download only for a confirmed native incompatibility or a source patch exceeding its safe size limit, and only when a successful official installer workflow matches the exact approved source SHA. A stale backup, offline check, unsafe path or documentation-only revision is not a reason to reinstall. The installer remains guarded by independent recovery verification.
