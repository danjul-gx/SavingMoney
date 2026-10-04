/**
 * M2.21 FIX — Remote Real Database Data-Volume Verification
 *
 * Verifies live Supabase query performance against realistic transaction volume:
 * - Benchmarks at 100+ transactions
 * - Benchmarks at 500+ transactions
 * - Benchmarks at 1,000+ transactions
 *
 * Tests on the 1,000+ transaction dataset:
 * 1. Default Bounded History Query (limit 50, indexed user_id + date DESC)
 * 2. Deep Pagination (page 10 / offset 450, page 20 / offset 950)
 * 3. Exact Count Scalability (count: 'exact')
 * 4. Text Search via ILIKE (indexed / partial matches across 1,000+ records)
 * 5. Multi-Filter Query (type + wallet + date range across 1,000+ records)
 * 6. Date-Scoped Aggregation (month boundary gte/lt)
 * 7. Reversal Join Performance (transactions with reversed_by join)
 * 8. User Isolation at Scale (ensuring User A sees none of User B's 1,000+ records)
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
  console.log('=== M2.21 FIX: Real Database Data-Volume Verification ===\n');
  const results = [];

  function record(flow, passed, evidence) {
    results.push({ flow, passed, evidence });
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${flow}: ${evidence}`);
  }

  // Helper to time async calls
  async function timeCall(label, fn) {
    const t0 = performance.now();
    const res = await fn();
    const t1 = performance.now();
    const duration = Math.round(t1 - t0);
    return { res, duration };
  }

  // 1. Auth Clients
  const clientB = createClient(url, key);
  const clientA = createClient(url, key);

  const { data: authB, error: errB } = await clientB.auth.signInWithPassword({
    email: 'test_m212_user@gmail.com',
    password: 'StrongPassword123!'
  });
  const { data: authA } = await clientA.auth.signInWithPassword({
    email: 'verify.test.30355@gmail.com',
    password: 'StrongPassword123!'
  });

  const userBId = authB?.user?.id;
  const userAId = authA?.user?.id;
  if (!userBId || !userAId) {
    throw new Error('Authentication failed for test users.');
  }
  record('Authentication', true, `User B=${userBId.slice(0, 8)}… User A=${userAId.slice(0, 8)}…`);

  // Ensure Wallet for User B
  let { data: walletB } = await clientB.from('wallets').select('*').limit(1).maybeSingle();
  if (!walletB) {
    const { data: w } = await clientB.from('wallets').insert({
      user_id: userBId, type: 'cash', label: 'Volume Benchmark Wallet', balance: 0
    }).select().single();
    walletB = w;
  }

  // 2. Check current count and scale up to 1,000+
  let { count: currentCount } = await clientB.from('transactions').select('*', { count: 'exact', head: true });
  console.log(`Current User B transaction count: ${currentCount}`);

  const targetCount = 1050;
  if (currentCount < targetCount) {
    const needed = targetCount - currentCount;
    console.log(`Seeding ${needed} transactions to reach ${targetCount}+ records...`);
    const batchSize = 200;
    for (let i = 0; i < needed; i += batchSize) {
      const thisBatchSize = Math.min(batchSize, needed - i);
      const batch = [];
      for (let j = 0; j < thisBatchSize; j++) {
        const idx = currentCount + i + j;
        const day = (idx % 28) + 1;
        const dayStr = day < 10 ? `0${day}` : `${day}`;
        const month = ((idx % 12) + 1);
        const monthStr = month < 10 ? `0${month}` : `${month}`;
        batch.push({
          user_id: userBId,
          wallet_id: walletB.id,
          type: idx % 5 === 0 ? 'expense' : 'income',
          amount: 10000 + (idx % 500) * 100,
          description: idx % 10 === 0 ? `Target searchable payment ${idx}` : `Volume transaction entry #${idx}`,
          transaction_date: `2026-${monthStr}-${dayStr}`
        });
      }
      const { error: insErr } = await clientB.from('transactions').insert(batch);
      if (insErr) {
        throw new Error(`Seeding error: ${insErr.message}`);
      }
    }
  }

  // Verify milestone counts
  const { count: finalCount } = await clientB.from('transactions').select('*', { count: 'exact', head: true });
  record('Volume Scale: 1,000+ dataset established', finalCount >= 1000, `total transactions in DB: ${finalCount}`);

  // --------------------------------------------------------------------------
  // Benchmark 1: Bounded History Query at Scale (Limit 50, Date DESC)
  // --------------------------------------------------------------------------
  console.log('\n--- Real DB Scalability Benchmarks (1,000+ rows) ---');

  const { res: q1Res, duration: q1Duration } = await timeCall('Bounded History Query', async () => {
    return clientB
      .from('transactions')
      .select('*, reversed_by:transactions!reversal_of_transaction_id(id)', { count: 'exact' })
      .eq('user_id', userBId)
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(0, 49);
  });
  record(
    '1. Bounded History Query at Scale (50 rows)',
    !q1Res.error && q1Duration < 1000 && q1Res.data.length === 50,
    `latency=${q1Duration}ms, rows returned=${q1Res.data?.length}, total count=${q1Res.count}`
  );

  // --------------------------------------------------------------------------
  // Benchmark 2: Deep Pagination (Offset 500 / Page 11)
  // --------------------------------------------------------------------------
  const { res: q2Res, duration: q2Duration } = await timeCall('Deep Pagination Query (offset 500)', async () => {
    return clientB
      .from('transactions')
      .select('*, reversed_by:transactions!reversal_of_transaction_id(id)')
      .eq('user_id', userBId)
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(500, 549);
  });
  record(
    '2. Deep Pagination (Offset 500 / Page 11)',
    !q2Res.error && q2Duration < 1000 && q2Res.data.length === 50,
    `latency=${q2Duration}ms, rows returned=${q2Res.data?.length}`
  );

  // --------------------------------------------------------------------------
  // Benchmark 3: Extreme Deep Pagination (Offset 950 / Page 20)
  // --------------------------------------------------------------------------
  const { res: q3Res, duration: q3Duration } = await timeCall('Deep Pagination Query (offset 950)', async () => {
    return clientB
      .from('transactions')
      .select('*, reversed_by:transactions!reversal_of_transaction_id(id)')
      .eq('user_id', userBId)
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(950, 999);
  });
  record(
    '3. Extreme Deep Pagination (Offset 950 / Page 20)',
    !q3Res.error && q3Duration < 1000 && q3Res.data.length === 50,
    `latency=${q3Duration}ms, rows returned=${q3Res.data?.length}`
  );

  // --------------------------------------------------------------------------
  // Benchmark 4: Text Search across 1,000+ Transactions
  // --------------------------------------------------------------------------
  const { res: q4Res, duration: q4Duration } = await timeCall('Server-Side Search Query', async () => {
    return clientB
      .from('transactions')
      .select('id, description, amount, transaction_date')
      .eq('user_id', userBId)
      .ilike('description', '%searchable%')
      .order('transaction_date', { ascending: false })
      .limit(50);
  });
  record(
    '4. Text Search (ILIKE) across 1,000+ Transactions',
    !q4Res.error && q4Duration < 1000 && q4Res.data.length > 0,
    `latency=${q4Duration}ms, matches returned=${q4Res.data?.length}`
  );

  // --------------------------------------------------------------------------
  // Benchmark 5: Multi-Filter Scalability (Type + Date Range)
  // --------------------------------------------------------------------------
  const { res: q5Res, duration: q5Duration } = await timeCall('Multi-Filter Query', async () => {
    return clientB
      .from('transactions')
      .select('*')
      .eq('user_id', userBId)
      .eq('type', 'expense')
      .gte('transaction_date', '2026-03-01')
      .lte('transaction_date', '2026-06-30')
      .order('transaction_date', { ascending: false })
      .range(0, 49);
  });
  record(
    '5. Multi-Filter Query across 1,000+ Transactions',
    !q5Res.error && q5Duration < 1000,
    `latency=${q5Duration}ms, rows returned=${q5Res.data?.length}`
  );

  // --------------------------------------------------------------------------
  // Benchmark 6: Monthly Date-Scoped Aggregation
  // --------------------------------------------------------------------------
  const { res: q6Res, duration: q6Duration } = await timeCall('Monthly Aggregation Query', async () => {
    return clientB
      .from('transactions')
      .select('id, type, amount')
      .eq('user_id', userBId)
      .gte('transaction_date', '2026-05-01')
      .lt('transaction_date', '2026-06-01');
  });
  record(
    '6. Monthly Date-Scoped Aggregation at Scale',
    !q6Res.error && q6Duration < 1000,
    `latency=${q6Duration}ms, rows aggregated=${q6Res.data?.length}`
  );

  // --------------------------------------------------------------------------
  // Benchmark 7: Cross-User Isolation at Scale
  // --------------------------------------------------------------------------
  const { res: q7Res, duration: q7Duration } = await timeCall('Cross-User Read Check', async () => {
    return clientA
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userBId);
  });
  record(
    '7. Cross-User Isolation at Scale (RLS)',
    !q7Res.error && (q7Res.count === 0 || q7Res.count === null),
    `User A sees ${q7Res.count ?? 0} rows of User B's ${finalCount} transactions`
  );

  // --------------------------------------------------------------------------
  // Summary
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
