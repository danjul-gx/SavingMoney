import { createClient } from '@/lib/supabase/client'
import { getDeterministicMonthContext } from '@/lib/rollover/client'
import { calculateGoalProgress } from '@/lib/goals/client'
import type { Rupiah } from '@/types/domain'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MonthHistorySummary {
  year: number
  month: number
  totalIncome: Rupiah
  plannedOperationalBudget: Rupiah
  actualOperationalSpending: Rupiah
  budgetLeftover: Rupiah
  overspentAmount: Rupiah
  isOverspent: boolean
  actualSavingsContributed: Rupiah
  savingsWithdrawn: Rupiah
  netSavingsMovement: Rupiah
  rolloverAmount: Rupiah
  savedVsBudget: Rupiah
  isFinalized: boolean
  finalizedAt: string | null
  /** Whether data came from a stored monthly_summaries row */
  hasStoredSummary: boolean
}

export interface MonthTransactionsByType {
  income: MonthTransactionRow[]
  expense: MonthTransactionRow[]
  savingsContribution: MonthTransactionRow[]
  savingsWithdrawal: MonthTransactionRow[]
}

export interface MonthTransactionRow {
  id: string
  amount: Rupiah
  description: string | null
  transactionDate: string
  createdAt: string
  reversalOfTransactionId?: string | null
  reversalReason?: string | null
  isReversed?: boolean
}

export interface GoalProgressSnapshot {
  id: string
  name: string
  targetAmount: Rupiah
  currentAmount: Rupiah
  progressPercent: number
  status: string
  /** True — this is current state, not a historical snapshot */
  isCurrentSnapshot: boolean
}

export interface AvailableMonth {
  year: number
  month: number
  isFinalized: boolean
}

// ---------------------------------------------------------------------------
// Read-only data access — NO mutations
// ---------------------------------------------------------------------------

/**
 * Fetch month history summary for the authenticated user.
 * Uses stored monthly_summaries when available; otherwise computes
 * read-only metrics from live authoritative data. Never writes.
 */
export async function getMonthHistorySummary(
  year: number,
  month: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: any,
): Promise<{ data: MonthHistorySummary | null; error: string | null }> {
  if (!year || year < 2000) return { data: null, error: 'Tahun tidak valid.' }
  if (!month || month < 1 || month > 12) return { data: null, error: 'Bulan tidak valid (1-12).' }

  const supabase = supabaseClient || createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { data: null, error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.' }
  }

  const context = getDeterministicMonthContext(year, month)

  try {
    // Parallel read-only fetches
    const [summaryRes, budgetRes, incomeRes, expenseRes, contribRes, withdrawRes] = await Promise.all([
      supabase
        .from('monthly_summaries')
        .select('*')
        .eq('user_id', user.id)
        .eq('year', year)
        .eq('month', month)
        .maybeSingle(),
      supabase
        .from('budget_allocations')
        .select('normalized_monthly_amount')
        .eq('user_id', user.id)
        .eq('budget_year', year)
        .eq('budget_month', month),
      supabase
        .from('transactions')
        .select('amount')
        .eq('user_id', user.id)
        .eq('type', 'income')
        .gte('transaction_date', context.startDate)
        .lt('transaction_date', context.nextMonthStartDate),
      supabase
        .from('transactions')
        .select('amount')
        .eq('user_id', user.id)
        .eq('type', 'expense')
        .gte('transaction_date', context.startDate)
        .lt('transaction_date', context.nextMonthStartDate),
      supabase
        .from('transactions')
        .select('amount')
        .eq('user_id', user.id)
        .eq('type', 'savings_contribution')
        .gte('transaction_date', context.startDate)
        .lt('transaction_date', context.nextMonthStartDate),
      supabase
        .from('transactions')
        .select('amount')
        .eq('user_id', user.id)
        .eq('type', 'savings_withdrawal')
        .gte('transaction_date', context.startDate)
        .lt('transaction_date', context.nextMonthStartDate),
    ])

    if (summaryRes.error) return { data: null, error: 'Gagal memuat ringkasan bulanan.' }
    if (budgetRes.error) return { data: null, error: 'Gagal memuat alokasi anggaran.' }
    if (incomeRes.error || expenseRes.error || contribRes.error || withdrawRes.error) {
      return { data: null, error: 'Gagal memuat data transaksi.' }
    }

    const storedSummary = summaryRes.data

    // Compute live aggregates from authoritative transaction data
    const totalIncome = sumAmounts(incomeRes.data)
    const actualSpending = sumAmounts(expenseRes.data)
    const actualContributed = sumAmounts(contribRes.data)
    const actualWithdrawn = sumAmounts(withdrawRes.data)
    const totalBudget = sumNormalized(budgetRes.data)

    // For finalized months: use stored rollover amount (set by M2.9 finalization).
    // For unfinalized months: rollover is 0 (not yet decided).
    const rolloverAmount = storedSummary
      ? (Math.trunc(storedSummary.rollover_amount) as Rupiah)
      : (0 as Rupiah)

    const rawDiff = totalBudget - actualSpending
    const isOverspent = rawDiff < 0
    const budgetLeftover = (isOverspent ? 0 : rawDiff) as Rupiah
    const overspentAmount = (isOverspent ? Math.abs(rawDiff) : 0) as Rupiah
    const netSavingsMovement = (actualContributed - actualWithdrawn) as Rupiah

    return {
      data: {
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
        savedVsBudget: rawDiff as Rupiah,
        isFinalized: Boolean(storedSummary?.finalized_at),
        finalizedAt: storedSummary?.finalized_at || null,
        hasStoredSummary: Boolean(storedSummary),
      },
      error: null,
    }
  } catch (err: unknown) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Terjadi kesalahan memuat riwayat bulanan.',
    }
  }
}

