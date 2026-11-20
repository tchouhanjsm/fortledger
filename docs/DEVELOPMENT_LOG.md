# FortLedger — Development log
Append a dated entry for each meaningful implementation or business decision. Never record private guest data, account numbers or secrets here.

## 2026-11-20 — Repository initialization and first development increment
- Source: product discovery conversation, project blueprint.
- Decision: prioritize premium low-click UX equally with minimal/zero recurring cost.
- Scope: implement initial seven-room local booking and payment foundation first; further invoice/restaurant modules remain roadmap.
- Proposed changes: local Node/Express server, SQLite data tables and seed, searchable booking list, category/room allocation, GST-inclusive calculation and automatic balance, tests, readme and blueprint.
- Review gates: run available automated tests; inspect PR diff and GitHub checks before merging.
- Not yet built in this increment: invoice PDFs, billing lifecycle, restaurant CSV, room charge settlement, Epson printing, backup/restore, real calendar timeline, auth.
- Important limitation: initial booking UI is not for actual production use until security, data validation, persistence recovery and financial compliance review are complete.
