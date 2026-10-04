/**
 * M2.15 Financial Reports & Data Export Module
 *
 * Provides a read-only export capability summarizing authoritative
 * financial records (wallets, transactions, budget allocations, goals,
 * monthly summaries, and financial audit events).
 *
 * Core Principles:
 * - Read-only: Zero database mutations (no INSERT/UPDATE/DELETE).
 * - Single source of truth: authoritative tables (wallets, transactions, goals, budgets, audit).
 * - Exact integer Rupiah arithmetic: zero floating-point accumulation.
 * - Reversal semantics: original and reversal transactions are clearly exposed with
 *   reversal_of_transaction_id and reversal_reason, with M2.14 net accounting applied to summary.
 * - Deterministic CSV formatting: UTF-8, proper RFC 4180 escaping, deterministic headers/rows.
 * - User-scoped RLS security: strictly derived from auth.uid().
 */

import { createClient } from '@/lib/supabase/client'
import { getDeterministicMonthContext } from '@/lib/rollover/client'
import {
  computeDashboardCashflow,
  computeDashboardSavingsMovement,
  computeDashboardBudgetUsage,
} from '@/lib/dashboard/client'
import { calculateGoalProgress } from '@/lib/goals/client'
import type { Rupiah } from '@/types/domain'

// ---------------------------------------------------------------------------
// Export Data Structures
// ---------------------------------------------------------------------------

export interface FinancialReportMetadata {
  year: number
  month: number
  generatedAt: string
  userId: string
  userEmail: string | null
}

export interface ExportWalletItem {
  id: string
  label: string
  type: string
  balance: Rupiah
}

export interface ExportTransactionItem {
  id: string
  transactionDate: string
  type: string
  amount: Rupiah
  walletId: string
  walletLabel: string
  goalId: string | null
  goalName: string | null
  description: string
  adjustmentDirection: string | null
  reversalOfTransactionId: string | null
  reversalReason: string | null
}

export interface ExportBudgetItem {
  id: string
  category: string
  customLabel: string | null
  period: string
  intervalDays: number | null
  originalAmount: Rupiah
  normalizedMonthlyAmount: Rupiah
}

export interface ExportGoalItem {
  id: string
  name: string
  targetAmount: Rupiah
  currentAmount: Rupiah
  targetYear: number | null
  targetMonth: number | null
  progressPercent: number
  isOverfunded: boolean
  remainingAmount: Rupiah
  status: string
}

export interface ExportSavingsSummary {
  plannedSavings: Rupiah
  actualContributions: Rupiah
  actualWithdrawals: Rupiah
  netSavingsMovement: Rupiah
}

export interface ExportCashflowSummary {
  totalIncome: Rupiah
  totalExpenses: Rupiah
  netCashflow: Rupiah
}

export interface ExportBudgetSummary {
  totalAllocatedBudget: Rupiah
  actualOperationalSpending: Rupiah
  remainingBudget: Rupiah
  overspentAmount: Rupiah
  isOverspent: boolean
  utilizationPercentage: number
}

export interface ExportMonthlySummaryItem {
  id: string
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
  savedVsBudget: Rupiah
  finalizedAt: string | null
}

export interface ExportAuditItem {
  id: string
  createdAt: string
  eventType: string
  entityType: string
  entityId: string | null
  transactionId: string | null
  relatedTransactionId: string | null
}

export interface FinancialReportData {
  metadata: FinancialReportMetadata
  wallets: ExportWalletItem[]
  transactions: ExportTransactionItem[]
  budgets: ExportBudgetItem[]
  goals: ExportGoalItem[]
  cashflow: ExportCashflowSummary
  savingsSummary: ExportSavingsSummary
  budgetSummary: ExportBudgetSummary
  monthlySummary: ExportMonthlySummaryItem | null
  auditEvents: ExportAuditItem[]
}

export interface FinancialReportFetchResult {
  data: FinancialReportData | null
  error: string | null
}

// ---------------------------------------------------------------------------
// Authoritative Read-Only Fetch
// ---------------------------------------------------------------------------

