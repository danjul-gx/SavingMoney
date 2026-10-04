/**
 * M2.18 — Remote Financial Consistency Verification
 *
 * Verifies live Supabase financial consistency invariants using two
 * authenticated users. Tests contributions, withdrawals, reversals,
 * cross-user isolation, balance consistency, and audit trail behavior.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env.local', 'utf8');
let url = '', key = '';
for (const line of envFile.split('\n')) {
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) url = line.split('=')[1].trim();
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')) key = line.split('=')[1].trim();
}

async function run() {
  console.log('=== M2.18 Remote Financial Consistency Verification ===\n');
  const results = [];
  let cleanupTxIds = [];

  function record(flow, passed, evidence) {
    results.push({ flow, passed, evidence });
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${flow}: ${evidence}`);
  }

  // ---------- 1. Authentication ----------
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
    throw new Error(`Auth failed. A: ${errA?.message}, B: ${errB?.message}`);
  }
  record('Authentication', true, `A=${userAId.slice(0,8)}… B=${userBId.slice(0,8)}…`);

  // ---------- 2. Setup: ensure wallet + goal for both users ----------
  async function ensureWallet(client, userId, label) {
    let { data } = await client.from('wallets').select('*').eq('user_id', userId).limit(1).maybeSingle();
    if (!data) {
      const { data: w } = await client.from('wallets').insert({
        user_id: userId, type: 'cash', label, balance: 0
      }).select().single();
      data = w;
    }
    return data;
  }

  async function ensureGoal(client, userId, name) {
    let { data } = await client.from('goals').select('*').eq('user_id', userId).eq('status', 'active').limit(1).maybeSingle();
    if (!data) {
      const { data: g } = await client.from('goals').insert({
        user_id: userId, name, target_amount: 10000000, status: 'active'
      }).select().single();
      data = g;
    }
    return data;
  }

  const walletA = await ensureWallet(clientA, userAId, 'M2.18 Wallet A');
  const walletB = await ensureWallet(clientB, userBId, 'M2.18 Wallet B');
  const goalA = await ensureGoal(clientA, userAId, 'M2.18 Goal A');
  const goalB = await ensureGoal(clientB, userBId, 'M2.18 Goal B');

  // Helper: get fresh balances
  async function getBalances(client, walletId, goalId) {
    const { data: w } = await client.from('wallets').select('balance').eq('id', walletId).single();
    const { data: g } = await client.from('goals').select('current_amount').eq('id', goalId).single();
    return { wallet: Number(w.balance), goal: Number(g.current_amount) };
  }

  // Helper: count audit events linked to a specific transaction
  async function countAuditEventsForTx(client, transactionId) {
    const { data, error } = await client.from('financial_audit_events')
      .select('id')
      .or(`transaction_id.eq.${transactionId},related_transaction_id.eq.${transactionId}`);
    if (error) return -1;
    return data ? data.length : 0;
  }

  // ========================================================================
  // CONTRIBUTION TESTS
  // ========================================================================
  console.log('\n--- Contribution Tests ---');

  // Seed wallet A with income for tests
  const seedAmount = 2000000;
  const { data: seedTx } = await clientA.from('transactions').insert({
    user_id: userAId, wallet_id: walletA.id, type: 'income',
    amount: seedAmount, description: 'M2.18 seed', transaction_date: '2026-10-01'
  }).select().single();
  if (seedTx) cleanupTxIds.push(seedTx.id);

  const baseA = await getBalances(clientA, walletA.id, goalA.id);
  console.log(`Baseline A: wallet=${baseA.wallet}, goal=${baseA.goal}`);

  // 2a. Valid contribution
  const contribAmount = 100000;
  const beforeContrib = await getBalances(clientA, walletA.id, goalA.id);

  const { data: contribTx, error: contribErr } = await clientA.from('transactions').insert({
    user_id: userAId, wallet_id: walletA.id, goal_id: goalA.id,
    type: 'savings_contribution', amount: contribAmount,
    description: 'M2.18 contribution test', transaction_date: '2026-10-01'
  }).select().single();

  if (contribTx) cleanupTxIds.push(contribTx.id);

  const afterContrib = await getBalances(clientA, walletA.id, goalA.id);
  record('Contribution: valid',
    !contribErr && afterContrib.wallet === beforeContrib.wallet - contribAmount && afterContrib.goal === beforeContrib.goal + contribAmount,
    `wallet: ${beforeContrib.wallet} → ${afterContrib.wallet}, goal: ${beforeContrib.goal} → ${afterContrib.goal}`
  );

  // 2b. Contribution transaction created
  record('Contribution: transaction created',
    contribTx && contribTx.type === 'savings_contribution' && Number(contribTx.amount) === contribAmount,
    contribTx ? `id=${contribTx.id.slice(0,8)}…, type=${contribTx.type}` : 'no tx'
  );

  // 2c. Audit event for contribution
  const auditAfterContrib = contribTx ? await countAuditEventsForTx(clientA, contribTx.id) : 0;
  record('Contribution: audit event created',
    auditAfterContrib > 0,
    `${auditAfterContrib} audit event(s) since contribution`
  );

  // 2d. Insufficient wallet rejection
  const hugeAmount = 999999999999;
  const beforeBadContrib = await getBalances(clientA, walletA.id, goalA.id);
  const { error: badContribErr } = await clientA.from('transactions').insert({
    user_id: userAId, wallet_id: walletA.id, goal_id: goalA.id,
    type: 'savings_contribution', amount: hugeAmount,
    description: 'should fail', transaction_date: '2026-10-01'
  }).select().single();
  const afterBadContrib = await getBalances(clientA, walletA.id, goalA.id);

  record('Contribution: insufficient wallet rejected',
    !!badContribErr,
    badContribErr ? badContribErr.message.slice(0, 80) : 'no error'
  );
  record('Contribution: balances unchanged after rejection',
    afterBadContrib.wallet === beforeBadContrib.wallet && afterBadContrib.goal === beforeBadContrib.goal,
    `wallet: ${afterBadContrib.wallet}, goal: ${afterBadContrib.goal}`
  );

  // 2e. Cross-user wallet rejection
  const { error: crossWalletErr } = await clientA.from('transactions').insert({
    user_id: userAId, wallet_id: walletB.id, goal_id: goalA.id,
    type: 'savings_contribution', amount: 1000,
    description: 'cross-user', transaction_date: '2026-10-01'
  }).select().single();
  record('Contribution: cross-user wallet rejected',
    !!crossWalletErr,
    crossWalletErr ? 'blocked' : 'ERROR: allowed'
  );

  // 2f. Cross-user goal rejection
  const { error: crossGoalErr } = await clientA.from('transactions').insert({
    user_id: userAId, wallet_id: walletA.id, goal_id: goalB.id,
    type: 'savings_contribution', amount: 1000,
    description: 'cross-user goal', transaction_date: '2026-10-01'
  }).select().single();
  record('Contribution: cross-user goal rejected',
    !!crossGoalErr,
    crossGoalErr ? 'blocked' : 'ERROR: allowed'
  );

  // ========================================================================
  // WITHDRAWAL TESTS
  // ========================================================================
  console.log('\n--- Withdrawal Tests ---');

  const withdrawAmount = 50000;
  const beforeWithdraw = await getBalances(clientA, walletA.id, goalA.id);

  const { data: withdrawData, error: withdrawErr } = await clientA.rpc('execute_savings_withdrawal', {
    p_goal_id: goalA.id,
    p_destination_wallet_id: walletA.id,
    p_amount: withdrawAmount,
    p_reason: 'M2.18 withdrawal test',
    p_transaction_date: '2026-10-01',
    p_estimated_delay_days: 0
  });

  if (withdrawData?.transaction) cleanupTxIds.push(withdrawData.transaction.id);

  const afterWithdraw = await getBalances(clientA, walletA.id, goalA.id);
  record('Withdrawal: valid',
    !withdrawErr && afterWithdraw.wallet === beforeWithdraw.wallet + withdrawAmount && afterWithdraw.goal === beforeWithdraw.goal - withdrawAmount,
    `wallet: ${beforeWithdraw.wallet} → ${afterWithdraw.wallet}, goal: ${beforeWithdraw.goal} → ${afterWithdraw.goal}`
  );

  record('Withdrawal: transaction created',
    withdrawData?.transaction && withdrawData.transaction.type === 'savings_withdrawal',
    withdrawData?.transaction ? `id=${withdrawData.transaction.id.slice(0,8)}…` : 'no tx'
  );

  // Audit for withdrawal
  const withdrawTxId = withdrawData?.transaction?.id;
  const auditAfterWithdraw = withdrawTxId ? await countAuditEventsForTx(clientA, withdrawTxId) : 0;
  record('Withdrawal: audit events created',
    auditAfterWithdraw > 0,
    `${auditAfterWithdraw} audit event(s)`
  );

  // Insufficient goal rejection
  const beforeBadWithdraw = await getBalances(clientA, walletA.id, goalA.id);
  const { error: badWithdrawErr } = await clientA.rpc('execute_savings_withdrawal', {
    p_goal_id: goalA.id,
    p_destination_wallet_id: walletA.id,
    p_amount: 999999999999,
    p_reason: 'should fail',
    p_transaction_date: '2026-10-01',
    p_estimated_delay_days: 0
  });
  const afterBadWithdraw = await getBalances(clientA, walletA.id, goalA.id);
  record('Withdrawal: insufficient goal rejected',
    !!badWithdrawErr,
    badWithdrawErr ? badWithdrawErr.message.slice(0, 80) : 'no error'
  );
  record('Withdrawal: balances unchanged after rejection',
    afterBadWithdraw.wallet === beforeBadWithdraw.wallet && afterBadWithdraw.goal === beforeBadWithdraw.goal,
    'unchanged'
  );

  // Cross-user wallet rejection
  const { error: crossWWithdrawErr } = await clientA.rpc('execute_savings_withdrawal', {
    p_goal_id: goalA.id,
    p_destination_wallet_id: walletB.id,
    p_amount: 1000,
    p_reason: 'cross-user test',
    p_transaction_date: '2026-10-01',
    p_estimated_delay_days: 0
  });
  record('Withdrawal: cross-user wallet rejected',
    !!crossWWithdrawErr,
    crossWWithdrawErr ? 'blocked' : 'ERROR: allowed'
  );

  // Cross-user goal rejection
  const { error: crossGWithdrawErr } = await clientA.rpc('execute_savings_withdrawal', {
    p_goal_id: goalB.id,
    p_destination_wallet_id: walletA.id,
    p_amount: 1000,
    p_reason: 'cross-user test',
    p_transaction_date: '2026-10-01',
    p_estimated_delay_days: 0
  });
  record('Withdrawal: cross-user goal rejected',
    !!crossGWithdrawErr,
    crossGWithdrawErr ? 'blocked' : 'ERROR: allowed'
  );

  // ========================================================================
  // REVERSAL TESTS
  // ========================================================================
  console.log('\n--- Reversal Tests ---');

  // Create an income to reverse
  const revIncAmount = 200000;
  const { data: incForRev } = await clientA.from('transactions').insert({
    user_id: userAId, wallet_id: walletA.id, type: 'income',
    amount: revIncAmount, description: 'M2.18 income to reverse', transaction_date: '2026-10-01'
  }).select().single();
  if (incForRev) cleanupTxIds.push(incForRev.id);

  const beforeRev = await getBalances(clientA, walletA.id, goalA.id);

  const { data: revData, error: revErr } = await clientA.rpc('reverse_transaction', {
    p_transaction_id: incForRev.id,
    p_reason: 'M2.18 reversal test'
  });

  if (revData?.reversal_transaction) cleanupTxIds.push(revData.reversal_transaction.id);

  const afterRev = await getBalances(clientA, walletA.id, goalA.id);

  record('Reversal: income reversed successfully',
    !revErr && afterRev.wallet === beforeRev.wallet - revIncAmount,
    `wallet: ${beforeRev.wallet} → ${afterRev.wallet}`
  );

  record('Reversal: original unchanged',
    revData?.original_transaction &&
      Number(revData.original_transaction.amount) === revIncAmount &&
      revData.original_transaction.type === 'income',
    'original preserved'
  );

  record('Reversal: reversal created once',
    revData?.reversal_transaction &&
      revData.reversal_transaction.reversal_of_transaction_id === incForRev.id,
    revData?.reversal_transaction ? `rev_id=${revData.reversal_transaction.id.slice(0,8)}…` : 'no reversal'
  );

  // Duplicate reversal rejection
  const { error: dupRevErr } = await clientA.rpc('reverse_transaction', {
    p_transaction_id: incForRev.id,
    p_reason: 'duplicate attempt'
  });
  record('Reversal: duplicate rejected',
    !!dupRevErr,
    dupRevErr ? dupRevErr.message.slice(0, 60) : 'ERROR: allowed'
  );

  // Reversal-of-reversal rejection
  if (revData?.reversal_transaction) {
    const { error: revRevErr } = await clientA.rpc('reverse_transaction', {
      p_transaction_id: revData.reversal_transaction.id,
      p_reason: 'reverse the reversal'
    });
    record('Reversal: reversal-of-reversal rejected',
      !!revRevErr,
      revRevErr ? revRevErr.message.slice(0, 60) : 'ERROR: allowed'
    );
  }

  // Failed reversal leaves state unchanged
  const beforeFailedRev = await getBalances(clientA, walletA.id, goalA.id);
  const { error: failRevErr } = await clientA.rpc('reverse_transaction', {
    p_transaction_id: '00000000-0000-0000-0000-000000000000',
    p_reason: 'nonexistent transaction'
  });
  const afterFailedRev = await getBalances(clientA, walletA.id, goalA.id);
  record('Reversal: failed reversal leaves state unchanged',
    !!failRevErr && afterFailedRev.wallet === beforeFailedRev.wallet && afterFailedRev.goal === beforeFailedRev.goal,
    'unchanged'
  );

  // Audit linkage
  const revTxId = revData?.reversal_transaction?.id;
  const auditAfterRev = revTxId ? await countAuditEventsForTx(clientA, revTxId) : 0;
  record('Reversal: audit events created',
    auditAfterRev > 0,
    `${auditAfterRev} audit event(s)`
  );

  // Contribution reversal (goal-affecting)
  const contribForRev = 80000;
  // Seed additional income to cover the contribution
  const { data: seedTx2 } = await clientA.from('transactions').insert({
    user_id: userAId, wallet_id: walletA.id, type: 'income',
    amount: contribForRev * 2, description: 'M2.18 seed for contrib reversal', transaction_date: '2026-10-01'
  }).select().single();
  if (seedTx2) cleanupTxIds.push(seedTx2.id);

  const { data: contribToRev } = await clientA.from('transactions').insert({
    user_id: userAId, wallet_id: walletA.id, goal_id: goalA.id,
    type: 'savings_contribution', amount: contribForRev,
    description: 'M2.18 contrib to reverse', transaction_date: '2026-10-01'
  }).select().single();
  if (contribToRev) cleanupTxIds.push(contribToRev.id);

  const beforeContribRev = await getBalances(clientA, walletA.id, goalA.id);
  const { data: contribRevData, error: contribRevErr } = await clientA.rpc('reverse_transaction', {
    p_transaction_id: contribToRev.id,
    p_reason: 'M2.18 contribution reversal test'
  });
  if (contribRevData?.reversal_transaction) cleanupTxIds.push(contribRevData.reversal_transaction.id);

  const afterContribRev = await getBalances(clientA, walletA.id, goalA.id);
  record('Reversal: contribution reversed (wallet + goal corrected)',
    !contribRevErr &&
      afterContribRev.wallet === beforeContribRev.wallet + contribForRev &&
      afterContribRev.goal === beforeContribRev.goal - contribForRev,
    `wallet: ${beforeContribRev.wallet} → ${afterContribRev.wallet}, goal: ${beforeContribRev.goal} → ${afterContribRev.goal}`
  );

  // ========================================================================
  // CROSS-USER ISOLATION
  // ========================================================================
  console.log('\n--- Cross-User Isolation ---');

  // User B cannot see User A's wallets
  const { data: bSeesAWallets } = await clientB.from('wallets').select('id').eq('id', walletA.id);
  record('Isolation: B cannot see A wallets',
    !bSeesAWallets || bSeesAWallets.length === 0,
    `B sees ${bSeesAWallets?.length || 0} of A's wallets`
  );

  // User B cannot see User A's goals
  const { data: bSeesAGoals } = await clientB.from('goals').select('id').eq('id', goalA.id);
  record('Isolation: B cannot see A goals',
    !bSeesAGoals || bSeesAGoals.length === 0,
    `B sees ${bSeesAGoals?.length || 0} of A's goals`
  );

  // User B cannot see User A's transactions
  const { data: bSeesATx } = await clientB.from('transactions').select('id').eq('user_id', userAId).limit(1);
  record('Isolation: B cannot see A transactions',
    !bSeesATx || bSeesATx.length === 0,
    `B sees ${bSeesATx?.length || 0} of A's transactions`
  );

  // User B cannot see User A's audit events
  const { data: bSeesAAudit } = await clientB.from('financial_audit_events').select('id').eq('user_id', userAId).limit(1);
  record('Isolation: B cannot see A audit events',
    !bSeesAAudit || bSeesAAudit.length === 0,
    `B sees ${bSeesAAudit?.length || 0} of A's audit events`
  );

  // User B cannot see User A's monthly summaries
  const { data: bSeesASummaries } = await clientB.from('monthly_summaries').select('id').eq('user_id', userAId).limit(1);
  record('Isolation: B cannot see A monthly summaries',
    !bSeesASummaries || bSeesASummaries.length === 0,
    `B sees ${bSeesASummaries?.length || 0} of A's summaries`
  );

  // User B cannot reverse User A's transactions
  if (seedTx) {
    const { error: bRevAErr } = await clientB.rpc('reverse_transaction', {
      p_transaction_id: seedTx.id,
      p_reason: 'cross-user attempt'
    });
    record('Isolation: B cannot reverse A transactions',
      !!bRevAErr,
      bRevAErr ? 'blocked' : 'ERROR: allowed'
    );
  }

  // ========================================================================
  // RAPID REPEATED REQUESTS (lightweight concurrency)
  // ========================================================================
  console.log('\n--- Rapid Request Tests ---');

  // Create income to attempt rapid double-reversal
  const { data: rapidTx } = await clientA.from('transactions').insert({
    user_id: userAId, wallet_id: walletA.id, type: 'income',
    amount: 50000, description: 'M2.18 rapid test', transaction_date: '2026-10-01'
  }).select().single();
  if (rapidTx) cleanupTxIds.push(rapidTx.id);

  const rapidResults = await Promise.allSettled([
    clientA.rpc('reverse_transaction', { p_transaction_id: rapidTx.id, p_reason: 'rapid 1' }),
    clientA.rpc('reverse_transaction', { p_transaction_id: rapidTx.id, p_reason: 'rapid 2' }),
    clientA.rpc('reverse_transaction', { p_transaction_id: rapidTx.id, p_reason: 'rapid 3' }),
  ]);

  const rapidSuccesses = rapidResults.filter(r =>
    r.status === 'fulfilled' && r.value.data && !r.value.error
  );
  const rapidFailures = rapidResults.filter(r =>
    r.status === 'fulfilled' && r.value.error
  );

  // Track the reversal transaction for cleanup
  for (const r of rapidSuccesses) {
    if (r.value?.data?.reversal_transaction) {
      cleanupTxIds.push(r.value.data.reversal_transaction.id);
    }
  }

  record('Rapid reversal: exactly one succeeds',
    rapidSuccesses.length === 1,
    `${rapidSuccesses.length} success, ${rapidFailures.length} failures`
  );

  // ========================================================================
  // SUMMARY
  // ========================================================================
  console.log('\n=== Results ===');
  const passCount = results.filter(r => r.passed).length;
  const failCount = results.filter(r => !r.passed).length;
  console.log(`Total: ${passCount} passed, ${failCount} failed out of ${results.length}`);

  if (failCount > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => console.log(`  ✗ ${r.flow}: ${r.evidence}`));
  }

  // Cleanup note: test transactions remain for audit trail integrity.
  // They are isolated by user and do not affect other tests.
  console.log(`\nTest transactions created: ${cleanupTxIds.length}`);
  console.log('(Retained for audit trail completeness)\n');

  process.exit(failCount > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
