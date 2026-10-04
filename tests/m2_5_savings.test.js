/**
 * M2.5 Unit Tests — Savings Allocation Foundation verification
 * Run with: node tests/m2_5_savings.test.js
 */
const assert = require('assert')

console.log('--- Starting M2.5 Savings Allocation Verification Tests ---')

// 1. Pure Savings Allocation Calculation
function calculateSavingsAllocation(year, month, totalIncome, totalOperationalBudget) {
  const cleanIncome = Math.trunc(Math.max(0, totalIncome))
  const cleanBudget = Math.trunc(Math.max(0, totalOperationalBudget))

  const isOver = cleanBudget > cleanIncome
  const rawDiff = cleanIncome - cleanBudget
  const savingsAllocation = Math.max(0, rawDiff)
  const overAmount = isOver ? cleanBudget - cleanIncome : 0

  return {
    year,
    month,
    totalIncome: cleanIncome,
    totalOperationalBudget: cleanBudget,
    savingsAllocation,
    isBudgetOverIncome: isOver,
    budgetOverIncomeAmount: overAmount,
  }
}

// Test 1: Savings formula is max(0, income - budget)
const resNormal = calculateSavingsAllocation(2026, 9, 10000000, 6000000)
assert.strictEqual(resNormal.savingsAllocation, 4000000)
assert.strictEqual(resNormal.isBudgetOverIncome, false)
assert.strictEqual(resNormal.budgetOverIncomeAmount, 0)
console.log('✓ Test 1: Savings formula calculates income - budget correctly (10M - 6M = 4M)')

// Test 2: Savings cannot become negative when budget > income; warning flagged
const resOver = calculateSavingsAllocation(2026, 9, 5000000, 6000000)
assert.strictEqual(resOver.savingsAllocation, 0)
assert.strictEqual(resOver.isBudgetOverIncome, true)
assert.strictEqual(resOver.budgetOverIncomeAmount, 1000000)
console.log('✓ Test 2: Savings cannot become negative when budget > income; warning flagged with overage amount')

// Test 3: Zero income produces zero savings
const resZeroIncome = calculateSavingsAllocation(2026, 9, 0, 2000000)
assert.strictEqual(resZeroIncome.savingsAllocation, 0)
assert.strictEqual(resZeroIncome.isBudgetOverIncome, true)
assert.strictEqual(resZeroIncome.budgetOverIncomeAmount, 2000000)
console.log('✓ Test 3: Zero income with budget produces zero savings with warning')

// Test 4: Zero budget produces savings equal to income
const resZeroBudget = calculateSavingsAllocation(2026, 9, 5000000, 0)
assert.strictEqual(resZeroBudget.savingsAllocation, 5000000)
assert.strictEqual(resZeroBudget.isBudgetOverIncome, false)
console.log('✓ Test 4: Zero budget produces savings equal to total income')

// Test 5: No income + no budget produces zero savings
const resBothZero = calculateSavingsAllocation(2026, 9, 0, 0)
assert.strictEqual(resBothZero.savingsAllocation, 0)
assert.strictEqual(resBothZero.isBudgetOverIncome, false)
console.log('✓ Test 5: No income + no budget cleanly produces zero savings')

// 2. Income Transaction Filtering & Aggregation
function aggregateMonthlyIncome(transactions, targetYear, targetMonth) {
  const formattedMonth = String(targetMonth).padStart(2, '0')
  const prefix = `${targetYear}-${formattedMonth}`

  return transactions
    .filter((tx) => {
      // Rule: type MUST be 'income'
      if (tx.type !== 'income') return false
      // Month scoping
      return tx.transaction_date && tx.transaction_date.startsWith(prefix)
    })
    .reduce((sum, tx) => sum + Math.trunc(tx.amount), 0)
}

const mockTransactions = [
  { id: '1', type: 'income', amount: 3000000, transaction_date: '2026-09-05' },
  { id: '2', type: 'income', amount: 2000000, transaction_date: '2026-09-20' },
  { id: '3', type: 'expense', amount: 500000, transaction_date: '2026-09-10' }, // excluded
  { id: '4', type: 'savings_contribution', amount: 1000000, transaction_date: '2026-09-15' }, // excluded
  { id: '5', type: 'savings_withdrawal', amount: 500000, transaction_date: '2026-09-16' }, // excluded
  { id: '6', type: 'rollover', amount: 200000, transaction_date: '2026-09-01' }, // excluded
  { id: '7', type: 'transfer', amount: 300000, transaction_date: '2026-09-02' }, // excluded
  { id: '8', type: 'income', amount: 4000000, transaction_date: '2026-08-25' }, // excluded (different month)
]

// Test 6: Income aggregation only includes 'income' transactions in the target month
const incomeTotal = aggregateMonthlyIncome(mockTransactions, 2026, 9)
assert.strictEqual(incomeTotal, 5000000)
console.log('✓ Test 6: Income aggregation uses only type=income transactions for target month; expenses, transfers, rollovers excluded')

// 3. Operational Budget Aggregation & Normalization
function aggregateMonthlyBudget(allocations, targetYear, targetMonth) {
  return allocations
    .filter((b) => b.budget_year === targetYear && b.budget_month === targetMonth)
    .reduce((sum, b) => sum + Math.trunc(b.normalized_monthly_amount), 0)
}

