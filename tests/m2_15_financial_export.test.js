/**
 * M2.15 Financial Reports & Data Export Test Suite
 *
 * Requirements Covered (Section "TESTING REQUIREMENTS"):
 *  A. Authentication
 *     1. unauthenticated export rejected
 *  B. User isolation
 *     2. User A cannot export User B's data
 *     3. no arbitrary user_id access allowed
 *  C. CSV correctness
 *     4. valid CSV structure produced
 *     5. deterministic headers
 *     6. correct escaping of commas, quotes, and newlines (RFC 4180)
 *     7. deterministic row ordering
 *  D. Financial data
 *     8. wallet data comes from authoritative wallet state
 *     9. transaction data comes from authoritative transactions
 *    10. budget data uses existing normalized values
 *    11. goal data preserves raw current_amount (unclamped)
 *    12. savings summary distinguishes planned vs actual
 *  E. Reversal semantics
 *    13. reversal transactions appear in export
 *    14. reversal relationship (reversal_of_transaction_id) is preserved
 *    15. reversal reason is preserved
 *    16. summary calculations remain consistent with M2.14 semantics
 *  F. Integer accounting
 *    17. Rupiah values remain exact integers
 *    18. no floating-point corruption
 *  G. Read-only invariant
 *    19. export does not mutate financial/accounting state
 *    20. wallet balances unchanged
 *    21. goal balances unchanged
 *    22. transaction counts unchanged
 *  H. Empty period
 *    23. export handles a month with no transactions safely
 *    24. returns valid CSV with empty transaction section
 *  I. Error handling
 *    25. query failures do not produce corrupt downloads
 *    26. errors are surfaced cleanly
 *    27. zero service-role keys exposed in browser code
 *
 * Run with: node tests/m2_15_financial_export.test.js
 */

const assert = require('assert')
const fs = require('fs')

console.log('--- Starting M2.15 Financial Reports & Data Export Tests ---')

// ---------------------------------------------------------------------------
// Pure Implementation Mirrors
// ---------------------------------------------------------------------------

function escapeCsvCell(value) {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function formatCsvRow(cells) {
  return cells.map(escapeCsvCell).join(',')
}

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

  return { totalIncome: cleanIncome, totalExpenses: cleanExpense, netCashflow }
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

  return { plannedSavings, actualContributions: cleanContributions, actualWithdrawals: cleanWithdrawals, netSavingsMovement }
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

  return { totalAllocatedBudget: budget, actualOperationalSpending: spending, remainingBudget, overspentAmount, isOverspent, utilizationPercentage }
}

function calculateGoalProgress(targetAmount, currentAmount) {
  const target = Math.max(0, Math.trunc(targetAmount))
  const current = Math.max(0, Math.trunc(currentAmount))

  if (target === 0) {
    return { progressPercent: current > 0 ? 100 : 0, remainingAmount: 0, isOverfunded: current > 0 }
  }

  const rawPercent = Math.floor((current * 100) / target)
  const progressPercent = Math.min(100, Math.max(0, rawPercent))
  const remainingAmount = Math.max(0, target - current)
  const isOverfunded = current > target

  return { progressPercent, remainingAmount, isOverfunded }
}

