# FINAL RELEASE — Savings & Cashflow Tracker v1.0

**Release Date**: 2026-10-02
**Milestone**: M2.25 — Final Production Release & Operational Handoff

---

## 1. Release Baseline

| Component | Version |
|---|---|
| Next.js | 16.3.8 |
| React | 19.2.8 |
| Supabase JS | ^2.116.0 |
| Supabase SSR | ^0.12.7 |
| Node.js (build) | 26.3.0 |
| TypeScript | ^5 |
| Tailwind CSS | ^4 |

### Database Migrations (0001–0008)

| Migration | Purpose |
|---|---|
| `0001_initial_schema.sql` | Core tables, RLS, triggers |
| `0002_accounting_hardening.sql` | Ledger immutability, constraint hardening |
| `0003_m1_1_accounting_fixes.sql` | Accounting correction patches |
| `0004_m2_8_1_savings_withdrawal_atomicity.sql` | Atomic `execute_savings_withdrawal` RPC |
| `0005_m2_4_2_budget_interval_days.sql` | Budget interval day support |
| `0006_m2_1_3_2_tx_update_delta_fix.sql` | Transaction update delta trigger fix |
| `0007_m2_12_transaction_reversal.sql` | Atomic `reverse_transaction` RPC |
| `0008_m2_13_financial_audit.sql` | `financial_audit_events` table + immutability trigger |

### PWA Configuration

- Manifest: `public/manifest.webmanifest` — `standalone` display, theme `#FA855A`, lang `id`
- Icons: `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`
- iOS: `viewport-fit=cover`, `black-translucent` status bar, safe-area CSS classes
- Offline: No service worker — all operations require live Supabase connection

---

## 2. Architecture Summary

### Accounting Model

- **Ledger-authoritative**: Wallet and goal balances are derived from transaction sums via database triggers (`update_wallet_balance_on_tx`, `update_goal_balance_on_tx`).
- **Integer arithmetic**: All monetary values are integer Rupiah (IDR). No floating point.
- **Transaction types**: `income`, `expense`, `savings_contribution`, `savings_withdrawal`.
- **Reversals**: Handled by `reverse_transaction` RPC — creates a compensating adjustment, marks original as `cancelled`. Original records are never deleted or mutated.
- **Audit trail**: `financial_audit_events` is append-only (BEFORE UPDATE/DELETE trigger rejects mutations).

### Security Model

- **RLS everywhere**: All 8 financial tables enforce `auth.uid() = user_id`.
- **SECURITY DEFINER RPCs**: `execute_savings_withdrawal` and `reverse_transaction` run with fixed `search_path` and explicit privilege grants.
- **No service_role in client**: Only `NEXT_PUBLIC_SUPABASE_ANON_KEY` is exposed to the browser.
- **Middleware**: Supabase auth session refresh on every request.

### Application Routes

| Route | Purpose |
|---|---|
| `/` | Authenticated dashboard (wallets, goals, transactions, budgets, audit) |
| `/login` | Authentication |
| `/signup` | Registration |

---

## 3. Final Verification Results (M2.25)

### Build Pipeline

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** (0 errors) |
| `npm run lint` | **PASS** (0 errors, 0 warnings) |
| `npm run build` | **PASS** (Next.js 16.3.8, Turbopack) |
| `npm audit` | **PASS** (0 vulnerabilities) |

### Test Suite (29 test files)

All 29 test files in `tests/` executed via `node` — **100% pass rate**.

Includes M2.25-specific release assertions (`tests/m2_25_final_release.test.js`): **16 / 16 PASS**.

Covers: auth, profiles, wallets, transactions, budgets, interval budgets, savings goals, savings contributions, savings withdrawal (atomicity + RPC security), month rollover, monthly history, transaction reversal, financial audit, dashboard, financial export, transaction search, financial activity UX, financial consistency, financial reconciliation, security boundaries, performance, observability, backup/recovery, release readiness (M2.24 + M2.24 FIX), final release (M2.25).

### Live Supabase Smoke Verification

`supabase/tests/run_m2_24_release_smoke.js` — **10/10 PASS**:

1. Authentication & session — verified
2. Schema presence (8 tables) — verified
3. Income flow — verified
4. Expense flow — verified
5. Savings contribution flow — verified
6. Savings withdrawal (atomic RPC) — verified
7. Transaction reversals (baseline restoration) — verified
8. Independent ledger reconciliation (Delta = 0 across 114 transactions) — verified
9. Independent goal reconciliation (Delta = 0) — verified
10. Multi-user RLS isolation — verified

### Migration Synchronization

`npx supabase migration list` executed against remote project `tieeffpsshpnibuaxsaf` — all 8 migrations (0001–0008) confirmed synchronized local ↔ remote.

### Workspace Cleanliness

- **Git repository**: Not initialized. Git-level verification not applicable.
- **Temporary files** (`.log`, `.tmp`, `.bak`, `.swp`): None found.
- **Credential files** (`.pem`, `.key`): None found.
- **`service_role` in client source**: Not present (redaction pattern in `diagnostics.js` is a security control).
- **`.env.local`**: Protected by `.gitignore`.

---

## 4. Deployment Procedure

See `RELEASE_CHECKLIST.md` for the step-by-step operational checklist.

Summary:

1. Verify all 8 migrations are applied to remote Supabase (`npx supabase migration list`).
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in hosting provider.
3. Run `npm run build` — deploy the `.next` output to Vercel or equivalent.
4. Execute post-deployment accounting smoke test.

---

## 5. Known Limitations

- **Physical database restore (PITR)**: NOT VERIFIED in this repository environment. Must be coordinated via Supabase platform management. Do not claim this was tested.
- **Migration reconstruction**: Verified as sequentially consistent; isolated reconstruction not physically executed.
- **CSV export**: Read-only client report, not a database backup.
- **Offline writes**: Not supported. All financial mutations require a live Supabase connection.
- **`middleware.ts` deprecation warning**: Next.js 16 recommends migration to `proxy` convention. Non-blocking — current middleware functions correctly.

---

## 6. Milestone History

| Milestone | Description | Status |
|---|---|---|
| M2.1 | Auth & Profile | PASS |
| M2.2 | Wallet CRUD | PASS |
| M2.3 | Transaction CRUD | PASS |
| M2.4 | Budget Management | PASS |
| M2.5 | Savings Allocation | PASS |
| M2.6 | Savings Goals | PASS |
| M2.7 | Savings Contributions | PASS |
| M2.8 | Savings Withdrawal (+ Atomicity + RPC Security) | PASS |
| M2.9 | Month Transition & Rollover | PASS |
| M2.10 | Monthly History | PASS |
| M2.11 | Integration Flow | PASS |
| M2.12 | Transaction Reversal | PASS |
| M2.13 | Financial Audit Trail | PASS |
| M2.14 | Dashboard | PASS |
| M2.15 | Financial Export | PASS |
| M2.16 | Transaction Search | PASS |
| M2.17 | Financial Activity UX | PASS |
| M2.18 | Financial Consistency | PASS |
| M2.19 | Ledger Reconciliation | PASS |
| M2.20 | Security & Authorization Audit | PASS |
| M2.21 | Performance & Data-Volume Hardening | PASS |
| M2.22 | Observability & Diagnostics | PASS |
| M2.23 | Backup & Recovery Verification | PASS |
| M2.24 | Release Candidate Audit | PASS |
| **M2.25** | **Final Production Release** | **PASS** |
