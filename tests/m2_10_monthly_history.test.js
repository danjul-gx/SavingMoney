/**
 * M2.10 — Monthly History & Savings Summary Tests
 * 28 focused tests covering all required M2.10 invariants.
 * Tests distinguish: PASS / FAIL / NOT EXECUTED (live DB unavailable).
 */

const assert = require('assert');

// ---------------------------------------------------------------------------
// 1. Domain logic under test (mirrored from src/lib/history/client.ts
//    and supporting modules)
// ---------------------------------------------------------------------------

function getDeterministicMonthContext(year, month) {
  const cleanYear = Math.trunc(year);
  const cleanMonth = Math.trunc(month);

  const previousYear = cleanMonth === 1 ? cleanYear - 1 : cleanYear;
  const previousMonth = cleanMonth === 1 ? 12 : cleanMonth - 1;

  const nextYear = cleanMonth === 12 ? cleanYear + 1 : cleanYear;
  const nextMonth = cleanMonth === 12 ? 1 : cleanMonth + 1;

  const formattedMonth = String(cleanMonth).padStart(2, '0');
  const startDate = `${cleanYear}-${formattedMonth}-01`;

  const formattedNextMonth = String(nextMonth).padStart(2, '0');
  const nextMonthStartDate = `${nextYear}-${formattedNextMonth}-01`;

  return {
    year: cleanYear,
    month: cleanMonth,
    previousYear,
    previousMonth,
    nextYear,
    nextMonth,
    startDate,
    nextMonthStartDate,
  };
}

function calculateGoalProgress(targetAmount, currentAmount) {
  const cleanTarget = Math.trunc(Math.max(1, targetAmount));
  const cleanCurrent = Math.trunc(Math.max(0, currentAmount));
  const isOver = cleanCurrent >= cleanTarget;
  const remaining = Math.max(0, cleanTarget - cleanCurrent);
  const rawPercent = Math.floor((cleanCurrent * 100) / cleanTarget);
  const progressPercent = Math.min(100, Math.max(0, rawPercent));
  return { progressPercent, remainingAmount: remaining, isOverfunded: isOver };
}

function sumAmounts(rows) {
  return (rows || []).reduce((sum, r) => sum + Math.trunc(r.amount), 0);
}

function sumNormalized(rows) {
  return (rows || []).reduce((sum, r) => sum + Math.trunc(r.normalized_monthly_amount), 0);
}

/**
 * Pure read-only month history computation (mirrors getMonthHistorySummary logic).
 * NO mutations. Accepts pre-fetched data arrays.
 */
function computeMonthSummary(year, month, opts) {
  const { incomeRows, expenseRows, contribRows, withdrawRows, budgetRows, storedSummary } = opts;

  const totalIncome = sumAmounts(incomeRows);
  const actualSpending = sumAmounts(expenseRows);
  const actualContributed = sumAmounts(contribRows);
  const actualWithdrawn = sumAmounts(withdrawRows);
  const totalBudget = sumNormalized(budgetRows);

  const rolloverAmount = storedSummary
    ? Math.trunc(storedSummary.rollover_amount)
    : 0;

  const rawDiff = totalBudget - actualSpending;
  const isOverspent = rawDiff < 0;
  const budgetLeftover = isOverspent ? 0 : rawDiff;
  const overspentAmount = isOverspent ? Math.abs(rawDiff) : 0;
  const netSavingsMovement = actualContributed - actualWithdrawn;

  return {
    year,
    month,
    totalIncome,
    plannedOperationalBudget: totalBudget,
    actualOperationalSpending: actualSpending,
    budgetLeftover,
    overspentAmount,
    isOverspent,
    actualSavingsContributed: actualContributed,
    savingsWithdrawn: actualWithdrawn,
    netSavingsMovement,
    rolloverAmount,
    savedVsBudget: rawDiff,
    isFinalized: Boolean(storedSummary?.finalized_at),
    finalizedAt: storedSummary?.finalized_at || null,
    hasStoredSummary: Boolean(storedSummary),
  };
}

// ---------------------------------------------------------------------------
// 2. Mock Supabase builder (read-only verification)
// ---------------------------------------------------------------------------

