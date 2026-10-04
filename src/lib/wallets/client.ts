import { createClient } from '@/lib/supabase/client'
import type { Wallet, WalletType, Rupiah } from '@/types/domain'

export interface CreateWalletInput {
  label: string
  type: WalletType
}

export interface UpdateWalletInput {
  label: string
}

export interface WalletActionResult {
  data: Wallet | null
  error: string | null
}

export interface WalletsFetchResult {
  data: Wallet[]
  error: string | null
}

function mapRowToWallet(row: {
  id: string
  user_id: string
  type: WalletType
  label: string
  balance: number
  created_at: string
  updated_at: string
}): Wallet {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    label: row.label,
    balance: Math.trunc(row.balance) as Rupiah,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Fetch all wallets belonging to the currently authenticated user.
 * Order: created_at ASC.
 */
export async function getWallets(): Promise<WalletsFetchResult> {
  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { data: [], error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.' }
  }

  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (error) {
    return { data: [], error: 'Gagal memuat daftar dompet.' }
  }

  return {
    data: (data || []).map(mapRowToWallet),
    error: null,
  }
}

/**
 * Create a new wallet for the currently authenticated user.
 * Initial balance is strictly 0 (database default).
 */
export async function createWallet(input: CreateWalletInput): Promise<WalletActionResult> {
  const trimmedLabel = (input.label || '').trim()
  if (!trimmedLabel) {
    return { data: null, error: 'Nama dompet wajib diisi.' }
  }

  if (trimmedLabel.length > 50) {
    return { data: null, error: 'Nama dompet maksimal 50 karakter.' }
  }

  if (input.type !== 'cash' && input.type !== 'digital') {
    return { data: null, error: 'Tipe dompet tidak valid.' }
  }

  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { data: null, error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.' }
  }

  const { data, error } = await supabase
    .from('wallets')
    .insert({
      user_id: user.id,
      label: trimmedLabel,
      type: input.type,
      balance: 0,
    })
    .select('*')
    .single()

  if (error) {
    // Check for uniqueness constraint violation (e.g. one cash / one digital per user)
    if (error.code === '23505') {
      return {
        data: null,
        error: `Anda sudah memiliki dompet bertipe ${input.type === 'cash' ? 'Tunai (Cash)' : 'Digital'}.`,
      }
    }
    return { data: null, error: 'Gagal membuat dompet baru.' }
  }

  return {
    data: mapRowToWallet(data),
    error: null,
  }
}

/**
 * Update wallet metadata (only label).
 * Direct balance modification or user_id manipulation is strictly excluded.
 */
export async function updateWallet(
  walletId: string,
  input: UpdateWalletInput
): Promise<WalletActionResult> {
  if (!walletId) {
    return { data: null, error: 'ID dompet tidak valid.' }
  }

  const trimmedLabel = (input.label || '').trim()
  if (!trimmedLabel) {
    return { data: null, error: 'Nama dompet tidak boleh kosong.' }
  }

  if (trimmedLabel.length > 50) {
    return { data: null, error: 'Nama dompet maksimal 50 karakter.' }
  }

  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { data: null, error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.' }
  }

  const { data, error } = await supabase
    .from('wallets')
    .update({
      label: trimmedLabel,
    })
    .eq('id', walletId)
    .eq('user_id', user.id)
    .select('*')
    .single()

  if (error) {
    return { data: null, error: 'Gagal memperbarui dompet.' }
  }

  return {
    data: mapRowToWallet(data),
    error: null,
  }
}
