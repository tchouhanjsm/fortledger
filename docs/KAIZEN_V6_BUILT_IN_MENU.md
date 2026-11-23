# FortLedger V6 — Built-in Garh Jaisal Kitchen menu

The **owner-provided four-page** `Garh Jaisal Menu.pdf` (source dated August 30, 2026) is bundled through the previously prepared `Garh_Jaisal_Menu_IMPORT_provisional_GST5.csv`. The catalog is packaged as 142 entries across 23 menu categories in `src/bundled-garh-jaisal-menu.js`, loaded locally through Node.js—**no web connection, CSV upload, or paid service** is needed.

## Using the prebuilt menu

1. Sign in as **Owner** or **Manager**.
2. Open **Restaurant → Menu management → Prebuilt Garh Jaisal Kitchen menu**.
3. Select **Review prebuilt menu**; examine the complete current-vs-bundled list.
4. Confirm the printed inclusive prices and the **provisional** 5% GST setting with the accountant. Check the acknowledgement checkbox.
5. Choose **Add missing dishes** and confirm the native review dialog. Staff will immediately find the added menu items in the existing Restaurant bill-only flow after reload.

A new empty restaurant has **142 missing items** and will receive all 142 only after review and confirmation. An existing restaurant receives only missing name+category pairs; the owner's current item IDs, manual price/GST changes, inactive dish preferences, already saved bills, room charges and receipt printouts are **never modified**.

A second sync is **no-op**: all 142 will be preserved if previously added. A menu that changed after preview rejects the complete sync in a transaction and must be reviewed again. No destructive CSV import, database reset or version migration occurs.

## Accounting and source caveat

The **printed PDF does not specify GST**. The prior *provisional* import CSV places **5% on all 142 dishes**, which is included in this starter. This rate is **not an accounting/legal determination**. Verify tax eligibility and required rates before using prebuilt prices for guest bills or receipts. Current menu editing supports manager/owner price & GST corrections and audit, without changing historical bills.

The imported spelling and original printed rates remain unchanged. In particular, the printed menu shows **Chapati ₹320** and **Butter Chapati ₹300**, and spells **Palal Paneer** as shown. These may need owner review; the app never invents corrected values. Source provenance is held in this guide; the printed menu artwork/contacts are not republished in the installer.

## Permissions and review gates

The read-only preview and signed commit routes are owner/manager **`menu.manage`** only; cashier and front-desk cannot invoke them. The server checks acknowledgement of provisional GST and exact current-menu snapshot at commit time and logs added dishes in the existing audit ledger. All 142 rows are visible in the UI review without pagination hiding the true change set; screen-reader focus and mobile reflow follow existing styles.

Automated tests check all 142 entries, empty-database and partial sync, no-overwrite semantics, inactive-item preservation, historic bill invariants, stale/forged review tokens, HTTP role enforcement and Chromium owner/cashier journeys. Physical GST sign-off remains a human release gate. No new KOT, open orders, online menu synchronization or ongoing cost.
