/**
 * M2.14 Dashboard Data Access & Calculation Module
 *
 * Provides a read-only presentation/information layer summarizing authoritative
 * financial records (wallets, transactions, budget allocations, goals, monthly summaries).
 *
 * Core Principles:
 * - Read-only: Never mutates any database table or balance.
 * - Source of truth: Wallets.balance and goals.current_amount are taken directly from DB.
 * - Cashflow calculation: Net Cashflow = Income - Expense (adjusted for reversals).
 * - Savings movement: Contributions - Withdrawals (strictly separate from planned savings).
 * - Budget usage: Based on normalized monthly amounts and actual expenses.
 * - Goal progress: Actual amount preserved, progress percentage clamped to 0-100% for display.
 * - Security: Scoped to authenticated user (auth.uid()).
 */

import { createClient } from '@/lib/supabase/client'
import { getDeterministicMonthContext } from '@/lib/rollover/client'
import { calculateGoalProgress } from '@/lib/goals/client'
import type { Wallet, Rupiah } from '@/types/domain'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WalletDashboardSummary {
  totalBalance: Rupiah
  wallets: Wallet[]
}

export interface CashflowSummary {
  totalIncome: Rupiah
  totalExpenses: Rupiah
  netCashflow: Rupiah
}

export interface SavingsMovementSummary {
  plannedSavings: Rupiah
  actualContributions: Rupiah
  actualWithdrawals: Rupiah
  netSavingsMovement: Rupiah
}

export interface BudgetUsageSummary {
  totalAllocatedBudget: Rupiah
  actualOperationalSpending: Rupiah
  remainingBudget: Rupiah
  overspentAmount: Rupiah
  isOverspent: boolean
  utilizationPercentage: number
}

export interface GoalDashboardItem {
  id: string
  name: string
  targetAmount: Rupiah
  currentAmount: Rupiah
  remainingAmount: Rupiah
  progressPercent: number
  isOverfunded: boolean
  targetYear: number | null
  targetMonth: number | null
  status: string
  isPrimary: boolean
}

export interface FinancialHealthFactSummary {
  totalIncome: Rupiah
  totalExpenses: Rupiah
  netCashflow: Rupiah
  plannedSavings: Rupiah
  actualSavingsMovement: Rupiah
  budgetUsagePercent: number
  activeGoalsCount: number
}

export interface DashboardData {
  year: number
  month: number
  walletSummary: WalletDashboardSummary
  cashflow: CashflowSummary
  savingsMovement: SavingsMovementSummary
  budgetUsage: BudgetUsageSummary
  goals: GoalDashboardItem[]
  financialFacts: FinancialHealthFactSummary
}

export interface DashboardFetchResult {
  data: DashboardData | null
  error: string | null
}

// ---------------------------------------------------------------------------
// Pure Calculation Helpers (Deterministic, Integer-safe)
// ---------------------------------------------------------------------------

interface TransactionRow {
  id: string
  type: string
  amount: number
  adjustment_direction?: string | null
  reversal_of_transaction_id?: string | null
}

export function computeDashboardCashflow(transactions: TransactionRow[]): CashflowSummary {
  let income = 0
  let expense = 0

  for (const tx of transactions) {
    const amt = Math.trunc(tx.amount)
    if (tx.type === 'income') {
      income += amt
    } else if (tx.type === 'expense') {
      expense += amt
    } else if (tx.type === 'adjustment' && tx.reversal_of_transaction_id) {
      // Reversal adjustment
      if (tx.adjustment_direction === 'debit') {
        // Negates income: subtract from income
        income -= amt
      } else if (tx.adjustment_direction === 'credit') {
        // Negates expense: subtract from expense
        expense -= amt
      }
    }
    // Note: savings_contribution, savings_withdrawal, rollover are intentionally NOT ordinary cashflow
  }

  const cleanIncome = Math.max(0, income) as Rupiah
  const cleanExpense = Math.max(0, expense) as Rupiah
  const netCashflow = (cleanIncome - cleanExpense) as Rupiah

  return {
    totalIncome: cleanIncome,
    totalExpenses: cleanExpense,
    netCashflow,
  }
}

export function computeDashboardSavingsMovement(
  transactions: TransactionRow[],
  plannedSavings: Rupiah
): SavingsMovementSummary {
  let contributions = 0
  let withdrawals = 0

  for (const tx of transactions) {
    const amt = Math.trunc(tx.amount)
    if (tx.type === 'savings_contribution') {
      if (tx.reversal_of_transaction_id) {
        // Reversal of withdrawal: negates withdrawal
        withdrawals -= amt
      } else {
        contributions += amt
      }
    } else if (tx.type === 'savings_withdrawal') {
      if (tx.reversal_of_transaction_id) {
        // Reversal of contribution: negates contribution
        contributions -= amt
      } else {
        withdrawals += amt
      }
    }
  }

  const cleanContributions = Math.max(0, contributions) as Rupiah
  const cleanWithdrawals = Math.max(0, withdrawals) as Rupiah
  const netSavingsMovement = (cleanContributions - cleanWithdrawals) as Rupiah

  return {
    plannedSavings,
    actualContributions: cleanContributions,
    actualWithdrawals: cleanWithdrawals,
    netSavingsMovement,
  }
}

