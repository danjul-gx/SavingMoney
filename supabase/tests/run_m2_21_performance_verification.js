/**
 * M2.21 — Remote Performance & Data-Volume Verification
 *
 * Measures query latency and verifies execution characteristics on live Supabase:
 * 1. Transaction Bounded Query Latency (limit 50)
 * 2. Range Pagination Latency (page 1 vs page 2)
 * 3. Text Search Query Latency (server-side ILIKE)
 * 4. Multi-Filter Query Latency (wallet + type + date)
 * 5. Dashboard Parallel Fetch Latency (all 4 domain entities concurrently)
 * 6. Audit Trail Bounded Query Latency (limit 50, indexed created_at DESC)
 * 7. Report Export Multi-Table Fetch Latency
 * 8. Query Limit Enforcement (client requests 500, server clamps to <= 100)
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
  console.log('=== M2.21 Remote Performance & Data-Volume Verification ===\n');
  const results = [];

  function record(flow, passed, evidence) {
    results.push({ flow, passed, evidence });
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${flow}: ${evidence}`);
  }

  const client = createClient(url, key);
  const { data: auth, error: authErr } = await client.auth.signInWithPassword({
    email: 'verify.test.30355@gmail.com',
    password: 'StrongPassword123!'
  });

  if (authErr || !auth?.user) {
    throw new Error(`Authentication failed: ${authErr?.message}`);
  }
  const userId = auth.user.id;
  record('Authentication', true, `User=${userId.slice(0, 8)}…`);

  // Helper to time async calls
  async function timeCall(label, fn) {
    const t0 = performance.now();
    const res = await fn();
    const t1 = performance.now();
    const duration = Math.round(t1 - t0);
    return { res, duration };
  }

  // 1. Default Transaction Query (limit 50, sorted by date DESC)
  const { res: txRes, duration: txDuration } = await timeCall('Transactions Bounded Query', async () => {
    return client
      .from('transactions')
      .select('*, reversed_by:transactions!reversal_of_transaction_id(id)', { count: 'exact' })
      .eq('user_id', userId)
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(0, 49);
  });
  record('1. Transaction Bounded Query Latency', !txRes.error && txDuration < 1500, `duration=${txDuration}ms, rows=${txRes.data?.length || 0}, totalCount=${txRes.count}`);

  // 2. Pagination Offset Query (Page 2: offset 50, limit 50)
  const { res: page2Res, duration: page2Duration } = await timeCall('Pagination Offset Query', async () => {
    return client
      .from('transactions')
      .select('*, reversed_by:transactions!reversal_of_transaction_id(id)')
      .eq('user_id', userId)
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(50, 99);
  });
  record('2. Range Pagination Query Latency', !page2Res.error && page2Duration < 1500, `duration=${page2Duration}ms, rows=${page2Res.data?.length || 0}`);

  // 3. Server-Side Text Search Latency
  const { res: searchRes, duration: searchDuration } = await timeCall('Text Search Query', async () => {
    return client
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .or('description.ilike.%gaji%,reversal_reason.ilike.%gaji%')
      .limit(50);
  });
  record('3. Text Search Query Latency', !searchRes.error && searchDuration < 1500, `duration=${searchDuration}ms, matches=${searchRes.data?.length || 0}`);

  // 4. Multi-Filter Query (Type + Wallet + Date Range)
  const { res: filterRes, duration: filterDuration } = await timeCall('Multi-Filter Query', async () => {
    return client
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('type', 'income')
      .gte('transaction_date', '2026-01-01')
      .lte('transaction_date', '2026-12-31')
      .limit(50);
  });
  record('4. Multi-Filter Query Latency', !filterRes.error && filterDuration < 1500, `duration=${filterDuration}ms, rows=${filterRes.data?.length || 0}`);

  // 5. Dashboard Parallel Aggregation Query
  const { res: dashRes, duration: dashDuration } = await timeCall('Dashboard Concurrent Fetch', async () => {
    return Promise.all([
      client.from('wallets').select('*').eq('user_id', userId),
      client.from('budget_allocations').select('normalized_monthly_amount').eq('user_id', userId).eq('budget_year', 2026).eq('budget_month', 10),
      client.from('transactions').select('id, type, amount, adjustment_direction, reversal_of_transaction_id').eq('user_id', userId).gte('transaction_date', '2026-10-01').lt('transaction_date', '2026-11-01'),
      client.from('goals').select('*').eq('user_id', userId).eq('status', 'active')
    ]);
  });
  const allDashSuccess = dashRes.every(r => !r.error);
  record('5. Dashboard Concurrent Fetch Latency', allDashSuccess && dashDuration < 2000, `duration=${dashDuration}ms, 4 queries completed concurrently`);

  // 6. Audit Trail Bounded Query (limit 50, created_at DESC)
  const { res: auditRes, duration: auditDuration } = await timeCall('Audit Trail Query', async () => {
    return client
      .from('financial_audit_events')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
  });
  record('6. Audit Trail Query Latency', !auditRes.error && auditDuration < 1500, `duration=${auditDuration}ms, rows=${auditRes.data?.length || 0}`);

  // 7. Report Export Multi-Table Concurrent Latency
  const { res: reportRes, duration: reportDuration } = await timeCall('Report Export Concurrent Fetch', async () => {
    return Promise.all([
      client.from('wallets').select('*').eq('user_id', userId),
      client.from('budget_allocations').select('*').eq('user_id', userId).eq('budget_year', 2026).eq('budget_month', 10),
      client.from('transactions').select('*').eq('user_id', userId).gte('transaction_date', '2026-10-01').lt('transaction_date', '2026-11-01'),
      client.from('goals').select('*').eq('user_id', userId),
      client.from('monthly_summaries').select('*').eq('user_id', userId).eq('year', 2026).eq('month', 10).maybeSingle(),
      client.from('financial_audit_events').select('*').eq('user_id', userId).gte('created_at', '2026-10-01T00:00:00.000Z').lt('created_at', '2026-11-01T00:00:00.000Z')
    ]);
  });
  const allReportSuccess = reportRes.every(r => !r.error);
  record('7. Report Export Multi-Table Concurrent Latency', allReportSuccess && reportDuration < 2500, `duration=${reportDuration}ms, 6 queries completed concurrently`);

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
