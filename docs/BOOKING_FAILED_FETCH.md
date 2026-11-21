# Booking creation: "Failed to fetch" and uncertain network response

**What the message means:** The browser did not receive an HTTP response from the local FortLedger service. This can happen when the Node server has stopped, the browser has lost its local connection, or the connection drops after the server saved the reservation. It does **not** prove the booking failed, and it is not evidence of an invoice/room-rate validation error.

## First action — protect the ledger

1. Do **not** press Add a booking again with a new request ID, close the editor, or change the guest/dates merely to retry.
2. Confirm FortLedger is still running in its PowerShell terminal. Check for a Node stack trace or process exit. Preserve the first error line privately, with guest details removed.
3. In the *same browser* open `http://127.0.0.1:3000/api/auth/status` on the local hotel computer. The endpoint should respond with JSON. If it fails to connect, restart the app through `scripts/windows-start.ps1` only after checking the existing data-folder configuration.
4. After connectivity returns, check the booking list by guest/date. On updated installations, the editor automatically queries the recorded booking **by the exact request UUID** whenever the POST response is lost. If found, it closes the editor and reports the existing booking number without creating another.
5. If lookup is unavailable, leave the editor intact while investigating. An unchanged retry uses its original UUID and is idempotent, but changing fields/starting over generates a different UUID and may duplicate the booking.
6. If the server shows a disk/database error or an abrupt exit, **stop** and preserve the database and WAL files; do not manually delete `-wal` or `-shm`, reinstall the application, or reset Git.

## Read-only local checks in a second PowerShell

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/auth/status
$env:FORTLEDGER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'FortLedger\data'
npm.cmd run doctor
```

`doctor` validates existing SQLite integrity and important dependencies, but does not prove the local HTTP listener is available. Keep the first failing error line (excluding passwords and personal data). After an authorized stopped-app backup, use `scripts/windows-update.ps1` to sync the tested fix, then reopen the hotel via `scripts/windows-start.ps1`.

## What the fix does

- `GET /api/bookings/request/<request-id>` is authenticated and returns only the exact saved booking ID, or that no such request is recorded.
- It never creates another booking, payment, room allocation or audit event.
- A lost response after a committed booking is automatically reconciled in the browser.
- If the local service is down, the browser explains that confirmation is impossible; it preserves the original UUID and blocks unsafe assumptions.
- This does **not** solve physical laptop power loss, a stopped Node process, disk failure, or external firewalls. Those require local diagnostics.

**Release status:** This is a network-failure UX fix, not proof of the cause of any specific physical installation outage.
