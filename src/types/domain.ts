/**
 * Application-level domain types.
 * These are richer than raw DB rows — they carry computed fields,
 * formatted values, and cross-table compositions used by the UI and logic layers.
 *
 * Monetary values are always integer Rupiah (number, no decimals).
 * NEVER use floating point for money.
 */

import type {
  WalletType,
  GoalStatus,
  BudgetCategory,
  BudgetPeriod,
  TransactionType,
  AdjustmentDirection,
} from './database'

// Re-export enum types for convenience
export type { WalletType, GoalStatus, BudgetCategory, BudgetPeriod, TransactionType, AdjustmentDirection }

// ---------------------------------------------------------------------------
// Money helpers
// ---------------------------------------------------------------------------

/** Rupiah amount as integer. Never use float. */
export type Rupiah = number

/** Format integer Rupiah to display string: 50000 → "Rp50.000" */
export function formatRupiah(amount: Rupiah): string {
  return 'Rp' + amount.toLocaleString('id-ID')
}

/**
 * Compute normalized monthly amount from original + period using integer-safe arithmetic.
 * Weekly normalization uses project default factor 4.3 (43/10).
 * Rounding policy: standard half-up integer rounding via Math.floor((amount * 43 + 5) / 10).
 * Interval normalization uses integer formula: Math.floor((originalAmount * 30 + Math.floor(intervalDays / 2)) / intervalDays).
 * No floating-point multiplication.
 */
export function normalizeToMonthly(
  originalAmount: Rupiah,
  period: BudgetPeriod,
  intervalDays?: number | null
): Rupiah {
  if (period === 'monthly') return originalAmount
  if (period === 'weekly') {
    // Integer arithmetic: (originalAmount * 43 + 5) / 10
    return Math.floor((originalAmount * 43 + 5) / 10) as Rupiah
  }
  if (period === 'interval') {
    if (!intervalDays || intervalDays <= 0) {
      throw new Error('interval_days must be a positive integer for interval period')
    }
    // Integer arithmetic: Math.floor((originalAmount * 30 + Math.floor(intervalDays / 2)) / intervalDays)
    return Math.floor(((originalAmount * 30) + Math.floor(intervalDays / 2)) / intervalDays) as Rupiah
  }
  return originalAmount
}

// ---------------------------------------------------------------------------
// Domain entities
// ---------------------------------------------------------------------------

export interface Profile {
  id: string
  userId: string
  displayName: string | null
  timezone: string
  createdAt: string
  updatedAt: string
}

export interface Goal {
  id: string
  userId: string
  name: string
  targetAmount: Rupiah
  currentAmount: Rupiah
  targetYear: number | null
  targetMonth: number | null
  status: GoalStatus
  isPrimary: boolean
  createdAt: string
  updatedAt: string
  /** Computed: 0–100 */
  progressPercent: number
}

export interface Wallet {
  id: string
  userId: string
  type: WalletType
  label: string
  balance: Rupiah
  createdAt: string
  updatedAt: string
}

export interface BudgetAllocation {
  id: string
  userId: string
  walletId: string
  budgetYear: number
  budgetMonth: number
  category: BudgetCategory
  customLabel: string | null
  originalAmount: Rupiah
  period: BudgetPeriod
  intervalDays: number | null
  normalizedMonthlyAmount: Rupiah
  createdAt: string
  updatedAt: string
}

export interface Transaction {
  id: string
  userId: string
  /** Required for all valid transaction types (enforced by tx_wallet_required constraint) */
  walletId: string
  goalId: string | null
  type: TransactionType
  amount: Rupiah
  description: string | null
  /** Required when type = 'adjustment'. Null for all other types. */
  adjustmentDirection: AdjustmentDirection | null
  /** Reversal relationship fields (M2.12) */
  reversalOfTransactionId: string | null
  reversalReason: string | null
  /** Derived helper: whether this transaction has been reversed by a subsequent transaction */
  reversedByTransactionId?: string | null
  isReversed?: boolean
  transactionDate: string
  createdAt: string
}

