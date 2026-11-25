# Existing hotel Wi-Fi / LAN — authorized phone HTTPS

**No second staff-only Wi-Fi is required.** The Windows PC may connect to the existing hotel router by Ethernet while authorized phones use that router's password-protected Wi-Fi. One Windows computer and one local SQLite ledger remain the source of truth.

**Security:** The Wi-Fi password is not a FortLedger login. A device on the allowed LAN subnet can reach the sign-in page. Every operator requires an individual FortLedger staff account and correct role; HTTPS must use a trusted certificate. Never forward port 3000 to the internet or use an HTTP shortcut. If guests share the same Wi-Fi, they may also reach the login page; configure router guest isolation or device access controls if network-level denial is required. Do not assume the shared Wi-Fi password proves device isolation.

## One-time owner / IT setup

1. Reserve the actual Windows PC **private IPv4** address in the router (for example `192.168.1.15`, only if this is your actual IP). Ethernet or Wi-Fi is supported. Set the Windows Ethernet/Wi-Fi interface to the **Private** profile.
2. Provision a private-IP TLS server certificate with the exact bound IP in its Subject Alternative Name (SAN). A technician can use [mkcert](https://github.com/FiloSottile/mkcert) and an example command `mkcert -cert-file hotel-lan.crt -key-file hotel-lan.key 192.168.1.15`. Keep the private server key and local CA private key protected. Trust **only the CA certificate** on authorized phones.
3. On Windows, choose **FortLedger tray → Hotel LAN HTTPS - phone access (owner/IT)**. Approve the UAC prompt. Enter the PC private IP, authorized source CIDR covering the PC and phones (e.g. `192.168.1.0/24`, but check your actual subnet), and absolute certificate/key paths. Existing helper arguments `-StaffIP` and `-StaffSubnet` are preserved for backward compatibility.
4. The helper verifies the IP is assigned to this PC, Windows Private profile, and certificate/private-key/validity/IP SAN. It configures the firewall for only TCP 3000 on the PC private IP and specified allowed local subnet; it does not enable WAN access.
5. Safely close and restart FortLedger from its tray. On a phone joined to the hotel's existing Wi-Fi, open `https://<actual-Windows-PC-IP>:3000`, trust the certificate issuer, and sign in with that phone user's staff account. The hotel PC and FortLedger must stay running.
6. Verify the phone can sign in over trusted HTTPS, individual role restrictions and logout/revocation work, and that **outside-LAN/cellular access fails**. Check there is **no router port-forwarding** to port 3000. If the network allows guest devices, evaluate a guest SSID, router ACL or per-device access controls. This is a human device acceptance step, not certified by software.

The owner phone panel keeps the configured HTTPS address visible and selectable even after clipboard copy. Address candidates are only hints until LAN HTTPS is enabled. A successful status check is not a physical phone test.

**Local maintenance with LAN enabled:** On a compatible packaged Windows supervisor, open `http://127.0.0.1:3000/#profile` on the hotel PC and sign in as owner. The same Node process serves the loopback-only HTTP socket and the existing private-IP HTTPS socket; both share one ledger, authentication authority and transaction drain. Phone sessions cannot authorize updates or replay their HTTPS session on the local maintenance socket. No router/firewall/certificate changes are required during a routine code update. The existing tray restarts both listeners after the verified update; all staff must finish unsaved forms before owner approval. Physical Windows and phone acceptance remain required.

To disable: **FortLedger tray → Return to this computer only (owner/IT)**, approve UAC and restart. The helper removes its firewall rule and archives LAN settings without changing hotel data, owner credentials or existing TLS key files.

Do not bypass phone certificate warnings, use `0.0.0.0` or `RemoteAddress Any`, put the guest ledger on a hosted server, or run a second writable copy on the phone. This remains **ACTIVE ALPHA — NOT RELEASED** until physical device/backup/accountant acceptance.
