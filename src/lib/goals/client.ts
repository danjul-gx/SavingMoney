import { createClient } from '@/lib/supabase/client'
import type { Goal, GoalStatus, Rupiah } from '@/types/domain'

export interface CreateGoalInput {
  name: string
  targetAmount: number
  targetYear?: number | null
  targetMonth?: number | null
  isPrimary?: boolean
}

export interface UpdateGoalInput {
  name?: string
  targetAmount?: number
  targetYear?: number | null
  targetMonth?: number | null
  status?: GoalStatus
  isPrimary?: boolean
}

export interface GoalActionResult {
  data: Goal | null
  error: string | null
}

export interface GoalsFetchResult {
  data: Goal[]
  error: string | null
}

/**
 * Pure calculation of goal progress and remaining amount.
 * Money remains strictly integer Rupiah.
 * Progress is presentation percentage clamped to 0–100% for progress bars.
 */
export function calculateGoalProgress(
  targetAmount: number,
  currentAmount: number
): {
  progressPercent: number
  remainingAmount: Rupiah
  isOverfunded: boolean
} {
  const cleanTarget = Math.trunc(Math.max(1, targetAmount))
  const cleanCurrent = Math.trunc(Math.max(0, currentAmount))

  const isOver = cleanCurrent >= cleanTarget
  const remaining = Math.max(0, cleanTarget - cleanCurrent) as Rupiah

  // Integer percentage: (cleanCurrent * 100) / cleanTarget
  const rawPercent = Math.floor((cleanCurrent * 100) / cleanTarget)
  const progressPercent = Math.min(100, Math.max(0, rawPercent))

  return {
    progressPercent,
    remainingAmount: remaining,
    isOverfunded: isOver,
  }
}

function mapRowToGoal(row: {
  id: string
  user_id: string
  name: string
  target_amount: number
  current_amount: number
  target_year: number | null
  target_month: number | null
  status: string
  is_primary: boolean
  created_at: string
  updated_at: string
}): Goal {
  const { progressPercent } = calculateGoalProgress(row.target_amount, row.current_amount)

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    targetAmount: Math.trunc(row.target_amount) as Rupiah,
    currentAmount: Math.trunc(row.current_amount) as Rupiah,
    targetYear: row.target_year,
    targetMonth: row.target_month,
    status: row.status as GoalStatus,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    progressPercent,
  }
}

/**
 * Validate goal input fields.
 */
export function validateGoalInput(input: {
  name?: string
  targetAmount?: number
  targetYear?: number | null
  targetMonth?: number | null
}): { valid: boolean; error: string | null } {
  if (input.name !== undefined) {
    const trimmed = input.name.trim()
    if (!trimmed) {
      return { valid: false, error: 'Nama tujuan tabungan tidak boleh kosong.' }
    }
    if (trimmed.length > 50) {
      return { valid: false, error: 'Nama tujuan tabungan maksimal 50 karakter.' }
    }
  }

  if (input.targetAmount !== undefined) {
    if (typeof input.targetAmount !== 'number' || isNaN(input.targetAmount)) {
      return { valid: false, error: 'Target tabungan tidak valid.' }
    }
    if (!Number.isInteger(input.targetAmount)) {
      return { valid: false, error: 'Target tabungan harus berupa bilangan bulat Rupiah.' }
    }
    if (input.targetAmount <= 0) {
      return { valid: false, error: 'Target tabungan harus lebih besar dari 0.' }
    }
  }

  if (input.targetYear !== undefined && input.targetYear !== null) {
    const now = new Date()
    if (typeof input.targetYear !== 'number' || input.targetYear < now.getFullYear()) {
      return { valid: false, error: 'Tahun target tabungan tidak boleh di masa lalu.' }
    }
  }

  if (input.targetMonth !== undefined && input.targetMonth !== null) {
    if (
      typeof input.targetMonth !== 'number' ||
      input.targetMonth < 1 ||
      input.targetMonth > 12
    ) {
      return { valid: false, error: 'Bulan target tabungan tidak valid (1-12).' }
    }
  }

  return { valid: true, error: null }
}

