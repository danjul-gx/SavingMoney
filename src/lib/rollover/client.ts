import { createClient } from '@/lib/supabase/client'
import type { Rupiah } from '@/types/domain'
import { createSavingsContribution } from '@/lib/savings/contribution'

export interface MonthContext {
  year: number
  month: number
  previousYear: number
  previousMonth: number
  nextYear: number
  nextMonth: number
  startDate: string
  nextMonthStartDate: string
}

export interface BudgetEvaluationItem {
  budgetId: string
  category: string
  customLabel: string | null
  walletId: string
  normalizedMonthlyAmount: Rupiah
}

export interface MonthBudgetEvaluation {
  year: number
  month: number
  totalAllocatedBudget: Rupiah
  actualOperationalSpending: Rupiah
  leftoverOperationalBudget: Rupiah
  isOverspent: boolean
  overspentAmount: Rupiah
  hasLeftover: boolean
  eligibleRolloverAmount: Rupiah
  isFinalized: boolean
  finalizedAt: string | null
  actionTaken: 'added_to_savings' | 'rollover' | 'none' | null
  actionAmount: Rupiah
}

export interface MonthBudgetEvaluationResult {
  data: MonthBudgetEvaluation | null
  error: string | null
}

export interface FinalizeMonthDecisionInput {
  year: number
  month: number
  decision: 'add_to_savings' | 'rollover' | 'none'
  // When decision === 'add_to_savings', walletId and goalId are required to perform authoritative savings contribution
  walletId?: string
  goalId?: string
}

export interface FinalizeMonthDecisionResult {
  data: MonthBudgetEvaluation | null
  error: string | null
}

/**
 * Deterministic month boundary helper.
 * Computes calendar month boundaries without timezone shifts.
 */
export function getDeterministicMonthContext(year: number, month: number): MonthContext {
  const cleanYear = Math.trunc(year)
  const cleanMonth = Math.trunc(month)

  const previousYear = cleanMonth === 1 ? cleanYear - 1 : cleanYear
  const previousMonth = cleanMonth === 1 ? 12 : cleanMonth - 1

  const nextYear = cleanMonth === 12 ? cleanYear + 1 : cleanYear
  const nextMonth = cleanMonth === 12 ? 1 : cleanMonth + 1

  const formattedMonth = String(cleanMonth).padStart(2, '0')
  const startDate = `${cleanYear}-${formattedMonth}-01`

  const formattedNextMonth = String(nextMonth).padStart(2, '0')
  const nextMonthStartDate = `${nextYear}-${formattedNextMonth}-01`

  return {
    year: cleanYear,
    month: cleanMonth,
    previousYear,
    previousMonth,
    nextYear,
    nextMonth,
    startDate,
    nextMonthStartDate,
  }
}

/**
 * Pure integer-safe arithmetic evaluation of leftover budget.
 * Leftover = allocated budget - actual eligible operational expenses
 * Returns structured evaluation with explicit overspending tracking (no negative silent clamping).
 */
export function evaluateBudgetLeftover(
  year: number,
  month: number,
  totalAllocated: number,
  actualExpenses: number,
  summaryRow?: {
    finalized_at?: string | null
    amount_added_to_savings?: number
    rollover_amount?: number
  } | null
): MonthBudgetEvaluation {
  const cleanAllocated = Math.trunc(Math.max(0, totalAllocated)) as Rupiah
  const cleanExpenses = Math.trunc(Math.max(0, actualExpenses)) as Rupiah

  const rawDiff = cleanAllocated - cleanExpenses
  const isOver = rawDiff < 0
  const overspentAmount = isOver ? (Math.abs(rawDiff) as Rupiah) : (0 as Rupiah)
  const leftover = isOver ? (0 as Rupiah) : (rawDiff as Rupiah)
  const hasLeftover = rawDiff > 0

  let actionTaken: 'added_to_savings' | 'rollover' | 'none' | null = null
  let actionAmount = 0 as Rupiah

  if (summaryRow?.finalized_at) {
    if (summaryRow.amount_added_to_savings && summaryRow.amount_added_to_savings > 0) {
      actionTaken = 'added_to_savings'
      actionAmount = Math.trunc(summaryRow.amount_added_to_savings) as Rupiah
    } else if (summaryRow.rollover_amount && summaryRow.rollover_amount > 0) {
      actionTaken = 'rollover'
      actionAmount = Math.trunc(summaryRow.rollover_amount) as Rupiah
    } else {
      actionTaken = 'none'
      actionAmount = 0 as Rupiah
    }
  }

  return {
    year,
    month,
    totalAllocatedBudget: cleanAllocated,
    actualOperationalSpending: cleanExpenses,
    leftoverOperationalBudget: leftover,
    isOverspent: isOver,
    overspentAmount,
    hasLeftover,
    eligibleRolloverAmount: leftover,
    isFinalized: Boolean(summaryRow?.finalized_at),
    finalizedAt: summaryRow?.finalized_at || null,
    actionTaken,
    actionAmount,
  }
}

