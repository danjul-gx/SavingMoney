/**
 * M2.20 — Remote Production Security & Authorization Boundary Verification
 *
 * Runs live penetration and boundary attack tests against Supabase
 * using two distinct authenticated users (User A & User B) as well as
 * an anonymous (unauthenticated) client.
 *
 * Tests:
 * 1. Anonymous Access Restrictions (RLS rejects all unauthenticated reads & writes)
 * 2. Cross-User Read Prevention (User A cannot read User B wallets, goals, transactions, audit events)
 * 3. Cross-User Mutation Prevention (User A cannot insert/update/delete User B rows)
 * 4. Cross-User Foreign Key Linking (User A cannot create a transaction referencing User B wallet/goal)
 * 5. Privileged RPC Attack: User B cannot reverse User A transaction
 * 6. Privileged RPC Attack: User A cannot withdraw from User B goal
 * 7. Privileged RPC Attack: User A cannot withdraw into User B wallet
 * 8. Audit Trail Immutability: Direct UPDATE/DELETE on financial_audit_events blocked
 * 9. Transaction Immutability: Updating immutable ledger columns blocked
 * 10. Ledger Manipulation: Negative amounts or non-existent types rejected by constraints
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
  console.log('=== M2.20 Remote Production Security & Boundary Verification ===\n');
  const results = [];

  function record(flow, passed, evidence) {
    results.push({ flow, passed, evidence });
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${flow}: ${evidence}`);
  }

  // --------------------------------------------------------------------------
  // 1. Clients & Authentication
  // --------------------------------------------------------------------------
  const anonClient = createClient(url, key);
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
  record('Authentication', true, `A=${userAId.slice(0, 8)}… B=${userBId.slice(0, 8)}…`);

  // Ensure baseline records exist for User B to attack
  let { data: walletB } = await clientB.from('wallets').select('*').limit(1).maybeSingle();
  if (!walletB) {
    const { data: w } = await clientB.from('wallets').insert({
      user_id: userBId, type: 'cash', label: 'Security Target Wallet B', balance: 0
    }).select().single();
    walletB = w;
  }

  let { data: goalB } = await clientB.from('goals').select('*').limit(1).maybeSingle();
  if (!goalB) {
    const { data: g } = await clientB.from('goals').insert({
      user_id: userBId, name: 'Security Target Goal B', target_amount: 1000000, current_amount: 0
    }).select().single();
    goalB = g;
  }

  let { data: walletA } = await clientA.from('wallets').select('*').limit(1).maybeSingle();
  let { data: txA } = await clientA.from('transactions').select('*').limit(1).maybeSingle();

  // --------------------------------------------------------------------------
  // 2. Anonymous Access Restrictions (RLS)
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Anonymous Access Restrictions ---');

  const { data: anonWallets } = await anonClient.from('wallets').select('*');
  record('Anon: Cannot read wallets', (anonWallets?.length || 0) === 0, `rows returned: ${anonWallets?.length || 0}`);

  const { data: anonTxs } = await anonClient.from('transactions').select('*');
  record('Anon: Cannot read transactions', (anonTxs?.length || 0) === 0, `rows returned: ${anonTxs?.length || 0}`);

  const { data: anonGoals } = await anonClient.from('goals').select('*');
  record('Anon: Cannot read goals', (anonGoals?.length || 0) === 0, `rows returned: ${anonGoals?.length || 0}`);

  const { data: anonAudit } = await anonClient.from('financial_audit_events').select('*');
  record('Anon: Cannot read audit events', (anonAudit?.length || 0) === 0, `rows returned: ${anonAudit?.length || 0}`);

  const { error: anonInsertErr } = await anonClient.from('wallets').insert({
    user_id: userAId, type: 'cash', label: 'Anon Hack Wallet', balance: 1000
  });
  record('Anon: Cannot insert wallet', !!anonInsertErr, `error: ${anonInsertErr?.message || 'none'}`);

  // --------------------------------------------------------------------------
  // 3. Cross-User Read Attacks (User A reads User B)
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Cross-User Read Attacks ---');

  const { data: readBWallet } = await clientA.from('wallets').select('*').eq('id', walletB.id);
  record('Isolation: User A cannot read User B wallet', (readBWallet?.length || 0) === 0, `rows: ${readBWallet?.length || 0}`);

  const { data: readBGoal } = await clientA.from('goals').select('*').eq('id', goalB.id);
  record('Isolation: User A cannot read User B goal', (readBGoal?.length || 0) === 0, `rows: ${readBGoal?.length || 0}`);

  const { data: readBAudit } = await clientA.from('financial_audit_events').select('*').eq('user_id', userBId);
  record('Isolation: User A cannot read User B audit events', (readBAudit?.length || 0) === 0, `rows: ${readBAudit?.length || 0}`);

  // --------------------------------------------------------------------------
  // 4. Cross-User Mutation Attacks
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Cross-User Mutation Attacks ---');

  // Attempt to update User B's wallet
  const { data: updateBWallet } = await clientA.from('wallets')
    .update({ label: 'Hacked by A' }).eq('id', walletB.id).select();
  record('Protection: User A cannot update User B wallet', (updateBWallet?.length || 0) === 0, `updated rows: ${updateBWallet?.length || 0}`);

  // Attempt to delete User B's goal
  const { data: deleteBGoal } = await clientA.from('goals')
    .delete().eq('id', goalB.id).select();
  record('Protection: User A cannot delete User B goal', (deleteBGoal?.length || 0) === 0, `deleted rows: ${deleteBGoal?.length || 0}`);

  // Attempt to insert transaction directly assigned to User B's user_id
  const { error: insertForeignTxErr } = await clientA.from('transactions').insert({
    user_id: userBId,
    wallet_id: walletA.id,
    type: 'income',
    amount: 50000,
    description: 'Forged foreign user_id transaction',
    transaction_date: '2026-10-02'
  });
  record('Protection: User A cannot forge transaction for User B user_id', !!insertForeignTxErr, `error: ${insertForeignTxErr?.message}`);

  // Attempt to insert transaction for User A but pointing to User B's wallet
  const { error: crossWalletTxErr } = await clientA.from('transactions').insert({
    user_id: userAId,
    wallet_id: walletB.id,
    type: 'income',
    amount: 50000,
    description: 'Cross-wallet transaction attack',
    transaction_date: '2026-10-02'
  });
  record('Protection: User A cannot attach transaction to User B wallet', !!crossWalletTxErr, `error: ${crossWalletTxErr?.message}`);

  // --------------------------------------------------------------------------
  // 5. Privileged RPC Boundary Attacks
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Privileged RPC Boundary Attacks ---');

  // Attack 1: User B tries to reverse User A's transaction
  if (txA) {
    const { error: rpcRevErr } = await clientB.rpc('reverse_transaction', {
      p_transaction_id: txA.id,
      p_reason: 'Malicious reversal attempt across users'
    });
    record('RPC Security: User B cannot reverse User A transaction', !!rpcRevErr, `error: ${rpcRevErr?.message}`);
  }

  // Attack 2: User A tries to withdraw from User B's goal into User A's wallet
  const { error: rpcWithGoalErr } = await clientA.rpc('execute_savings_withdrawal', {
    p_goal_id: goalB.id,
    p_destination_wallet_id: walletA.id,
    p_amount: 1000,
    p_reason: 'Malicious cross-user goal theft',
    p_transaction_date: '2026-10-02'
  });
  record('RPC Security: User A cannot withdraw from User B goal', !!rpcWithGoalErr, `error: ${rpcWithGoalErr?.message}`);

  // Attack 3: User A tries to withdraw from User A's goal into User B's wallet
  let { data: goalA } = await clientA.from('goals').select('*').limit(1).maybeSingle();
  if (goalA) {
    const { error: rpcWithWalletErr } = await clientA.rpc('execute_savings_withdrawal', {
      p_goal_id: goalA.id,
      p_destination_wallet_id: walletB.id,
      p_amount: 1000,
      p_reason: 'Malicious cross-user wallet injection',
      p_transaction_date: '2026-10-02'
    });
    record('RPC Security: User A cannot withdraw into User B wallet', !!rpcWithWalletErr, `error: ${rpcWithWalletErr?.message}`);
  }

  // --------------------------------------------------------------------------
  // 6. Immutability & Constraint Protections
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Immutability & Constraint Protections ---');

  // Direct UPDATE on financial_audit_events
  const { data: auditEventA } = await clientA.from('financial_audit_events').select('*').limit(1).maybeSingle();
  if (auditEventA) {
    const { data: updateRes, error: auditUpdateErr } = await clientA.from('financial_audit_events')
      .update({ event_type: 'tampered_event' })
      .eq('id', auditEventA.id)
      .select();
    const updateBlocked = !!auditUpdateErr || (updateRes?.length || 0) === 0;
    record('Audit Security: Direct UPDATE on financial_audit_events rejected/zero rows', updateBlocked, `error: ${auditUpdateErr?.message || 'none'}, updated: ${updateRes?.length || 0}`);

    const { data: deleteRes, error: auditDeleteErr } = await clientA.from('financial_audit_events')
      .delete()
      .eq('id', auditEventA.id)
      .select();
    const deleteBlocked = !!auditDeleteErr || (deleteRes?.length || 0) === 0;
    record('Audit Security: Direct DELETE on financial_audit_events rejected/zero rows', deleteBlocked, `error: ${auditDeleteErr?.message || 'none'}, deleted: ${deleteRes?.length || 0}`);
  }

  // Cross-user INSERT on financial_audit_events (trying to forge User B audit event)
  const { error: auditCrossInsertErr } = await clientA.from('financial_audit_events').insert({
    user_id: userBId,
    event_type: 'forged_event',
    entity_type: 'wallet'
  });
  record('Audit Security: Forged cross-user audit event rejected by RLS', !!auditCrossInsertErr, `error: ${auditCrossInsertErr?.message}`);

  // Ledger Immutability: User A tries to change transaction amount
  if (txA) {
    const { error: txTamperErr } = await clientA.from('transactions')
      .update({ amount: 999999999 })
      .eq('id', txA.id);
    record('Ledger Security: Modifying transaction amount rejected', !!txTamperErr, `error: ${txTamperErr?.message}`);
  }

  // Constraint: Negative transaction amount rejected
  const { error: negTxErr } = await clientA.from('transactions').insert({
    user_id: userAId,
    wallet_id: walletA.id,
    type: 'income',
    amount: -5000,
    description: 'Negative transaction attempt',
    transaction_date: '2026-10-02'
  });
  record('Constraint: Negative transaction amount rejected', !!negTxErr, `error: ${negTxErr?.message}`);

  // --------------------------------------------------------------------------
  // Results
  // --------------------------------------------------------------------------
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