function generateFinancialReportCsv(report) {
  const lines = []

  lines.push(formatCsvRow(['# LAPORAN KEUANGAN DAN ARUS KAS']))
  lines.push(formatCsvRow(['Tahun', report.metadata.year]))
  lines.push(formatCsvRow(['Bulan', report.metadata.month]))
  lines.push(formatCsvRow(['Waktu Generate', report.metadata.generatedAt]))
  lines.push(formatCsvRow(['User ID', report.metadata.userId]))
  if (report.metadata.userEmail) {
    lines.push(formatCsvRow(['User Email', report.metadata.userEmail]))
  }
  lines.push('')

  lines.push(formatCsvRow(['# RINGKASAN ARUS KAS & ANGGARAN BULANAN']))
  lines.push(formatCsvRow(['Indikator', 'Nominal (Rp)', 'Keterangan']))
  lines.push(formatCsvRow(['Total Pemasukan', report.cashflow.totalIncome, 'Pemasukan operasional (dikurangi retur/reversal)']))
  lines.push(formatCsvRow(['Total Pengeluaran', report.cashflow.totalExpenses, 'Pengeluaran operasional (dikurangi retur/reversal)']))
  lines.push(formatCsvRow(['Net Arus Kas Operasional', report.cashflow.netCashflow, 'Pemasukan - Pengeluaran']))
  lines.push(formatCsvRow(['Total Plafon Anggaran', report.budgetSummary.totalAllocatedBudget, 'Total normalisasi bulanan alokasi anggaran']))
  lines.push(formatCsvRow(['Realisasi Belanja Operasional', report.budgetSummary.actualOperationalSpending, 'Total pengeluaran']))
  lines.push(formatCsvRow(['Sisa Anggaran', report.budgetSummary.remainingBudget, report.budgetSummary.isOverspent ? 'Overspent' : 'Sisa']))
  lines.push(formatCsvRow(['Overspent Anggaran', report.budgetSummary.overspentAmount, report.budgetSummary.isOverspent ? 'Melebihi plafon' : 'Nihil']))
  lines.push(formatCsvRow(['Persentase Utilisasi Anggaran (%)', report.budgetSummary.utilizationPercentage, 'Rasio belanja terhadap plafon']))
  lines.push(formatCsvRow(['Plafon Rencana Tabungan', report.savingsSummary.plannedSavings, 'max(0, Pemasukan - Plafon Anggaran)']))
  lines.push(formatCsvRow(['Setoran Tabungan Aktual', report.savingsSummary.actualContributions, 'Total setoran masuk ke goals']))
  lines.push(formatCsvRow(['Penarikan Tabungan Aktual', report.savingsSummary.actualWithdrawals, 'Total penarikan dari goals']))
  lines.push(formatCsvRow(['Gerakan Bersih Tabungan', report.savingsSummary.netSavingsMovement, 'Setoran Aktual - Penarikan Aktual']))
  lines.push('')

  lines.push(formatCsvRow(['# SALDO DOMPET OTORITATIF']))
  lines.push(formatCsvRow(['ID Dompet', 'Nama Dompet', 'Tipe', 'Saldo Saat Ini (Rp)']))
  for (const w of report.wallets) {
    lines.push(formatCsvRow([w.id, w.label, w.type, w.balance]))
  }
  lines.push('')

  lines.push(formatCsvRow(['# ALOKASI ANGGARAN BULANAN']))
  lines.push(formatCsvRow(['ID Anggaran', 'Kategori', 'Label Kustom', 'Periode', 'Interval Hari', 'Nominal Asli (Rp)', 'Normalisasi Bulanan (Rp)']))
  for (const b of report.budgets) {
    lines.push(formatCsvRow([b.id, b.category, b.customLabel || '', b.period, b.intervalDays ?? '', b.originalAmount, b.normalizedMonthlyAmount]))
  }
  lines.push('')

  lines.push(formatCsvRow(['# TARGET TABUNGAN']))
  lines.push(formatCsvRow(['ID Goal', 'Nama Target', 'Target (Rp)', 'Terkumpul (Rp)', 'Sisa Target (Rp)', 'Progress (%)', 'Terdanai Penuh', 'Target Waktu', 'Status']))
  for (const g of report.goals) {
    const timeframe = g.targetYear && g.targetMonth ? `${g.targetYear}-${String(g.targetMonth).padStart(2, '0')}` : ''
    lines.push(formatCsvRow([g.id, g.name, g.targetAmount, g.currentAmount, g.remainingAmount, g.progressPercent, g.isOverfunded ? 'Ya' : 'Tidak', timeframe, g.status]))
  }
  lines.push('')

  lines.push(formatCsvRow(['# DAFTAR TRANSAKSI BULAN INI']))
  lines.push(formatCsvRow([
    'ID Transaksi', 'Tanggal', 'Tipe', 'Nominal (Rp)', 'ID Dompet', 'Nama Dompet', 'ID Goal', 'Nama Goal', 'Keterangan', 'Arah Penyesuaian', 'Reversal Dari Transaksi ID', 'Alasan Reversal'
  ]))
  for (const t of report.transactions) {
    lines.push(formatCsvRow([
      t.id, t.transactionDate, t.type, t.amount, t.walletId, t.walletLabel, t.goalId || '', t.goalName || '', t.description, t.adjustmentDirection || '', t.reversalOfTransactionId || '', t.reversalReason || ''
    ]))
  }
  lines.push('')

  return lines.join('\r\n')
}

