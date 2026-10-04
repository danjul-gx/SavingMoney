/**
 * Comprehensive Remote Runtime Verification Suite for M2.1.3.2
 * Tests real authentication, RLS, triggers, functions, RPC, and constraints.
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env.local', 'utf8');
let url = '', key = '';
for (const line of envFile.split('\n')) {
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) url = line.split('=')[1].trim();
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')) key = line.split('=')[1].trim();
}

const unauthClient = createClient(url, key);

async function runVerification() {
  const report = {};
  function logResult(area, testName, passed, evidence) {
    if (!report[area]) report[area] = [];
    report[area].push({ testName, status: passed ? 'PASS' : 'FAIL', evidence });
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${area} -> ${testName}: ${evidence}`);
  }

  console.log('=== Starting M2.1.3.2 Real Runtime Verification ===\n');

  // Authenticate Client A and Client B
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

  // -------------------------------------------------------------
  // 1. AUTH & PROFILE PROVISIONING
  // -------------------------------------------------------------
  logResult('Auth/session', 'Session persistence & validity', !!authA?.session && !!authB?.session, `User A: ${userAId}, User B: ${userBId}`);

  // Profile provisioning
  const { data: profA, error: profAErr } = await clientA.from('profiles').upsert({
    user_id: userAId,
    display_name: 'Verified User A',
    timezone: 'Asia/Jakarta'
  }, { onConflict: 'user_id' }).select().single();
  logResult('Profile provisioning', 'User A profile upsert/read', !profAErr && profA?.display_name === 'Verified User A', profAErr ? profAErr.message : `Profile loaded: ${profA.id}`);

  const { data: profB, error: profBErr } = await clientB.from('profiles').upsert({
    user_id: userBId,
    display_name: 'Verified User B',
    timezone: 'Asia/Jakarta'
  }, { onConflict: 'user_id' }).select().single();
  logResult('Profile provisioning', 'User B profile upsert/read', !profBErr && profB?.display_name === 'Verified User B', profBErr ? profBErr.message : `Profile loaded: ${profB.id}`);

  // Profile update allowed fields
  const { error: updateProfErr } = await clientA.from('profiles').update({
    display_name: 'Updated Name A'
  }).eq('user_id', userAId);
  logResult('Profile provisioning', 'Update allowed profile fields', !updateProfErr, updateProfErr ? updateProfErr.message : 'display_name updated');

  // Unauthenticated access rejection
  const { data: unauthProfiles, error: unauthProfErr } = await unauthClient.from('profiles').select('*');
  logResult('Auth/session', 'Unauthenticated read rejected/empty', (!unauthProfiles || unauthProfiles.length === 0), `Rows returned: ${unauthProfiles?.length || 0}`);

  // -------------------------------------------------------------
  // Clean up previous test artifacts for deterministic test state
  // -------------------------------------------------------------
  await clientA.from('savings_withdrawals').delete().eq('user_id', userAId);
  await clientB.from('savings_withdrawals').delete().eq('user_id', userBId);
  await clientA.from('transactions').delete().eq('user_id', userAId);
  await clientB.from('transactions').delete().eq('user_id', userBId);
  await clientA.from('budget_allocations').delete().eq('user_id', userAId);
  await clientB.from('budget_allocations').delete().eq('user_id', userBId);
  await clientA.from('goals').delete().eq('user_id', userAId);
  await clientB.from('goals').delete().eq('user_id', userBId);
  await clientA.from('monthly_summaries').delete().eq('user_id', userAId);
  await clientB.from('monthly_summaries').delete().eq('user_id', userBId);

  // Setup initial wallets for User A & User B (fetch or create, reset balance to 0)
  let { data: walletA } = await clientA.from('wallets').select('*').eq('user_id', userAId).maybeSingle();
  if (!walletA) {
    const resA = await clientA.from('wallets').insert({
      user_id: userAId,
      type: 'cash',
      label: 'Dompet Cash A',
      balance: 0
    }).select().single();
    walletA = resA.data;
  } else if (walletA.balance !== 0) {
    // Bring balance to 0 via adjustment if needed
    if (walletA.balance > 0) {
      await clientA.from('transactions').insert({
        user_id: userAId,
        wallet_id: walletA.id,
        type: 'adjustment',
        amount: walletA.balance,
        adjustment_direction: 'debit',
        transaction_date: '2026-10-01',
        description: 'Reset balance'
      });
    }
  }

  let { data: walletB } = await clientB.from('wallets').select('*').eq('user_id', userBId).maybeSingle();
  if (!walletB) {
    const resB = await clientB.from('wallets').insert({
      user_id: userBId,
      type: 'cash',
      label: 'Dompet Cash B',
      balance: 0
    }).select().single();
    walletB = resB.data;
  } else if (walletB.balance !== 0) {
    if (walletB.balance > 0) {
      await clientB.from('transactions').insert({
        user_id: userBId,
        wallet_id: walletB.id,
        type: 'adjustment',
        amount: walletB.balance,
        adjustment_direction: 'debit',
        transaction_date: '2026-10-01',
        description: 'Reset balance'
      });
    }
  }

  logResult('Wallet accounting', 'Wallets created for User A and B', !!walletA && !!walletB, `Wallet A: ${walletA?.id}, Wallet B: ${walletB?.id}`);

  // Setup Goal for User A & User B
  const { data: goalA, error: gAErr } = await clientA.from('goals').insert({
    user_id: userAId,
    name: 'Dana Darurat A',
    target_amount: 5000000,
    current_amount: 0
  }).select().single();

  const { data: goalB, error: gBErr } = await clientB.from('goals').insert({
    user_id: userBId,
    name: 'Dana Liburan B',
    target_amount: 2000000,
    current_amount: 0
  }).select().single();

  // -------------------------------------------------------------
  // 2. MULTI-USER OWNERSHIP / RLS
  // -------------------------------------------------------------
  const { data: aReadsBWallet } = await clientA.from('wallets').select('*').eq('id', walletB.id);
  logResult('Cross-user RLS', 'User A cannot read User B wallet', !aReadsBWallet || aReadsBWallet.length === 0, `Returned: ${aReadsBWallet?.length} rows`);

  const { data: aReadsBGoal } = await clientA.from('goals').select('*').eq('id', goalB.id);
  logResult('Cross-user RLS', 'User A cannot read User B goal', !aReadsBGoal || aReadsBGoal.length === 0, `Returned: ${aReadsBGoal?.length} rows`);

  const { error: aMutateBWallet } = await clientA.from('wallets').update({ label: 'Hacked' }).eq('id', walletB.id);
  // With RLS, update on 0 matching rows returns success with 0 affected rows, verify label didn't change
  const { data: checkBWallet } = await clientB.from('wallets').select('label').eq('id', walletB.id).single();
  logResult('Cross-user RLS', 'User A cannot mutate User B wallet', checkBWallet?.label === 'Dompet Cash B', `Label is still: ${checkBWallet?.label}`);

  // User A attempts to use User B wallet in transaction
  const { error: crossTxErr } = await clientA.from('transactions').insert({
    user_id: userAId,
    wallet_id: walletB.id,
    type: 'income',
    amount: 100000,
    transaction_date: '2026-10-01'
  });
  logResult('Cross-user RLS', 'User A cannot use User B wallet in transaction', !!crossTxErr, crossTxErr ? crossTxErr.message : 'No error');

  // -------------------------------------------------------------
  // 3. WALLET BALANCE PROTECTION & ACCOUNTING
  // -------------------------------------------------------------
  // Normal income increases wallet
  const { data: txInc, error: incErr } = await clientA.from('transactions').insert({
    user_id: userAId,
    wallet_id: walletA.id,
    type: 'income',
    amount: 1000000,
    transaction_date: '2026-10-01',
    description: 'Gaji Bulanan'
  }).select().single();

  const { data: wAfterInc } = await clientA.from('wallets').select('balance').eq('id', walletA.id).single();
  logResult('Wallet accounting', 'Income increases wallet balance', wAfterInc?.balance === 1000000, `Balance after +1,000,000: ${wAfterInc?.balance}`);

  // Normal expense decreases wallet
  const { data: txExp, error: expErr } = await clientA.from('transactions').insert({
    user_id: userAId,
    wallet_id: walletA.id,
    type: 'expense',
    amount: 200000,
    transaction_date: '2026-10-01',
    description: 'Belanja'
  }).select().single();

  const { data: wAfterExp } = await clientA.from('wallets').select('balance').eq('id', walletA.id).single();
  logResult('Wallet accounting', 'Expense decreases wallet balance', wAfterExp?.balance === 800000, `Balance after -200,000: ${wAfterExp?.balance}`);

  // Direct client-side attempt to modify wallets.balance is rejected by protect_wallet_balance trigger
  const { error: directBalErr } = await clientA.from('wallets').update({ balance: 99999999 }).eq('id', walletA.id);
  logResult('Wallet balance protection', 'Direct client UPDATE on wallets.balance rejected', !!directBalErr, directBalErr ? directBalErr.message : 'FAIL: direct update succeeded');

  // Overspending/overdraft rejected
  const { error: overdraftErr } = await clientA.from('transactions').insert({
    user_id: userAId,
    wallet_id: walletA.id,
    type: 'expense',
    amount: 9999999, // exceeds 800,000
    transaction_date: '2026-10-01',
    description: 'Overdraft test'
  });
  const { data: wAfterOverdraft } = await clientA.from('wallets').select('balance').eq('id', walletA.id).single();
  logResult('Overdraft rejection', 'Overdraft rejected and balance unmodified', !!overdraftErr && wAfterOverdraft?.balance === 800000, overdraftErr ? overdraftErr.message : 'FAIL: overdraft accepted');

  // -------------------------------------------------------------
  // 4. GOAL BALANCE PROTECTION
  // -------------------------------------------------------------
  // Direct client-side attempt to modify goals.current_amount is rejected
  const { error: directGoalErr } = await clientA.from('goals').update({ current_amount: 5000000 }).eq('id', goalA.id);
  logResult('Goal balance protection', 'Direct client UPDATE on goals.current_amount rejected', !!directGoalErr, directGoalErr ? directGoalErr.message : 'FAIL: direct goal update succeeded');

  // -------------------------------------------------------------
  // 5. TRANSACTION IMMUTABILITY
  // -------------------------------------------------------------
  const { error: immutAmountErr } = await clientA.from('transactions').update({ amount: 50000 }).eq('id', txInc.id);
  logResult('Transaction immutability', 'Modifying transaction amount rejected', !!immutAmountErr, immutAmountErr ? immutAmountErr.message : 'FAIL: amount modified');

  const { error: immutTypeErr } = await clientA.from('transactions').update({ type: 'expense' }).eq('id', txInc.id);
  logResult('Transaction immutability', 'Modifying transaction type rejected', !!immutTypeErr, immutTypeErr ? immutTypeErr.message : 'FAIL: type modified');

  const { error: immutWalletErr } = await clientA.from('transactions').update({ wallet_id: walletB.id }).eq('id', txInc.id);
  logResult('Transaction immutability', 'Modifying transaction wallet_id rejected', !!immutWalletErr, immutWalletErr ? immutWalletErr.message : 'FAIL: wallet_id modified');

  // Permitted metadata change (description) succeeds
  const { error: mutDescErr } = await clientA.from('transactions').update({ description: 'Gaji Bulanan (Updated)' }).eq('id', txInc.id);
  logResult('Transaction immutability', 'Updating permitted metadata (description) succeeds', !mutDescErr, mutDescErr ? mutDescErr.message : 'Description updated');

  // -------------------------------------------------------------
  // 6. SAVINGS CONTRIBUTION — REAL ACCOUNTING
  // -------------------------------------------------------------
  // Current wallet balance: 800,000, Goal current: 0
  const contributionAmount = 300000;
  const { data: txContrib, error: contribErr } = await clientA.from('transactions').insert({
    user_id: userAId,
    wallet_id: walletA.id,
    goal_id: goalA.id,
    type: 'savings_contribution',
    amount: contributionAmount,
    transaction_date: '2026-10-01',
    description: 'Menabung Dana Darurat'
  }).select().single();

  const { data: wAfterContrib } = await clientA.from('wallets').select('balance').eq('id', walletA.id).single();
  const { data: gAfterContrib } = await clientA.from('goals').select('current_amount').eq('id', goalA.id).single();

  logResult('Savings contribution', 'Wallet debited and Goal credited by exact amount',
    !contribErr && wAfterContrib?.balance === 500000 && gAfterContrib?.current_amount === 300000,
    `Wallet: ${wAfterContrib?.balance} (expected 500000), Goal: ${gAfterContrib?.current_amount} (expected 300000)`
  );

  // Insufficient wallet balance for contribution rejected
  const { error: contribOverdraftErr } = await clientA.from('transactions').insert({
    user_id: userAId,
    wallet_id: walletA.id,
    goal_id: goalA.id,
    type: 'savings_contribution',
    amount: 1000000, // exceeds 500,000
    transaction_date: '2026-10-01'
  });
  logResult('Savings contribution', 'Insufficient wallet balance for contribution rejected', !!contribOverdraftErr, contribOverdraftErr ? contribOverdraftErr.message : 'FAIL: accepted');

  // Cross-user goal contribution rejected
  const { error: crossContribErr } = await clientA.from('transactions').insert({
    user_id: userAId,
    wallet_id: walletA.id,
    goal_id: goalB.id,
    type: 'savings_contribution',
    amount: 10000,
    transaction_date: '2026-10-01'
  });
  logResult('Savings contribution', 'Cross-user goal contribution rejected', !!crossContribErr, crossContribErr ? crossContribErr.message : 'FAIL: accepted');

  // -------------------------------------------------------------
  // 7. SAVINGS WITHDRAWAL — REAL RPC / ATOMICITY
  // -------------------------------------------------------------
  // Unauthenticated execution rejected
  const { error: unauthRpcErr } = await unauthClient.rpc('execute_savings_withdrawal', {
    p_goal_id: goalA.id,
    p_destination_wallet_id: walletA.id,
    p_amount: 100000,
    p_reason: 'Kebutuhan mendesak',
    p_transaction_date: '2026-10-01'
  });
  logResult('Savings withdrawal RPC', 'Unauthenticated RPC call rejected', !!unauthRpcErr, unauthRpcErr ? unauthRpcErr.message : 'FAIL: unauth succeeded');

  // Valid withdrawal execution
  const { data: rpcRes, error: rpcErr } = await clientA.rpc('execute_savings_withdrawal', {
    p_goal_id: goalA.id,
    p_destination_wallet_id: walletA.id,
    p_amount: 100000,
    p_reason: 'Kebutuhan mendesak',
    p_transaction_date: '2026-10-01'
  });

  const { data: wAfterWd } = await clientA.from('wallets').select('balance').eq('id', walletA.id).single();
  const { data: gAfterWd } = await clientA.from('goals').select('current_amount').eq('id', goalA.id).single();

  logResult('Savings withdrawal RPC', 'Valid withdrawal RPC succeeds atomically',
    !rpcErr && wAfterWd?.balance === 600000 && gAfterWd?.current_amount === 200000,
    `Wallet: ${wAfterWd?.balance} (expected 600000), Goal: ${gAfterWd?.current_amount} (expected 200000), RPC result: ${!!rpcRes}`
  );

  // Metadata verification
  const swTx = rpcRes?.transaction;
  const swMeta = rpcRes?.withdrawal;
  logResult('Withdrawal atomicity', 'Metadata references matching transaction atomically',
    swTx?.id === swMeta?.transaction_id && swMeta?.amount === 100000 && swMeta?.reason === 'Kebutuhan mendesak',
    `Tx ID: ${swTx?.id}, Meta Tx ID: ${swMeta?.transaction_id}, Reason: ${swMeta?.reason}`
  );

  // Withdrawal greater than goal balance rejected
  const { error: overWdErr } = await clientA.rpc('execute_savings_withdrawal', {
    p_goal_id: goalA.id,
    p_destination_wallet_id: walletA.id,
    p_amount: 999999, // exceeds 200,000
    p_reason: 'Overdraft test',
    p_transaction_date: '2026-10-01'
  });
  const { data: gAfterOverWd } = await clientA.from('goals').select('current_amount').eq('id', goalA.id).single();
  logResult('Withdrawal atomicity', 'Over-balance withdrawal rejected and goal unmodified',
    !!overWdErr && gAfterOverWd?.current_amount === 200000,
    overWdErr ? overWdErr.message : 'FAIL: over-balance withdrawal accepted'
  );

  // Cross-user withdrawal rejected
  const { error: crossWdErr } = await clientA.rpc('execute_savings_withdrawal', {
    p_goal_id: goalB.id,
    p_destination_wallet_id: walletA.id,
    p_amount: 50000,
    p_reason: 'Steal from B',
    p_transaction_date: '2026-10-01'
  });
  logResult('Withdrawal atomicity', 'Cross-user goal withdrawal rejected', !!crossWdErr, crossWdErr ? crossWdErr.message : 'FAIL: cross withdrawal accepted');

  // -------------------------------------------------------------
  // 8. BUDGET INTERVAL — M2.4.2
  // -------------------------------------------------------------
  // original_amount: 50,000, interval_days: 4 -> normalized: 50000 * 30 / 4 = 375,000
  const { data: intervalBudget, error: intBudgetErr } = await clientA.from('budget_allocations').insert({
    user_id: userAId,
    wallet_id: walletA.id,
    category: 'transport',
    budget_year: 2026,
    budget_month: 10,
    period: 'interval',
    interval_days: 4,
    original_amount: 50000,
    normalized_monthly_amount: 375000
  }).select().single();

  logResult('Interval budget', 'Valid interval budget (50k / 4 days = 375k) created', !intBudgetErr && !!intervalBudget, intBudgetErr ? intBudgetErr.message : `ID: ${intervalBudget?.id}`);

  // Inconsistent normalization rejected (exact equality)
  const { error: badNormErr } = await clientA.from('budget_allocations').insert({
    user_id: userAId,
    wallet_id: walletA.id,
    category: 'food',
    budget_year: 2026,
    budget_month: 10,
    period: 'interval',
    interval_days: 4,
    original_amount: 50000,
    normalized_monthly_amount: 375001 // mismatched by 1
  });
  logResult('Interval budget', 'Mismatched normalized_monthly_amount strictly rejected', !!badNormErr, badNormErr ? badNormErr.message : 'FAIL: accepted mismatch');

  // Invalid interval_days (e.g. 0 or null) rejected
  const { error: zeroDaysErr } = await clientA.from('budget_allocations').insert({
    user_id: userAId,
    wallet_id: walletA.id,
    category: 'other',
    budget_year: 2026,
    budget_month: 10,
    period: 'interval',
    interval_days: 0,
    original_amount: 50000,
    normalized_monthly_amount: 375000
  });
  logResult('Interval budget', 'Invalid interval_days <= 0 rejected', !!zeroDaysErr, zeroDaysErr ? zeroDaysErr.message : 'FAIL: accepted 0 days');

  // Weekly normalization (200,000 * 4.3 = 860,000)
  const { data: weeklyBudget, error: weeklyErr } = await clientA.from('budget_allocations').insert({
    user_id: userAId,
    wallet_id: walletA.id,
    category: 'food',
    budget_year: 2026,
    budget_month: 10,
    period: 'weekly',
    original_amount: 200000,
    normalized_monthly_amount: 860000
  }).select().single();
  logResult('Interval budget', 'Weekly normalization (200k * 4.3 = 860k) verified', !weeklyErr, weeklyErr ? weeklyErr.message : `ID: ${weeklyBudget?.id}`);

  // Monthly normalization (1:1)
  const { data: monthlyBudget, error: monthlyErr } = await clientA.from('budget_allocations').insert({
    user_id: userAId,
    wallet_id: walletA.id,
    category: 'other',
    custom_label: 'Langganan Internet',
    budget_year: 2026,
    budget_month: 10,
    period: 'monthly',
    original_amount: 150000,
    normalized_monthly_amount: 150000
  }).select().single();
  logResult('Interval budget', 'Monthly normalization (1:1) verified', !monthlyErr, monthlyErr ? monthlyErr.message : `ID: ${monthlyBudget?.id}`);

  // Budget operations do NOT mutate wallet balance
  const { data: wAfterBudgets } = await clientA.from('wallets').select('balance').eq('id', walletA.id).single();
  logResult('Interval budget', 'Budget CRUD has zero wallet mutation side effects', wAfterBudgets?.balance === 600000, `Balance is still: ${wAfterBudgets?.balance}`);

  // -------------------------------------------------------------
  // 9. MONTHLY HISTORY / ROLLOVER SAFETY
  // -------------------------------------------------------------
  // Find or insert monthly summary for User A
  const testYear = 2025;
  const testMonth = Math.floor(Math.random() * 12) + 1;
  const { data: sumA, error: sumAErr } = await clientA.from('monthly_summaries').insert({
    user_id: userAId,
    year: testYear,
    month: testMonth,
    total_income: 1000000,
    planned_operational_budget: 500000,
    actual_operational_spending: 200000,
    planned_savings: 300000,
    actual_savings: 300000,
    leftover_operational_budget: 300000,
    rollover_amount: 300000,
    finalized_at: '2026-10-01T00:00:00Z'
  }).select().single();
  logResult('Rollover isolation', 'Monthly summary inserted for User A', !sumAErr && !!sumA, sumAErr ? sumAErr.message : `Summary A: ${sumA?.id}`);

  // User B cannot read User A's monthly summary
  const { data: bReadsSumA } = await clientB.from('monthly_summaries').select('*').eq('id', sumA?.id);
  logResult('Monthly history isolation', 'User B cannot read User A monthly summary', !bReadsSumA || bReadsSumA.length === 0, `Returned: ${bReadsSumA?.length} rows`);

  // Rollover does not mutate wallet balance
  const { data: wAfterSummary } = await clientA.from('wallets').select('balance').eq('id', walletA.id).single();
  logResult('Rollover isolation', 'Summary / rollover record produces no wallet balance mutation', wAfterSummary?.balance === 600000, `Wallet balance is still: ${wAfterSummary?.balance}`);


  // -------------------------------------------------------------
  // Clean up temporary test records created during verification
  // -------------------------------------------------------------
  console.log('Cleaning up temporary test records...');
  await clientA.from('savings_withdrawals').delete().eq('user_id', userAId);
  await clientB.from('savings_withdrawals').delete().eq('user_id', userBId);
  await clientA.from('transactions').delete().eq('user_id', userAId);
  await clientB.from('transactions').delete().eq('user_id', userBId);
  await clientA.from('budget_allocations').delete().eq('user_id', userAId);
  await clientB.from('budget_allocations').delete().eq('user_id', userBId);
  await clientA.from('goals').delete().eq('user_id', userAId);
  await clientB.from('goals').delete().eq('user_id', userBId);
  await clientA.from('monthly_summaries').delete().eq('user_id', userAId);
  await clientB.from('monthly_summaries').delete().eq('user_id', userBId);

  console.log('\n=== All Live Runtime Verifications Completed & Cleaned Up ===\n');
}


runVerification().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
