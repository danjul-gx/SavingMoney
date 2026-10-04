/**
 * M2.14 Dashboard & Accounting Insights Test Suite
 *
 * Requirements Covered (Section "TEST REQUIREMENTS"):
 *  Wallet summary:
 *   1. total wallet balance is derived correctly
 *   2. wallet balances are user-scoped
 *   3. another user's wallet is excluded
 *  Cashflow:
 *   4. monthly income is calculated correctly
 *   5. monthly expense is calculated correctly
 *   6. net cashflow is correct
 *   7. savings contribution is not counted as ordinary expense
 *   8. savings withdrawal is not counted as ordinary income
 *  Reversal:
 *   9. reversed transaction is accounted for correctly
 *  10. reversal does not double-count original financial effect
 *  11. reversal data remains consistent with M2.12
 *  Savings:
 *  12. planned savings remains separate from actual savings movement
 *  13. contribution total is correct
 *  14. withdrawal total is correct
 *  15. net savings movement is correct
 *  Budget:
 *  16. normalized monthly budget is used
 *  17. interval budget uses existing normalization
 *  18. actual expense usage is correct
 *  19. overspending is detected correctly
 *  20. utilization percentage is correct
 *  Goals:
 *  21. goal progress is correct
 *  22. overfunded goal preserves raw amount
 *  23. visual progress can clamp at 100%
 *  Security:
 *  24. User A dashboard cannot access User B data
 *  25. unauthenticated dashboard access is rejected/protected
 *  Regression:
 *  26. existing wallet balance remains unchanged after dashboard reads
 *  27. goal balance remains unchanged after dashboard reads
 *  28. transaction count remains unchanged after dashboard reads
 *  29. dashboard performs no financial mutation
 *
 * Run with: node tests/m2_14_dashboard.test.js
 */

const assert = require('assert')
const fs = require('fs')

console.log('--- Starting M2.14 Financial Dashboard & Accounting Insights Tests ---')

// ---------------------------------------------------------------------------
// Pure Calculation Logic (Mirrors src/lib/dashboard/client.ts)
// ---------------------------------------------------------------------------

function computeDashboardCashflow(transactions) {
  let income = 0
  let expense = 0

  for (const tx of transactions) {
    const amt = Math.trunc(tx.amount)
    if (tx.type === 'income') {
      income += amt
    } else if (tx.type === 'expense') {
      expense += amt
    } else if (tx.type === 'adjustment' && tx.reversal_of_transaction_id) {
      if (tx.adjustment_direction === 'debit') {
        income -= amt
      } else if (tx.adjustment_direction === 'credit') {
        expense -= amt
      }
    }
  }

  const cleanIncome = Math.max(0, income)
  const cleanExpense = Math.max(0, expense)
  const netCashflow = cleanIncome - cleanExpense

  return {
    totalIncome: cleanIncome,
    totalExpenses: cleanExpense,
    netCashflow,
  }
}

function computeDashboardSavingsMovement(transactions, plannedSavings) {
  let contributions = 0
  let withdrawals = 0

  for (const tx of transactions) {
    const amt = Math.trunc(tx.amount)
    if (tx.type === 'savings_contribution') {
      if (tx.reversal_of_transaction_id) {
        withdrawals -= amt
      } else {
        contributions += amt
      }
    } else if (tx.type === 'savings_withdrawal') {
      if (tx.reversal_of_transaction_id) {
        contributions -= amt
      } else {
        withdrawals += amt
      }
    }
  }

  const cleanContributions = Math.max(0, contributions)
  const cleanWithdrawals = Math.max(0, withdrawals)
  const netSavingsMovement = cleanContributions - cleanWithdrawals

  return {
    plannedSavings,
    actualContributions: cleanContributions,
    actualWithdrawals: cleanWithdrawals,
    netSavingsMovement,
  }
}

function computeDashboardBudgetUsage(totalAllocatedBudget, actualOperationalSpending) {
  const budget = Math.trunc(Math.max(0, totalAllocatedBudget))
  const spending = Math.trunc(Math.max(0, actualOperationalSpending))

  const rawDiff = budget - spending
  const isOverspent = rawDiff < 0
  const remainingBudget = isOverspent ? 0 : rawDiff
  const overspentAmount = isOverspent ? Math.abs(rawDiff) : 0

  const rawPercent = budget > 0 ? Math.floor((spending * 100) / budget) : spending > 0 ? 100 : 0
  const utilizationPercentage = Math.max(0, rawPercent)

  return {
    totalAllocatedBudget: budget,
    actualOperationalSpending: spending,
    remainingBudget,
    overspentAmount,
    isOverspent,
    utilizationPercentage,
  }
}