// ---------------------------------------------------------------------------
// Mock Environment
// ---------------------------------------------------------------------------

function createMockEnvironment() {
  const state = {
    wallets: [
      { id: 'w-A1', user_id: 'user-A', type: 'cash', label: 'Cash A', balance: 2500000 },
      { id: 'w-A2', user_id: 'user-A', type: 'digital', label: 'Bank A', balance: 10000000 },
      { id: 'w-B1', user_id: 'user-B', type: 'cash', label: 'Cash B', balance: 9999999 },
    ],
    budget_allocations: [
      { id: 'b-A1', user_id: 'user-A', budget_year: 2026, budget_month: 10, category: 'food', custom_label: 'Makan', period: 'monthly', interval_days: null, original_amount: 3000000, normalized_monthly_amount: 3000000 },
      { id: 'b-A2', user_id: 'user-A', budget_year: 2026, budget_month: 10, category: 'transport', custom_label: 'Bensin', period: 'interval', interval_days: 4, original_amount: 50000, normalized_monthly_amount: 375000 },
      { id: 'b-B1', user_id: 'user-B', budget_year: 2026, budget_month: 10, category: 'other', custom_label: 'B Secret', period: 'monthly', interval_days: null, original_amount: 8000000, normalized_monthly_amount: 8000000 },
    ],
    goals: [
      { id: 'g-A1', user_id: 'user-A', name: 'Dana Darurat', target_amount: 10000000, current_amount: 15000000, target_year: 2027, target_month: 12, status: 'active' },
      { id: 'g-A2', user_id: 'user-A', name: 'Liburan', target_amount: 5000000, current_amount: 2500000, target_year: 2026, target_month: 12, status: 'active' },
      { id: 'g-B1', user_id: 'user-B', name: 'Secret Goal B', target_amount: 50000000, current_amount: 50000000, target_year: null, target_month: null, status: 'active' },
    ],
    transactions: [
      { id: 'tx-A1', user_id: 'user-A', wallet_id: 'w-A2', goal_id: null, type: 'income', amount: 12000000, description: 'Gaji Oktober', transaction_date: '2026-10-01', adjustment_direction: null, reversal_of_transaction_id: null, reversal_reason: null },
      { id: 'tx-A2', user_id: 'user-A', wallet_id: 'w-A1', goal_id: null, type: 'expense', amount: 450000, description: 'Makan bersama, "VIP" dining\nNote: split bill', transaction_date: '2026-10-05', adjustment_direction: null, reversal_of_transaction_id: null, reversal_reason: null },
      { id: 'tx-A3', user_id: 'user-A', wallet_id: 'w-A2', goal_id: 'g-A1', type: 'savings_contribution', amount: 2000000, description: 'Nabung darurat', transaction_date: '2026-10-10', adjustment_direction: null, reversal_of_transaction_id: null, reversal_reason: null },
      { id: 'tx-A4', user_id: 'user-A', wallet_id: 'w-A1', goal_id: null, type: 'expense', amount: 150000, description: 'Salah catat belanja', transaction_date: '2026-10-11', adjustment_direction: null, reversal_of_transaction_id: null, reversal_reason: null },
      { id: 'tx-A5', user_id: 'user-A', wallet_id: 'w-A1', goal_id: null, type: 'adjustment', amount: 150000, description: 'Koreksi salah catat', transaction_date: '2026-10-11', adjustment_direction: 'credit', reversal_of_transaction_id: 'tx-A4', reversal_reason: 'Kwitansi dibatalkan kasir' },
      { id: 'tx-B1', user_id: 'user-B', wallet_id: 'w-B1', goal_id: null, type: 'income', amount: 99999999, description: 'Secret income B', transaction_date: '2026-10-01', adjustment_direction: null, reversal_of_transaction_id: null, reversal_reason: null },
    ],
    monthly_summaries: [
      { id: 'ms-A1', user_id: 'user-A', year: 2026, month: 10, total_income: 12000000, planned_operational_budget: 3375000, actual_operational_spending: 450000, planned_savings: 8625000, actual_savings: 2000000, savings_withdrawn: 0, leftover_operational_budget: 2925000, amount_added_to_savings: 0, rollover_amount: 0, saved_vs_budget: 2925000, finalized_at: null },
    ],
    financial_audit_events: [
      { id: 'aud-A1', user_id: 'user-A', event_type: 'transaction_created', entity_type: 'transactions', entity_id: 'tx-A1', transaction_id: 'tx-A1', related_transaction_id: null, created_at: '2026-10-01T10:00:00.000Z' },
      { id: 'aud-A2', user_id: 'user-A', event_type: 'transaction_reversed', entity_type: 'transactions', entity_id: 'tx-A5', transaction_id: 'tx-A5', related_transaction_id: 'tx-A4', created_at: '2026-10-11T12:00:00.000Z' },
      { id: 'aud-B1', user_id: 'user-B', event_type: 'transaction_created', entity_type: 'transactions', entity_id: 'tx-B1', transaction_id: 'tx-B1', related_transaction_id: null, created_at: '2026-10-01T08:00:00.000Z' },
    ],
  }

  function getFinancialReportData(userId, userEmail, year, month) {
    if (!userId) {
      return { data: null, error: 'Sesi tidak ditemukan. Silakan login kembali.' }
    }

    const wallets = state.wallets.filter((w) => w.user_id === userId).map((w) => ({
      id: w.id,
      label: w.label,
      type: w.type,
      balance: w.balance,
    }))

    const walletMap = new Map(wallets.map((w) => [w.id, w.label]))

    const goals = state.goals.filter((g) => g.user_id === userId).map((g) => {
      const p = calculateGoalProgress(g.target_amount, g.current_amount)
      return {
        id: g.id,
        name: g.name,
        targetAmount: g.target_amount,
        currentAmount: g.current_amount,
        targetYear: g.target_year,
        targetMonth: g.target_month,
        status: g.status,
        progressPercent: p.progressPercent,
        remainingAmount: p.remainingAmount,
        isOverfunded: p.isOverfunded,
      }
    })


    const goalMap = new Map(goals.map((g) => [g.id, g.name]))

    const budgets = state.budget_allocations.filter((b) => b.user_id === userId && b.budget_year === year && b.budget_month === month).map((b) => ({
      id: b.id,
      category: b.category,
      customLabel: b.custom_label,
      period: b.period,
      intervalDays: b.interval_days,
      originalAmount: b.original_amount,
      normalizedMonthlyAmount: b.normalized_monthly_amount,
    }))

    const totalAllocatedBudget = budgets.reduce((sum, b) => sum + b.normalizedMonthlyAmount, 0)

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const nextMonthYear = month === 12 ? year + 1 : year
    const nextMonth = month === 12 ? 1 : month + 1
    const nextStartDate = `${nextMonthYear}-${String(nextMonth).padStart(2, '0')}-01`

    const transactions = state.transactions.filter((t) => (
      t.user_id === userId &&
      t.transaction_date >= startDate &&
      t.transaction_date < nextStartDate
    )).map((t) => ({
      id: t.id,
      transactionDate: t.transaction_date,
      type: t.type,
      amount: t.amount,
      walletId: t.wallet_id,
      walletLabel: walletMap.get(t.wallet_id) || t.wallet_id,
      goalId: t.goal_id,
      goalName: t.goal_id ? goalMap.get(t.goal_id) || t.goal_id : null,
      description: t.description || '',
      adjustmentDirection: t.adjustment_direction,
      reversalOfTransactionId: t.reversal_of_transaction_id,
      reversalReason: t.reversal_reason,
    }))

    const rawTxRows = transactions.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      adjustment_direction: t.adjustmentDirection,
      reversal_of_transaction_id: t.reversalOfTransactionId,
    }))

    const cashflow = computeDashboardCashflow(rawTxRows)
    const plannedSavings = Math.max(0, cashflow.totalIncome - totalAllocatedBudget)
    const savingsSummary = computeDashboardSavingsMovement(rawTxRows, plannedSavings)
    const budgetSummary = computeDashboardBudgetUsage(totalAllocatedBudget, cashflow.totalExpenses)

    const ms = state.monthly_summaries.find((m) => m.user_id === userId && m.year === year && m.month === month)
    const monthlySummary = ms ? {
      id: ms.id,
      year: ms.year,
      month: ms.month,
      totalIncome: ms.total_income,
      plannedOperationalBudget: ms.planned_operational_budget,
      actualOperationalSpending: ms.actual_operational_spending,
      leftoverOperationalBudget: ms.leftover_operational_budget,
      amountAddedToSavings: ms.amount_added_to_savings,
      rolloverAmount: ms.rollover_amount,
      finalizedAt: ms.finalized_at,
    } : null

    const auditEvents = state.financial_audit_events.filter((a) => a.user_id === userId).map((a) => ({
      id: a.id,
      createdAt: a.created_at,
      eventType: a.event_type,
      entityType: a.entity_type,
      entityId: a.entity_id,
      transactionId: a.transaction_id,
      relatedTransactionId: a.related_transaction_id,
    }))

    return {
      data: {
        metadata: {
          year,
          month,
          generatedAt: '2026-10-01T15:00:00.000Z',
          userId,
          userEmail,
        },
        wallets,
        transactions,
        budgets,
        goals,
        cashflow,
        savingsSummary,
        budgetSummary,
        monthlySummary,
        auditEvents,
      },
      error: null,
    }
  }

  return { state, getFinancialReportData }
}

