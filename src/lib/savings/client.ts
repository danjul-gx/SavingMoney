import { createClient } from '@/lib/supabase/client'
import type { Rupiah } from '@/types/domain'

export interface SavingsAllocationCalculation {
  year: number
  month: number
  totalIncome: Rupiah
  totalOperationalBudget: Rupiah
  savingsAllocation: Rupiah
  isBudgetOverIncome: boolean
  budgetOverIncomeAmount: Rupiah
}

export interface SavingsAllocationResult {
  data: SavingsAllocationCalculation | null
  error: string | null
}

/**
 * Pure, integer-safe calculation of savings allocation.
 * Savings Allocation = max(0, Total Income - Total Operational Budget)
 */
export function calculateSavingsAllocation(
  year: number,
  month: number,
  totalIncome: number,
  totalOperationalBudget: number
): SavingsAllocationCalculation {
  const cleanIncome = Math.trunc(Math.max(0, totalIncome)) as Rupiah
  const cleanBudget = Math.trunc(Math.max(0, totalOperationalBudget)) as Rupiah

  const isOver = cleanBudget > cleanIncome
  const rawDiff = cleanIncome - cleanBudget
  const savingsAllocation = Math.max(0, rawDiff) as Rupiah
  const overAmount = isOver ? (cleanBudget - cleanIncome) as Rupiah : (0 as Rupiah)

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

/**
 * Fetch authoritative month data (income transactions & budget allocations)
 * and calculate savings allocation for the authenticated user.
 */
export async function getSavingsAllocation(
  year: number,
  month: number
): Promise<SavingsAllocationResult> {
  if (!year || year < 2000) {
    return { data: null, error: 'Tahun tidak valid.' }
  }
  if (!month || month < 1 || month > 12) {
    return { data: null, error: 'Bulan tidak valid (1-12).' }
  }

  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { data: null, error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.' }
  }

  // Calculate month boundaries in YYYY-MM-DD
  const formattedMonth = String(month).padStart(2, '0')
  const startDate = `${year}-${formattedMonth}-01`

  // Next month calculation for range filter: [startDate, nextMonthStartDate)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const formattedNextMonth = String(nextMonth).padStart(2, '0')
  const nextMonthStartDate = `${nextYear}-${formattedNextMonth}-01`

  try {
    // 1. Fetch actual income transactions for the month
    const { data: incomeTx, error: txError } = await supabase
      .from('transactions')
      .select('amount')
      .eq('user_id', user.id)
      .eq('type', 'income')
      .gte('transaction_date', startDate)
      .lt('transaction_date', nextMonthStartDate)

    if (txError) {
      return { data: null, error: 'Gagal memuat data transaksi pemasukan.' }
    }

    // 2. Fetch budget allocations for the month
    const { data: budgetAlloc, error: budgetError } = await supabase
      .from('budget_allocations')
      .select('normalized_monthly_amount')
      .eq('user_id', user.id)
      .eq('budget_year', year)
      .eq('budget_month', month)

    if (budgetError) {
      return { data: null, error: 'Gagal memuat data alokasi anggaran.' }
    }

    // Sum income (integer sum)
    const totalIncome = (incomeTx || []).reduce(
      (sum, row) => sum + Math.trunc(row.amount),
      0
    )

    // Sum normalized monthly budget (integer sum)
    const totalOperationalBudget = (budgetAlloc || []).reduce(
      (sum, row) => sum + Math.trunc(row.normalized_monthly_amount),
      0
    )

    const calculation = calculateSavingsAllocation(
      year,
      month,
      totalIncome,
      totalOperationalBudget
    )

    return {
      data: calculation,
      error: null,
    }
  } catch (err: unknown) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Terjadi kesalahan menghitung alokasi tabungan.',
    }
  }
}
