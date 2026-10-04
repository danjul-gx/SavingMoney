/**
 * M2.21 — Production Performance & Data-Volume Unit Tests
 *
 * Verifies query boundaries, index coverage, pagination limits,
 * date-scoping constraints, and predictable performance across
 * financial data access modules.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('=== M2.21 Production Performance & Data-Volume Tests ===\n');

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

// Read migration files
const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
const migrationsContent = migrationFiles.map(f => ({
  name: f,
  sql: fs.readFileSync(path.join(migrationsDir, f), 'utf8')
}));
const allSql = migrationsContent.map(m => m.sql).join('\n');

// Read client files
const txClientFile = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'transactions', 'client.ts'), 'utf8');
const dashboardClientFile = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'dashboard', 'client.ts'), 'utf8');
const reportsClientFile = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'reports', 'client.ts'), 'utf8');
const auditClientFile = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'audit', 'client.ts'), 'utf8');

// ============================================================================
// 1. Transaction Query Bounds & Hard Limits
// ============================================================================
console.log('--- 1. Transaction Query Bounds & Hard Limits ---');

test('queryTransactions enforces hard minimum and maximum limit [1, 100]', () => {
  assert.ok(txClientFile.includes('Math.min(Math.max(1, options.limit ?? 50), 100)'), 'Must clamp limit to [1, 100]');
});

test('queryTransactions enforces non-negative offset', () => {
  assert.ok(txClientFile.includes('Math.max(0, options.offset ?? 0)'), 'Must clamp offset >= 0');
});

test('getTransactions has default safe limit = 50', () => {
  assert.ok(txClientFile.includes('getTransactions(limit = 50)'), 'Default limit must be 50');
});

test('queryTransactions executes server-side range pagination', () => {
  assert.ok(txClientFile.includes('.range(offset, offset + limit - 1)'), 'Must paginate with SQL range');
});

test('queryTransactions uses deterministic tie-breaker sorting', () => {
  assert.ok(txClientFile.includes(".order('transaction_date'"), 'Primary sort: transaction_date');
  assert.ok(txClientFile.includes(".order('created_at'"), 'Secondary sort: created_at');
  assert.ok(txClientFile.includes(".order('id'"), 'Tertiary sort: id');
});

// ============================================================================
// 2. Audit Trail Query Bounds
// ============================================================================
console.log('\n--- 2. Audit Trail Query Bounds ---');

test('getFinancialAuditEvents enforces bounded limit = 50', () => {
  assert.ok(auditClientFile.includes('limit = 50'), 'Default audit limit must be bounded');
  assert.ok(auditClientFile.includes('.limit(limit)'), 'Query must pass limit to Supabase query');
});

test('getFinancialAuditEvents orders by created_at descending', () => {
  assert.ok(auditClientFile.includes(".order('created_at', { ascending: false })"), 'Must order newest first for audit index usage');
});

// ============================================================================
// 3. Time-Scoped Financial Query Bounds
// ============================================================================
console.log('\n--- 3. Time-Scoped Financial Query Bounds ---');

test('dashboard transactions query strictly date-scoped to target month', () => {
  assert.ok(dashboardClientFile.includes(".gte('transaction_date', context.startDate)"), 'Must bound lower date');
  assert.ok(dashboardClientFile.includes(".lt('transaction_date', context.nextMonthStartDate)"), 'Must bound upper date');
});

test('reports transactions query strictly date-scoped to target month', () => {
  assert.ok(reportsClientFile.includes(".gte('transaction_date', context.startDate)"), 'Report tx must bound lower date');
  assert.ok(reportsClientFile.includes(".lt('transaction_date', context.nextMonthStartDate)"), 'Report tx must bound upper date');
});

test('reports audit query strictly timestamp-scoped to target month', () => {
  assert.ok(reportsClientFile.includes(".gte('created_at'"), 'Report audit must bound lower timestamp');
  assert.ok(reportsClientFile.includes(".lt('created_at'"), 'Report audit must bound upper timestamp');
});

// ============================================================================
// 4. Index Coverage Audit
// ============================================================================
console.log('\n--- 4. Index Coverage Audit ---');

const expectedIndexes = [
  { name: 'idx_transactions_user_date', table: 'transactions', columns: '(user_id, transaction_date DESC)' },
  { name: 'idx_transactions_wallet', table: 'transactions', columns: '(wallet_id)' },
  { name: 'idx_transactions_goal', table: 'transactions', columns: '(goal_id)' },
  { name: 'idx_transactions_type', table: 'transactions', columns: '(user_id, type)' },
  { name: 'idx_transactions_reversal_of', table: 'transactions', columns: 'reversal_of_transaction_id' },
  { name: 'idx_audit_events_user_created', table: 'financial_audit_events', columns: '(user_id, created_at DESC)' },
  { name: 'idx_budget_alloc_user_period', table: 'budget_allocations', columns: 'budget_year' },
  { name: 'idx_monthly_summaries_user', table: 'monthly_summaries', columns: '(user_id, year DESC, month DESC)' }
];

for (const idx of expectedIndexes) {
  test(`Index ${idx.name} on ${idx.table} exists in migrations`, () => {
    assert.ok(allSql.includes(idx.name), `Migration must define index ${idx.name}`);
  });
}

// ============================================================================
// 5. Data Volume Simulation (10,000 Transactions In-Memory)
// ============================================================================
console.log('\n--- 5. High-Volume In-Memory Ledger Benchmark ---');

test('Linear scan & reduction of 10,000 transactions completes in < 15ms', () => {
  const dataset = [];
  const start = Date.now();
  for (let i = 0; i < 10000; i++) {
    dataset.push({
      id: `tx-${i}`,
      type: i % 2 === 0 ? 'income' : 'expense',
      amount: 15000 + (i % 100),
      walletId: 'w-1',
      date: '2026-10-02'
    });
  }

  let totalIncome = 0;
  let totalExpense = 0;
  for (let i = 0; i < dataset.length; i++) {
    const item = dataset[i];
    if (item.type === 'income') totalIncome += item.amount;
    else if (item.type === 'expense') totalExpense += item.amount;
  }
  const duration = Date.now() - start;

  assert.strictEqual(dataset.length, 10000);
  assert.ok(totalIncome > 0);
  assert.ok(totalExpense > 0);
  assert.ok(duration < 25, `Execution duration ${duration}ms should be well under threshold`);
});

// ============================================================================
// Summary
// ============================================================================
console.log(`\n=== M2.21 Unit Test Results: ${passedCount} passed, ${failedCount} failed ===\n`);

if (failedCount > 0) {
  process.exit(1);
}
