# V2 sensitive-response cache policy

All `/api/*` responses (including authentication, bookings, folios, restaurant bills, printable documents, success/error responses) and the app entry HTML now send `Cache-Control: no-store` and `Pragma: no-cache`. `X-Content-Type-Options: nosniff` applies across responses. Static CSS, JavaScript, icon and manifest retain existing static handling.

This reduces accidental browser/intermediary storage; it does **not** provide encryption, wipe already cached content, turn a private LAN into a trusted network, or replace HTTPS. Financial changes remain server-authoritative, and no offline mutation queue is introduced.

Test with `node --test test/v2-cache-policy.test.js`, `npm test` and `npm run test:browser`. Confirm on actual deployed Mac and browsers as part of release acceptance. No database migration, auth permission change, payment change or package dependency.
