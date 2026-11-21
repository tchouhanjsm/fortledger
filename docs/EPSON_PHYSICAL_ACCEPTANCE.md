# Epson TM-T82 physical paper-output acceptance (operator checklist)

**Status: not certified.** A successful TCP connection is **not** proof of paper output. Do this only at the actual hotel with a technician/cashier and the intended Epson TM-T82 model. Do not use real guest or payment details.

## Preparation

1. Confirm the printer model, actual LAN connection, paper width, IP address and TCP port. Use the private hotel LAN; do not expose port 9100 to the Internet.
2. Ensure the printer has paper and is switched on. Do not confuse browser print with Epson LAN transport.
3. Run the one-off test slip below from the same computer and network as FortLedger:

```powershell
npm.cmd run printer:test-slip -- 192.168.1.50 9100 --confirm
```

Replace the sample IP/port with your confirmed values. **The explicit `--confirm` flag is required.** This sends a clearly marked **TEST ONLY — NO SALE** slip. It never creates a restaurant bill, takes payment, modifies SQLite, or uses guest details.

4. Inspect the real paper. Verify the text begins **GARH JAISAL / EPSON LAN TEST - NO SALE**, is legible and not clipped. Keep a private photo of the test paper with date/device reference, excluding confidential data. The CLI only reports bytes sent; the cashier decides whether paper actually printed.

## Failure/reprint behavior to verify with a synthetic saved bill

1. Create one synthetic restaurant bill in the local test installation; record its *bill ID*, total and saved receipt number.
2. Print it using the restaurant UI once and check the actual paper and displayed total.
3. Disconnect the printer LAN temporarily and attempt a different synthetic bill; the app must report uncertain/failure. Confirm no duplicate sale or payment was entered.
4. Restore the network and inspect physical output **before** choosing explicit reprint. Reprints require staff confirmation; interrupted old `sending` jobs do not unblock for at least 10 minutes. Check that a new bill/charge is not created.
5. Test cashier access and browser-print fallback separately; neither is evidence of successful Epson LAN output.

**Human outcome record:** date, operator, physical printer model, IP/port environment description, test-slip paper actually received (yes/no), line clipping, offline failure, duplicate suppression, explicit reprint behavior, corrective action. Store this record privately. Never print sensitive real hotel data as a test.

**Gate:** Mark Epson hardware accepted only after physical paper and failure/reprint behavior were observed and verified by hotel staff. CLI/test CI is not that acceptance.

**Command safety:** Running this without `--confirm` exits without contacting the printer. A network timeout or TCP error is not evidence that paper did or did not print; inspect the device before any second attempt.