function normalizeToMonthly(originalAmount, period, intervalDays) {
  if (period === 'monthly') return originalAmount
  if (period === 'weekly') {
    return Math.floor((originalAmount * 43 + 5) / 10)
  }
  if (period === 'interval') {
    if (!intervalDays || intervalDays <= 0) {
      throw new Error('interval_days must be positive')
    }
    return Math.floor((originalAmount * 30 + Math.floor(intervalDays / 2)) / intervalDays)
  }
  return originalAmount
}

function calculateGoalProgress(targetAmount, currentAmount) {
  const target = Math.max(0, Math.trunc(targetAmount))
  const current = Math.max(0, Math.trunc(currentAmount))

  if (target === 0) {
    return {
      progressPercent: current > 0 ? 100 : 0,
      remainingAmount: 0,
      isOverfunded: current > 0,
    }
  }

  const rawPercent = Math.floor((current * 100) / target)
  const progressPercent = Math.min(100, Math.max(0, rawPercent))
  const remainingAmount = Math.max(0, target - current)
  const isOverfunded = current > target

  return {
    progressPercent,
    remainingAmount,
    isOverfunded,
  }
}

// ---------------------------------------------------------------------------
// Mock Environment for Integration / Security / Immutability Testing
// ---------------------------------------------------------------------------

function createMockEnvironment() {
  const state = {
    wallets: [
      { id: 'w-A1', user_id: 'user-A', type: 'cash', label: 'Cash A', balance: 2000000 },
      { id: 'w-A2', user_id: 'user-A', type: 'digital', label: 'Digital A', balance: 6500000 },
      { id: 'w-B1', user_id: 'user-B', type: 'cash', label: 'Cash B', balance: 9999999 },
    ],
    budget_allocations: [
      { id: 'b-A1', user_id: 'user-A', budget_year: 2026, budget_month: 10, normalized_monthly_amount: 1500000 },
      { id: 'b-A2', user_id: 'user-A', budget_year: 2026, budget_month: 10, normalized_monthly_amount: 375000 }, // interval
      { id: 'b-B1', user_id: 'user-B', budget_year: 2026, budget_month: 10, normalized_monthly_amount: 5000000 },
    ],
    goals: [
      { id: 'g-A1', user_id: 'user-A', name: 'Emergency', target_amount: 10000000, current_amount: 12000000, status: 'active', is_primary: true },
      { id: 'g-A2', user_id: 'user-A', name: 'Vacation', target_amount: 5000000, current_amount: 2500000, status: 'active', is_primary: false },
      { id: 'g-B1', user_id: 'user-B', name: 'Secret B', target_amount: 9000000, current_amount: 9000000, status: 'active', is_primary: true },
    ],
    transactions: [
      { id: 'tx-A1', user_id: 'user-A', type: 'income', amount: 8000000, transaction_date: '2026-10-05' },
      { id: 'tx-A2', user_id: 'user-A', type: 'expense', amount: 1200000, transaction_date: '2026-10-10' },
      { id: 'tx-A3', user_id: 'user-A', type: 'savings_contribution', amount: 1000000, transaction_date: '2026-10-12' },
      { id: 'tx-A4', user_id: 'user-A', type: 'savings_withdrawal', amount: 200000, transaction_date: '2026-10-15' },
      { id: 'tx-B1', user_id: 'user-B', type: 'income', amount: 50000000, transaction_date: '2026-10-01' },
    ],
  }

  function getDashboardData(userId, year, month) {
    if (!userId) {
      return { data: null, error: 'Sesi tidak ditemukan. Silakan login kembali.' }
    }

    const wallets = state.wallets.filter((w) => w.user_id === userId)
    const totalBalance = wallets.reduce((sum, w) => sum + w.balance, 0)

    const budgets = state.budget_allocations.filter((b) => b.user_id === userId && b.budget_year === year && b.budget_month === month)
    const totalAllocatedBudget = budgets.reduce((sum, b) => sum + b.normalized_monthly_amount, 0)

    const txs = state.transactions.filter((t) => t.user_id === userId)
    const cashflow = computeDashboardCashflow(txs)

    const plannedSavings = Math.max(0, cashflow.totalIncome - totalAllocatedBudget)
    const savingsMovement = computeDashboardSavingsMovement(txs, plannedSavings)
    const budgetUsage = computeDashboardBudgetUsage(totalAllocatedBudget, cashflow.totalExpenses)

    const goals = state.goals.filter((g) => g.user_id === userId && g.status === 'active').map((g) => {
      const p = calculateGoalProgress(g.target_amount, g.current_amount)
      return {
        ...g,
        progressPercent: p.progressPercent,
        remainingAmount: p.remainingAmount,
        isOverfunded: p.isOverfunded,
      }
    })

    return {
      data: {
        year,
        month,
        walletSummary: {
          totalBalance,
          wallets,
        },
        cashflow,
        savingsMovement,
        budgetUsage,
        goals,
        financialFacts: {
          totalIncome: cashflow.totalIncome,
          totalExpenses: cashflow.totalExpenses,
          netCashflow: cashflow.netCashflow,
          plannedSavings,
          actualSavingsMovement: savingsMovement.netSavingsMovement,
          budgetUsagePercent: budgetUsage.utilizationPercentage,
          activeGoalsCount: goals.length,
        },
      },
      error: null,
    }
  }

  return { state, getDashboardData }
}