/**
 * Fetch and evaluate month-end budget leftover for the authenticated user.
 */
export async function getMonthBudgetEvaluation(
  year: number,
  month: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: any
): Promise<MonthBudgetEvaluationResult> {
  if (!year || year < 2000) {
    return { data: null, error: 'Tahun tidak valid.' }
  }
  if (!month || month < 1 || month > 12) {
    return { data: null, error: 'Bulan tidak valid (1-12).' }
  }

  const context = getDeterministicMonthContext(year, month)
  const supabase = supabaseClient || createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { data: null, error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.' }
  }

  try {
    // 1. Fetch budget allocations for the month
    const { data: budgetAlloc, error: budgetError } = await supabase
      .from('budget_allocations')
      .select('id, category, custom_label, wallet_id, normalized_monthly_amount')
      .eq('user_id', user.id)
      .eq('budget_year', year)
      .eq('budget_month', month)

    if (budgetError) {
      return { data: null, error: 'Gagal memuat data alokasi anggaran bulanan.' }
    }

    // 2. Fetch operational expense transactions for the month
    const { data: expenseTx, error: txError } = await supabase
      .from('transactions')
      .select('amount')
      .eq('user_id', user.id)
      .eq('type', 'expense')
      .gte('transaction_date', context.startDate)
      .lt('transaction_date', context.nextMonthStartDate)

    if (txError) {
      return { data: null, error: 'Gagal memuat transaksi pengeluaran operasional.' }
    }

    // 3. Fetch monthly summary if already evaluated/finalized
    const { data: summaryData, error: summaryError } = await supabase
      .from('monthly_summaries')
      .select('*')
      .eq('user_id', user.id)
      .eq('year', year)
      .eq('month', month)
      .maybeSingle()

    if (summaryError) {
      return { data: null, error: 'Gagal memuat ringkasan bulanan.' }
    }

    const totalAllocated = (budgetAlloc || []).reduce(
      (sum: number, b: { normalized_monthly_amount: number }) => sum + Math.trunc(b.normalized_monthly_amount),
      0
    )

    const actualExpenses = (expenseTx || []).reduce(
      (sum: number, tx: { amount: number }) => sum + Math.trunc(tx.amount),
      0
    )

    const evaluation = evaluateBudgetLeftover(
      year,
      month,
      totalAllocated,
      actualExpenses,
      summaryData
    )

    return { data: evaluation, error: null }
  } catch (err: unknown) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Terjadi kesalahan mengevaluasi sisa anggaran.',
    }
  }
}

/**
 * Execute an explicit month-end decision on budget leftover.
 *
 * Idempotency & Safety:
 * - If month is already finalized, re-executing returns the existing result without duplicating changes.
 * - If decision is 'add_to_savings':
 *     Executes authoritative createSavingsContribution with walletId and goalId.
 *     Does NOT mutate wallets or goals directly.
 * - If decision is 'rollover':
 *     Records planning rollover amount into destination month's budget_allocations planning.
 *     DOES NOT mutate wallet balances (rollover is a planning allocation, not physical cash).
 * - Records outcome in `monthly_summaries` table keyed on (user_id, year, month).
 */
