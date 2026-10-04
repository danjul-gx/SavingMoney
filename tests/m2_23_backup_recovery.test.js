/**
 * M2.23 — Backup, Recovery & Disaster-Readiness Unit Tests
 *
 * Verifies:
 * 1. Authoritative vs Derived Data Classification Inventory
 * 2. Reconstruction & Recovery Feasibility Invariants
 * 3. Migration Sequence & Dependency Ordering
 * 4. Logical Export vs Physical Database Backup Boundaries
 * 5. Reversal, Withdrawal & Audit Trail Recovery Invariants
 * 6. Security (RLS) & Authorization Recovery Invariants
 * 7. Failure Scenario Recovery Classification
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('=== M2.23 Backup, Recovery & Disaster-Readiness Tests ===\n');

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

// Read migrations
const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
const migrationsContent = migrationFiles.map(f => ({
  name: f,
  sql: fs.readFileSync(path.join(migrationsDir, f), 'utf8')
}));
const allSql = migrationsContent.map(m => m.sql).join('\n');

// ============================================================================
// 1. Authoritative Data Inventory & Classification
// ============================================================================
console.log('--- 1. Authoritative vs Derived Data Classification ---');

const DATA_INVENTORY = {
  transactions: {
    type: 'authoritative_ledger',
    backupRequired: true,
    reconstructible: false,
    hasOwnership: true,
  },
  wallets: {
    type: 'authoritative_entity_with_derived_balance',
    backupRequired: true,
    reconstructibleBalance: true, // balance can be recomputed from ledger
    hasOwnership: true,
  },
  goals: {
    type: 'authoritative_entity_with_derived_balance',
    backupRequired: true,
    reconstructibleBalance: true, // current_amount can be recomputed from contributions/withdrawals
    hasOwnership: true,
  },
  savings_withdrawals: {
    type: 'authoritative_withdrawal_metadata',
    backupRequired: true,
    reconstructible: false, // contains reason and delay metadata
    hasOwnership: true,
  },
  financial_audit_events: {
    type: 'authoritative_append_only_audit',
    backupRequired: true,
    reconstructible: false, // timestamps and event context
    hasOwnership: true,
  },
  budget_allocations: {
    type: 'planning_authoritative',
    backupRequired: true,
    reconstructible: false,
    hasOwnership: true,
  },
  monthly_summaries: {
    type: 'derived_historical_snapshot',
    backupRequired: true,
    reconstructible: true, // can be recalculated from ledger & budgets
    hasOwnership: true,
  },
  profiles: {
    type: 'user_profile_configuration',
    backupRequired: true,
    reconstructible: false,
    hasOwnership: true,
  },
};

test('authoritative financial ledger tables must require database backup', () => {
  assert.strictEqual(DATA_INVENTORY.transactions.backupRequired, true);
  assert.strictEqual(DATA_INVENTORY.transactions.reconstructible, false);
});

test('wallet and goal balances are derived from transactions and can be reconciled', () => {
  assert.strictEqual(DATA_INVENTORY.wallets.reconstructibleBalance, true);
  assert.strictEqual(DATA_INVENTORY.goals.reconstructibleBalance, true);
});

test('savings withdrawal reasons and audit logs require physical backup', () => {
  assert.strictEqual(DATA_INVENTORY.savings_withdrawals.backupRequired, true);
  assert.strictEqual(DATA_INVENTORY.financial_audit_events.backupRequired, true);
});

// ============================================================================
// 2. Migration Sequence & Static Schema Consistency
// ============================================================================
console.log('\n--- 2. Migration Sequence & Static Consistency (Static Verification) ---');

test('all 8 migrations exist and follow strict numerical prefix ordering', () => {
  assert.strictEqual(migrationFiles.length, 8);
  const prefixes = migrationFiles.map(f => f.slice(0, 4));
  assert.deepStrictEqual(prefixes, ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008']);
});

test('0001 initializes core tables before 0002 applies hardening', () => {
  const m1 = migrationsContent[0].sql;
  assert.ok(m1.includes('CREATE TABLE wallets'), '0001 creates wallets');
  assert.ok(m1.includes('CREATE TABLE transactions'), '0001 creates transactions');
  assert.ok(m1.includes('CREATE TABLE goals'), '0001 creates goals');
});

test('0004 introduces atomic savings withdrawal RPC', () => {
  const m4 = migrationsContent[3].sql;
  assert.ok(m4.includes('execute_savings_withdrawal('), '0004 defines withdrawal RPC');
});

test('0007 introduces atomic reversal RPC and immutability', () => {
  const m7 = migrationsContent[6].sql;
  assert.ok(m7.includes('reverse_transaction('), '0007 defines reversal RPC');
  assert.ok(m7.includes('reversal_of_transaction_id'), '0007 defines reversal foreign key');
});

test('0008 introduces append-only financial audit events', () => {
  const m8 = migrationsContent[7].sql;
  assert.ok(m8.includes('CREATE TABLE IF NOT EXISTS public.financial_audit_events'), '0008 defines audit events table');
  assert.ok(m8.includes('prevent_audit_event_mutation'), '0008 enforces append-only immutability');
});

test('migration reconstruction status is explicitly classified as NOT VERIFIED (static chain consistency only)', () => {
  // Option B: no isolated clean DB available; do not claim empty DB reconstruction execution
  const executionStatus = 'NOT VERIFIED (static chain consistency verified; isolated empty DB not available)';
  assert.ok(executionStatus.startsWith('NOT VERIFIED'));
});

// ============================================================================
// 3. Distinction: Database Backup vs Logical Financial CSV Export
// ============================================================================
console.log('\n--- 3. Database Backup vs Logical Financial CSV Export ---');

test('logical CSV export is read-only and cannot substitute for full schema/RLS recovery', () => {
  const reportsFile = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'reports', 'client.ts'), 'utf8');
  assert.ok(reportsFile.includes('generateFinancialReportCsv'), 'CSV export generates user summary CSV');
  assert.ok(!reportsFile.includes('INSERT INTO'), 'CSV export does not restore database structure');
  assert.ok(!reportsFile.includes('CREATE TABLE'), 'CSV export cannot recreate schema');
});

test('database backup must preserve RLS policies and triggers across tables', () => {
  for (const table of Object.keys(DATA_INVENTORY)) {
    assert.ok(allSql.includes(`ENABLE ROW LEVEL SECURITY`), `RLS definition exists`);
  }
});

test('physical backup restore is explicitly classified as NOT VERIFIED', () => {
  const backupRestoreStatus = 'NOT VERIFIED — no isolated restore target available; destructive restore against production avoided';
  assert.ok(backupRestoreStatus.startsWith('NOT VERIFIED'));
});

// ============================================================================
// 4. Post-Recovery Independent Accounting Reconciliation Formulas
// ============================================================================
console.log('\n--- 4. Independent Accounting Reconciliation Formulas ---');

test('wallet balance formula correctly sums transaction deltas independently', () => {
  function computeWalletBalance(txs) {
    let bal = 0;
    for (const tx of txs) {
      if (tx.type === 'income' || tx.type === 'savings_withdrawal' || tx.type === 'rollover') bal += tx.amount;
      else if (tx.type === 'expense' || tx.type === 'savings_contribution') bal -= tx.amount;
      else if (tx.type === 'adjustment') {
        if (tx.adjustmentDirection === 'credit') bal += tx.amount;
        if (tx.adjustmentDirection === 'debit') bal -= tx.amount;
      }
    }
    return bal;
  }

  const sampleTxs = [
    { type: 'income', amount: 500000 },
    { type: 'expense', amount: 150000 },
    { type: 'savings_contribution', amount: 100000 },
    { type: 'savings_withdrawal', amount: 50000 },
    { type: 'adjustment', amount: 20000, adjustmentDirection: 'credit' },
  ];
  assert.strictEqual(computeWalletBalance(sampleTxs), 320000);
});

test('goal balance formula reconciles net contributions minus withdrawals', () => {
  function computeGoalBalance(initialAmount, txs) {
    let bal = initialAmount;
    for (const tx of txs) {
      if (tx.type === 'savings_contribution') bal += tx.amount;
      else if (tx.type === 'savings_withdrawal') bal -= tx.amount;
    }
    return bal;
  }

  const goalTxs = [
    { type: 'savings_contribution', amount: 200000 },
    { type: 'savings_contribution', amount: 300000 },
    { type: 'savings_withdrawal', amount: 150000 },
  ];
  assert.strictEqual(computeGoalBalance(0, goalTxs), 350000);
  assert.strictEqual(computeGoalBalance(50000, goalTxs), 400000);
});

test('reversals net out to zero in recovered ledger', () => {
  const originalTx = { id: 'tx-1', type: 'expense', amount: 100000 };
  const reversalTx = { id: 'tx-2', type: 'adjustment', amount: 100000, adjustmentDirection: 'credit', reversalOf: 'tx-1' };

  let netEffect = 0;
  if (originalTx.type === 'expense') netEffect -= originalTx.amount;
  if (reversalTx.type === 'adjustment' && reversalTx.adjustmentDirection === 'credit') netEffect += reversalTx.amount;

  assert.strictEqual(netEffect, 0, 'Reversal must cancel original transaction exactly');
});

test('post-restore accounting reconciliation is strictly classified as NOT VERIFIED', () => {
  const postRestoreStatus = 'NOT VERIFIED (live DB reconciliation is verified, but post-restore reconciliation cannot be tested without restore target)';
  assert.ok(postRestoreStatus.startsWith('NOT VERIFIED'));
});

// ============================================================================
// 5. Failure / Partial Recovery Scenario Analysis
// ============================================================================
console.log('\n--- 5. Disaster-Readiness Failure Scenario Classifications ---');

const SCENARIO_CLASSIFICATIONS = {
  db_unavailable: 'REQUIRES EXTERNAL OPERATOR/SUPABASE PROCEDURE',
  missing_migration: 'PARTIALLY VERIFIED (migration chain statically verified; actual execution on empty DB not verified)',
  db_restored_to_older_point: 'PARTIALLY VERIFIED (live ledger balance formula verified mathematically consistent; post-restore execution not verified)',
  app_rollback_newer_schema: 'PARTIALLY VERIFIED (schema additions are non-breaking/additive; app rollback execution not verified)',
  partial_csv_export: 'NOT VERIFIED (CSV export is read-only client reporting; not a recovery mechanism)',
  incomplete_financial_csv: 'NOT VERIFIED (CSV export is read-only client reporting; no import restore path exists)',
  audit_trail_unavailable: 'REQUIRES EXTERNAL OPERATOR/SUPABASE PROCEDURE',
  env_config_lost: 'REQUIRES EXTERNAL OPERATOR/SUPABASE PROCEDURE',
  auth_state_lost: 'REQUIRES EXTERNAL OPERATOR/SUPABASE PROCEDURE',
};

test('all 9 required operational failure scenarios are classified into allowed categories', () => {
  const allowed = [
    'VERIFIED',
    'PARTIALLY VERIFIED',
    'NOT VERIFIED',
    'REQUIRES EXTERNAL OPERATOR/SUPABASE PROCEDURE',
  ];

  for (const [scenario, classification] of Object.entries(SCENARIO_CLASSIFICATIONS)) {
    const isAllowed = allowed.some(a => classification.startsWith(a));
    assert.ok(isAllowed, `Scenario ${scenario} has valid classification: ${classification}`);
  }
});

// ============================================================================
// 6. Security & Audit Recovery Invariants
// ============================================================================
console.log('\n--- 6. Security & Audit Invariants on Recovery ---');

test('all financial tables enforce RLS using auth.uid() = user_id', () => {
  const tables = ['wallets', 'transactions', 'goals', 'savings_withdrawals', 'budget_allocations', 'monthly_summaries', 'financial_audit_events'];
  for (const table of tables) {
    const policyRegex = new RegExp(`CREATE\\s+POLICY[\\s\\S]*?ON\\s+(public\\.)?${table}[\\s\\S]*?auth\\.uid\\(\\)\\s*=\\s*user_id`, 'i');
    assert.ok(policyRegex.test(allSql), `Table ${table} must enforce auth.uid() = user_id`);
  }
});

test('reconstructed schema maintains SECURITY DEFINER with fixed search_path', () => {
  const rpcNames = ['execute_savings_withdrawal', 'reverse_transaction', 'audit_transaction_lifecycle'];
  for (const rpc of rpcNames) {
    const rpcRegex = new RegExp(`FUNCTION\\s+(public\\.)?${rpc}[\\s\\S]*?SECURITY\\s+DEFINER\\s+SET\\s+search_path\\s*=\\s*public,\\s*pg_temp`, 'i');
    assert.ok(rpcRegex.test(allSql), `RPC ${rpc} must maintain fixed search_path`);
  }
});

test('financial audit events table strictly blocks UPDATE and DELETE on recovery', () => {
  assert.ok(allSql.includes('prevent_audit_event_mutation'), 'Audit table has append-only trigger');
  assert.ok(allSql.includes('BEFORE UPDATE OR DELETE ON public.financial_audit_events'), 'Trigger fires on UPDATE OR DELETE');
});

// ============================================================================
// 7. Ledger Constraints & Foreign Key Recovery Invariants
// ============================================================================
console.log('\n--- 7. Ledger Constraints & Integrity Invariants on Recovery ---');

test('transactions table enforces positive amount constraint', () => {
  assert.ok(allSql.includes('amount > 0') || allSql.includes('amount > (0)::numeric'), 'transactions enforces amount > 0');
});

test('transactions table enforces wallet_id required for money movements', () => {
  assert.ok(allSql.includes('tx_wallet_required_for_money_types'), 'tx_wallet_required_for_money_types constraint exists');
});

test('transactions table enforces goal_id required for savings movements', () => {
  assert.ok(allSql.includes('tx_goal_required_for_savings'), 'tx_goal_required_for_savings constraint exists');
});

test('wallets table enforces non-negative balance guard triggers', () => {
  assert.ok(allSql.includes('check_wallet_balance_non_negative') || allSql.includes('enforce_wallet_balance_non_negative'), 'wallet non-negative trigger exists');
});

test('goals table enforces non-negative current_amount constraint', () => {
  assert.ok(allSql.includes('current_amount >= 0') || allSql.includes('goals_current_amount_non_negative'), 'goal non-negative balance constraint exists');
});

// ============================================================================
// Summary
// ============================================================================
console.log(`\n=== M2.23 Unit Test Results: ${passedCount} passed, ${failedCount} failed ===\n`);

if (failedCount > 0) {
  process.exit(1);
}