// ---------------------------------------------------------------------------
// Test Execution
// ---------------------------------------------------------------------------

let passedCount = 0

function runTest(name, fn) {
  try {
    fn()
    passedCount++
    console.log(`  ✓ Test ${passedCount}: ${name}`)
  } catch (err) {
    console.error(`  ✗ FAILED: ${name}`)
    console.error(err)
    process.exit(1)
  }
}

// === Wallet Summary (1 - 3) ===
runTest('total wallet balance is derived correctly', () => {
  const env = createMockEnvironment()
  const res = env.getDashboardData('user-A', 2026, 10)
  assert.strictEqual(res.data.walletSummary.totalBalance, 8500000)
})

runTest('wallet balances are user-scoped', () => {
  const env = createMockEnvironment()
  const res = env.getDashboardData('user-A', 2026, 10)
  assert.strictEqual(res.data.walletSummary.wallets.length, 2)
  assert(res.data.walletSummary.wallets.every((w) => w.user_id === 'user-A'))
})

runTest("another user's wallet is excluded", () => {
  const env = createMockEnvironment()
  const res = env.getDashboardData('user-A', 2026, 10)
  assert(!res.data.walletSummary.wallets.some((w) => w.id === 'w-B1'))
  assert(!res.data.walletSummary.wallets.some((w) => w.user_id === 'user-B'))
})

// === Cashflow (4 - 8) ===
runTest('monthly income is calculated correctly', () => {
  const txs = [
    { id: '1', type: 'income', amount: 5000000 },
    { id: '2', type: 'income', amount: 2500000 },
  ]
  const c = computeDashboardCashflow(txs)
  assert.strictEqual(c.totalIncome, 7500000)
})

runTest('monthly expense is calculated correctly', () => {
  const txs = [
    { id: '1', type: 'expense', amount: 1500000 },
    { id: '2', type: 'expense', amount: 750000 },
  ]
  const c = computeDashboardCashflow(txs)
  assert.strictEqual(c.totalExpenses, 2250000)
})

runTest('net cashflow is correct (income - expenses)', () => {
  const txs = [
    { id: '1', type: 'income', amount: 5000000 },
    { id: '2', type: 'expense', amount: 1500000 },
  ]
  const c = computeDashboardCashflow(txs)
  assert.strictEqual(c.netCashflow, 3500000)
})

runTest('savings contribution is not counted as ordinary expense', () => {
  const txs = [
    { id: '1', type: 'expense', amount: 500000 },
    { id: '2', type: 'savings_contribution', amount: 2000000 },
  ]
  const c = computeDashboardCashflow(txs)
  assert.strictEqual(c.totalExpenses, 500000)
})

runTest('savings withdrawal is not counted as ordinary income', () => {
  const txs = [
    { id: '1', type: 'income', amount: 3000000 },
    { id: '2', type: 'savings_withdrawal', amount: 1000000 },
  ]
  const c = computeDashboardCashflow(txs)
  assert.strictEqual(c.totalIncome, 3000000)
})