export interface Transfer {
  id: string
  userId: string
  sourceWalletId: string
  destinationWalletId: string
  amount: Rupiah
  description: string | null
  transferDate: string
  createdAt: string
}

export interface SavingsWithdrawal {
  id: string
  userId: string
  goalId: string
  destinationWalletId: string
  transactionId: string
  amount: Rupiah
  reason: string
  estimatedDelayDays: number
  createdAt: string
}

export interface MonthlySummary {
  id: string
  userId: string
  year: number
  month: number
  totalIncome: Rupiah
  plannedOperationalBudget: Rupiah
  actualOperationalSpending: Rupiah
  plannedSavings: Rupiah
  actualSavings: Rupiah
  savingsWithdrawn: Rupiah
  leftoverOperationalBudget: Rupiah
  amountAddedToSavings: Rupiah
  rolloverAmount: Rupiah
  /** Can be negative when overspending */
  savedVsBudget: Rupiah
  finalizedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AppSettings {
  weeklyMultiplier: number
}

export interface UserFinancialSettings {
  userId: string
  /** Weekly-to-monthly multiplier. Stored as NUMERIC(5,2). Default 4.3. */
  weeklyMultiplier: number
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Computed / composite types for UI
// ---------------------------------------------------------------------------

/** Monthly savings allocation = income - total normalized operational budget */
export function computePlannedSavings(
  monthlyIncome: Rupiah,
  budgetAllocations: BudgetAllocation[]
): Rupiah {
  const totalBudget = budgetAllocations.reduce(
    (sum, b) => sum + b.normalizedMonthlyAmount,
    0
  )
  return monthlyIncome - totalBudget
}

/** Wallet pair for a user (MVP: exactly one cash, one digital) */
export interface WalletPair {
  cash: Wallet | null
  digital: Wallet | null
}

export interface SavingsContributionInput {
  walletId: string
  goalId: string
  amount: number
  description?: string | null
  transactionDate: string
}

export interface SavingsContributionResult {
  data: Transaction | null
  error: string | null
}

export interface SavingsWithdrawalInput {
  goalId: string
  walletId: string
  amount: number
  reason: string
  transactionDate: string
  estimatedDelayDays?: number
}

export interface SavingsWithdrawalResult {
  data: {
    transaction: Transaction
    withdrawal: SavingsWithdrawal
  } | null
  error: string | null
}

// ---------------------------------------------------------------------------
// Financial Audit Trail Types (M2.13)
// ---------------------------------------------------------------------------

export type AuditEventType =
  | 'income_recorded'
  | 'expense_recorded'
  | 'savings_contribution_recorded'
  | 'savings_withdrawal_recorded'
  | 'rollover_recorded'
  | 'adjustment_recorded'
  | 'transaction_created'
  | 'transaction_reversed'
  | 'savings_withdrawal_executed'
  | 'budget_rollover_finalized'

export type AuditFilterCategory =
  | 'all'
  | 'transactions'
  | 'savings'
  | 'reversals'
  | 'rollover'

export interface FinancialAuditEvent {
  id: string
  userId: string
  eventType: AuditEventType
  entityType: string
  entityId: string | null
  transactionId: string | null
  relatedTransactionId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

// ---------------------------------------------------------------------------
// Dashboard Types (M2.14)
// ---------------------------------------------------------------------------

export type {
  DashboardData,
  WalletDashboardSummary,
  CashflowSummary,
  SavingsMovementSummary,
  BudgetUsageSummary,
  GoalDashboardItem,
  FinancialHealthFactSummary,
  DashboardFetchResult,
} from '../lib/dashboard/client'

// ---------------------------------------------------------------------------
// Report & Export Types (M2.15)
// ---------------------------------------------------------------------------

export type {
  FinancialReportData,
  FinancialReportMetadata,
  ExportWalletItem,
  ExportTransactionItem,
  ExportBudgetItem,
  ExportGoalItem,
  ExportSavingsSummary,
  ExportCashflowSummary,
  ExportBudgetSummary,
  ExportMonthlySummaryItem,
  ExportAuditItem,
  FinancialReportFetchResult,
} from '../lib/reports/client'