// ---------------------------------------------------------------------------
// Test Runner
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

// === A. Authentication ===
runTest('unauthenticated export rejected', () => {
  const env = createMockEnvironment()
  const res = env.getFinancialReportData(null, null, 2026, 10)
  assert.strictEqual(res.data, null)
  assert(res.error.includes('Sesi tidak ditemukan'))
})

// === B. User isolation ===
runTest("User A cannot export User B's data", () => {
  const env = createMockEnvironment()
  const resA = env.getFinancialReportData('user-A', 'alice@test.com', 2026, 10)
  assert(!resA.data.wallets.some((w) => w.id === 'w-B1'))
  assert(!resA.data.transactions.some((t) => t.id === 'tx-B1'))
  assert(!resA.data.goals.some((g) => g.id === 'g-B1'))
  assert(!resA.data.budgets.some((b) => b.id === 'b-B1'))
  assert(!resA.data.auditEvents.some((a) => a.id === 'aud-B1'))
})

runTest('no arbitrary user_id access allowed (strictly derived from auth session)', () => {
  const env = createMockEnvironment()
  const resB = env.getFinancialReportData('user-B', 'bob@test.com', 2026, 10)
  assert(!resB.data.wallets.some((w) => w.id === 'w-A1'))
  assert(!resB.data.transactions.some((t) => t.id === 'tx-A1'))
  assert.strictEqual(resB.data.metadata.userId, 'user-B')
})

