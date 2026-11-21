# V2 mobile install foundation (non-offline)

This change adds a local app manifest and scalable icon, referenced by both login and operations pages. On supported browsers staff may use **Add to Home Screen** for convenient launch. Availability of a native install prompt differs across browsers and operating systems and needs real-device testing.

- No service worker, offline app shell, background sync, or cached authenticated API responses are introduced.
- **A home-screen shortcut is not permission to use the app offline.** All operations still need a running FortLedger server and authenticated connection.
- The existing loopback-only server policy stays active. Phones on hotel Wi-Fi **cannot yet reach** the Mac server; secure HTTPS staff-LAN ingress requires a separate security-reviewed rollout. Never open router ports or turn on `0.0.0.0` as a workaround.
- No database changes, new dependencies, accounting changes, or printer changes.

## Verification

Run `node --test test/v2-mobile-install.test.js`, `npm test`, and `npm run test:browser` on an installed development checkout. Confirm on actual iPhone/Android devices only after approved HTTPS LAN access exists. No physical-device acceptance or production release claim is made by this PR.
