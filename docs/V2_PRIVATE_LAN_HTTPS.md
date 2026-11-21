# FortLedger V2 — opt-in direct HTTPS staff LAN (Mac and supported OS)

**Alpha; NOT RELEASED.** The ordinary `npm start` remains bound to `127.0.0.1:3000` over HTTP. No reverse proxy, port forward, VPN, Docker, public host or second database is required. The optional LAN listener is **disabled by default**.

## Trust boundary and prerequisites

1. Use a dedicated, stable private IPv4 address on the hotel Mac (for example `192.168.21.12`, replacing it with the actual Mac address). Set up staff-only Wi-Fi with network isolation from guest Wi-Fi, router administration and printer networks as appropriate. An RFC1918 address is **not itself proof of network isolation**. Have a network technician verify that guest Wi-Fi and public internet cannot reach the Mac service.
2. Create or obtain an HTTPS certificate and private key trusted by each authorized staff phone/tablet. The certificate must have a `subjectAltName` IP entry exactly matching the Mac's chosen address, be valid for the current date, and match its private key. Never click through browser certificate warnings, and never publish the key to GitHub or put it in project source.
3. Store the TLS private key in a Mac owner-controlled directory with restricted file permissions and maintain a secure recovery copy. Ensure owner/staff passwords are configured. Run the existing backup and recovery preflight before changing deployment.
4. Explicitly allow only selected staff IPs/subnet(s) to the application's chosen port in the Mac firewall and staff network ACL; refuse access from guest Wi-Fi. No router port forwarding, UPnP or public DNS. Confirm IP assignments and routing.
5. Retain the existing `FORTLEDGER_DATA_DIR` and other data-related configuration exactly. All browsers use the **same running server and SQLite file**.

## Start directly on staff Wi-Fi (after validating the trust boundary)

From the existing Mac's configured startup shell, replace example values below with real deployment values (do not commit these values or credentials):

```sh
export FORTLEDGER_LAN_ENABLED=1
export FORTLEDGER_HOST=192.168.21.12
export PORT=3000
export FORTLEDGER_TLS_CERT=/secure/path/staff-lan-cert.pem
export FORTLEDGER_TLS_KEY=/secure/path/staff-lan-private-key.pem
npm start
```

The server validates all settings and certificate before binding. Authorized staff use `https://192.168.21.12:3000/` after trusting the verified certificate. Sessions gain the Secure cookie attribute. Host-header and request Origin checks require exactly the configured HTTPS destination; plain HTTP and forwarded-host tricks fail closed. Browsers still require live server connectivity; **no offline financial mutations** are enabled. Credentials are never printed to the console.

## Rollback

Stop the server, unset `FORTLEDGER_LAN_ENABLED`, `FORTLEDGER_TLS_CERT` and `FORTLEDGER_TLS_KEY`, restore `FORTLEDGER_HOST=127.0.0.1`, then restart using the original configuration. Do not delete database files, WAL files, authentication or backups. This feature has **no schema migration**.

## Testing and acceptance

Run `node --test test/v2-private-lan-https.test.js`, `npm test` and `npm run test:browser`. These protect configuration and plaintext rejection but are not equivalent to a real device TLS handshake.

On actual Mac/phones, independently verify certificate trust, HTTPS-only login, Secure cookies, cross-origin denial, guest-Wi-Fi denial, staff revocation, simultaneous booking/room-charge/settlement integrity, disconnection/recovery, backup integrity, and Mac firewall configuration. Keep release status **NOT RELEASED** until physical and accountant gates are independently evidenced.

**Limits:** There is no certificate issuance/renewal automation, device enrollment, built-in firewall management, VPN or service discovery. Authorization is per staff account; device reachability is controlled by network/firewall rules. Avoid operating LAN mode unless these prerequisites are met.