/**
 * Fetch transactions for a given month, grouped by type.
 * Read-only. Newest first within each group.
 */
export async function getMonthTransactions(
  year: number,
  month: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: any,
): Promise<{ data: MonthTransactionsByType | null; error: string | null }> {
  if (!year || year < 2000) return { data: null, error: 'Tahun tidak valid.' }
  if (!month || month < 1 || month > 12) return { data: null, error: 'Bulan tidak valid (1-12).' }

  const supabase = supabaseClient || createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { data: null, error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.' }
  }

  const context = getDeterministicMonthContext(year, month)

  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('id, type, amount, description, transaction_date, created_at, reversal_of_transaction_id, reversal_reason')
      .eq('user_id', user.id)
      .gte('transaction_date', context.startDate)
      .lt('transaction_date', context.nextMonthStartDate)
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) return { data: null, error: 'Gagal memuat transaksi bulan ini.' }

    const rows = data || []
    const reversedMap = new Map<string, string>()
    for (const r of rows) {
      if (r.reversal_of_transaction_id) {
        reversedMap.set(r.reversal_of_transaction_id, r.id)
      }
    }

    const result: MonthTransactionsByType = {
      income: [],
      expense: [],
      savingsContribution: [],
      savingsWithdrawal: [],
    }

    for (const row of rows) {
      const mapped: MonthTransactionRow = {
        id: row.id,
        amount: Math.trunc(row.amount) as Rupiah,
        description: row.description,
        transactionDate: row.transaction_date,
        createdAt: row.created_at,
        reversalOfTransactionId: row.reversal_of_transaction_id ?? null,
        reversalReason: row.reversal_reason ?? null,
        isReversed: reversedMap.has(row.id),
      }
      switch (row.type) {
        case 'income':
          result.income.push(mapped)
          break
        case 'expense':
          result.expense.push(mapped)
          break
        case 'savings_contribution':
          result.savingsContribution.push(mapped)
          break
        case 'savings_withdrawal':
          result.savingsWithdrawal.push(mapped)
          break
        // rollover, adjustment, transfer — intentionally excluded from history detail
      }
    }

    return { data: result, error: null }
  } catch (err: unknown) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Terjadi kesalahan memuat transaksi.',
    }
  }
}

/**
 * Fetch list of months that have stored summaries, plus current month.
 * Read-only.
 */
export async function getAvailableMonths(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: any,
): Promise<{ data: AvailableMonth[]; error: string | null }> {
  const supabase = supabaseClient || createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { data: [], error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.' }
  }

  try {
    const { data, error } = await supabase
      .from('monthly_summaries')
      .select('year, month, finalized_at')
      .eq('user_id', user.id)
      .order('year', { ascending: false })
      .order('month', { ascending: false })

    if (error) return { data: [], error: 'Gagal memuat daftar bulan.' }

    const months: AvailableMonth[] = (data || []).map((row: { year: number; month: number; finalized_at: string | null }) => ({
      year: row.year,
      month: row.month,
      isFinalized: Boolean(row.finalized_at),
    }))

    // Ensure current month is included even without a summary row
    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth() + 1
    const hasCurrent = months.some((m) => m.year === currentYear && m.month === currentMonth)
    if (!hasCurrent) {
      months.unshift({ year: currentYear, month: currentMonth, isFinalized: false })
    }

    return { data: months, error: null }
  } catch (err: unknown) {
    return {
      data: [],
      error: err instanceof Error ? err.message : 'Terjadi kesalahan memuat daftar bulan.',
    }
  }
}

/**
 * Read-only goal progress snapshots. Uses authoritative current goal state.
 * Does NOT represent historical goal balances — labeled as current snapshots.
 */
export async function getGoalProgressSnapshots(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: any,
): Promise<{ data: GoalProgressSnapshot[]; error: string | null }> {
  const supabase = supabaseClient || createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { data: [], error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.' }
  }

  try {
    const { data, error } = await supabase
      .from('goals')
      .select('id, name, target_amount, current_amount, status')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })

    if (error) return { data: [], error: 'Gagal memuat data tujuan tabungan.' }

    const snapshots: GoalProgressSnapshot[] = (data || []).map((row: {
      id: string
      name: string
      target_amount: number
      current_amount: number
      status: string
    }) => {
      const { progressPercent } = calculateGoalProgress(row.target_amount, row.current_amount)
      return {
        id: row.id,
        name: row.name,
        targetAmount: Math.trunc(row.target_amount) as Rupiah,
        currentAmount: Math.trunc(row.current_amount) as Rupiah,
        progressPercent,
        status: row.status,
        isCurrentSnapshot: true,
      }
    })

    return { data: snapshots, error: null }
  } catch (err: unknown) {
    return {
      data: [],
      error: err instanceof Error ? err.message : 'Terjadi kesalahan memuat progres tujuan.',
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers — integer Rupiah arithmetic
// ---------------------------------------------------------------------------

function sumAmounts(rows: { amount: number }[] | null): Rupiah {
  return (rows || []).reduce((sum, r) => sum + Math.trunc(r.amount), 0) as Rupiah
}

function sumNormalized(rows: { normalized_monthly_amount: number }[] | null): Rupiah {
  return (rows || []).reduce((sum, r) => sum + Math.trunc(r.normalized_monthly_amount), 0) as Rupiah
}
