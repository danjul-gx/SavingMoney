import { createClient } from '@/lib/supabase/client'
import type { Transaction, Rupiah } from '@/types/domain'

export type AllowedEntryTransactionType = 'income' | 'expense'

export interface CreateTransactionInput {
  walletId: string
  type: AllowedEntryTransactionType
  amount: number
  description?: string | null
  transactionDate: string
}

export interface TransactionActionResult {
  data: Transaction | null
  error: string | null
}

export interface TransactionsFetchResult {
  data: Transaction[]
  error: string | null
}

function mapRowToTransaction(row: {
  id: string
  user_id: string
  wallet_id: string
  goal_id: string | null
  type: string
  amount: number
  description: string | null
  transaction_date: string
  adjustment_direction: string | null
  reversal_of_transaction_id?: string | null
  reversal_reason?: string | null
  created_at: string
}): Transaction {
  return {
    id: row.id,
    userId: row.user_id,
    walletId: row.wallet_id,
    goalId: row.goal_id,
    type: row.type as Transaction['type'],
    amount: Math.trunc(row.amount) as Rupiah,
    description: row.description,
    transactionDate: row.transaction_date,
    adjustmentDirection: row.adjustment_direction as Transaction['adjustmentDirection'],
    reversalOfTransactionId: row.reversal_of_transaction_id ?? null,
    reversalReason: row.reversal_reason ?? null,
    createdAt: row.created_at,
  }
}

/**
 * Validate transaction creation inputs before sending to database.
 */
export function validateTransactionInput(input: CreateTransactionInput): {
  valid: boolean
  error: string | null
} {
  if (!input.walletId || !input.walletId.trim()) {
    return { valid: false, error: 'Dompet wajib dipilih.' }
  }

  if (input.type !== 'income' && input.type !== 'expense') {
    return { valid: false, error: 'Tipe transaksi tidak valid. Hanya pemasukan dan pengeluaran yang diizinkan.' }
  }

  // Amount validations: positive integer only, no float, no zero, no negative
  if (typeof input.amount !== 'number' || isNaN(input.amount)) {
    return { valid: false, error: 'Nominal transaksi tidak valid.' }
  }

  if (!Number.isInteger(input.amount)) {
    return { valid: false, error: 'Nominal transaksi harus berupa bilangan bulat Rupiah.' }
  }

  if (input.amount <= 0) {
    return { valid: false, error: 'Nominal transaksi harus lebih besar dari 0.' }
  }

  // Description validation: optional, max 255 chars
  if (input.description && input.description.trim().length > 255) {
    return { valid: false, error: 'Keterangan transaksi maksimal 255 karakter.' }
  }

  // Date validation: YYYY-MM-DD structural check
  if (!input.transactionDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.transactionDate)) {
    return { valid: false, error: 'Format tanggal tidak valid (harus YYYY-MM-DD).' }
  }

  const parsedDate = new Date(input.transactionDate)
  if (isNaN(parsedDate.getTime())) {
    return { valid: false, error: 'Tanggal transaksi tidak valid.' }
  }

  return { valid: true, error: null }
}

export interface QueryTransactionsOptions {
  search?: string | null
  type?: string | null
  walletId?: string | null
  goalId?: string | null
  startDate?: string | null
  endDate?: string | null
  sortNewestFirst?: boolean
  limit?: number
  offset?: number
}

export interface TransactionQueryResult {
  data: Transaction[]
  totalCount: number
  hasMore: boolean
  error: string | null
}

/**
 * Server-side bounded query for transactions with search, filter, and deterministic pagination.
 * Scoped strictly to the authenticated user via RLS (auth.uid()).
 */
