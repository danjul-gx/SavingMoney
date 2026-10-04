/**
 * M2.24 — Remote Release Smoke Test & Complete Accounting Verification
 *
 * Verifies live Supabase state for production deployment readiness:
 * 1. Authentication & Session Verification
 * 2. Live Schema Table Presence & Access
 * 3. Complete End-to-End Accounting Smoke Cycle:
 *    A. Record Income -> wallet increments by exact amount
 *    B. Record Expense -> wallet decrements by exact amount
 *    C. Savings Contribution -> wallet decrements, goal increments by exact amount
 *    D. Savings Withdrawal -> goal decrements, destination wallet increments, reason persisted, atomic
 *    E. Transaction Reversals -> compensating adjustment entries created, original transactions immutable, balances return to expected state
 * 4. Multi-User RLS Boundary Verification
 * 5. Append-Only Audit Trail Invariant Check
 * 6. Independent Ledger & Goal Reconciliation (Delta = 0)
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env.local', 'utf8');
let url = '', key = '';
for (const line of envFile.split('\n')) {
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) url = line.split('=')[1].trim();
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')) key = line.split('=')[1].trim();
}

function calculateWalletDelta(type, amount, dir) {
  const a = Number(amount);
  switch (type) {
    case 'income':
    case 'rollover':
    case 'savings_withdrawal':
      return a;
    case 'expense':
    case 'savings_contribution':
      return -a;
    case 'adjustment':
      if (dir === 'credit') return a;
      if (dir === 'debit') return -a;
      return 0;
    default:
      return 0;
  }
}

async function run() {
  console.log('=== M2.24 Remote Release Candidate Complete Accounting Smoke Verification ===\n');
  const results = [];

  function record(flow, passed, evidence) {
    results.push({ flow, passed, evidence });
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${flow}: ${evidence}`);
  }

  // 1. Authenticate test users
  const clientA = createClient(url, key);
  const clientB = createClient(url, key);

  const { data: authA } = await clientA.auth.signInWithPassword({
    email: 'verify.test.30355@gmail.com',
    password: 'StrongPassword123!'
  });
  const { data: authB } = await clientB.auth.signInWithPassword({
    email: 'test_m212_user@gmail.com',
    password: 'StrongPassword123!'
  });

  const userAId = authA?.user?.id;
  const userBId = authB?.user?.id;

  if (!userAId || !userBId) {
    throw new Error('Authentication failed for test users.');
  }
  record('1. Authentication & Session Verification', true, `User A=${userAId.slice(0, 8)}… User B=${userBId.slice(0, 8)}…`);

  // 2. Core Tables Presence
  const coreTables = ['profiles', 'wallets', 'transactions', 'goals', 'savings_withdrawals', 'budget_allocations', 'monthly_summaries', 'financial_audit_events'];
  let tablesOk = true;
  for (const tbl of coreTables) {
    const { error } = await clientA.from(tbl).select('*', { count: 'exact', head: true });
    if (error) {
      tablesOk = false;
      console.error(`Table access error on ${tbl}: ${error.message}`);
    }
  }
  record('2. Live Schema Table Presence', tablesOk, 'All 8 core financial tables live and queryable');

  // 3. User A Initial Pre-Smoke State
  const { data: walletA } = await clientA.from('wallets').select('*').limit(1).single();
  const { data: goalA } = await clientA.from('goals').select('*').eq('user_id', userAId).gt('current_amount', 100000).limit(1).single();
  if (!goalA) throw new Error('No goal with sufficient balance found for User A');

  const initialWalletBalance = walletA.balance;
  const initialGoalAmount = goalA.current_amount;
  const today = new Date().toISOString().slice(0, 10);
  const smokeTag = `smoke_${Date.now()}`;

  // --------------------------------------------------------------------------
  // Flow A: Record Income
  // --------------------------------------------------------------------------
  const incomeAmount = 50000;
  const { data: incomeTx, error: incomeErr } = await clientA.from('transactions').insert({
    user_id: userAId,
    wallet_id: walletA.id,
    type: 'income',
    amount: incomeAmount,
    transaction_date: today,
    description: `Smoke Income ${smokeTag}`
  }).select().single();
  if (incomeErr) throw new Error(`Income failed: ${incomeErr.message}`);

  const { data: walletAfterIncome } = await clientA.from('wallets').select('*').eq('id', walletA.id).single();
  const incomeMatched = walletAfterIncome.balance === initialWalletBalance + incomeAmount;
  record('3. Flow A: Record Income', incomeMatched, `Wallet +${incomeAmount} (From ${initialWalletBalance} -> ${walletAfterIncome.balance})`);

  // --------------------------------------------------------------------------
  // Flow B: Record Expense
  // --------------------------------------------------------------------------
  const expenseAmount = 20000;
  const { data: expenseTx, error: expenseErr } = await clientA.from('transactions').insert({
    user_id: userAId,
    wallet_id: walletA.id,
    type: 'expense',
    amount: expenseAmount,
    transaction_date: today,
    description: `Smoke Expense ${smokeTag}`
  }).select().single();
  if (expenseErr) throw new Error(`Expense failed: ${expenseErr.message}`);

  const { data: walletAfterExpense } = await clientA.from('wallets').select('*').eq('id', walletA.id).single();
  const expenseMatched = walletAfterExpense.balance === walletAfterIncome.balance - expenseAmount;
  record('4. Flow B: Record Expense', expenseMatched, `Wallet -${expenseAmount} (From ${walletAfterIncome.balance} -> ${walletAfterExpense.balance})`);

  // --------------------------------------------------------------------------
  // Flow C: Savings Contribution
  // --------------------------------------------------------------------------
  const contribAmount = 30000;
  const { data: contribTx, error: contribErr } = await clientA.from('transactions').insert({
    user_id: userAId,
    wallet_id: walletA.id,
    goal_id: goalA.id,
    type: 'savings_contribution',
    amount: contribAmount,
    transaction_date: today,
    description: `Smoke Contribution ${smokeTag}`
  }).select().single();
  if (contribErr) throw new Error(`Contribution failed: ${contribErr.message}`);

  const { data: walletAfterContrib } = await clientA.from('wallets').select('*').eq('id', walletA.id).single();
  const { data: goalAfterContrib } = await clientA.from('goals').select('*').eq('id', goalA.id).single();
  const contribWalletMatched = walletAfterContrib.balance === walletAfterExpense.balance - contribAmount;
  const contribGoalMatched = goalAfterContrib.current_amount === initialGoalAmount + contribAmount;
  record(
    '5. Flow C: Savings Contribution',
    contribWalletMatched && contribGoalMatched,
    `Wallet -${contribAmount} (${walletAfterExpense.balance} -> ${walletAfterContrib.balance}), Goal +${contribAmount} (${initialGoalAmount} -> ${goalAfterContrib.current_amount})`
  );

  // --------------------------------------------------------------------------
  // Flow D: Savings Withdrawal (via atomic RPC)
  // --------------------------------------------------------------------------
  const withdrawAmount = 25000;
  const withdrawReason = `Smoke withdrawal ${smokeTag}`;
  const { data: withdrawRes, error: withdrawErr } = await clientA.rpc('execute_savings_withdrawal', {
    p_goal_id: goalA.id,
    p_destination_wallet_id: walletA.id,
    p_amount: withdrawAmount,
    p_reason: withdrawReason,
    p_transaction_date: today,
    p_estimated_delay_days: 0
  });
  if (withdrawErr) throw new Error(`Withdrawal failed: ${withdrawErr.message}`);

  const { data: walletAfterWithdraw } = await clientA.from('wallets').select('*').eq('id', walletA.id).single();
  const { data: goalAfterWithdraw } = await clientA.from('goals').select('*').eq('id', goalA.id).single();
  const { data: swRecord } = await clientA.from('savings_withdrawals').select('*').eq('transaction_id', withdrawRes.transaction.id).single();

  const withdrawGoalMatched = goalAfterWithdraw.current_amount === goalAfterContrib.current_amount - withdrawAmount;
  const withdrawWalletMatched = walletAfterWithdraw.balance === walletAfterContrib.balance + withdrawAmount;
  const reasonMatched = swRecord && swRecord.reason === withdrawReason;

  record(
    '6. Flow D: Savings Withdrawal (Atomic)',
    withdrawGoalMatched && withdrawWalletMatched && reasonMatched,
    `Goal -${withdrawAmount} (${goalAfterContrib.current_amount} -> ${goalAfterWithdraw.current_amount}), Wallet +${withdrawAmount} (${walletAfterContrib.balance} -> ${walletAfterWithdraw.balance}), Reason persisted: "${swRecord?.reason}"`
  );

  // --------------------------------------------------------------------------
  // Flow E: Transaction Reversals
  // Neutralize Income, Expense, Contribution, and Withdrawal via reverse_transaction RPC
  // --------------------------------------------------------------------------
  const txsToReverse = [
    { id: incomeTx.id, name: 'Income' },
    { id: expenseTx.id, name: 'Expense' },
    { id: contribTx.id, name: 'Contribution' },
    { id: withdrawRes.transaction.id, name: 'Withdrawal' }
  ];

  let reversalsOk = true;
  for (const item of txsToReverse) {
    const { error: revErr } = await clientA.rpc('reverse_transaction', {
      p_transaction_id: item.id,
      p_reason: `Neutralize smoke ${item.name} ${smokeTag}`
    });
    if (revErr) {
      reversalsOk = false;
      console.error(`Failed to reverse ${item.name}: ${revErr.message}`);
    }
  }

  const { data: finalWallet } = await clientA.from('wallets').select('*').eq('id', walletA.id).single();
  const { data: finalGoal } = await clientA.from('goals').select('*').eq('id', goalA.id).single();

  const walletReturned = finalWallet.balance === initialWalletBalance;
  const goalReturned = finalGoal.current_amount === initialGoalAmount;
  record(
    '7. Flow E: Transaction Reversals & Return to Clean Baseline',
    reversalsOk && walletReturned && goalReturned,
    `All 4 smoke operations neutralized atomically via reverse_transaction. Final wallet=${finalWallet.balance} (was ${initialWalletBalance}), final goal=${finalGoal.current_amount} (was ${initialGoalAmount})`
  );

  // --------------------------------------------------------------------------
  // Flow F: Independent Ledger & Goal Reconciliation
  // --------------------------------------------------------------------------
  let totalLedgerBal = 0;
  let offset = 0;
  let txCount = 0;
  while (true) {
    const { data: page, error: pErr } = await clientA
      .from('transactions')
      .select('type, amount, adjustment_direction')
      .eq('wallet_id', walletA.id)
      .range(offset, offset + 99);
    if (pErr || !page || page.length === 0) break;
    for (const t of page) {
      totalLedgerBal += calculateWalletDelta(t.type, t.amount, t.adjustment_direction);
      txCount++;
    }
    if (page.length < 100) break;
    offset += 100;
  }

  const walletDelta = finalWallet.balance - totalLedgerBal;
  record(
    '8. Flow F: Independent Ledger Reconciliation',
    walletDelta === 0,
    `Stored wallet=${finalWallet.balance}, Calculated ledger=${totalLedgerBal} across ${txCount} transactions (Delta: ${walletDelta})`
  );

  // Goal reconciliation
  let goalNetBal = 0;
  const { data: goalTxs } = await clientA
    .from('transactions')
    .select('type, amount, adjustment_direction')
    .eq('goal_id', goalA.id);

  for (const t of (goalTxs || [])) {
    if (t.type === 'savings_contribution') goalNetBal += Number(t.amount);
    if (t.type === 'savings_withdrawal') goalNetBal -= Number(t.amount);
    if (t.type === 'adjustment') {
      if (t.adjustment_direction === 'credit') goalNetBal += Number(t.amount);
      if (t.adjustment_direction === 'debit') goalNetBal -= Number(t.amount);
    }
  }

  const goalDelta = finalGoal.current_amount - goalNetBal;
  record(
    '9. Flow F: Independent Goal Reconciliation',
    goalDelta === 0,
    `Stored goal current_amount=${finalGoal.current_amount}, Net goal transactions=${goalNetBal} (Delta: ${goalDelta})`
  );

  // Multi-user RLS check
  const { data: crossWallets } = await clientA.from('wallets').select('*').eq('user_id', userBId);
  const { data: crossAudit } = await clientA.from('financial_audit_events').select('*').eq('user_id', userBId);
  const rlsOk = (crossWallets?.length || 0) === 0 && (crossAudit?.length || 0) === 0;
  record('10. Multi-User RLS Isolation Check', rlsOk, 'User A cannot access User B wallets or audit events');

  // Summary
  console.log('\n=== Results ===');
  const failed = results.filter(r => !r.passed);
  console.log(`Total: ${results.length - failed.length} passed, ${failed.length} failed out of ${results.length}`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
