import { createClient } from '@/lib/supabase/client'
import type { BudgetAllocation, BudgetCategory, BudgetPeriod, Rupiah } from '@/types/domain'
import { normalizeToMonthly } from '@/types/domain'

export interface CreateBudgetAllocationInput {
  walletId: string
  category: BudgetCategory
  customLabel?: string | null
  originalAmount: number
  period: BudgetPeriod
  intervalDays?: number | null
  budgetYear?: number
  budgetMonth?: number
}

export interface UpdateBudgetAllocationInput {
  originalAmount?: number
  period?: BudgetPeriod
  intervalDays?: number | null
  customLabel?: string | null
}

export interface BudgetActionResult {
  data: BudgetAllocation | null
  error: string | null
}

export interface BudgetsFetchResult {
  data: BudgetAllocation[]
  error: string | null
}

function mapRowToBudgetAllocation(row: {
  id: string
  user_id: string
  wallet_id: string
  budget_year: number
  budget_month: number
  category: string
  custom_label: string | null
  original_amount: number
  period: string
  interval_days?: number | null
  normalized_monthly_amount: number
  created_at: string
  updated_at: string
}): BudgetAllocation {
  return {
    id: row.id,
    userId: row.user_id,
    walletId: row.wallet_id,
    budgetYear: row.budget_year,
    budgetMonth: row.budget_month,
    category: row.category as BudgetCategory,
    customLabel: row.custom_label,
    originalAmount: Math.trunc(row.original_amount) as Rupiah,
    period: row.period as BudgetPeriod,
    intervalDays: row.interval_days != null ? Math.trunc(row.interval_days) : null,
    normalizedMonthlyAmount: Math.trunc(row.normalized_monthly_amount) as Rupiah,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Validate budget allocation inputs.
 */
export function validateBudgetAllocationInput(input: {
  walletId?: string
  category?: string
  customLabel?: string | null
  originalAmount?: number
  period?: string
  intervalDays?: number | null
  budgetYear?: number
  budgetMonth?: number
}): { valid: boolean; error: string | null } {
  if (input.walletId !== undefined && (!input.walletId || !input.walletId.trim())) {
    return { valid: false, error: 'Dompet sumber wajib dipilih.' }
  }

  if (input.category !== undefined) {
    if (input.category !== 'transport' && input.category !== 'food' && input.category !== 'other') {
      return { valid: false, error: 'Kategori anggaran tidak valid.' }
    }
    if (input.category === 'other') {
      if (!input.customLabel || !input.customLabel.trim()) {
        return { valid: false, error: 'Label khusus wajib diisi untuk kategori Lainnya.' }
      }
      if (input.customLabel.trim().length > 50) {
        return { valid: false, error: 'Label khusus maksimal 50 karakter.' }
      }
    }
  }

  if (input.period !== undefined) {
    if (input.period !== 'weekly' && input.period !== 'monthly' && input.period !== 'interval') {
      return { valid: false, error: 'Periode anggaran tidak valid (harus mingguan atau bulanan).' }
    }

    if (input.period === 'interval') {
      if (input.intervalDays === undefined || input.intervalDays === null) {
        return { valid: false, error: 'Jumlah hari interval wajib diisi untuk periode interval.' }
      }
      if (typeof input.intervalDays !== 'number' || isNaN(input.intervalDays)) {
        return { valid: false, error: 'Jumlah hari interval harus berupa angka bulat positif.' }
      }
      if (!Number.isInteger(input.intervalDays)) {
        return { valid: false, error: 'Jumlah hari interval harus berupa bilangan bulat.' }
      }
      if (input.intervalDays <= 0) {
        return { valid: false, error: 'Jumlah hari interval harus lebih besar dari 0.' }
      }
    } else {
      // weekly or monthly
      if (input.intervalDays !== undefined && input.intervalDays !== null) {
        return { valid: false, error: 'Jumlah hari interval hanya berlaku untuk periode interval.' }
      }
    }
  }

  if (input.originalAmount !== undefined) {
    if (typeof input.originalAmount !== 'number' || isNaN(input.originalAmount)) {
      return { valid: false, error: 'Nominal anggaran tidak valid.' }
    }
    if (!Number.isInteger(input.originalAmount)) {
      return { valid: false, error: 'Nominal anggaran harus berupa bilangan bulat Rupiah.' }
    }
    if (input.originalAmount <= 0) {
      return { valid: false, error: 'Nominal anggaran harus lebih besar dari 0.' }
    }
  }

  if (input.budgetYear !== undefined && input.budgetYear < 2000) {
    return { valid: false, error: 'Tahun anggaran tidak valid.' }
  }

  if (input.budgetMonth !== undefined && (input.budgetMonth < 1 || input.budgetMonth > 12)) {
    return { valid: false, error: 'Bulan anggaran tidak valid (1-12).' }
  }

  return { valid: true, error: null }
}

/**
 * Fetch budget allocations for the authenticated user.
 * Scoped to user_id, optionally filtered by year/month.
 */
export async function getBudgetAllocations(params?: {
  year?: number
  month?: number
}): Promise<BudgetsFetchResult> {
  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { data: [], error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.' }
  }

  let query = supabase
    .from('budget_allocations')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (params?.year) {
    query = query.eq('budget_year', params.year)
  }
  if (params?.month) {
    query = query.eq('budget_month', params.month)
  }

  const { data, error } = await query

  if (error) {
    return { data: [], error: 'Gagal memuat daftar anggaran operasional.' }
  }

  return {
    data: (data || []).map(mapRowToBudgetAllocation),
    error: null,
  }
}

/**
 * Create a new operational budget allocation.
 * Note: Planning layer only — does NOT affect wallets.balance.
 */
export async function createBudgetAllocation(
  input: CreateBudgetAllocationInput
): Promise<BudgetActionResult> {
  const now = new Date()
  const year = input.budgetYear ?? now.getFullYear()
  const month = input.budgetMonth ?? (now.getMonth() + 1)

  const validation = validateBudgetAllocationInput({
    walletId: input.walletId,
    category: input.category,
    customLabel: input.customLabel,
    originalAmount: input.originalAmount,
    period: input.period,
    intervalDays: input.intervalDays,
    budgetYear: year,
    budgetMonth: month,
  })

  if (!validation.valid) {
    return { data: null, error: validation.error }
  }

  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { data: null, error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.' }
  }

  const normalized = normalizeToMonthly(input.originalAmount as Rupiah, input.period, input.intervalDays)
  const trimmedCustomLabel = input.category === 'other' && input.customLabel ? input.customLabel.trim() : null
  const cleanIntervalDays = input.period === 'interval' && input.intervalDays ? Math.trunc(input.intervalDays) : null

  const { data, error } = await supabase
    .from('budget_allocations')
    .insert({
      user_id: user.id,
      wallet_id: input.walletId,
      category: input.category,
      custom_label: trimmedCustomLabel,
      original_amount: input.originalAmount,
      period: input.period,
      interval_days: cleanIntervalDays,
      normalized_monthly_amount: normalized,
      budget_year: year,
      budget_month: month,
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23503') {
      return { data: null, error: 'Dompet sumber tidak ditemukan atau bukan milik Anda.' }
    }
    return { data: null, error: 'Gagal menyimpan alokasi anggaran.' }
  }

  return {
    data: mapRowToBudgetAllocation(data),
    error: null,
  }
}

/**
 * Update an existing budget allocation (amount, period, intervalDays, customLabel).
 * Note: Planning layer only — does NOT mutate wallets.balance.
 */
export async function updateBudgetAllocation(
  allocationId: string,
  input: UpdateBudgetAllocationInput,
  currentAllocation: {
    originalAmount: number
    period: BudgetPeriod
    intervalDays?: number | null
    category: BudgetCategory
  }
): Promise<BudgetActionResult> {
  if (!allocationId) {
    return { data: null, error: 'ID alokasi anggaran tidak valid.' }
  }

  const newAmount = input.originalAmount ?? currentAllocation.originalAmount
  const newPeriod = input.period ?? currentAllocation.period
  const newIntervalDays = input.period !== undefined
    ? (newPeriod === 'interval' ? input.intervalDays : null)
    : (input.intervalDays !== undefined ? input.intervalDays : currentAllocation.intervalDays)

  const validation = validateBudgetAllocationInput({
    originalAmount: newAmount,
    period: newPeriod,
    intervalDays: newIntervalDays,
    category: currentAllocation.category,
    customLabel: input.customLabel,
  })

  if (!validation.valid) {
    return { data: null, error: validation.error }
  }

  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { data: null, error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.' }
  }

  const normalized = normalizeToMonthly(newAmount as Rupiah, newPeriod, newIntervalDays)
  const cleanIntervalDays = newPeriod === 'interval' && newIntervalDays ? Math.trunc(newIntervalDays) : null

  const payload: {
    original_amount?: number
    period?: BudgetPeriod
    interval_days?: number | null
    normalized_monthly_amount?: number
    custom_label?: string | null
  } = {
    original_amount: newAmount,
    period: newPeriod,
    interval_days: cleanIntervalDays,
    normalized_monthly_amount: normalized,
  }

  if (input.customLabel !== undefined) {
    payload.custom_label = input.customLabel ? input.customLabel.trim() : null
  }

  const { data, error } = await supabase
    .from('budget_allocations')
    .update(payload)
    .eq('id', allocationId)
    .eq('user_id', user.id)
    .select('*')
    .single()

  if (error) {
    return { data: null, error: 'Gagal memperbarui alokasi anggaran.' }
  }

  return {
    data: mapRowToBudgetAllocation(data),
    error: null,
  }
}

/**
 * Delete a budget allocation (planning layer removal).
 */
export async function deleteBudgetAllocation(allocationId: string): Promise<{ success: boolean; error: string | null }> {
  if (!allocationId) {
    return { success: false, error: 'ID alokasi anggaran tidak valid.' }
  }

  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { success: false, error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.' }
  }

  const { error } = await supabase
    .from('budget_allocations')
    .delete()
    .eq('id', allocationId)
    .eq('user_id', user.id)

  if (error) {
    return { success: false, error: 'Gagal menghapus alokasi anggaran.' }
  }

  return { success: true, error: null }
}
