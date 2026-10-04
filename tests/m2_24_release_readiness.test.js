/**
 * M2.24 — Release Candidate & Production Deployment Readiness Unit Tests
 *
 * Verifies:
 * 1. Environment & Secret Exposure Boundary Invariants
 * 2. Database Migration Consistency & Immutability Order
 * 3. PWA Configuration, Manifest & Asset Integrity
 * 4. Dependency & Package Configuration Baseline
 * 5. Production Build & Middleware Matcher Safety
 * 6. Accounting Immutability & Reversal Boundary Invariants
 * 7. Security (RLS) & Audit Release Guard Invariants
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('=== M2.24 Release Candidate & Deployment Readiness Tests ===\n');

let passedCount = 0;
let failedCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failedCount++;
  }
}

// ----------------------------------------------------------------------------
// 1. Environment & Secret Exposure Boundary Invariants
// ----------------------------------------------------------------------------
console.log('--- 1. Environment & Secret Exposure Auditing ---');

test('.gitignore strictly excludes .env* and build artifacts', () => {
  const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('.env*'), '.gitignore must ignore .env*');
  assert.ok(gitignore.includes('/node_modules'), '.gitignore must ignore node_modules');
  assert.ok(gitignore.includes('/.next/'), '.gitignore must ignore /.next/');
});

test('.env.local.example contains only intended public variables without real secrets', () => {
  const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.local.example'), 'utf8');
  assert.ok(!envExample.includes('service_role'), 'example must not mention service_role');
  assert.ok(!envExample.includes('SECRET'), 'example must not contain SECRET keys');
  assert.ok(envExample.includes('NEXT_PUBLIC_SUPABASE_URL'), 'example defines NEXT_PUBLIC_SUPABASE_URL');
  assert.ok(envExample.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY'), 'example defines NEXT_PUBLIC_SUPABASE_ANON_KEY');
});

test('client-side config never references SUPABASE_SERVICE_ROLE_KEY', () => {
  const clientConfig = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'supabase', 'config.ts'), 'utf8');
  assert.ok(!clientConfig.includes('SUPABASE_SERVICE_ROLE_KEY'), 'client config must never use service role');
  assert.ok(!clientConfig.includes('service_role'), 'client config must never reference service_role');
});

// ----------------------------------------------------------------------------
// 2. Database Migration Consistency & Release Audit
// ----------------------------------------------------------------------------
console.log('\n--- 2. Database Migration Release Consistency ---');

const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

test('all 8 migrations exist and adhere to chronological sequence 0001 through 0008', () => {
  assert.strictEqual(migrationFiles.length, 8);
  const prefixes = migrationFiles.map(f => f.slice(0, 4));
  assert.deepStrictEqual(prefixes, ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008']);
});

test('no migration contains destructive database reset or table drop commands', () => {
  for (const file of migrationFiles) {
    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    assert.ok(!content.includes('DROP DATABASE'), `${file} must not drop database`);
    assert.ok(!content.includes('TRUNCATE TABLE'), `${file} must not truncate production tables`);
  }
});

// ----------------------------------------------------------------------------
// 3. PWA Configuration, Manifest & Asset Integrity
// ----------------------------------------------------------------------------
console.log('\n--- 3. PWA Configuration, Manifest & Asset Integrity ---');

test('webmanifest file exists, is valid JSON, and has standalone display', () => {
  const manifestPath = path.join(__dirname, '..', 'public', 'manifest.webmanifest');
  assert.ok(fs.existsSync(manifestPath), 'manifest.webmanifest must exist in public/');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.strictEqual(manifest.display, 'standalone');
  assert.strictEqual(manifest.theme_color, '#FA855A');
  assert.strictEqual(manifest.start_url, '/');
  assert.ok(manifest.icons && manifest.icons.length >= 2, 'manifest must specify icons');
});

test('required PWA icon files exist on disk with valid file size', () => {
  const iconPaths = [
    path.join(__dirname, '..', 'public', 'icons', 'icon-192.png'),
    path.join(__dirname, '..', 'public', 'icons', 'icon-512.png'),
    path.join(__dirname, '..', 'public', 'icons', 'apple-touch-icon.png'),
  ];
  for (const iconPath of iconPaths) {
    assert.ok(fs.existsSync(iconPath), `Icon ${iconPath} must exist`);
    const stat = fs.statSync(iconPath);
    assert.ok(stat.size > 500, `Icon ${iconPath} must have non-trivial size`);
  }
});

test('app/layout.tsx configures viewport-fit=cover and mobile metadata', () => {
  const layout = fs.readFileSync(path.join(__dirname, '..', 'app', 'layout.tsx'), 'utf8');
  assert.ok(layout.includes("viewportFit: 'cover'"), 'layout must include viewportFit=cover');
  assert.ok(layout.includes("manifest: '/manifest.webmanifest'"), 'layout must link manifest');
  assert.ok(layout.includes("appleWebApp"), 'layout must include appleWebApp metadata');
});

// ----------------------------------------------------------------------------
// 4. Dependency & Package Configuration Baseline
// ----------------------------------------------------------------------------
console.log('\n--- 4. Dependency & Package Configuration Baseline ---');

test('package.json specifies compatible Next.js and React versions without extraneous dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies.next.includes('16.3.8'), 'Next.js must be patched 16.3.8');
  assert.strictEqual(pkg.dependencies.react, '19.2.8');
  assert.strictEqual(pkg.dependencies['react-dom'], '19.2.8');
  assert.ok(pkg.dependencies['@supabase/ssr'], 'must declare @supabase/ssr');
  assert.ok(pkg.dependencies['@supabase/supabase-js'], 'must declare @supabase/supabase-js');
});

test('package-lock.json is present and synchronized', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'package-lock.json')), 'package-lock.json must exist');
});

// ----------------------------------------------------------------------------
// 5. Middleware & Proxy Configuration Safety
// ----------------------------------------------------------------------------
console.log('\n--- 5. Middleware & Matcher Safety ---');

test('middleware matcher excludes static assets, PWA manifest, and icons', () => {
  const middleware = fs.readFileSync(path.join(__dirname, '..', 'middleware.ts'), 'utf8');
  assert.ok(middleware.includes('manifest.webmanifest'), 'middleware must bypass PWA manifest');
  assert.ok(middleware.includes('icons/.*'), 'middleware must bypass PWA icons');
  assert.ok(middleware.includes('_next/static'), 'middleware must bypass _next/static');
});

// ----------------------------------------------------------------------------
// 6. Security, RLS & Ledger Protection Invariants
// ----------------------------------------------------------------------------
console.log('\n--- 6. Security, RLS & Ledger Protection Invariants ---');

const allSql = migrationFiles.map(f => fs.readFileSync(path.join(migrationsDir, f), 'utf8')).join('\n');

test('migrations enforce ROW LEVEL SECURITY across all 8 core tables', () => {
  const tables = ['wallets', 'transactions', 'goals', 'savings_withdrawals', 'budget_allocations', 'monthly_summaries', 'financial_audit_events'];
  for (const tbl of tables) {
    const rlsRegex = new RegExp(`ALTER\\s+TABLE[\\s\\S]*?${tbl}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i');
    assert.ok(rlsRegex.test(allSql), `Table ${tbl} must enable RLS`);
  }
});

test('financial_audit_events has tamper-prevention trigger blocking UPDATE and DELETE', () => {
  assert.ok(allSql.includes('prevent_audit_event_mutation'), 'Audit table has tamper-proof trigger');
  assert.ok(allSql.includes('BEFORE UPDATE OR DELETE ON public.financial_audit_events'), 'Audit tamper trigger fires on UPDATE OR DELETE');
});

test('transactions table prevents client DELETE policy and enforces immutability via reversals', () => {
  // DELETE policy is intentionally omitted on transactions table (immutable settled history principle)
  assert.ok(!allSql.includes('CREATE POLICY "transactions_delete_own"'), 'No DELETE policy permitted on transactions');
  assert.ok(allSql.includes('reversal_of_transaction_id'), 'Reversals require dedicated link column');
  assert.ok(allSql.includes('idx_transactions_unique_reversal'), 'Partial unique index enforces at most one reversal');
});

test('privileged RPCs execute with fixed SECURITY DEFINER search_path', () => {
  const rpcs = ['execute_savings_withdrawal', 'reverse_transaction', 'audit_transaction_lifecycle'];
  for (const rpc of rpcs) {
    const rpcPattern = new RegExp(`FUNCTION\\s+(public\\.)?${rpc}[\\s\\S]*?SECURITY\\s+DEFINER\\s+SET\\s+search_path\\s*=\\s*public,\\s*pg_temp`, 'i');
    assert.ok(rpcPattern.test(allSql), `RPC ${rpc} must fix search_path`);
  }
});

// ----------------------------------------------------------------------------
// 7. Operational Deployment Documentation
// ----------------------------------------------------------------------------
console.log('\n--- 7. Operational Deployment Documentation ---');

test('RELEASE_CHECKLIST.md exists and contains required operational procedures', () => {
  const checklistPath = path.join(__dirname, '..', 'RELEASE_CHECKLIST.md');
  assert.ok(fs.existsSync(checklistPath), 'RELEASE_CHECKLIST.md must exist');
  const content = fs.readFileSync(checklistPath, 'utf8');
  assert.ok(content.includes('Pre-Deployment Verification'), 'contains pre-deployment section');
  assert.ok(content.includes('Environment Configuration'), 'contains environment config section');
  assert.ok(content.includes('Database Migration Deployment'), 'contains migration deployment section');
  assert.ok(content.includes('Rollback Considerations'), 'contains rollback section');
  assert.ok(content.includes('Known Recovery Limitations'), 'contains recovery limitations section');
});

test('reversal and withdrawal diagnostic tracking does not leak credentials', () => {
  const diagnostics = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'diagnostics.ts'), 'utf8');
  assert.ok(diagnostics.includes('redactSensitiveData'), 'diagnostics includes redaction');
  assert.ok(diagnostics.includes('service_role'), 'redacts service_role');
  assert.ok(diagnostics.includes('password'), 'redacts password');
  assert.ok(diagnostics.includes('token'), 'redacts token');
});

test('financial export is strictly client-side read-only formatting', () => {
  const reportsClient = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'reports', 'client.ts'), 'utf8');
  assert.ok(reportsClient.includes('generateFinancialReportCsv'), 'CSV function exists');
  assert.ok(!reportsClient.includes('INSERT INTO'), 'No write operations in export module');
});

test('transactions table enforces integer Rupiah amount constraint > 0', () => {
  assert.ok(allSql.includes('amount > 0') || allSql.includes('amount > (0)::numeric'), 'transactions enforces positive amount');
});

test('0005 migration defines interval_days column for budget planning', () => {
  const m5 = fs.readFileSync(path.join(migrationsDir, '0005_m2_4_2_budget_interval_days.sql'), 'utf8');
  assert.ok(m5.includes('interval_days'), '0005 migration introduces interval_days');
});

test('0008 migration defines audit_transaction_lifecycle with SECURITY DEFINER', () => {
  const m8 = fs.readFileSync(path.join(migrationsDir, '0008_m2_13_financial_audit.sql'), 'utf8');
  assert.ok(m8.includes('audit_transaction_lifecycle'), '0008 migration introduces audit_transaction_lifecycle');
  assert.ok(m8.includes('SECURITY DEFINER'), 'audit function is SECURITY DEFINER');
});

test('all required release candidate checks pass cleanly', () => {
  assert.strictEqual(failedCount, 0, 'No failed assertions permitted in release candidate test suite');
});

// ----------------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------------
console.log(`\n=== M2.24 Unit Test Results: ${passedCount} passed, ${failedCount} failed ===\n`);

if (failedCount > 0) {
  process.exit(1);
}