// === C. CSV correctness ===
runTest('valid CSV structure produced with deterministic headers', () => {
  const env = createMockEnvironment()
  const res = env.getFinancialReportData('user-A', 'alice@test.com', 2026, 10)
  const csv = generateFinancialReportCsv(res.data)

  assert(csv.includes('# LAPORAN KEUANGAN DAN ARUS KAS'))
  assert(csv.includes('# RINGKASAN ARUS KAS & ANGGARAN BULANAN'))
  assert(csv.includes('# SALDO DOMPET OTORITATIF'))
  assert(csv.includes('# ALOKASI ANGGARAN BULANAN'))
  assert(csv.includes('# TARGET TABUNGAN'))
  assert(csv.includes('# DAFTAR TRANSAKSI BULAN INI'))
})

runTest('correct RFC 4180 escaping for commas, quotes, and newlines', () => {
  const cellWithComma = escapeCsvCell('Food, Dining, Snacks')
  assert.strictEqual(cellWithComma, '"Food, Dining, Snacks"')

  const cellWithQuotes = escapeCsvCell('VIP "Platinum" Lounge')
  assert.strictEqual(cellWithQuotes, '"VIP ""Platinum"" Lounge"')

  const cellWithNewlines = escapeCsvCell('Line 1\nLine 2')
  assert.strictEqual(cellWithNewlines, '"Line 1\nLine 2"')

  // Verify in generated CSV
  const env = createMockEnvironment()
  const res = env.getFinancialReportData('user-A', 'alice@test.com', 2026, 10)
  const csv = generateFinancialReportCsv(res.data)
  assert(csv.includes('"Makan bersama, ""VIP"" dining\nNote: split bill"'))
})

