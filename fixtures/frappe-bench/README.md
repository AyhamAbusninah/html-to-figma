# Frappe/ERPNext v15 — Stress-Test Benchmark

> **Benchmark only.** This stack exists to stress the *universal* engine against a large, complex,
> real-world DOM (Flexbox/Grid, sticky headers, inner scroll containers, SVG sprites, RTL Arabic).
> Nothing in this folder may be referenced by `packages/*` (REQUIREMENTS SYS-5 / SYS-7).

## Run

```bash
docker compose -f fixtures/frappe-bench/docker-compose.yml up -d   # first run: ~5 min (site creation)
node fixtures/frappe-bench/seed.mjs                                  # idempotent, ~10 s
# → http://127.0.0.1:8085/login
```

Stop: `docker compose -f fixtures/frappe-bench/docker-compose.yml stop` ·
Reset everything: `... down -v`

| Setting | Value |
|---|---|
| Image | `frappe/erpnext:v15.124.5` (override with `H2F_ERPNEXT_VERSION`) + MariaDB 10.6 |
| URL | `http://127.0.0.1:8085` (bound to loopback only; port via `H2F_FRAPPE_PORT`) |
| Administrator | `Administrator` / `admin` |
| English user (LTR) | `bench-en@example.com` / `H2f-bench-EN-2026` |
| Arabic user (RTL) | `bench-ar@example.com` / `H2f-bench-AR-2026`, so Desk renders `<html dir="rtl" lang="ar">` |

All credentials are throwaway local values. Never expose this stack beyond localhost.

## What `seed.mjs` creates

1. Setup wizard with **ERPNext demo data**: company `H2F Benchmark Co (Demo)` with invoices, customers, and items.
2. The two benchmark users above (roles: System Manager + accounting/sales/stock).
3. POS Profile `H2F Benchmark POS` and an **open POS Opening Entry** per user, so `/app/point-of-sale` opens straight to the till.
4. Web Pages `/h2f-benchmark-en` and `/h2f-benchmark-ar` (Cairo/Tajawal from Google Fonts, grid/flex layout).

## Benchmark views

Defined in [`views.json`](views.json): Workspace, List, Form, POS (with scroll-area expansion), and Web Page,
each captured as the EN and AR user, giving 10 captures (TST-6 set B).