export async function getFinancialReportData(
  year: number,
  month: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: any
): Promise<FinancialReportFetchResult> {
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
    // 1. Parallel fetch of all authoritative user records
    const [
      walletsRes,
      budgetsRes,
      txRes,
      goalsRes,
      monthlySummaryRes,
      auditRes,
    ] = await Promise.all([
      supabase.from('wallets').select('*').eq('user_id', user.id).order('created_at', { ascending: true }),
      supabase
        .from('budget_allocations')
        .select('*')
        .eq('user_id', user.id)
        .eq('budget_year', year)
        .eq('budget_month', month)
        .order('created_at', { ascending: true }),
      supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .gte('transaction_date', context.startDate)
        .lt('transaction_date', context.nextMonthStartDate)
        .order('transaction_date', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase.from('goals').select('*').eq('user_id', user.id).order('created_at', { ascending: true }),
      supabase
        .from('monthly_summaries')
        .select('*')
        .eq('user_id', user.id)
        .eq('year', year)
        .eq('month', month)
        .maybeSingle(),
      supabase
        .from('financial_audit_events')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', `${context.startDate}T00:00:00.000Z`)
        .lt('created_at', `${context.nextMonthStartDate}T00:00:00.000Z`)
        .order('created_at', { ascending: true }),
    ])

    if (walletsRes.error) return { data: null, error: 'Gagal memuat saldo dompet untuk laporan.' }
    if (budgetsRes.error) return { data: null, error: 'Gagal memuat anggaran untuk laporan.' }
    if (txRes.error) return { data: null, error: 'Gagal memuat transaksi untuk laporan.' }
    if (goalsRes.error) return { data: null, error: 'Gagal memuat tujuan tabungan untuk laporan.' }
    if (monthlySummaryRes.error) return { data: null, error: 'Gagal memuat ringkasan bulanan untuk laporan.' }
    if (auditRes.error) return { data: null, error: 'Gagal memuat riwayat audit untuk laporan.' }

    // Map dictionaries for labels
    const walletMap = new Map<string, { label: string; type: string }>()
    const exportWallets: ExportWalletItem[] = (walletsRes.data || []).map((w: { id: string; label: string; type: string; balance: number }) => {
      walletMap.set(w.id, { label: w.label, type: w.type })
      return {
        id: w.id,
        label: w.label,
        type: w.type,
        balance: Math.trunc(w.balance) as Rupiah,
      }
    })

    const goalMap = new Map<string, string>()
    const exportGoals: ExportGoalItem[] = (goalsRes.data || []).map((g: { id: string; name: string; target_amount: number; current_amount: number; target_year: number | null; target_month: number | null; status: string }) => {
      goalMap.set(g.id, g.name)
      const prog = calculateGoalProgress(g.target_amount, g.current_amount)
      return {
        id: g.id,
        name: g.name,
        targetAmount: Math.trunc(g.target_amount) as Rupiah,
        currentAmount: Math.trunc(g.current_amount) as Rupiah, // Preserves raw amount without clamping
        targetYear: g.target_year,
        targetMonth: g.target_month,
        progressPercent: prog.progressPercent,
        isOverfunded: prog.isOverfunded,
        remainingAmount: prog.remainingAmount,
        status: g.status,
      }
    })

    const exportBudgets: ExportBudgetItem[] = (budgetsRes.data || []).map((b: { id: string; category: string; custom_label: string | null; period: string; interval_days: number | null; original_amount: number; normalized_monthly_amount: number }) => ({
      id: b.id,
      category: b.category,
      customLabel: b.custom_label,
      period: b.period,
      intervalDays: b.interval_days,
      originalAmount: Math.trunc(b.original_amount) as Rupiah,
      normalizedMonthlyAmount: Math.trunc(b.normalized_monthly_amount) as Rupiah,
    }))

    const totalAllocatedBudget = exportBudgets.reduce(
      (sum, b) => sum + b.normalizedMonthlyAmount,
      0
    ) as Rupiah

    const exportTransactions: ExportTransactionItem[] = (txRes.data || []).map((t: { id: string; transaction_date: string; type: string; amount: number; wallet_id: string; goal_id: string | null; description: string | null; adjustment_direction: string | null; reversal_of_transaction_id: string | null; reversal_reason: string | null }) => ({
      id: t.id,
      transactionDate: t.transaction_date,
      type: t.type,
      amount: Math.trunc(t.amount) as Rupiah,
      walletId: t.wallet_id,
      walletLabel: walletMap.get(t.wallet_id)?.label || t.wallet_id,
      goalId: t.goal_id,
      goalName: t.goal_id ? goalMap.get(t.goal_id) || t.goal_id : null,
      description: t.description || '',
      adjustmentDirection: t.adjustment_direction,
      reversalOfTransactionId: t.reversal_of_transaction_id,
      reversalReason: t.reversal_reason,
    }))

    // Calculate authoritative summaries using M2.14 rules
    const rawTxRows = exportTransactions.map((tx) => ({
      id: tx.id,
      type: tx.type,
      amount: tx.amount,
      adjustment_direction: tx.adjustmentDirection,
      reversal_of_transaction_id: tx.reversalOfTransactionId,
    }))

    const cashflow = computeDashboardCashflow(rawTxRows)
    const plannedSavings = Math.max(0, cashflow.totalIncome - totalAllocatedBudget) as Rupiah
    const savingsSummary = computeDashboardSavingsMovement(rawTxRows, plannedSavings)
    const budgetSummary = computeDashboardBudgetUsage(totalAllocatedBudget, cashflow.totalExpenses)

    const monthlySummary: ExportMonthlySummaryItem | null = monthlySummaryRes.data
      ? {
          id: monthlySummaryRes.data.id,
          year: monthlySummaryRes.data.year,
          month: monthlySummaryRes.data.month,
          totalIncome: Math.trunc(monthlySummaryRes.data.total_income || 0) as Rupiah,
          plannedOperationalBudget: Math.trunc(monthlySummaryRes.data.planned_operational_budget || 0) as Rupiah,
          actualOperationalSpending: Math.trunc(monthlySummaryRes.data.actual_operational_spending || 0) as Rupiah,
          plannedSavings: Math.trunc(monthlySummaryRes.data.planned_savings || 0) as Rupiah,
          actualSavings: Math.trunc(monthlySummaryRes.data.actual_savings || 0) as Rupiah,
          savingsWithdrawn: Math.trunc(monthlySummaryRes.data.savings_withdrawn || 0) as Rupiah,
          leftoverOperationalBudget: Math.trunc(monthlySummaryRes.data.leftover_operational_budget || 0) as Rupiah,
          amountAddedToSavings: Math.trunc(monthlySummaryRes.data.amount_added_to_savings || 0) as Rupiah,
          rolloverAmount: Math.trunc(monthlySummaryRes.data.rollover_amount || 0) as Rupiah,
          savedVsBudget: Math.trunc(monthlySummaryRes.data.saved_vs_budget || 0) as Rupiah,
          finalizedAt: monthlySummaryRes.data.finalized_at,
        }
      : null

    const auditEvents: ExportAuditItem[] = (auditRes.data || []).map((a: { id: string; created_at: string; event_type: string; entity_type: string; entity_id: string | null; transaction_id: string | null; related_transaction_id: string | null }) => ({
      id: a.id,
      createdAt: a.created_at,
      eventType: a.event_type,
      entityType: a.entity_type,
      entityId: a.entity_id,
      transactionId: a.transaction_id,
      relatedTransactionId: a.related_transaction_id,
    }))

    const metadata: FinancialReportMetadata = {
      year,
      month,
      generatedAt: new Date().toISOString(),
      userId: user.id,
      userEmail: user.email || null,
    }

    return {
      data: {
        metadata,
        wallets: exportWallets,
        transactions: exportTransactions,
        budgets: exportBudgets,
        goals: exportGoals,
        cashflow,
        savingsSummary,
        budgetSummary,
        monthlySummary,
        auditEvents,
      },
      error: null,
    }
  } catch (err: unknown) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Terjadi kesalahan saat memproses laporan keuangan.',
    }
  }
}