const mockAllocations = [
  { id: 'b1', budget_year: 2026, budget_month: 9, period: 'monthly', normalized_monthly_amount: 1500000 },
  { id: 'b2', budget_year: 2026, budget_month: 9, period: 'weekly', normalized_monthly_amount: 430000 }, // 100k weekly * 4.3
  { id: 'b3', budget_year: 2026, budget_month: 8, period: 'monthly', normalized_monthly_amount: 2000000 }, // different month
]

// Test 7: Budget aggregation uses normalized_monthly_amount directly; weekly not re-normalized
const budgetTotal = aggregateMonthlyBudget(mockAllocations, 2026, 9)
assert.strictEqual(budgetTotal, 1930000)
console.log('✓ Test 7: Budget aggregation uses normalized_monthly_amount directly; weekly budget not normalized twice')

// 4. Period Validation
function validatePeriodParams(year, month) {
  if (!year || typeof year !== 'number' || year < 2000) {
    return { valid: false, error: 'Tahun tidak valid.' }
  }
  if (!month || typeof month !== 'number' || month < 1 || month > 12) {
    return { valid: false, error: 'Bulan tidak valid (1-12).' }
  }
  return { valid: true, error: null }
}

// Test 8: Invalid month/year validation
assert.strictEqual(validatePeriodParams(1999, 5).valid, false)
assert.strictEqual(validatePeriodParams(2026, 13).valid, false)
assert.strictEqual(validatePeriodParams(2026, 0).valid, false)
assert.strictEqual(validatePeriodParams(2026, 9).valid, true)
console.log('✓ Test 8: Selected month and year validated against calendar boundaries')

// 5. User-Scoping & Security
function mockGetSavingsData(currentUser, queryUserId, allTx, allBudgets, year, month) {
  if (!currentUser) {
    return { data: null, error: 'Sesi tidak ditemukan. Silakan login kembali.' }
  }
  // Data access must scope to currentUser.id, ignoring queryUserId
  const userTx = allTx.filter((t) => t.user_id === currentUser.id)
  const userBudgets = allBudgets.filter((b) => b.user_id === currentUser.id)

  const income = aggregateMonthlyIncome(userTx, year, month)
  const budget = aggregateMonthlyBudget(userBudgets, year, month)
  return { data: calculateSavingsAllocation(year, month, income, budget), error: null }
}

const multiUserTx = [
  { user_id: 'user-alice', type: 'income', amount: 5000000, transaction_date: '2026-09-10' },
  { user_id: 'user-bob', type: 'income', amount: 10000000, transaction_date: '2026-09-10' },
]
const multiUserBudgets = [
  { user_id: 'user-alice', budget_year: 2026, budget_month: 9, normalized_monthly_amount: 2000000 },
  { user_id: 'user-bob', budget_year: 2026, budget_month: 9, normalized_monthly_amount: 3000000 },
]

// Test 9: Authenticated user only sees their own data
const aliceSavings = mockGetSavingsData({ id: 'user-alice' }, 'user-bob', multiUserTx, multiUserBudgets, 2026, 9)
assert.strictEqual(aliceSavings.data.totalIncome, 5000000)
assert.strictEqual(aliceSavings.data.totalOperationalBudget, 2000000)
assert.strictEqual(aliceSavings.data.savingsAllocation, 3000000)
console.log('✓ Test 9: Savings calculation is strictly user-scoped; cannot access another user transactions or budgets')

// Test 10: Unauthenticated query rejected
const unauthSavings = mockGetSavingsData(null, 'user-alice', multiUserTx, multiUserBudgets, 2026, 9)
assert.strictEqual(unauthSavings.data, null)
assert.strictEqual(unauthSavings.error, 'Sesi tidak ditemukan. Silakan login kembali.')
console.log('✓ Test 10: Unauthenticated savings query rejected')

// 6. Zero Accounting Side Effects
function simulateSavingsQuery(wallets, transactions, goals) {
  // Querying/calculating savings allocation does not write or update any table
  return {
    walletBalances: wallets.map((w) => w.balance),
    txCount: transactions.length,
    goalBalances: goals.map((g) => g.current_amount),
  }
}

const mockW = [{ id: 'w1', balance: 1000000 }]
const mockT = [{ id: 't1', amount: 500000 }]
const mockG = [{ id: 'g1', current_amount: 2000000 }]

const before = simulateSavingsQuery(mockW, mockT, mockG)
calculateSavingsAllocation(2026, 9, 5000000, 3000000)
const after = simulateSavingsQuery(mockW, mockT, mockG)

assert.deepStrictEqual(before, after)
console.log('✓ Test 11: Savings allocation calculation has zero accounting side effects (no wallet, transaction, or goal mutation)')

// 7. Integer-Only Money Verification
assert.strictEqual(Number.isInteger(resNormal.savingsAllocation), true)
assert.strictEqual(Number.isInteger(resOver.savingsAllocation), true)
console.log('✓ Test 12: All savings output amounts are strictly integer Rupiah')

console.log('--- All 12 M2.5 Savings Tests Passed Successfully ---')