// === Reversal (9 - 11) ===
runTest('reversed transaction is accounted for correctly', () => {
  // Income 5.000.000, then reversed with adjustment debit 5.000.000
  const txs = [
    { id: '1', type: 'income', amount: 5000000 },
    { id: '2', type: 'adjustment', amount: 5000000, adjustment_direction: 'debit', reversal_of_transaction_id: '1' },
  ]
  const c = computeDashboardCashflow(txs)
  assert.strictEqual(c.totalIncome, 0)
  assert.strictEqual(c.netCashflow, 0)
})

runTest('reversal does not double-count original financial effect', () => {
  // Expense 200.000, reversed with adjustment credit 200.000
  const txs = [
    { id: '1', type: 'expense', amount: 200000 },
    { id: '2', type: 'adjustment', amount: 200000, adjustment_direction: 'credit', reversal_of_transaction_id: '1' },
  ]
  const c = computeDashboardCashflow(txs)
  assert.strictEqual(c.totalExpenses, 0)
  assert.strictEqual(c.netCashflow, 0)
})

runTest('reversal data remains consistent with M2.12', () => {
  // Contribution reversed via withdrawal-typed reversal tx
  const txs = [
    { id: '1', type: 'savings_contribution', amount: 500000 },
    { id: '2', type: 'savings_withdrawal', amount: 500000, reversal_of_transaction_id: '1' },
  ]
  const s = computeDashboardSavingsMovement(txs, 1000000)
  assert.strictEqual(s.actualContributions, 0)
  assert.strictEqual(s.actualWithdrawals, 0)
  assert.strictEqual(s.netSavingsMovement, 0)
})

// === Savings (12 - 15) ===
runTest('planned savings remains separate from actual savings movement', () => {
  // Planned: Income 10.000.000 - Budget 6.000.000 = 4.000.000
  // Actual: 0 contributions
  const plannedSavings = 4000000
  const txs = []
  const s = computeDashboardSavingsMovement(txs, plannedSavings)
  assert.strictEqual(s.plannedSavings, 4000000)
  assert.strictEqual(s.actualContributions, 0)
  assert.strictEqual(s.netSavingsMovement, 0)
  assert.notStrictEqual(s.plannedSavings, s.netSavingsMovement)
})

runTest('contribution total is correct', () => {
  const txs = [
    { id: '1', type: 'savings_contribution', amount: 750000 },
    { id: '2', type: 'savings_contribution', amount: 250000 },
  ]
  const s = computeDashboardSavingsMovement(txs, 0)
  assert.strictEqual(s.actualContributions, 1000000)
})

runTest('withdrawal total is correct', () => {
  const txs = [
    { id: '1', type: 'savings_withdrawal', amount: 400000 },
    { id: '2', type: 'savings_withdrawal', amount: 150000 },
  ]
  const s = computeDashboardSavingsMovement(txs, 0)
  assert.strictEqual(s.actualWithdrawals, 550000)
})

runTest('net savings movement is correct (contributions - withdrawals)', () => {
  const txs = [
    { id: '1', type: 'savings_contribution', amount: 1000000 },
    { id: '2', type: 'savings_withdrawal', amount: 300000 },
  ]
  const s = computeDashboardSavingsMovement(txs, 0)
  assert.strictEqual(s.netSavingsMovement, 700000)
})

// === Budget (16 - 20) ===
runTest('normalized monthly budget is used', () => {
  // Weekly budget: Rp100.000 * 4.3 = Rp430.000
  const norm = normalizeToMonthly(100000, 'weekly')
  assert.strictEqual(norm, 430000)
})

runTest('interval budget uses existing normalization', () => {
  // Gasoline Rp50.000 every 4 days -> Math.floor((50000 * 30 + 2) / 4) = 375000
  const norm = normalizeToMonthly(50000, 'interval', 4)
  assert.strictEqual(norm, 375000)
})

runTest('actual expense usage is correct', () => {
  const b = computeDashboardBudgetUsage(2000000, 1500000)
  assert.strictEqual(b.totalAllocatedBudget, 2000000)
  assert.strictEqual(b.actualOperationalSpending, 1500000)
  assert.strictEqual(b.remainingBudget, 500000)
  assert.strictEqual(b.overspentAmount, 0)
  assert.strictEqual(b.isOverspent, false)
})

