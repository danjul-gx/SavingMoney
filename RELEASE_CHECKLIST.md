# Production Deployment Checklist (Release Candidate M2.24)

This checklist provides a reproducible, step-by-step operational guide for deploying the Savings & Cashflow Tracker to production.

---

## 1. Pre-Deployment Verification

- [ ] **Clean Git Workspace**: Ensure all changes are committed and working tree is clean.
- [ ] **Dependency Audit Reviewed**: Verify packages in `package.json` are pinned and audited.
- [ ] **No Secret Leaks**: Verify `.env.local` is never committed (protected by `.gitignore`).
- [ ] **No Service Role Keys**: Verify `service_role` credentials are not present in client code or browser bundles.

---

## 2. Environment Configuration

Set the following environment variables in the production hosting provider (e.g. Vercel, Supabase):

| Variable | Description | Exposure |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project HTTPS URL (`https://<project-ref>.supabase.co`) | Client & Server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable anonymous API key (`sb_publishable_...`) | Client & Server |

> **Critical**: Do NOT add `SUPABASE_SERVICE_ROLE_KEY` to client environment variables.

---

## 3. Database Migration Deployment

Verify that all migrations `0001` through `0008` in `supabase/migrations/` are applied to the remote Supabase database:

```bash
npx supabase migration list
```

Ensure output confirms `local` and `remote` are synchronized:
- `0001_initial_schema.sql`
- `0002_accounting_hardening.sql`
- `0003_m1_1_accounting_fixes.sql`
- `0004_m2_8_1_savings_withdrawal_atomicity.sql`
- `0005_m2_4_2_budget_interval_days.sql`
- `0006_m2_1_3_2_tx_update_delta_fix.sql`
- `0007_m2_12_transaction_reversal.sql`
- `0008_m2_13_financial_audit.sql`

---

## 4. Build & PWA Verification

Run the build pipeline:
```bash
npx tsc --noEmit
npm run lint
npm run build
```

Verify PWA assets:
- `public/manifest.webmanifest` exists with `standalone` display and theme color `#FA855A`.
- `public/icons/icon-192.png`, `public/icons/icon-512.png`, and `apple-touch-icon.png` exist and are accessible.
- Safe-area inset CSS classes (`pb-safe`, `pt-safe`, `viewport-fit=cover`) are present in root layout.

---

## 5. Security & RLS Verification

Run the automated live verification script:
```bash
node supabase/tests/run_m2_24_release_smoke.js
```
Confirms:
- RLS enabled on all 8 tables (`profiles`, `wallets`, `transactions`, `goals`, `savings_withdrawals`, `budget_allocations`, `monthly_summaries`, `financial_audit_events`).
- Cross-user data isolation strictly active (User A cannot read User B records).
- Append-only immutability enforced on `financial_audit_events`.
- Transaction immutability trigger prevents retroactive tampering with settled ledger lines.

---

## 6. Post-Deployment Accounting Smoke Test

Perform a manual or automated smoke test on the deployed instance:
1. Log in with a verified user account.
2. Verify dashboard loads wallet balances and active goals.
3. Record an Income transaction -> verify wallet balance increments by exact amount.
4. Record an Expense transaction -> verify wallet balance decrements by exact amount.
5. Create a Savings Contribution -> verify wallet decrements and goal balance increments.
6. Execute a Savings Withdrawal -> verify goal decrements, wallet increments, and withdrawal reason is recorded.
7. Execute a Transaction Reversal -> verify compensating adjustment is created and original transaction is marked cancelled.
8. Verify independent ledger balance matches stored wallet balance (`Delta = 0`).

---

## 7. Rollback Considerations

- **Code Rollback**: If a frontend bug is detected, redeploy the previous Git commit. All database schema migrations (`0001`–`0008`) are backward-compatible with older frontend versions.
- **Database Rollback**: Migrations must NOT be rolled back destructively in production. If a database issue occurs, write an additive forward migration.

---

## 8. Dependency Security & Advisory Assessment

- **Next.js Version**: Patched and pinned to `^16.3.8` (resolves to `16.3.8` in `package-lock.json`).
- **GHSA-vcvr-r3jv-pc5j**: Resolved. `npm audit` reports `found 0 vulnerabilities`.
- **Reachability Assessment**: The codebase does not import or invoke `next/og` or `ImageResponse`. No dynamic Open Graph image endpoints exist. Upgraded to `16.3.8` cleanly with zero build or runtime regressions.

---

## 9. Known Recovery Limitations (from M2.23)

- **Physical Database Restore**: Unverified in this repository environment. Physical snapshot restores or point-in-time recovery (PITR) must be coordinated via Supabase platform management.
- **CSV Export vs Database Backup**: The in-app CSV export is a read-only client report and does not function as a database backup.