export async function queryTransactions(
  options: QueryTransactionsOptions = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: any
): Promise<TransactionQueryResult> {
  const supabase = supabaseClient || createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return {
      data: [],
      totalCount: 0,
      hasMore: false,
      error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.',
    }
  }

  // Safe bounds: limit between 1 and 100, default 50. offset >= 0, default 0.
  const limit = Math.min(Math.max(1, options.limit ?? 50), 100)
  const offset = Math.max(0, options.offset ?? 0)
  const sortNewestFirst = options.sortNewestFirst !== false

  // Determine whether reversed filter requires inner join
  const isFilterReversed = options.type === 'reversed'

  let query = supabase
    .from('transactions')
    .select(
      isFilterReversed
        ? '*, reversed_by:transactions!inner(id)'
        : '*, reversed_by:transactions!reversal_of_transaction_id(id)',
      { count: 'exact' }
    )
    .eq('user_id', user.id)

  // 1. Text search on description or reversal_reason
  const searchTrimmed = (options.search || '').trim()
  if (searchTrimmed) {
    const sanitized = searchTrimmed.replace(/[%_,()]/g, '')
    if (sanitized) {
      query = query.or(`description.ilike.%${sanitized}%,reversal_reason.ilike.%${sanitized}%`)
    }
  }

  // 2. Type filter
  if (options.type && options.type !== 'all') {
    if (options.type === 'reversal') {
      query = query.not('reversal_of_transaction_id', 'is', null)
    } else if (options.type === 'reversed') {
      // Handled via inner join on reversed_by
    } else {
      query = query.eq('type', options.type).is('reversal_of_transaction_id', null)
    }
  }

  // 3. Wallet filter
  if (options.walletId && options.walletId !== 'all') {
    query = query.eq('wallet_id', options.walletId)
  }

  // 4. Goal filter
  if (options.goalId && options.goalId !== 'all') {
    query = query.eq('goal_id', options.goalId)
  }

  // 5. Date filters
  if (options.startDate) {
    query = query.gte('transaction_date', options.startDate)
  }
  if (options.endDate) {
    query = query.lte('transaction_date', options.endDate)
  }

  // 6. Deterministic ordering: transaction_date, created_at, id
  query = query
    .order('transaction_date', { ascending: !sortNewestFirst })
    .order('created_at', { ascending: !sortNewestFirst })
    .order('id', { ascending: !sortNewestFirst })
    .range(offset, offset + limit - 1)

  const { data, count, error } = await query

  if (error) {
    return {
      data: [],
      totalCount: 0,
      hasMore: false,
      error: 'Gagal memuat riwayat transaksi.',
    }
  }

  const totalCount = count ?? 0
  const rawRows = (data || []) as Array<Record<string, unknown> & { reversed_by?: Array<{ id: string }> }>

  const mapped = rawRows.map((row) => {
    const tx = mapRowToTransaction(row as unknown as Parameters<typeof mapRowToTransaction>[0])
    const reversedByRows = row.reversed_by
    const reversedById = Array.isArray(reversedByRows) && reversedByRows.length > 0 ? reversedByRows[0].id : null
    return {
      ...tx,
      reversedByTransactionId: reversedById,
      isReversed: Boolean(reversedById),
    }
  })

  return {
    data: mapped,
    totalCount,
    hasMore: offset + mapped.length < totalCount,
    error: null,
  }
}

/**
 * Fetch authenticated user's recent transactions sorted newest first.
 * Default limit = 50 rows.
 */
export async function getTransactions(limit = 50): Promise<TransactionsFetchResult> {
  const result = await queryTransactions({ limit, offset: 0 })
  return {
    data: result.data,
    error: result.error,
  }
}

/**
 * Create a new income or expense transaction for the authenticated user.
 * Database triggers update wallet balance and guard against negative balances.
 */
export async function createTransaction(
  input: CreateTransactionInput
): Promise<TransactionActionResult> {
  const validation = validateTransactionInput(input)
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

  const trimmedDesc = input.description ? input.description.trim() : null

  const { data, error } = await supabase
    .from('transactions')
    .insert({
      user_id: user.id,
      wallet_id: input.walletId,
      type: input.type,
      amount: input.amount,
      description: trimmedDesc,
      transaction_date: input.transactionDate,
    })
    .select('*')
    .single()

  if (error) {
    // Map Postgres check_violation or custom trigger errors to user-friendly messages
    if (error.message.includes('insufficient') || error.code === '23514') {
      return {
        data: null,
        error: 'Saldo dompet tidak mencukupi untuk transaksi ini.',
      }
    }
    if (error.code === '23503') {
      return {
        data: null,
        error: 'Dompet yang dipilih tidak ditemukan.',
      }
    }
    return { data: null, error: 'Gagal mencatat transaksi.' }
  }

  return {
    data: mapRowToTransaction(data),
    error: null,
  }
}