export function computeDashboardBudgetUsage(
  totalAllocatedBudget: number,
  actualOperationalSpending: number
): BudgetUsageSummary {
  const budget = Math.trunc(Math.max(0, totalAllocatedBudget)) as Rupiah
  const spending = Math.trunc(Math.max(0, actualOperationalSpending)) as Rupiah

  const rawDiff = budget - spending
  const isOverspent = rawDiff < 0
  const remainingBudget = (isOverspent ? 0 : rawDiff) as Rupiah
  const overspentAmount = (isOverspent ? Math.abs(rawDiff) : 0) as Rupiah

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

// ---------------------------------------------------------------------------
// Authoritative Read-Only Dashboard Fetch
// ---------------------------------------------------------------------------

export async function getDashboardData(
  year: number,
  month: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: any
): Promise<DashboardFetchResult> {
  if (!year || year < 2000) return { data: null, error: 'Tahun tidak valid.' }
  if (!month || month < 1 || month > 12) return { data: null, error: 'Bulan tidak valid (1-12).' }

  const supabase = supabaseClient || createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { data: null, error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.' }
  }

  const context = getDeterministicMonthContext(year, month)

  try {
    // Parallel fetch of authoritative records
    const [walletsRes, budgetsRes, txRes, goalsRes] = await Promise.all([
      supabase.from('wallets').select('*').eq('user_id', user.id).order('created_at', { ascending: true }),
      supabase
        .from('budget_allocations')
        .select('normalized_monthly_amount')
        .eq('user_id', user.id)
        .eq('budget_year', year)
        .eq('budget_month', month),
      supabase
        .from('transactions')
        .select('id, type, amount, adjustment_direction, reversal_of_transaction_id')
        .eq('user_id', user.id)
        .gte('transaction_date', context.startDate)
        .lt('transaction_date', context.nextMonthStartDate),
      supabase.from('goals').select('*').eq('user_id', user.id).eq('status', 'active').order('created_at', { ascending: true }),
    ])

    if (walletsRes.error) return { data: null, error: 'Gagal memuat saldo dompet.' }
    if (budgetsRes.error) return { data: null, error: 'Gagal memuat alokasi anggaran.' }
    if (txRes.error) return { data: null, error: 'Gagal memuat transaksi bulan ini.' }
    if (goalsRes.error) return { data: null, error: 'Gagal memuat tujuan tabungan.' }

    // 1. Wallets
    const wallets: Wallet[] = (walletsRes.data || []).map((w: { id: string; user_id: string; type: Wallet['type']; label: string; balance: number; created_at: string; updated_at: string }) => ({
      id: w.id,
      userId: w.user_id,
      type: w.type,
      label: w.label,
      balance: Math.trunc(w.balance) as Rupiah,
      createdAt: w.created_at,
      updatedAt: w.updated_at,
    }))
    const totalWalletBalance = wallets.reduce((sum, w) => sum + w.balance, 0) as Rupiah

    // 2. Budget Allocations total
    const totalAllocatedBudget = (budgetsRes.data || []).reduce(
      (sum: number, b: { normalized_monthly_amount: number }) => sum + Math.trunc(b.normalized_monthly_amount),
      0
    ) as Rupiah

    // 3. Transactions & Cashflow
    const rawTx: TransactionRow[] = txRes.data || []
    const cashflow = computeDashboardCashflow(rawTx)

    // Planned savings = max(0, totalIncome - totalAllocatedBudget)
    const plannedSavings = Math.max(0, cashflow.totalIncome - totalAllocatedBudget) as Rupiah

    // 4. Savings Movement
    const savingsMovement = computeDashboardSavingsMovement(rawTx, plannedSavings)

    // 5. Budget Usage (operational spending = cashflow.totalExpenses)
    const budgetUsage = computeDashboardBudgetUsage(totalAllocatedBudget, cashflow.totalExpenses)

    // 6. Goals Progress
    const goals: GoalDashboardItem[] = (goalsRes.data || []).map((g: { id: string; name: string; target_amount: number; current_amount: number; target_year: number | null; target_month: number | null; status: string; is_primary: boolean }) => {
      const progress = calculateGoalProgress(g.target_amount, g.current_amount)
      return {
        id: g.id,
        name: g.name,
        targetAmount: Math.trunc(g.target_amount) as Rupiah,
        currentAmount: Math.trunc(g.current_amount) as Rupiah,
        remainingAmount: progress.remainingAmount,
        progressPercent: progress.progressPercent,
        isOverfunded: progress.isOverfunded,
        targetYear: g.target_year,
        targetMonth: g.target_month,
        status: g.status,
        isPrimary: g.is_primary,
      }
    })

    // 7. Factual Financial Summary
    const financialFacts: FinancialHealthFactSummary = {
      totalIncome: cashflow.totalIncome,
      totalExpenses: cashflow.totalExpenses,
      netCashflow: cashflow.netCashflow,
      plannedSavings,
      actualSavingsMovement: savingsMovement.netSavingsMovement,
      budgetUsagePercent: budgetUsage.utilizationPercentage,
      activeGoalsCount: goals.length,
    }

    return {
      data: {
        year,
        month,
        walletSummary: {
          totalBalance: totalWalletBalance,
          wallets,
        },
        cashflow,
        savingsMovement,
        budgetUsage,
        goals,
        financialFacts,
      },
      error: null,
    }
  } catch (err: unknown) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Terjadi kesalahan memuat dashboard keuangan.',
    }
  }
}