// ---------------------------------------------------------------------------
// CSV Generator (RFC 4180 Compliant, Deterministic)
// ---------------------------------------------------------------------------

/**
 * Escapes a cell value according to RFC 4180:
 * If value contains comma, double-quote, or newline, wrap in quotes and escape quotes with "".
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function formatCsvRow(cells: unknown[]): string {
  return cells.map(escapeCsvCell).join(',')
}

/**
 * Generates structured, deterministic, multi-section CSV report text.
 */
export function generateFinancialReportCsv(report: FinancialReportData): string {
  const lines: string[] = []

  // 1. Report Metadata
  lines.push(formatCsvRow(['# LAPORAN KEUANGAN DAN ARUS KAS']))
  lines.push(formatCsvRow(['Tahun', report.metadata.year]))
  lines.push(formatCsvRow(['Bulan', report.metadata.month]))
  lines.push(formatCsvRow(['Waktu Generate', report.metadata.generatedAt]))
  lines.push(formatCsvRow(['User ID', report.metadata.userId]))
  if (report.metadata.userEmail) {
    lines.push(formatCsvRow(['User Email', report.metadata.userEmail]))
  }
  lines.push('')

  // 2. Financial Summary (Fakta Ringkasan & Arus Kas)
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

  // 3. Wallets Summary
  lines.push(formatCsvRow(['# SALDO DOMPET OTORITATIF']))
  lines.push(formatCsvRow(['ID Dompet', 'Nama Dompet', 'Tipe', 'Saldo Saat Ini (Rp)']))
  for (const w of report.wallets) {
    lines.push(formatCsvRow([w.id, w.label, w.type, w.balance]))
  }
  lines.push('')

  // 4. Budget Allocations
  lines.push(formatCsvRow(['# ALOKASI ANGGARAN BULANAN']))
  lines.push(formatCsvRow(['ID Anggaran', 'Kategori', 'Label Kustom', 'Periode', 'Interval Hari', 'Nominal Asli (Rp)', 'Normalisasi Bulanan (Rp)']))
  for (const b of report.budgets) {
    lines.push(formatCsvRow([
      b.id,
      b.category,
      b.customLabel || '',
      b.period,
      b.intervalDays ?? '',
      b.originalAmount,
      b.normalizedMonthlyAmount,
    ]))
  }
  lines.push('')

  // 5. Goals Progress
  lines.push(formatCsvRow(['# TARGET TABUNGAN']))
  lines.push(formatCsvRow(['ID Goal', 'Nama Target', 'Target (Rp)', 'Terkumpul (Rp)', 'Sisa Target (Rp)', 'Progress (%)', 'Terdanai Penuh', 'Target Waktu', 'Status']))
  for (const g of report.goals) {
    const timeframe = g.targetYear && g.targetMonth ? `${g.targetYear}-${String(g.targetMonth).padStart(2, '0')}` : ''
    lines.push(formatCsvRow([
      g.id,
      g.name,
      g.targetAmount,
      g.currentAmount, // Preserves raw overfunded value
      g.remainingAmount,
      g.progressPercent,
      g.isOverfunded ? 'Ya' : 'Tidak',
      timeframe,
      g.status,
    ]))
  }
  lines.push('')

  // 6. Transactions
  lines.push(formatCsvRow(['# DAFTAR TRANSAKSI BULAN INI']))
  lines.push(formatCsvRow([
    'ID Transaksi',
    'Tanggal',
    'Tipe',
    'Nominal (Rp)',
    'ID Dompet',
    'Nama Dompet',
    'ID Goal',
    'Nama Goal',
    'Keterangan',
    'Arah Penyesuaian',
    'Reversal Dari Transaksi ID',
    'Alasan Reversal',
  ]))
  for (const t of report.transactions) {
    lines.push(formatCsvRow([
      t.id,
      t.transactionDate,
      t.type,
      t.amount,
      t.walletId,
      t.walletLabel,
      t.goalId || '',
      t.goalName || '',
      t.description,
      t.adjustmentDirection || '',
      t.reversalOfTransactionId || '',
      t.reversalReason || '',
    ]))
  }
  lines.push('')

  // 7. Monthly Summary Snapshot (if available)
  if (report.monthlySummary) {
    lines.push(formatCsvRow(['# CATATAN PENUTUPAN BULANAN (MONTHLY SUMMARY)']))
    lines.push(formatCsvRow(['ID Summary', 'Tahun', 'Bulan', 'Total Income (Rp)', 'Anggaran Terencana (Rp)', 'Belanja Aktual (Rp)', 'Sisa Anggaran Operasional (Rp)', 'Dialihkan ke Tabungan (Rp)', 'Rollover ke Bulan Berikutnya (Rp)', 'Waktu Finalisasi']))
    lines.push(formatCsvRow([
      report.monthlySummary.id,
      report.monthlySummary.year,
      report.monthlySummary.month,
      report.monthlySummary.totalIncome,
      report.monthlySummary.plannedOperationalBudget,
      report.monthlySummary.actualOperationalSpending,
      report.monthlySummary.leftoverOperationalBudget,
      report.monthlySummary.amountAddedToSavings,
      report.monthlySummary.rolloverAmount,
      report.monthlySummary.finalizedAt || 'Belum difinalisasi',
    ]))
    lines.push('')
  }

  // 8. Financial Audit Trail Events
  if (report.auditEvents.length > 0) {
    lines.push(formatCsvRow(['# AKTIVITAS AUDIT KEUANGAN']))
    lines.push(formatCsvRow(['ID Event Audit', 'Waktu Kejadian', 'Tipe Event', 'Tipe Entitas', 'ID Entitas', 'ID Transaksi', 'ID Terkait']))
    for (const a of report.auditEvents) {
      lines.push(formatCsvRow([
        a.id,
        a.createdAt,
        a.eventType,
        a.entityType,
        a.entityId || '',
        a.transactionId || '',
        a.relatedTransactionId || '',
      ]))
    }
  }

  return lines.join('\r\n')
}
