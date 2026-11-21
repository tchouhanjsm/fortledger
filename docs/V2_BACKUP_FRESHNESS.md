# V2 practical automation — backup freshness in Today

The owner and manager now receive a small **Encrypted backup needs review** card on Today when the Mac's configured encrypted backup folder is missing, unconfigured, invalid, unreadable or when the newest `.flbk` file is older than **36 hours**. The card links to the existing Hotel Settings workspace. Staff should use `npm run doctor` and `npm run recovery:drill` on the Mac and verify independently protected off-device backups.

**Scope:** Read-only directory metadata. No backup is created, decrypted, copied, restored, uploaded or modified. File paths, backup passphrases and filenames are not sent to browsers. A recent file is **not** proof that it decrypts or restores; the independent recovery gate remains mandatory. Front-desk and cashier users do not receive the endpoint or alert. Existing automated encrypted backup scheduling remains unchanged.

No database migration, paid service or change to invoices, bookings, restaurant billing or payments. Tests: `node --test test/v2-backup-freshness.test.js`, `npm test`, `npm run test:browser`. Real Mac backup and recovery acceptance remains pending.
