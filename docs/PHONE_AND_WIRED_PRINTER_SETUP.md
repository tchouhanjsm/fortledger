# FortLedger on staff phones + wired LAN receipt printer (owner guide)

**Scope:** Operates on the **one existing Windows hotel PC**, one SQLite database and your existing router/switch. This is not a guest-facing website, hosted app, Bluetooth workflow, or a cloud print service. No paid subscription required. A physically connected hotel printer, real telephone and router have **NOT** been tested by GitHub CI.

## A. Phone access on the same hotel network

The server already implements an **owner/technician opt-in HTTPS staff Wi-Fi listener**; it is localhost-only until configured. Follow [WINDOWS_STAFF_WIFI.md](WINDOWS_STAFF_WIFI.md).

1. Windows hotel PC stays powered on and runs FortLedger. It can connect to the same router by Ethernet or private staff Wi-Fi. Reserve the PC's **real assigned private IPv4** in the router (for example `192.168.10.15`). Do not use examples as actual addresses.
2. Configure a **staff-only** Wi-Fi/network where guest Wi-Fi cannot route to the PC. Firewall inbound TCP 3000 must be limited to the intended staff subnet, never the public internet.
3. Owner/IT provisions an HTTPS certificate whose IP SAN matches that PC address, protects its private key outside the source repository and installs/trusts the correct issuer on authorized phones only. **Never bypass browser certificate warnings.**
4. Windows tray → **Private hotel Wi-Fi HTTPS (owner/IT)** (approve UAC) → enter host IP, staff subnet and certificate/key paths → restart FortLedger. Existing native helper validates local address, Private network adapter, certificate/key and firewall rule. It does not invent a certificate, open public port forwarding or change the hotel ledger.
5. Owner → **My profile → Staff phones** → **Check staff phone address**. The API reports `localhost_only` or the private `staff_https` URL, e.g. `https://192.168.10.15:3000`. It does **not** certify the router or phone. Copy the URL to an authorized phone on staff Wi-Fi; sign in with that employee's own full-password account and use **Add to Home Screen** if desired.
6. Physically test real staff-phone login; browser SSL trust; staff PIN is intentionally **not** available on phones; disconnect/reconnect mid-read; sign out; verify guest Wi-Fi and cellular cannot access this service. Keep #135 OPEN until owner/IT verifies. Windows PC remains the authoritative source for all staff.

Revert using the tray → **Return to this computer only (owner/IT)**. Details in [WINDOWS_STAFF_WIFI.md](WINDOWS_STAFF_WIFI.md).

## B. Printer connected to the router/switch by LAN cable

The existing restaurant saved-receipt renderer and transport use **ESC/POS over raw TCP**, which works only for a printer supporting this protocol (e.g. correctly configured Epson TM-T82 Ethernet variant). No Bluetooth, phone USB cable or Windows printer share is used by the raw TCP path. **Generic IPP/LPR or ordinary A4 office printers are not supported by this receipt transport.**

1. Connect the printer's **Ethernet port** directly to the same local router/switch as the hotel PC. Power on and load paper. Reserve the printer's **actual private IPv4** (for example `192.168.10.50`) in the router or obtain its network configuration sheet. Staff phone Wi-Fi need not expose the printer; the Windows server sends printer bytes.
2. Confirm the printer is configured for **ESC/POS raw TCP** on port **9100** (alternative configured 9101/9102 only when supported by that specific printer). No port forwarding or printer-cloud account.
3. Log in as owner → **My profile → Ethernet receipt printer**. Enable printer, enter **its private IPv4** and raw TCP port, select **Save local printer setup**. Values are kept in the existing backed-up SQLite DB and survive PC restarts. Prior `FORTLEDGER_PRINTER_HOST/PORT` environment settings still work until the owner overrides or disables them.
4. Select **Send one TEST ONLY slip**, then inspect actual paper. The synthetic test says *NO SALE*, *NOT AN INVOICE*, *NO PAYMENT*. Each click requires confirmation and a stable request ID, so a lost response/retry **cannot silently send a second slip**. The UI may only report `sent_unverified` or `uncertain`; a TCP success **does not prove paper physically printed**.
5. On a cashier account (PC or permitted phone), **Restaurant POS → saved receipt → LAN Print**. The app checks that a printer is configured and prints **only an already saved restaurant receipt** from the PC server. Prior attempts show a state, and any reprint requires a separate explicit confirmation after inspecting paper. No billing record is created or changed by a print attempt.
6. If printer is unreachable, verify link light, correct IP/port, PC-to-printer routing, switch/VLAN access, printer paper and network model. Wrong certificate on a **phone** is separate from wired printer connectivity. Do not open raw TCP 9100 to the internet.

## Technical constraints and trust boundary

- Added owner-only JSON `GET/POST /api/printer/config` and `POST /api/printer/test`, GET test request replay lookup, cashier-only/owner sanitized `GET /api/printer/status`, owner-only `GET /api/network/staff-access`. Authentication, method restrictions and same-origin checks remain enforced on staff HTTPS.
- Raw network printer setup rejects hostnames, loopback, public IPv4, invalid ports and generic IPP/LPR ports. Configuration change is audited. Owner-only test status is persisted in a unique-request SQLite table; replay returns the first attempted outcome, never resends. No PDF or statutory GST issuance/numbering change.
- Newly added tables are additive and source-only-updater-compatible, retaining SQLite schema version 13, with no new native package dependency. They live in the one SQLite backup. Legacy environment printer variables remain as fallback unless owner settings exist.
- Print transport still cannot know if a slip printed; the device's network is not under CI control. A live acceptance test on **the real printer** is mandatory under [#135](https://github.com/tchouhanjsm/fortledger/issues/135).
- The owner can disable the printer in profile without changing any saved food bills or staff accounts. No forced reinstall of the Windows application for code-only changes when existing V7 supervisor checks/backup gate are met.

## Milestones not claimed complete

Physical phone/cert trust/guest network isolation, Epson cable/paper/width, real backup restore on a replacement Windows PC, and accountant-certified GST final invoice/credit note issuance remain unverified. The old online-generator PDF archive and manual serial identification do not themselves authorize issuing fresh legal GST invoices.