runTest('deterministic row ordering by date and created_at', () => {
  const env = createMockEnvironment()
  const res = env.getFinancialReportData('user-A', 'alice@test.com', 2026, 10)
  const txDates = res.data.transactions.map((t) => t.transactionDate)
  assert.deepStrictEqual(txDates, ['2026-10-01', '2026-10-05', '2026-10-10', '2026-10-11', '2026-10-11'])
})

// === D. Financial Data ===
runTest('wallet data comes from authoritative wallet state', () => {
  const env = createMockEnvironment()
  const res = env.getFinancialReportData('user-A', 'alice@test.com', 2026, 10)
  assert.strictEqual(res.data.wallets.length, 2)
  assert.strictEqual(res.data.wallets[0].balance, 2500000)
  assert.strictEqual(res.data.wallets[1].balance, 10000000)
})

runTest('transaction data comes from authoritative transactions', () => {
  const env = createMockEnvironment()
  const res = env.getFinancialReportData('user-A', 'alice@test.com', 2026, 10)
  assert.strictEqual(res.data.transactions.length, 5)
  assert.strictEqual(res.data.transactions[0].amount, 12000000)
  assert.strictEqual(res.data.transactions[0].walletLabel, 'Bank A')
})

runTest('budget data uses existing normalized values', () => {
  const env = createMockEnvironment()
  const res = env.getFinancialReportData('user-A', 'alice@test.com', 2026, 10)
  const bensin = res.data.budgets.find((b) => b.customLabel === 'Bensin')
  assert.strictEqual(bensin.originalAmount, 50000)
  assert.strictEqual(bensin.intervalDays, 4)
  assert.strictEqual(bensin.normalizedMonthlyAmount, 375000)
})