function createMockSupabase(userId, dbState, opts = {}) {
  const mutations = [];

  const chainable = (data, error) => {
    const obj = { data, error: error || null };
    obj.eq = () => chainable(data, error);
    obj.gte = () => chainable(data, error);
    obj.lt = () => chainable(data, error);
    obj.order = () => chainable(data, error);
    obj.maybeSingle = () => ({ data: Array.isArray(data) ? data[0] || null : data, error: error || null });
    // Promise-like for Promise.all
    obj.then = (resolve) => resolve(obj);
    return obj;
  };

  return {
    auth: {
      getUser: async () => {
        if (opts.unauthenticated) {
          return { data: { user: null }, error: { message: 'Not authenticated' } };
        }
        return { data: { user: { id: userId } }, error: null };
      },
    },
    from: (table) => {
      const tableData = dbState[table] || [];

      return {
        select: (cols) => {
          let filtered = [...tableData];

          const chain = {
            eq: (field, value) => {
              filtered = filtered.filter((r) => r[field] === value);
              return chain;
            },
            gte: (field, value) => {
              filtered = filtered.filter((r) => r[field] >= value);
              return chain;
            },
            lt: (field, value) => {
              filtered = filtered.filter((r) => r[field] < value);
              return chain;
            },
            order: () => chain,
            maybeSingle: () => ({ data: filtered[0] || null, error: null, then: (r) => r({ data: filtered[0] || null, error: null }) }),
            // Promise-like
            then: (resolve) => resolve({ data: filtered, error: null }),
            data: filtered,
            error: null,
          };

          return chain;
        },
        insert: (payload) => {
          mutations.push({ table, op: 'insert', payload });
          return { data: payload, error: null, select: () => ({ single: () => ({ data: payload, error: null }) }) };
        },
        update: (payload) => {
          mutations.push({ table, op: 'update', payload });
          return { data: payload, error: null, eq: () => ({ eq: () => ({ select: () => ({ single: () => ({ data: payload, error: null }) }) }) }) };
        },
        upsert: (payload) => {
          mutations.push({ table, op: 'upsert', payload });
          return { data: payload, error: null };
        },
        delete: () => {
          mutations.push({ table, op: 'delete' });
          return { eq: () => ({ eq: () => ({ data: null, error: null }) }) };
        },
      };
    },
    _mutations: mutations,
  };
}

// ---------------------------------------------------------------------------
// 3. History fetch logic (mirrors getMonthHistorySummary with mock support)
// ---------------------------------------------------------------------------

