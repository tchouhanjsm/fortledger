# Kaizen V3 — reproducible synthetic read-only API baseline

This benchmark is for comparing similar code versions **on equivalent CI runners**, not for certifying the physical hotel Windows PC, real hotel guest data, or a production latency service level.

## Run

```sh
npm ci --no-audit --no-fund
npm run perf:baseline
```

The script creates **only disposable SQLite `:memory:` fixtures** and listens on ephemeral localhost, seeded with seven existing room definitions and 28 vs 700 synthetic historical reservations. There is no external HTTP dependency, production file path, financial mutation, guest details or test-data persistence. No new package is required.

It reports end-to-end HTTP+JSON p50/p95/max of 10 measured requests (after 2 warmups) per endpoint: /api/health, /api/rooms, /api/bookings, /api/finance/daily, /api/finance/closing/attention. It also reports a booking-date SQLite query plan, CPU time during the benchmark, RSS and elapsed time. No performance threshold blocks the build; the Ubuntu CI job includes the informational measurement.

**Interpretation:** Browser cold start, actual Chromium navigation, receipt generation/PDF, idle CPU, backup crypto, physical Windows device, and printer time are not measured here. SQLite timing and machine memory are runner-dependent. Inspect before optimizing and keep all data/financial freshness constraints intact.

## Release boundary

The PR only adds a synthetic benchmarking script, pure sample aggregator tests, npm command and one CI measurement step. Zero database schema changes, network listener changes, app UI changes, or hotel records. Roll back by reverting files; it does not affect hotel data.