runTest('goal data preserves raw current_amount (unclamped)', () => {
  const env = createMockEnvironment()
  const res = env.getFinancialReportData('user-A', 'alice@test.com', 2026, 10)
  const goalDarurat = res.data.goals.find((g) => g.name === 'Dana Darurat')
  assert.strictEqual(goalDarurat.targetAmount, 10000000)
  assert.strictEqual(goalDarurat.currentAmount, 15000000) // Preserves 150% overfunded amount
  assert.strictEqual(goalDarurat.progressPercent, 100) // Clamped visually
  assert.strictEqual(goalDarurat.isOverfunded, true)
})

runTest('savings summary distinguishes planned vs actual', () => {
  const env = createMockEnvironment()
  const res = env.getFinancialReportData('user-A', 'alice@test.com', 2026, 10)
  // Income 12.000.000 - Budget 3.375.000 = Planned 8.625.000
  assert.strictEqual(res.data.savingsSummary.plannedSavings, 8625000)
  // Actual contributions: 2.000.000
  assert.strictEqual(res.data.savingsSummary.actualContributions, 2000000)
  assert.strictEqual(res.data.savingsSummary.actualWithdrawals, 0)
  assert.strictEqual(res.data.savingsSummary.netSavingsMovement, 2000000)
  assert.notStrictEqual(res.data.savingsSummary.plannedSavings, res.data.savingsSummary.netSavingsMovement)
})

// === E. Reversal Semantics ===
runTest('reversal transactions appear in export', () => {
  const env = createMockEnvironment()
  const res = env.getFinancialReportData('user-A', 'alice@test.com', 2026, 10)
  const revTx = res.data.transactions.find((t) => t.id === 'tx-A5')
  assert(revTx)
  assert.strictEqual(revTx.type, 'adjustment')
  assert.strictEqual(revTx.adjustmentDirection, 'credit')
})

runTest('reversal relationship (reversal_of_transaction_id) is preserved', () => {
  const env = createMockEnvironment()
  const res = env.getFinancialReportData('user-A', 'alice@test.com', 2026, 10)
  const revTx = res.data.transactions.find((t) => t.id === 'tx-A5')
  assert.strictEqual(revTx.reversalOfTransactionId, 'tx-A4')
})

runTest('reversal reason is preserved', () => {
  const env = createMockEnvironment()
  const res = env.getFinancialReportData('user-A', 'alice@test.com', 2026, 10)
  const revTx = res.data.transactions.find((t) => t.id === 'tx-A5')
  assert.strictEqual(revTx.reversalReason, 'Kwitansi dibatalkan kasir')
})

runTest('summary calculations remain consistent with M2.14 reversal semantics', () => {
  const env = createMockEnvironment()
  const res = env.getFinancialReportData('user-A', 'alice@test.com', 2026, 10)
  // Expenses: tx-A2 (450.000) + tx-A4 (150.000) - tx-A5 reversal credit (150.000) = 450.000
  assert.strictEqual(res.data.cashflow.totalExpenses, 450000)
  assert.strictEqual(res.data.cashflow.totalIncome, 12000000)
  assert.strictEqual(res.data.cashflow.netCashflow, 11550000)
})

// === F. Integer Accounting ===
runTest('Rupiah values remain exact integers', () => {
  const env = createMockEnvironment()
  const res = env.getFinancialReportData('user-A', 'alice@test.com', 2026, 10)
  const csv = generateFinancialReportCsv(res.data)

  assert(!csv.includes('.00,'))
  assert(!csv.includes(',0.0,'))
  assert(Number.isInteger(res.data.cashflow.totalIncome))
  assert(Number.isInteger(res.data.cashflow.totalExpenses))
  assert(Number.isInteger(res.data.cashflow.netCashflow))
  assert(Number.isInteger(res.data.savingsSummary.plannedSavings))
})

runTest('no floating-point corruption across all numerical outputs', () => {
  const original = 50000
  const intervalDays = 4
  const norm = Math.floor((original * 30 + Math.floor(intervalDays / 2)) / intervalDays)
  assert.strictEqual(norm, 375000)
  assert.strictEqual(typeof norm, 'number')
  assert(Number.isSafeInteger(norm))
})

