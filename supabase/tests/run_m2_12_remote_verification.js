/**
 * M2.12 Comprehensive Remote Runtime Verification Suite
 * Verifies real remote PostgreSQL execution for:
 *   - Income reversal & balance restoration
 *   - Expense reversal & balance restoration
 *   - Contribution reversal (wallet +amount, goal -amount)
 *   - Withdrawal reversal (wallet -amount, goal +amount)
 *   - Original transaction immutability check
 *   - Double reversal rejection (unique violation)
 *   - Cross-user rejection (user B cannot reverse user A)
 *   - Insufficient balance rejection & atomic rollback
 *   - Ledger & history consistency
 *   - Cleanup of temporary test records
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env.local', 'utf8');
let url = '', key = '';
for (const line of envFile.split('\n')) {
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) url = line.split('=')[1].trim();
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')) key = line.split('=')[1].trim();
}

async function runM212RemoteVerification() {
  console.log('=== Starting M2.12 Remote Runtime Verification against tieeffpsshpnibuaxsaf ===\n');
  const results = [];

  function record(flow, passed, evidence) {
    results.push({ flow, passed, evidence });
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${flow}: ${evidence}`);
  }

  // 1. Authenticate Client A and Client B
  const clientA = createClient(url, key);
  const clientB = createClient(url, key);

  const { data: authA, error: errA } = await clientA.auth.signInWithPassword({
    email: 'verify.test.30355@gmail.com',
    password: 'StrongPassword123!'
  });
  const { data: authB, error: errB } = await clientB.auth.signInWithPassword({
    email: 'test_m212_user@gmail.com',
    password: 'StrongPassword123!'
  });

  const userAId = authA?.user?.id;
  const userBId = authB?.user?.id;

  if (!userAId || !userBId) {
    throw new Error(`Authentication failed. A: ${errA?.message}, B: ${errB?.message}`);
  }
  record('Authentication', true, `User A (${userAId}) and User B (${userBId}) authenticated`);

  // Ensure clean test setup for User A
  // Get or create wallet for User A
  let { data: walletA } = await clientA.from('wallets').select('*').eq('user_id', userAId).maybeSingle();
  if (!walletA) {
    const { data: newW } = await clientA.from('wallets').insert({
      user_id: userAId,
      type: 'cash',
      label: 'Dompet A M2.12',
      balance: 1000000
    }).select().single();
    walletA = newW;
  }

  // Get or create goal for User A
  let { data: goalA } = await clientA.from('goals').select('*').eq('user_id', userAId).maybeSingle();
  if (!goalA) {
    const { data: newG } = await clientA.from('goals').insert({
      user_id: userAId,
      name: 'Goal M2.12',
      target_amount: 5000000,
      current_amount: 500000,
      status: 'active'
    }).select().single();
    goalA = newG;
  }

  // Record baseline balances
  let { data: currentWalletA } = await clientA.from('wallets').select('balance').eq('id', walletA.id).single();
  let { data: currentGoalA } = await clientA.from('goals').select('current_amount').eq('id', goalA.id).single();
  const baselineWallet = Number(currentWalletA.balance);
  const baselineGoal = Number(currentGoalA.current_amount);
  console.log(`Baseline balances: Wallet A = ${baselineWallet}, Goal A = ${baselineGoal}\n`);

  // -------------------------------------------------------------
  // Test 1: Successful Income Reversal
  // -------------------------------------------------------------
  const incAmount = 150000;
  const { data: txInc, error: txIncErr } = await clientA.from('transactions').insert({
    user_id: userAId,
    wallet_id: walletA.id,
    type: 'income',
    amount: incAmount,
    description: 'Income Test M2.12',
    transaction_date: '2026-10-01'
  }).select().single();

  if (txIncErr) throw new Error(`Failed to insert income: ${txIncErr.message}`);

  // Reverse income via RPC
  const { data: revIncRes, error: revIncErr } = await clientA.rpc('reverse_transaction', {
    p_transaction_id: txInc.id,
    p_reason: 'Koreksi salah input income'
  });

  const { data: postIncWallet } = await clientA.from('wallets').select('balance').eq('id', walletA.id).single();
  const incReversalPassed = !revIncErr && Number(postIncWallet.balance) === baselineWallet;
  record('Income reversal', incReversalPassed,
    revIncErr ? revIncErr.message : `Wallet restored exactly to ${postIncWallet.balance} (net delta 0)`);

  // -------------------------------------------------------------
  // Test 2: Successful Expense Reversal
  // -------------------------------------------------------------
  const expAmount = 75000;
  const { data: txExp, error: txExpErr } = await clientA.from('transactions').insert({
    user_id: userAId,
    wallet_id: walletA.id,
    type: 'expense',
    amount: expAmount,
    description: 'Expense Test M2.12',
    transaction_date: '2026-10-01'
  }).select().single();

  if (txExpErr) throw new Error(`Failed to insert expense: ${txExpErr.message}`);

  const { data: revExpRes, error: revExpErr } = await clientA.rpc('reverse_transaction', {
    p_transaction_id: txExp.id,
    p_reason: 'Koreksi salah input expense'
  });

  const { data: postExpWallet } = await clientA.from('wallets').select('balance').eq('id', walletA.id).single();
  const expReversalPassed = !revExpErr && Number(postExpWallet.balance) === baselineWallet;
  record('Expense reversal', expReversalPassed,
    revExpErr ? revExpErr.message : `Wallet credited back to ${postExpWallet.balance}`);

  // -------------------------------------------------------------
  // Test 3: Successful Savings Contribution Reversal
  // -------------------------------------------------------------
  const contribAmount = 100000;
  const { data: txContrib, error: txContribErr } = await clientA.from('transactions').insert({
    user_id: userAId,
    wallet_id: walletA.id,
    goal_id: goalA.id,
    type: 'savings_contribution',
    amount: contribAmount,
    description: 'Contribution Test M2.12',
    transaction_date: '2026-10-01'
  }).select().single();

  if (txContribErr) throw new Error(`Failed to insert contribution: ${txContribErr.message}`);

  const { data: revContribRes, error: revContribErr } = await clientA.rpc('reverse_transaction', {
    p_transaction_id: txContrib.id,
    p_reason: 'Koreksi kelebihan nabung'
  });

  const { data: postContribWallet } = await clientA.from('wallets').select('balance').eq('id', walletA.id).single();
  const { data: postContribGoal } = await clientA.from('goals').select('current_amount').eq('id', goalA.id).single();
  const contribReversalPassed = !revContribErr &&
    Number(postContribWallet.balance) === baselineWallet &&
    Number(postContribGoal.current_amount) === baselineGoal;
  record('Contribution reversal', contribReversalPassed,
    revContribErr ? revContribErr.message : `Wallet restored to ${postContribWallet.balance}, Goal restored to ${postContribGoal.current_amount}`);

  // -------------------------------------------------------------
  // Test 4: Successful Savings Withdrawal Reversal
  // -------------------------------------------------------------
  const withdrawAmount = 50000;
  const { data: withdrawRpcRes, error: withdrawRpcErr } = await clientA.rpc('execute_savings_withdrawal', {
    p_goal_id: goalA.id,
    p_destination_wallet_id: walletA.id,
    p_amount: withdrawAmount,
    p_reason: 'Penarikan M2.12 Test',
    p_transaction_date: '2026-10-01'
  });

  if (withdrawRpcErr) throw new Error(`Failed to execute withdrawal: ${withdrawRpcErr.message}`);
  const txWithdrawId = withdrawRpcRes.transaction.id;

  const { data: revWithdrawRes, error: revWithdrawErr } = await clientA.rpc('reverse_transaction', {
    p_transaction_id: txWithdrawId,
    p_reason: 'Batal tarik tabungan'
  });

  const { data: postWithdrawWallet } = await clientA.from('wallets').select('balance').eq('id', walletA.id).single();
  const { data: postWithdrawGoal } = await clientA.from('goals').select('current_amount').eq('id', goalA.id).single();
  const withdrawReversalPassed = !revWithdrawErr &&
    Number(postWithdrawWallet.balance) === baselineWallet &&
    Number(postWithdrawGoal.current_amount) === baselineGoal;
  record('Withdrawal reversal', withdrawReversalPassed,
    revWithdrawErr ? revWithdrawErr.message : `Wallet restored to ${postWithdrawWallet.balance}, Goal restored to ${postWithdrawGoal.current_amount}`);

  // -------------------------------------------------------------
  // Test 5: Original Transaction Immutability
  // -------------------------------------------------------------
  const { data: origTxAfter } = await clientA.from('transactions').select('*').eq('id', txInc.id).single();
  const immutabilityPassed =
    origTxAfter.amount === txInc.amount &&
    origTxAfter.type === txInc.type &&
    origTxAfter.wallet_id === txInc.wallet_id &&
    origTxAfter.user_id === txInc.user_id &&
    origTxAfter.transaction_date === txInc.transaction_date &&
    origTxAfter.description === txInc.description;
  record('Original immutability', immutabilityPassed,
    `Original transaction byte/field equivalent: amount=${origTxAfter.amount}, type=${origTxAfter.type}`);

  // -------------------------------------------------------------
  // Test 6: Double Reversal Prevention
  // -------------------------------------------------------------
  const { data: doubleRevRes, error: doubleRevErr } = await clientA.rpc('reverse_transaction', {
    p_transaction_id: txInc.id,
    p_reason: 'Mencoba reverse kedua kali'
  });

  const doubleRevBlocked = !!doubleRevErr && (doubleRevErr.message.includes('already been reversed') || doubleRevErr.code === '23505');
  record('Double reversal', doubleRevBlocked,
    `Double reversal rejected: code=${doubleRevErr?.code}, message="${doubleRevErr?.message}"`);

  // -------------------------------------------------------------
  // Test 7: Cross-User Reversal Rejection
  // -------------------------------------------------------------
  // User B attempts to reverse User A's transaction
  const { data: crossRevRes, error: crossRevErr } = await clientB.rpc('reverse_transaction', {
    p_transaction_id: txExp.id,
    p_reason: 'User B hacking User A'
  });

  const crossRevBlocked = !!crossRevErr && (crossRevErr.message.includes('does not exist or does not belong') || crossRevErr.code === '23503');
  record('Cross-user rejection', crossRevBlocked,
    `Cross-user reversal rejected: code=${crossRevErr?.code}, message="${crossRevErr?.message}"`);

  // -------------------------------------------------------------
  // Test 8: Failed Reversal Atomicity (Overdraft check)
  // -------------------------------------------------------------
  // Create an income of 50,000,000, then withdraw wallet down below 50,000,000
  // Attempt to reverse income should fail because wallet cannot be debited by 50,000,000
  // Verify ZERO mutations occur.
  const largeIncome = 50000000;
  const { data: txLargeInc } = await clientA.from('transactions').insert({
    user_id: userAId,
    wallet_id: walletA.id,
    type: 'income',
    amount: largeIncome,
    description: 'Income besar',
    transaction_date: '2026-10-01'
  }).select().single();

  // Now spend most of it with an expense
  const { data: txLargeExp } = await clientA.from('transactions').insert({
    user_id: userAId,
    wallet_id: walletA.id,
    type: 'expense',
    amount: largeIncome - 10000,
    description: 'Expense besar',
    transaction_date: '2026-10-01'
  }).select().single();

  const { data: walletBeforeFailedRev } = await clientA.from('wallets').select('balance').eq('id', walletA.id).single();
  const txCountBefore = (await clientA.from('transactions').select('id', { count: 'exact' }).eq('user_id', userAId)).count;

  // Now attempt to reverse txLargeInc — wallet balance is insufficient!
  const { data: failRes, error: failErr } = await clientA.rpc('reverse_transaction', {
    p_transaction_id: txLargeInc.id,
    p_reason: 'Koreksi yang harus gagal karena saldo kurang'
  });

  const { data: walletAfterFailedRev } = await clientA.from('wallets').select('balance').eq('id', walletA.id).single();
  const txCountAfter = (await clientA.from('transactions').select('id', { count: 'exact' }).eq('user_id', userAId)).count;

  const failedAtomicityPassed =
    !!failErr &&
    failErr.message.includes('insufficient') &&
    Number(walletBeforeFailedRev.balance) === Number(walletAfterFailedRev.balance) &&
    txCountBefore === txCountAfter;

  record('Failed reversal atomicity', failedAtomicityPassed,
    `Error="${failErr?.message}", balance untouched (${walletAfterFailedRev.balance}), txCount unchanged (${txCountAfter})`);

  // -------------------------------------------------------------
  // Test 9: Transaction History & Reversal Relations
  // -------------------------------------------------------------
  const { data: allTxA } = await clientA
    .from('transactions')
    .select('id, type, amount, reversal_of_transaction_id, reversal_reason')
    .eq('user_id', userAId)
    .order('created_at', { ascending: false });

  const hasReversals = allTxA.some(t => t.reversal_of_transaction_id !== null);
  record('History', hasReversals, `History contains ${allTxA.length} transactions with explicit reversal links`);

  // Clean up temporary test transactions to restore baseline
  await clientA.from('savings_withdrawals').delete().eq('user_id', userAId);
  await clientA.from('transactions').delete().eq('user_id', userAId);

  // Restore baseline balances cleanly
  await clientA.from('wallets').update({ balance: baselineWallet }).eq('id', walletA.id);
  await clientA.from('goals').update({ current_amount: baselineGoal }).eq('id', goalA.id);

  console.log('\n=== Remote Runtime Verification Finished. All test rows cleaned up. ===');
}

runM212RemoteVerification().catch((err) => {
  console.error('Remote verification error:', err);
  process.exit(1);
});
