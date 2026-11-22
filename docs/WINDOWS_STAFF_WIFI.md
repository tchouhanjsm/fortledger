# Hotel staff Wi-Fi access — private HTTPS, owner/IT opt-in

**Default is localhost-only.** FortLedger does not expose guest bookings or payment screens to a network unless the owner explicitly configures the private staff-LAN listener. This is an advanced Windows **owner/IT setup**. Daily reception staff still click the desktop icon and use their own accounts.

## One-time owner / technician steps

1. **Reserve a stable private IP** for the Windows hotel computer on the *staff-only* Wi-Fi network, e.g. `192.168.10.15`. Use the staff subnet `192.168.10.0/24` as an example only; verify your actual router addresses. Disable guest-to-staff routing and client access from the guest Wi-Fi. Never forward TCP 3000 from the internet.
2. Provision an **HTTPS server certificate valid for that exact private IP** with its IP address in the certificate's Subject Alternative Name. Store the PEM certificate and private key in protected Windows user storage, **outside Git and outside guest uploads**. For a small trusted local CA, a technician may use [mkcert](https://github.com/FiloSottile/mkcert) and then securely distribute only the **root CA certificate** (not the root CA private key) to authorized phones. Example technician command: `mkcert -cert-file staff-ip.crt -key-file staff-ip.key 192.168.10.15`. The actual hostname/IP must match your reserved address.
3. From the installed FortLedger system-tray icon, choose **Private hotel Wi-Fi HTTPS (owner/IT)**. Approve the Windows UAC prompt. Enter the PC's private IP, the actual **staff Wi-Fi CIDR**, and the absolute PEM certificate/key file paths.
4. The helper checks that the IP is a private IPv4 **assigned to this PC** and the Windows adapter is marked **Private**, validates the certificate, matching private key and expiration, and creates a Windows Firewall inbound TCP rule for **that IP, port 3000 and the specified staff subnet only**. It saves `%LOCALAPPDATA%\\FortLedger\\lan-settings.json`, not the key bytes.
5. **Safely close and reopen FortLedger** using the tray. The desktop icon will now open the local HTTPS address (for example, `https://192.168.10.15:3000`). If the TLS configuration is invalid, server startup refuses to expose the hotel ledger.
6. **On an authorized phone**, join the same protected staff Wi-Fi, have a trusted technician install and verify the appropriate CA trust profile according to that phone's OS, then open `https://192.168.10.15:3000` in its browser. Sign in using that staff member's individual FortLedger account. Use **Add to Home Screen** from the browser for an app-like icon. The mobile UI reuses FortLedger's tested responsive pages.
7. Prove *both* sides: successful secure sign-in on a staff phone, and failed connections from guest Wi-Fi and cellular/mobile data. Check Windows Firewall rules and router isolation. Phone access requires the hotel PC to be switched on, connected, and FortLedger running.

**Important certificate trust:** A valid self-signed certificate is not automatically trusted by an iPhone/Android phone. Never dismiss a browser's certificate warning to handle guest payment/identity information. Phone trust behavior varies by OS and browser; verify the HTTPS lock/certificate chain after setup. A certificate with a DNS name but **not the private IP SAN** is refused. For help with this technical task, [mkcert's official documentation](https://github.com/FiloSottile/mkcert) describes the root CA and phone trust requirements.

## Reverting to safe local mode

Use **FortLedger tray → Return to this computer only (owner/IT)**. Approve the Windows UAC prompt, complete the helper, then safely stop/restart the app. The helper removes the FortLedger staff-HTTPS firewall rule and archives the active LAN config without deleting bookings, bills, staff accounts or private-key files. The original browser address becomes `http://127.0.0.1:3000`. If networking/certificate changes prevent FortLedger from starting, a technician can run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\\windows-configure-staff-lan.ps1" -Disable` from the installed application folder with administrator approval.

## Boundaries

- This is **LAN-only HTTPS**, not publicly accessible HTTPS, a VPN, a hosted server, public DNS, remote/cloud sync, or a paid service.
- `localhost` on a phone refers to the **phone**, not the Windows hotel PC. A private-IP HTTPS URL only works when the phone has network access to that PC. For a memorable hostname later, configure router-local DNS plus matching certificate SAN; the current server intentionally expects the exact IP Host header.
- A Windows Firewall subnet allow rule is **not** proof your router isolates guests. Other existing firewall rules or guest/staff routing may permit access, so physical tests are mandatory.
- One Windows PC is the single hotel source of truth. All staff devices connect to that server; do not create separate writable phone or Mac databases.
- The private-lan HTTPS and guest Wi-Fi isolation **release gate remains pending** until tested on the real hotel router, phones and certificates. FortLedger remains ACTIVE ALPHA.