/**
 * Fetch all goals for the authenticated user.
 */
export async function getGoals(): Promise<GoalsFetchResult> {
  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { data: [], error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.' }
  }

  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .eq('user_id', user.id)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) {
    return { data: [], error: 'Gagal memuat daftar tujuan tabungan.' }
  }

  return {
    data: (data || []).map(mapRowToGoal),
    error: null,
  }
}

/**
 * Create a new savings goal.
 * Note: current_amount always starts at 0 (database default).
 */
export async function createGoal(input: CreateGoalInput): Promise<GoalActionResult> {
  const validation = validateGoalInput({
    name: input.name,
    targetAmount: input.targetAmount,
    targetYear: input.targetYear,
    targetMonth: input.targetMonth,
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

  const trimmedName = input.name.trim()

  const { data, error } = await supabase
    .from('goals')
    .insert({
      user_id: user.id,
      name: trimmedName,
      target_amount: input.targetAmount,
      current_amount: 0,
      target_year: input.targetYear ?? null,
      target_month: input.targetMonth ?? null,
      is_primary: input.isPrimary ?? false,
      status: 'active',
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { data: null, error: 'Hanya satu tujuan tabungan utama (primary) yang diperbolehkan.' }
    }
    return { data: null, error: 'Gagal membuat tujuan tabungan baru.' }
  }

  return {
    data: mapRowToGoal(data),
    error: null,
  }
}

/**
 * Update goal metadata / target.
 * Note: direct modification of current_amount or user_id is strictly disallowed.
 */
export async function updateGoal(
  goalId: string,
  input: UpdateGoalInput
): Promise<GoalActionResult> {
  if (!goalId) {
    return { data: null, error: 'ID tujuan tabungan tidak valid.' }
  }

  const validation = validateGoalInput({
    name: input.name,
    targetAmount: input.targetAmount,
    targetYear: input.targetYear,
    targetMonth: input.targetMonth,
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

  const payload: {
    name?: string
    target_amount?: number
    target_year?: number | null
    target_month?: number | null
    status?: GoalStatus
    is_primary?: boolean
  } = {}

  if (input.name !== undefined) payload.name = input.name.trim()
  if (input.targetAmount !== undefined) payload.target_amount = input.targetAmount
  if (input.targetYear !== undefined) payload.target_year = input.targetYear
  if (input.targetMonth !== undefined) payload.target_month = input.targetMonth
  if (input.status !== undefined) payload.status = input.status
  if (input.isPrimary !== undefined) payload.is_primary = input.isPrimary

  const { data, error } = await supabase
    .from('goals')
    .update(payload)
    .eq('id', goalId)
    .eq('user_id', user.id)
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { data: null, error: 'Hanya satu tujuan tabungan utama (primary) yang diperbolehkan.' }
    }
    return { data: null, error: 'Gagal memperbarui tujuan tabungan.' }
  }

  return {
    data: mapRowToGoal(data),
    error: null,
  }
}

/**
 * Safely delete a goal if it has never been referenced by transactions.
 * Database foreign key `ON DELETE RESTRICT` will block deletion if financial transactions exist.
 */
export async function deleteGoal(goalId: string): Promise<{ success: boolean; error: string | null }> {
  if (!goalId) {
    return { success: false, error: 'ID tujuan tabungan tidak valid.' }
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
    .from('goals')
    .delete()
    .eq('id', goalId)
    .eq('user_id', user.id)

  if (error) {
    if (error.code === '23503') {
      return {
        success: false,
        error: 'Tujuan tabungan tidak dapat dihapus karena sudah memiliki riwayat transaksi keuangan.',
      }
    }
    return { success: false, error: 'Gagal menghapus tujuan tabungan.' }
  }

  return { success: true, error: null }
}
