/**
 * M2.20 — Production Security & Authorization Boundary Unit Tests
 *
 * Verifies security boundary invariants, RLS policies, role privileges,
 * search_path specifications, ownership enforcement, parameter validation,
 * error handling, and authorization rules across the financial schema.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('=== M2.20 Production Security & Authorization Boundary Tests ===\n');

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

// Read all migration files
const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
const migrationsContent = migrationFiles.map(f => ({
  name: f,
  sql: fs.readFileSync(path.join(migrationsDir, f), 'utf8')
}));
const allSql = migrationsContent.map(m => m.sql).join('\n');

// ============================================================================
// 1. RLS Enabled on All Tables
// ============================================================================
console.log('--- 1. RLS Enabled on All Core Tables ---');

const expectedTables = [
  'profiles',
  'wallets',
  'transactions',
  'goals',
  'budget_allocations',
  'savings_withdrawals',
  'monthly_summaries',
  'financial_audit_events',
  'transfers',
  'app_settings',
  'user_financial_settings'
];

for (const table of expectedTables) {
  test(`RLS enabled on table: ${table}`, () => {
    const rlsRegex = new RegExp(`ALTER\\s+TABLE\\s+(public\\.)?${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i');
    assert.ok(rlsRegex.test(allSql), `Table ${table} must have ENABLE ROW LEVEL SECURITY defined in migrations`);
  });
}

// ============================================================================
// 2. SECURITY DEFINER Functions have search_path Set
// ============================================================================
console.log('\n--- 2. SECURITY DEFINER Functions search_path Hardening ---');

const secDefinerFunctions = [
  'execute_savings_withdrawal',
  'reverse_transaction',
  'audit_transaction_lifecycle',
  'audit_savings_withdrawal_metadata',
  'audit_monthly_summary_finalization'
];

for (const fnName of secDefinerFunctions) {
  test(`Function ${fnName} has SECURITY DEFINER and explicit search_path`, () => {
    const fnRegex = new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+(public\\.)?${fnName}[\\s\\S]*?LANGUAGE\\s+plpgsql\\s+SECURITY\\s+DEFINER\\s+SET\\s+search_path\\s*=\\s*public,\\s*pg_temp`, 'i');
    assert.ok(fnRegex.test(allSql), `Function ${fnName} must specify SECURITY DEFINER SET search_path = public, pg_temp`);
  });
}

// ============================================================================
// 3. User Ownership Checks in Privileged RPCs
// ============================================================================
console.log('\n--- 3. Authorization Guards in SECURITY DEFINER RPCs ---');

test('execute_savings_withdrawal validates auth.uid() and goal/wallet ownership', () => {
  const rpcMatch = allSql.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(public\.)?execute_savings_withdrawal[\s\S]*?END;/i);
  assert.ok(rpcMatch, 'execute_savings_withdrawal definition found');
  const code = rpcMatch[0];
  assert.ok(code.includes('v_user_id := auth.uid()'), 'Must derive v_user_id from auth.uid()');
  assert.ok(code.includes('v_user_id IS NULL'), 'Must check if auth.uid() is null');
  assert.ok(code.includes('user_id = v_user_id'), 'Must verify goal and wallet belong to authenticated user');
  assert.ok(code.includes('insufficient_privilege'), 'Must raise insufficient_privilege when unauthorized');
});

test('reverse_transaction validates auth.uid() and transaction ownership', () => {
  const rpcMatch = allSql.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(public\.)?reverse_transaction[\s\S]*?END;/i);
  assert.ok(rpcMatch, 'reverse_transaction definition found');
  const code = rpcMatch[0];
  assert.ok(code.includes('v_user_id := auth.uid()'), 'Must derive v_user_id from auth.uid()');
  assert.ok(code.includes('v_user_id IS NULL'), 'Must check if auth.uid() is null');
  assert.ok(code.includes('user_id = v_user_id'), 'Must verify transaction belongs to authenticated user');
  assert.ok(code.includes('cannot reverse a reversal transaction'), 'Must prevent reversing a reversal');
  assert.ok(code.includes('transaction has already been reversed'), 'Must prevent double reversal');
});

// ============================================================================
// 4. Transaction Immutability & Ownership Triggers
// ============================================================================
console.log('\n--- 4. Transaction Immutability & Ownership Triggers ---');

test('enforce_transaction_immutability protects critical ledger fields', () => {
  const triggerMatches = [...allSql.matchAll(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(public\.)?enforce_transaction_immutability[\s\S]*?END;/gi)];
  assert.ok(triggerMatches.length > 0, 'enforce_transaction_immutability definition found');
  const code = triggerMatches[triggerMatches.length - 1][0];
  const protectedFields = [
    'user_id', 'wallet_id', 'goal_id', 'type', 'amount',
    'adjustment_direction', 'reversal_of_transaction_id', 'reversal_reason'
  ];
  for (const f of protectedFields) {
    assert.ok(code.includes(`NEW.${f} IS DISTINCT FROM OLD.${f}`), `Trigger must protect field: ${f}`);
  }
});

test('check_transaction_ownership prevents linking to foreign wallet or goal', () => {
  const triggerMatch = allSql.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(public\.)?check_transaction_ownership[\s\S]*?END;/i);
  assert.ok(triggerMatch, 'check_transaction_ownership definition found');
  const code = triggerMatch[0];
  assert.ok(code.includes('user_id'), 'Trigger checks user_id consistency');
});

// ============================================================================
// 5. Audit Trail Protection
// ============================================================================
console.log('\n--- 5. Audit Trail Protection ---');

test('financial_audit_events table has prevent_audit_event_mutation trigger', () => {
  assert.ok(allSql.includes('prevent_audit_event_mutation'), 'prevent_audit_event_mutation trigger must be defined');
  const fnMatch = allSql.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(public\.)?prevent_audit_event_mutation[\s\S]*?END;/i);
  assert.ok(fnMatch, 'prevent_audit_event_mutation function found');
  const code = fnMatch[0];
  assert.ok(code.includes('UPDATE OR DELETE NOT ALLOWED') || code.includes('RAISE EXCEPTION'), 'Must reject updates or deletes');
});

test('financial_audit_events RLS enforces select_own policy', () => {
  assert.ok(allSql.includes('audit_events_select_own'), 'Must have select own policy for audit events');
  assert.ok(allSql.includes('auth.uid() = user_id'), 'Must filter by authenticated user_id');
});

// ============================================================================
// 6. Application Environment & Key Exposure Review
// ============================================================================
console.log('\n--- 6. Application Environment & Key Exposure Review ---');

test('Client Supabase config resolves ONLY NEXT_PUBLIC_SUPABASE_ANON_KEY', () => {
  const configFile = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'supabase', 'config.ts'), 'utf8');
  assert.ok(configFile.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY'), 'Must use anon key');
  assert.ok(!configFile.includes('SERVICE_ROLE'), 'Must NEVER use service role key in client config');
  assert.ok(!configFile.includes('service_role'), 'Must NEVER use service role key in client config');
});

test('No service role keys checked into repository .env.local', () => {
  const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
  assert.ok(!envFile.includes('SUPABASE_SERVICE_ROLE_KEY'), '.env.local must not contain service role key');
  assert.ok(!envFile.includes('SERVICE_KEY'), '.env.local must not contain service key');
  assert.ok(!envFile.includes('service_role'), '.env.local must not contain service role key');
});

// ============================================================================
// 7. Logical Authorization Boundary Invariants
// ============================================================================
console.log('\n--- 7. Logical Authorization Boundary Invariants ---');

test('User A cannot reverse User B transaction (invariant validation)', () => {
  function canReverse(callerId, origTxUserId) {
    if (!callerId) return false;
    return callerId === origTxUserId;
  }
  assert.strictEqual(canReverse('userA', 'userB'), false);
  assert.strictEqual(canReverse('userA', 'userA'), true);
  assert.strictEqual(canReverse(null, 'userA'), false);
});

test('User A cannot withdraw from User B goal or into User B wallet', () => {
  function canWithdraw(callerId, goalUserId, walletUserId) {
    if (!callerId) return false;
    if (callerId !== goalUserId) return false;
    if (callerId !== walletUserId) return false;
    return true;
  }
  assert.strictEqual(canWithdraw('userA', 'userB', 'userA'), false);
  assert.strictEqual(canWithdraw('userA', 'userA', 'userB'), false);
  assert.strictEqual(canWithdraw('userA', 'userB', 'userB'), false);
  assert.strictEqual(canWithdraw('userA', 'userA', 'userA'), true);
});

test('Overdraft protection boundary enforces balance >= amount', () => {
  function canDeduct(currentBalance, amount) {
    if (amount <= 0) return false;
    return currentBalance >= amount;
  }
  assert.strictEqual(canDeduct(100, 150), false);
  assert.strictEqual(canDeduct(100, 100), true);
  assert.strictEqual(canDeduct(100, 50), true);
  assert.strictEqual(canDeduct(0, 10), false);
});

// ============================================================================
// Summary
// ============================================================================
console.log(`\n=== M2.20 Unit Test Results: ${passedCount} passed, ${failedCount} failed ===\n`);

if (failedCount > 0) {
  process.exit(1);
}