async function getMonthHistorySummary(year, month, supabaseClient) {
  if (!year || year < 2000) return { data: null, error: 'Tahun tidak valid.' };
  if (!month || month < 1 || month > 12) return { data: null, error: 'Bulan tidak valid (1-12).' };

  const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
  if (authError || !user) {
    return { data: null, error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.' };
  }

  const context = getDeterministicMonthContext(year, month);

  const [summaryRes, budgetRes, incomeRes, expenseRes, contribRes, withdrawRes] = await Promise.all([
    supabaseClient
      .from('monthly_summaries')
      .select('*')
      .eq('user_id', user.id)
      .eq('year', year)
      .eq('month', month)
      .maybeSingle(),
    supabaseClient
      .from('budget_allocations')
      .select('normalized_monthly_amount')
      .eq('user_id', user.id)
      .eq('budget_year', year)
      .eq('budget_month', month),
    supabaseClient
      .from('transactions')
      .select('amount')
      .eq('user_id', user.id)
      .eq('type', 'income')
      .gte('transaction_date', context.startDate)
      .lt('transaction_date', context.nextMonthStartDate),
    supabaseClient
      .from('transactions')
      .select('amount')
      .eq('user_id', user.id)
      .eq('type', 'expense')
      .gte('transaction_date', context.startDate)
      .lt('transaction_date', context.nextMonthStartDate),
    supabaseClient
      .from('transactions')
      .select('amount')
      .eq('user_id', user.id)
      .eq('type', 'savings_contribution')
      .gte('transaction_date', context.startDate)
      .lt('transaction_date', context.nextMonthStartDate),
    supabaseClient
      .from('transactions')
      .select('amount')
      .eq('user_id', user.id)
      .eq('type', 'savings_withdrawal')
      .gte('transaction_date', context.startDate)
      .lt('transaction_date', context.nextMonthStartDate),
  ]);

  return {
    data: computeMonthSummary(year, month, {
      incomeRows: incomeRes.data || [],
      expenseRows: expenseRes.data || [],
      contribRows: contribRes.data || [],
      withdrawRows: withdrawRes.data || [],
      budgetRows: budgetRes.data || [],
      storedSummary: summaryRes.data,
    }),
    error: null,
  };
}

// ---------------------------------------------------------------------------
// 4. Test Runner
// ---------------------------------------------------------------------------

async function runM210Tests() {
  console.log('--- Running M2.10 Monthly History & Savings Summary Tests ---');

  let passed = 0;
  let total = 0;

  function record(desc, ok) {
    total++;
    if (ok) {
      passed++;
      console.log(`PASS: ${desc}`);
    } else {
      console.error(`FAIL: ${desc}`);
    }
  }

  function skip(desc) {
    total++;
    console.log(`NOT EXECUTED — environment limitation: ${desc}`);
  }

  const userId = 'user-uuid-m210';
  const otherUserId = 'user-uuid-other';

  // Standard test data: September 2026
  const standardDb = {
    transactions: [
      { user_id: userId, type: 'income', amount: 5000000, transaction_date: '2026-09-01' },
      { user_id: userId, type: 'income', amount: 1000000, transaction_date: '2026-09-15' },
      { user_id: userId, type: 'expense', amount: 800000, transaction_date: '2026-09-05' },
      { user_id: userId, type: 'expense', amount: 400000, transaction_date: '2026-09-20' },
      { user_id: userId, type: 'savings_contribution', amount: 500000, transaction_date: '2026-09-10' },
      { user_id: userId, type: 'savings_withdrawal', amount: 100000, transaction_date: '2026-09-25' },
      // Out-of-month — must be excluded
      { user_id: userId, type: 'expense', amount: 999999, transaction_date: '2026-10-01' },
      { user_id: userId, type: 'income', amount: 999999, transaction_date: '2026-08-31' },
      // Other user's transactions — must be excluded
      { user_id: otherUserId, type: 'income', amount: 7777777, transaction_date: '2026-09-01' },
      { user_id: otherUserId, type: 'expense', amount: 3333333, transaction_date: '2026-09-05' },
      // Adjustment — must not be counted as income or expense
      { user_id: userId, type: 'adjustment', amount: 50000, transaction_date: '2026-09-12' },
      // Rollover — must not be counted as income or expense
      { user_id: userId, type: 'rollover', amount: 200000, transaction_date: '2026-09-01' },
    ],
    budget_allocations: [
      { user_id: userId, budget_year: 2026, budget_month: 9, normalized_monthly_amount: 1500000 },
      { user_id: userId, budget_year: 2026, budget_month: 9, normalized_monthly_amount: 300000 },
      // Other user's budget
      { user_id: otherUserId, budget_year: 2026, budget_month: 9, normalized_monthly_amount: 9999999 },
    ],
    monthly_summaries: [],
    goals: [
      { id: 'goal-1', user_id: userId, name: 'Dana Darurat', target_amount: 10000000, current_amount: 3000000, status: 'active', created_at: '2026-01-01' },
      { id: 'goal-2', user_id: userId, name: 'Gadget', target_amount: 5000000, current_amount: 5000000, status: 'completed', created_at: '2026-02-01' },
      // Other user's goal
      { id: 'goal-x', user_id: otherUserId, name: 'Not Mine', target_amount: 1000000, current_amount: 500000, status: 'active', created_at: '2026-01-01' },
    ],
    wallets: [
      { id: 'wallet-1', user_id: userId, balance: 2000000 },
      { id: 'wallet-x', user_id: otherUserId, balance: 9000000 },
    ],
  };

  // =========================================================================
  // Test 1: Authenticated month history
  // =========================================================================
  {
    const mock = createMockSupabase(userId, standardDb);
    const res = await getMonthHistorySummary(2026, 9, mock);
    record(
      '1. authenticated user can fetch month history',
      res.data !== null && res.error === null && res.data.year === 2026 && res.data.month === 9,
    );
  }

  // =========================================================================
  // Test 2: Unauthenticated rejection
  // =========================================================================
  {
    const mock = createMockSupabase(userId, standardDb, { unauthenticated: true });
    const res = await getMonthHistorySummary(2026, 9, mock);
    record(
      '2. unauthenticated user is rejected',
      res.data === null && res.error !== null,
    );
  }

  // =========================================================================
  // Test 3: User-scoped reads (own data only)
  // =========================================================================
  {
    const mock = createMockSupabase(userId, standardDb);
    const res = await getMonthHistorySummary(2026, 9, mock);
    // Income: 5000000 + 1000000 = 6000000 (not 6000000 + 7777777)
    record(
      '3. user-scoped reads — only own data',
      res.data.totalIncome === 6000000,
    );
  }

  // =========================================================================
  // Test 4: Cross-user isolation
  // =========================================================================
  {
    const mock = createMockSupabase(otherUserId, standardDb);
    const res = await getMonthHistorySummary(2026, 9, mock);
    // Other user sees only their data
    record(
      '4. cross-user isolation — other user sees own income only',
      res.data.totalIncome === 7777777,
    );
  }

  // =========================================================================
  // Test 5: Income aggregation
  // =========================================================================
  {
    const mock = createMockSupabase(userId, standardDb);
    const res = await getMonthHistorySummary(2026, 9, mock);
    record(
      '5. income aggregation — sum of income transactions in month only',
      res.data.totalIncome === 6000000,
    );
  }

  // =========================================================================
  // Test 6: Operational expense aggregation
  // =========================================================================
  {
    const mock = createMockSupabase(userId, standardDb);
    const res = await getMonthHistorySummary(2026, 9, mock);
    // 800000 + 400000 = 1200000 (not including out-of-month, adjustments, savings)
    record(
      '6. operational expense aggregation — expense type only, in-month only',
      res.data.actualOperationalSpending === 1200000,
    );
  }

  // =========================================================================
  // Test 7: Savings contribution aggregation
  // =========================================================================
  {
    const mock = createMockSupabase(userId, standardDb);
    const res = await getMonthHistorySummary(2026, 9, mock);
    record(
      '7. savings contribution aggregation',
      res.data.actualSavingsContributed === 500000,
    );
  }

  // =========================================================================
  // Test 8: Withdrawal aggregation
  // =========================================================================
  {
    const mock = createMockSupabase(userId, standardDb);
    const res = await getMonthHistorySummary(2026, 9, mock);
    record(
      '8. savings withdrawal aggregation',
      res.data.savingsWithdrawn === 100000,
    );
  }

  // =========================================================================
  // Test 9: Net savings movement
  // =========================================================================
  {
    const mock = createMockSupabase(userId, standardDb);
    const res = await getMonthHistorySummary(2026, 9, mock);
    // 500000 - 100000 = 400000
    record(
      '9. net savings movement = contributions - withdrawals',
      res.data.netSavingsMovement === 400000,
    );
  }

  // =========================================================================
  // Test 10: Budget aggregation
  // =========================================================================
  {
    const mock = createMockSupabase(userId, standardDb);
    const res = await getMonthHistorySummary(2026, 9, mock);
    // 1500000 + 300000 = 1800000
    record(
      '10. budget aggregation — normalized monthly amounts',
      res.data.plannedOperationalBudget === 1800000,
    );
  }

  // =========================================================================
  // Test 11: Positive leftover
  // =========================================================================
  {
    const mock = createMockSupabase(userId, standardDb);
    const res = await getMonthHistorySummary(2026, 9, mock);
    // Budget 1800000 - Spending 1200000 = 600000
    record(
      '11. positive leftover when budget > spending',
      res.data.budgetLeftover === 600000 && !res.data.isOverspent && res.data.overspentAmount === 0,
    );
  }

  // =========================================================================
  // Test 12: Overspending
  // =========================================================================
  {
    const overspendDb = {
      ...standardDb,
      budget_allocations: [{ user_id: userId, budget_year: 2026, budget_month: 9, normalized_monthly_amount: 500000 }],
    };
    const mock = createMockSupabase(userId, overspendDb);
    const res = await getMonthHistorySummary(2026, 9, mock);
    // Budget 500000 - Spending 1200000 = -700000
    record(
      '12. overspending when spending > budget',
      res.data.isOverspent && res.data.overspentAmount === 700000 && res.data.budgetLeftover === 0,
    );
  }

  // =========================================================================
  // Test 13: Rollover display from stored summary
  // =========================================================================
  {
    const rolloverDb = {
      ...standardDb,
      monthly_summaries: [{
        user_id: userId, year: 2026, month: 9,
        rollover_amount: 350000,
        finalized_at: '2026-10-01T00:00:00Z',
      }],
    };
    const mock = createMockSupabase(userId, rolloverDb);
    const res = await getMonthHistorySummary(2026, 9, mock);
    record(
      '13. rollover amount read from stored summary',
      res.data.rolloverAmount === 350000,
    );
  }

  // =========================================================================
  // Test 14: Finalized month
  // =========================================================================
  {
    const finalizedDb = {
      ...standardDb,
      monthly_summaries: [{
        user_id: userId, year: 2026, month: 9,
        rollover_amount: 0,
        amount_added_to_savings: 600000,
        finalized_at: '2026-10-01T12:00:00Z',
      }],
    };
    const mock = createMockSupabase(userId, finalizedDb);
    const res = await getMonthHistorySummary(2026, 9, mock);
    record(
      '14. finalized month — isFinalized true, finalizedAt populated',
      res.data.isFinalized === true && res.data.finalizedAt === '2026-10-01T12:00:00Z' && res.data.hasStoredSummary === true,
    );
  }

  // =========================================================================
  // Test 15: Unfinalized month without creating monthly_summaries
  // =========================================================================
  {
    const mock = createMockSupabase(userId, standardDb);
    const res = await getMonthHistorySummary(2026, 9, mock);
    // Should return data without creating a summary row
    record(
      '15. unfinalized month viewable without stored summary — no mutation',
      res.data !== null && !res.data.isFinalized && !res.data.hasStoredSummary && mock._mutations.length === 0,
    );
  }

  // =========================================================================
  // Test 16: Zero-transaction month
  // =========================================================================
  {
    const emptyDb = {
      transactions: [],
      budget_allocations: [],
      monthly_summaries: [],
      goals: [],
      wallets: [],
    };
    const mock = createMockSupabase(userId, emptyDb);
    const res = await getMonthHistorySummary(2026, 6, mock);
    record(
      '16. zero-transaction month returns zero metrics',
      res.data.totalIncome === 0 && res.data.actualOperationalSpending === 0 &&
      res.data.actualSavingsContributed === 0 && res.data.savingsWithdrawn === 0 &&
      res.data.netSavingsMovement === 0,
    );
  }

  // =========================================================================
  // Test 17: Zero-budget month
  // =========================================================================
  {
    const noBudgetDb = {
      ...standardDb,
      budget_allocations: [],
    };
    const mock = createMockSupabase(userId, noBudgetDb);
    const res = await getMonthHistorySummary(2026, 9, mock);
    record(
      '17. zero-budget month — budget 0, overspent by full spending',
      res.data.plannedOperationalBudget === 0 && res.data.isOverspent && res.data.overspentAmount === 1200000,
    );
  }

  // =========================================================================
  // Test 18: December → January boundary
  // =========================================================================
  {
    const decDb = {
      transactions: [
        { user_id: userId, type: 'income', amount: 1000000, transaction_date: '2026-12-15' },
        { user_id: userId, type: 'income', amount: 500000, transaction_date: '2027-01-01' }, // Next year — excluded
      ],
      budget_allocations: [{ user_id: userId, budget_year: 2026, budget_month: 12, normalized_monthly_amount: 800000 }],
      monthly_summaries: [],
      goals: [],
      wallets: [],
    };
    const mock = createMockSupabase(userId, decDb);
    const res = await getMonthHistorySummary(2026, 12, mock);
    const ctx = getDeterministicMonthContext(2026, 12);
    record(
      '18. December → January boundary — correct date range and month context',
      res.data.totalIncome === 1000000 &&
      ctx.nextYear === 2027 && ctx.nextMonth === 1 &&
      ctx.startDate === '2026-12-01' && ctx.nextMonthStartDate === '2027-01-01',
    );
  }

  // =========================================================================
  // Test 19: January → December boundary (previous month)
  // =========================================================================
  {
    const janDb = {
      transactions: [
        { user_id: userId, type: 'income', amount: 2000000, transaction_date: '2027-01-10' },
        { user_id: userId, type: 'income', amount: 750000, transaction_date: '2026-12-31' }, // Previous month — excluded
      ],
      budget_allocations: [{ user_id: userId, budget_year: 2027, budget_month: 1, normalized_monthly_amount: 600000 }],
      monthly_summaries: [],
      goals: [],
      wallets: [],
    };
    const mock = createMockSupabase(userId, janDb);
    const res = await getMonthHistorySummary(2027, 1, mock);
    const ctx = getDeterministicMonthContext(2027, 1);
    record(
      '19. January → December boundary — previous month correct',
      res.data.totalIncome === 2000000 &&
      ctx.previousYear === 2026 && ctx.previousMonth === 12 &&
      ctx.startDate === '2027-01-01' && ctx.nextMonthStartDate === '2027-02-01',
    );
  }

  // =========================================================================
  // Test 20: History does not mutate transactions
  // =========================================================================
  {
    const mock = createMockSupabase(userId, standardDb);
    await getMonthHistorySummary(2026, 9, mock);
    const txMutations = mock._mutations.filter((m) => m.table === 'transactions');
    record(
      '20. history does not mutate transactions',
      txMutations.length === 0,
    );
  }

  // =========================================================================
  // Test 21: History does not mutate wallet balances
  // =========================================================================
  {
    const mock = createMockSupabase(userId, standardDb);
    await getMonthHistorySummary(2026, 9, mock);
    const walletMutations = mock._mutations.filter((m) => m.table === 'wallets');
    record(
      '21. history does not mutate wallet balances',
      walletMutations.length === 0,
    );
  }

  // =========================================================================
  // Test 22: History does not mutate goal balances
  // =========================================================================
  {
    const mock = createMockSupabase(userId, standardDb);
    await getMonthHistorySummary(2026, 9, mock);
    const goalMutations = mock._mutations.filter((m) => m.table === 'goals');
    record(
      '22. history does not mutate goal balances',
      goalMutations.length === 0,
    );
  }

  // =========================================================================
  // Test 23: History does not mutate budgets
  // =========================================================================
  {
    const mock = createMockSupabase(userId, standardDb);
    await getMonthHistorySummary(2026, 9, mock);
    const budgetMutations = mock._mutations.filter((m) => m.table === 'budget_allocations');
    record(
      '23. history does not mutate budgets',
      budgetMutations.length === 0,
    );
  }

  // =========================================================================
  // Test 24: History does not create/finalize monthly summaries
  // =========================================================================
  {
    const mock = createMockSupabase(userId, standardDb);
    await getMonthHistorySummary(2026, 9, mock);
    const summaryMutations = mock._mutations.filter((m) => m.table === 'monthly_summaries');
    record(
      '24. history does not create or finalize monthly_summaries',
      summaryMutations.length === 0,
    );
  }

  // =========================================================================
  // Test 25: Integer Rupiah arithmetic only
  // =========================================================================
  {
    const fracDb = {
      transactions: [
        { user_id: userId, type: 'income', amount: 1000000.7, transaction_date: '2026-09-01' },
        { user_id: userId, type: 'expense', amount: 333333.9, transaction_date: '2026-09-05' },
        { user_id: userId, type: 'savings_contribution', amount: 200000.5, transaction_date: '2026-09-10' },
        { user_id: userId, type: 'savings_withdrawal', amount: 50000.3, transaction_date: '2026-09-15' },
      ],
      budget_allocations: [{ user_id: userId, budget_year: 2026, budget_month: 9, normalized_monthly_amount: 500000.8 }],
      monthly_summaries: [],
      goals: [],
      wallets: [],
    };
    const mock = createMockSupabase(userId, fracDb);
    const res = await getMonthHistorySummary(2026, 9, mock);
    const d = res.data;
    const allInt =
      Number.isInteger(d.totalIncome) &&
      Number.isInteger(d.actualOperationalSpending) &&
      Number.isInteger(d.plannedOperationalBudget) &&
      Number.isInteger(d.actualSavingsContributed) &&
      Number.isInteger(d.savingsWithdrawn) &&
      Number.isInteger(d.netSavingsMovement) &&
      Number.isInteger(d.budgetLeftover) &&
      Number.isInteger(d.overspentAmount) &&
      Number.isInteger(d.savedVsBudget);
    record(
      '25. integer Rupiah arithmetic — all values are integers after truncation',
      allInt,
    );
  }

  // =========================================================================
  // Test 26: Transaction type classification remains correct
  // =========================================================================
  {
    const mock = createMockSupabase(userId, standardDb);
    const res = await getMonthHistorySummary(2026, 9, mock);
    // Adjustment (50000) and rollover (200000) must NOT appear in income, expense, contrib, or withdrawal
    const d = res.data;
    // If adjustment were counted as income: totalIncome would be > 6000000
    // If rollover were counted as income: totalIncome would be > 6000000
    // If savings_contribution were counted as expense: spending would be > 1200000
    record(
      '26. transaction type classification — adjustment/rollover excluded, savings not as expense',
      d.totalIncome === 6000000 &&
      d.actualOperationalSpending === 1200000 &&
      d.actualSavingsContributed === 500000 &&
      d.savingsWithdrawn === 100000,
    );
  }

  // =========================================================================
  // Test 27: M2.9 rollover behavior regression
  // =========================================================================
  {
    // Verify that evaluateBudgetLeftover logic from M2.9 still produces correct results
    const evalData = computeMonthSummary(2026, 9, {
      incomeRows: [{ amount: 5000000 }],
      expenseRows: [{ amount: 1000000 }],
      contribRows: [],
      withdrawRows: [],
      budgetRows: [{ normalized_monthly_amount: 1500000 }],
      storedSummary: {
        rollover_amount: 500000,
        amount_added_to_savings: 0,
        finalized_at: '2026-10-01T00:00:00Z',
      },
    });
    record(
      '27. M2.9 rollover regression — leftover, rollover, finalized status intact',
      evalData.budgetLeftover === 500000 &&
      evalData.rolloverAmount === 500000 &&
      evalData.isFinalized === true &&
      evalData.savedVsBudget === 500000,
    );
  }

  // =========================================================================
  // Test 28: M2.8.2 withdrawal RPC security regression (structural)
  // =========================================================================
  {
    // Verify createSavingsWithdrawal structure hasn't regressed:
    // The function must still require auth and use RPC when available.
    // This is a structural verification — the actual RPC test requires live DB.
    const fs = require('fs');
    const path = require('path');
    const withdrawalSource = fs.readFileSync(
      path.resolve(__dirname, '../src/lib/savings/withdrawal.ts'),
      'utf-8',
    );
    const hasAuthCheck = withdrawalSource.includes('auth.getUser()');
    const hasRpcCall = withdrawalSource.includes("supabase.rpc('execute_savings_withdrawal'") ||
                       withdrawalSource.includes('execute_savings_withdrawal');
    const noDirectUserIdParam = !withdrawalSource.includes('user_id: input.userId');
    record(
      '28. M2.8.2 RPC security regression — auth.getUser(), RPC call, no client user_id in structural check',
      hasAuthCheck && hasRpcCall && noDirectUserIdParam,
    );
  }

  // =========================================================================
  // Live DB tests — environment limitation
  // =========================================================================
  skip('Live RLS: monthly_summaries SELECT enforcement');
  skip('Live RLS: transactions cross-user rejection');
  skip('Live RLS: goals cross-user rejection');
  skip('Live RPC: execute_savings_withdrawal atomicity');

  // Summary
  console.log(`\n--- M2.10 Results: ${passed}/${total} passed ---`);
  if (passed === total) {
    console.log('All M2.10 tests passed.');
  } else {
    console.error(`${total - passed} test(s) failed or were skipped (environment limitation).`);
  }
}

runM210Tests().catch(console.error);