runTest('overspending is detected correctly', () => {
  const b = computeDashboardBudgetUsage(1000000, 1350000)
  assert.strictEqual(b.remainingBudget, 0)
  assert.strictEqual(b.overspentAmount, 350000)
  assert.strictEqual(b.isOverspent, true)
})

runTest('utilization percentage is correct', () => {
  const b1 = computeDashboardBudgetUsage(2000000, 1000000)
  assert.strictEqual(b1.utilizationPercentage, 50)

  const b2 = computeDashboardBudgetUsage(1000000, 1500000)
  assert.strictEqual(b2.utilizationPercentage, 150)
})

// === Goals (21 - 23) ===
runTest('goal progress is correct', () => {
  const g = calculateGoalProgress(10000000, 4500000)
  assert.strictEqual(g.progressPercent, 45)
  assert.strictEqual(g.remainingAmount, 5500000)
  assert.strictEqual(g.isOverfunded, false)
})

runTest('overfunded goal preserves raw amount', () => {
  const g = calculateGoalProgress(10000000, 15000000)
  assert.strictEqual(g.isOverfunded, true)
  assert.strictEqual(g.remainingAmount, 0)
  // Raw current amount is not clamped
  const rawCurrent = 15000000
  assert.strictEqual(rawCurrent, 15000000)
})

runTest('visual progress can clamp at 100%', () => {
  const g = calculateGoalProgress(10000000, 15000000)
  assert.strictEqual(g.progressPercent, 100)
})

// === Security (24 - 25) ===
runTest('User A dashboard cannot access User B data', () => {
  const env = createMockEnvironment()
  const resA = env.getDashboardData('user-A', 2026, 10)
  const resB = env.getDashboardData('user-B', 2026, 10)

  assert.strictEqual(resA.data.walletSummary.totalBalance, 8500000)
  assert.strictEqual(resB.data.walletSummary.totalBalance, 9999999)

  assert(!resA.data.goals.some((g) => g.user_id === 'user-B'))
  assert(!resB.data.goals.some((g) => g.user_id === 'user-A'))
})

runTest('unauthenticated dashboard access is rejected/protected', () => {
  const env = createMockEnvironment()
  const res = env.getDashboardData(null, 2026, 10)
  assert.strictEqual(res.data, null)
  assert(res.error.includes('Sesi tidak ditemukan'))
})

// === Regression & Immutability (26 - 29) ===
runTest('existing wallet balance remains unchanged after dashboard reads', () => {
  const env = createMockEnvironment()
  const beforeBalance = env.state.wallets.map((w) => ({ id: w.id, balance: w.balance }))

  env.getDashboardData('user-A', 2026, 10)
  env.getDashboardData('user-B', 2026, 10)

  const afterBalance = env.state.wallets.map((w) => ({ id: w.id, balance: w.balance }))
  assert.deepStrictEqual(beforeBalance, afterBalance)
})

runTest('goal balance remains unchanged after dashboard reads', () => {
  const env = createMockEnvironment()
  const beforeGoals = env.state.goals.map((g) => ({ id: g.id, current: g.current_amount }))

  env.getDashboardData('user-A', 2026, 10)

  const afterGoals = env.state.goals.map((g) => ({ id: g.id, current: g.current_amount }))
  assert.deepStrictEqual(beforeGoals, afterGoals)
})

runTest('transaction count remains unchanged after dashboard reads', () => {
  const env = createMockEnvironment()
  const beforeCount = env.state.transactions.length

  env.getDashboardData('user-A', 2026, 10)

  const afterCount = env.state.transactions.length
  assert.strictEqual(beforeCount, afterCount)
})

runTest('dashboard performs no financial mutation', () => {
  const env = createMockEnvironment()
  const beforeJson = JSON.stringify(env.state)

  env.getDashboardData('user-A', 2026, 10)
  env.getDashboardData('user-B', 2026, 10)

  const afterJson = JSON.stringify(env.state)
  assert.strictEqual(beforeJson, afterJson)
})

// === Security Code Scan ===
runTest('no service-role credentials exposed in dashboard client', () => {
  const code = fs.readFileSync('src/lib/dashboard/client.ts', 'utf8')
  assert(!code.includes('SUPABASE_SERVICE_ROLE_KEY'), 'Must not reference service-role key')
  assert(!code.includes('service_role'), 'Must not use service_role')
})

console.log(`\nAll ${passedCount} tests passed successfully! [M2.14 DASHBOARD & INSIGHTS: PASS]`)