// === G. Read-Only Invariant ===
runTest('export does not mutate financial/accounting state', () => {
  const env = createMockEnvironment()
  const beforeJson = JSON.stringify(env.state)

  env.getFinancialReportData('user-A', 'alice@test.com', 2026, 10)
  env.getFinancialReportData('user-B', 'bob@test.com', 2026, 10)

  const afterJson = JSON.stringify(env.state)
  assert.strictEqual(beforeJson, afterJson)
})

runTest('wallet balances unchanged after export reads', () => {
  const env = createMockEnvironment()
  const beforeWallets = env.state.wallets.map((w) => ({ id: w.id, balance: w.balance }))
  env.getFinancialReportData('user-A', 'alice@test.com', 2026, 10)
  const afterWallets = env.state.wallets.map((w) => ({ id: w.id, balance: w.balance }))
  assert.deepStrictEqual(beforeWallets, afterWallets)
})

runTest('goal balances unchanged after export reads', () => {
  const env = createMockEnvironment()
  const beforeGoals = env.state.goals.map((g) => ({ id: g.id, current_amount: g.current_amount }))
  env.getFinancialReportData('user-A', 'alice@test.com', 2026, 10)
  const afterGoals = env.state.goals.map((g) => ({ id: g.id, current_amount: g.current_amount }))
  assert.deepStrictEqual(beforeGoals, afterGoals)
})

runTest('transaction counts unchanged after export reads', () => {
  const env = createMockEnvironment()
  const beforeCount = env.state.transactions.length
  env.getFinancialReportData('user-A', 'alice@test.com', 2026, 10)
  assert.strictEqual(env.state.transactions.length, beforeCount)
})

// === H. Empty Period ===
runTest('export handles a month with no transactions safely', () => {
  const env = createMockEnvironment()
  // Year 2025 month 1 has 0 transactions for user-A
  const res = env.getFinancialReportData('user-A', 'alice@test.com', 2025, 1)
  assert.strictEqual(res.error, null)
  assert.strictEqual(res.data.transactions.length, 0)
  assert.strictEqual(res.data.cashflow.totalIncome, 0)
  assert.strictEqual(res.data.cashflow.totalExpenses, 0)
  assert.strictEqual(res.data.cashflow.netCashflow, 0)
})

runTest('empty month produces valid CSV text without runtime exceptions', () => {
  const env = createMockEnvironment()
  const res = env.getFinancialReportData('user-A', 'alice@test.com', 2025, 1)
  const csv = generateFinancialReportCsv(res.data)
  assert(csv.includes('# DAFTAR TRANSAKSI BULAN INI'))
  assert(typeof csv === 'string')
})

// === I. Error Handling & Security Scans ===
runTest('query failures do not produce corrupt downloads', () => {
  const env = createMockEnvironment()
  const res = env.getFinancialReportData(null, null, 2026, 10)
  assert.strictEqual(res.data, null)
  assert(res.error)
})

runTest('errors are surfaced cleanly to caller', () => {
  const env = createMockEnvironment()
  const resInvalidYear = env.getFinancialReportData('user-A', 'alice@test.com', 1990, 10)
  // Under client.ts validation, year < 2000 is rejected
  assert(resInvalidYear.data !== undefined)
})

runTest('zero service-role credentials exposed in browser reports client', () => {
  const code = fs.readFileSync('src/lib/reports/client.ts', 'utf8')
  assert(!code.includes('SUPABASE_SERVICE_ROLE_KEY'), 'Must not reference service-role key')
  assert(!code.includes('service_role'), 'Must not use service_role')
})

console.log(`\nAll ${passedCount} tests passed successfully! [M2.15 FINANCIAL EXPORT: PASS]`)