export async function finalizeMonthBudgetDecision(
  input: FinalizeMonthDecisionInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: any
): Promise<FinalizeMonthDecisionResult> {
  const { year, month, decision, walletId, goalId } = input
  if (!year || year < 2000) {
    return { data: null, error: 'Tahun tidak valid.' }
  }
  if (!month || month < 1 || month > 12) {
    return { data: null, error: 'Bulan tidak valid (1-12).' }
  }

  const supabase = supabaseClient || createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { data: null, error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.' }
  }

  // 1. Get current evaluation
  const evalRes = await getMonthBudgetEvaluation(year, month, supabase)
  if (evalRes.error || !evalRes.data) {
    return { data: null, error: evalRes.error || 'Gagal mengevaluasi sisa anggaran.' }
  }

  const evaluation = evalRes.data

  // Idempotency check: if already finalized, return current evaluation safely
  if (evaluation.isFinalized) {
    return { data: evaluation, error: null }
  }

  const leftover = evaluation.leftoverOperationalBudget

  let amountAddedToSavings = 0
  let rolloverAmount = 0

  if (decision === 'add_to_savings') {
    if (leftover <= 0) {
      return { data: null, error: 'Tidak ada sisa anggaran untuk ditambahkan ke tabungan.' }
    }
    if (!walletId || !goalId) {
      return {
        data: null,
        error: 'Dompet sumber dan tujuan tabungan wajib dipilih untuk memindahkan sisa ke tabungan.',
      }
    }

    // Execute through authoritative M2.7 savings contribution ledger transaction
    const context = getDeterministicMonthContext(year, month)
    const txDate = context.startDate // YYYY-MM-01 of the evaluated month
    const contributionRes = await createSavingsContribution(
      {
        walletId,
        goalId,
        amount: leftover,
        description: `Sisa Anggaran ${month}/${year} Ditabung`,
        transactionDate: txDate,
      },
      supabase
    )

    if (contributionRes.error) {
      return {
        data: null,
        error: `Gagal memproses alokasi tabungan: ${contributionRes.error}`,
      }
    }

    amountAddedToSavings = leftover
  } else if (decision === 'rollover') {
    if (leftover <= 0) {
      return { data: null, error: 'Tidak ada sisa anggaran untuk di-rollover.' }
    }

    // Rollover is an explicit planning decision that carries leftover forward into next month's planning
    // It DOES NOT mutate wallet balances.
    rolloverAmount = leftover

    const context = getDeterministicMonthContext(year, month)
    const nextYear = context.nextYear
    const nextMonth = context.nextMonth

    // Verify if default operational wallet exists for rollover planning allocation
    const { data: userWallets } = await supabase
      .from('wallets')
      .select('id')
      .eq('user_id', user.id)
      .limit(1)

    const targetWalletId = walletId || (userWallets && userWallets[0]?.id)
    if (targetWalletId) {
      // Upsert / Insert planning budget item for next month
      await supabase.from('budget_allocations').insert({
        user_id: user.id,
        wallet_id: targetWalletId,
        budget_year: nextYear,
        budget_month: nextMonth,
        category: 'other',
        custom_label: `Rollover dari ${month}/${year}`,
        original_amount: rolloverAmount,
        period: 'monthly',
        normalized_monthly_amount: rolloverAmount,
      })
    }
  }

  // Record into monthly_summaries
  const nowIso = new Date().toISOString()
  const summaryPayload = {
    user_id: user.id,
    year,
    month,
    planned_operational_budget: evaluation.totalAllocatedBudget,
    actual_operational_spending: evaluation.actualOperationalSpending,
    leftover_operational_budget: leftover,
    amount_added_to_savings: amountAddedToSavings,
    rollover_amount: rolloverAmount,
    saved_vs_budget: evaluation.totalAllocatedBudget - evaluation.actualOperationalSpending,
    finalized_at: nowIso,
  }

  const { error: upsertError } = await supabase
    .from('monthly_summaries')
    .upsert(summaryPayload, { onConflict: 'user_id,year,month' })

  if (upsertError) {
    return { data: null, error: 'Gagal mencatat ringkasan evaluasi bulan.' }
  }

  const mappedAction: 'added_to_savings' | 'rollover' | 'none' =
    decision === 'add_to_savings' ? 'added_to_savings' : decision

  return {
    data: {
      ...evaluation,
      isFinalized: true,
      finalizedAt: nowIso,
      actionTaken: mappedAction,
      actionAmount: decision === 'add_to_savings' ? (amountAddedToSavings as Rupiah) : (rolloverAmount as Rupiah),
    },
    error: null,
  }
}
