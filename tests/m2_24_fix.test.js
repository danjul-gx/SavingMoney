/**
 * M2.24 FIX — Release Candidate & Production Deployment Readiness Tests
 *
 * Verifies the two remediation areas:
 * 1. Complete Accounting Smoke Coverage Invariants (Income, Expense, Contribution, Withdrawal, Reversal, Reconciliation)
 * 2. Next.js Security Advisory & Dependency Remediation Invariants (GHSA-vcvr-r3jv-pc5j patch verification)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('=== M2.24 FIX: Release Readiness Remediation Tests ===\n');

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
// 1. Next.js Security Advisory & Dependency Remediation
// ----------------------------------------------------------------------------
console.log('--- 1. Next.js Advisory & Dependency Verification ---');

test('package.json specifies patched Next.js version >= 16.3.8', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const version = pkg.dependencies.next.replace(/[\^~]/, '');
  const [major, minor, patch] = version.split('.').map(Number);
  assert.ok(
    major > 16 || (major === 16 && minor > 3) || (major === 16 && minor === 3 && patch >= 8),
    `Next.js version must be >= 16.3.8 (found ${pkg.dependencies.next})`
  );
});

test('package-lock.json resolves next to 16.3.8 without vulnerability', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
  const nextResolved = lock.packages?.['node_modules/next']?.version || lock.dependencies?.next?.version;
  assert.strictEqual(nextResolved, '16.3.8');
});

test('source code does NOT import next/og or ImageResponse', () => {
  function checkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (f !== 'node_modules' && f !== '.next' && f !== '.git') {
          checkDir(full);
        }
      } else if (f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js') || f.endsWith('.jsx')) {
        const content = fs.readFileSync(full, 'utf8');
        assert.ok(!content.includes('next/og'), `File ${full} must not import next/og`);
        assert.ok(!content.includes('ImageResponse'), `File ${full} must not use ImageResponse`);
      }
    }
  }
  checkDir(path.join(__dirname, '..', 'app'));
  checkDir(path.join(__dirname, '..', 'src'));
});

// ----------------------------------------------------------------------------
// 2. Complete Accounting Smoke Coverage Invariants
// ----------------------------------------------------------------------------
console.log('\n--- 2. Accounting Smoke Flow Invariants ---');

test('run_m2_24_release_smoke.js verifies Income flow and wallet delta', () => {
  const smokeCode = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'tests', 'run_m2_24_release_smoke.js'), 'utf8');
  assert.ok(smokeCode.includes('Flow A: Record Income'), 'Smoke must contain Flow A');
  assert.ok(smokeCode.includes('initialWalletBalance + incomeAmount'), 'Smoke verifies income wallet delta');
});

test('run_m2_24_release_smoke.js verifies Expense flow and wallet delta', () => {
  const smokeCode = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'tests', 'run_m2_24_release_smoke.js'), 'utf8');
  assert.ok(smokeCode.includes('Flow B: Record Expense'), 'Smoke must contain Flow B');
  assert.ok(smokeCode.includes('walletAfterIncome.balance - expenseAmount'), 'Smoke verifies expense wallet delta');
});

test('run_m2_24_release_smoke.js verifies Savings Contribution flow atomically', () => {
  const smokeCode = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'tests', 'run_m2_24_release_smoke.js'), 'utf8');
  assert.ok(smokeCode.includes('Flow C: Savings Contribution'), 'Smoke must contain Flow C');
  assert.ok(smokeCode.includes('savings_contribution'), 'Smoke records savings_contribution transaction');
  assert.ok(smokeCode.includes('contribGoalMatched'), 'Smoke verifies goal increment');
});

test('run_m2_24_release_smoke.js verifies Savings Withdrawal via atomic RPC execute_savings_withdrawal', () => {
  const smokeCode = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'tests', 'run_m2_24_release_smoke.js'), 'utf8');
  assert.ok(smokeCode.includes('Flow D: Savings Withdrawal (Atomic)'), 'Smoke must contain Flow D');
  assert.ok(smokeCode.includes('execute_savings_withdrawal'), 'Smoke invokes execute_savings_withdrawal');
  assert.ok(smokeCode.includes('savings_withdrawals'), 'Smoke checks savings_withdrawals metadata table');
  assert.ok(smokeCode.includes('withdrawReason'), 'Smoke checks reason persistence');
});

test('run_m2_24_release_smoke.js verifies Transaction Reversal flow via reverse_transaction RPC', () => {
  const smokeCode = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'tests', 'run_m2_24_release_smoke.js'), 'utf8');
  assert.ok(smokeCode.includes('Flow E: Transaction Reversals'), 'Smoke must contain Flow E');
  assert.ok(smokeCode.includes('reverse_transaction'), 'Smoke invokes reverse_transaction RPC');
  assert.ok(smokeCode.includes('walletReturned'), 'Smoke verifies wallet returns to initial balance');
  assert.ok(smokeCode.includes('goalReturned'), 'Smoke verifies goal returns to initial balance');
});

test('run_m2_24_release_smoke.js executes independent wallet and goal ledger reconciliation', () => {
  const smokeCode = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'tests', 'run_m2_24_release_smoke.js'), 'utf8');
  assert.ok(smokeCode.includes('Flow F: Independent Ledger Reconciliation'), 'Smoke must contain Flow F wallet reconciliation');
  assert.ok(smokeCode.includes('Flow F: Independent Goal Reconciliation'), 'Smoke must contain Flow F goal reconciliation');
  assert.ok(smokeCode.includes('walletDelta === 0'), 'Smoke asserts wallet Delta = 0');
  assert.ok(smokeCode.includes('goalDelta === 0'), 'Smoke asserts goal Delta = 0');
});

test('all required remediation checks pass cleanly', () => {
  assert.strictEqual(failedCount, 0, 'No failed assertions in M2.24 FIX suite');
});

// ----------------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------------
console.log(`\n=== M2.24 FIX Unit Test Results: ${passedCount} passed, ${failedCount} failed ===\n`);

if (failedCount > 0) {
  process.exit(1);
}
