import { createClient } from '@/lib/supabase/client'
import type {
  Transaction,
  SavingsContributionInput,
  SavingsContributionResult,
  Rupiah,
} from '@/types/domain'

/**
 * Validate savings contribution inputs before submitting to the database.
 */
export function validateSavingsContributionInput(input: SavingsContributionInput): {
  valid: boolean
  error: string | null
} {
  if (!input.walletId || !input.walletId.trim()) {
    return { valid: false, error: 'Dompet sumber wajib dipilih.' }
  }

  if (!input.goalId || !input.goalId.trim()) {
    return { valid: false, error: 'Tujuan tabungan wajib dipilih.' }
  }

  // Amount validations: integer Rupiah only, positive, no float, no zero, no negative
  if (typeof input.amount !== 'number' || isNaN(input.amount)) {
    return { valid: false, error: 'Nominal kontribusi tidak valid.' }
  }

  if (!Number.isInteger(input.amount)) {
    return { valid: false, error: 'Nominal kontribusi harus berupa bilangan bulat Rupiah.' }
  }

  if (input.amount <= 0) {
    return { valid: false, error: 'Nominal kontribusi harus lebih besar dari 0.' }
  }

  // Optional description validation: max 255 chars
  if (input.description && input.description.trim().length > 255) {
    return { valid: false, error: 'Keterangan kontribusi maksimal 255 karakter.' }
  }

  // Transaction date validation: YYYY-MM-DD
  if (!input.transactionDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.transactionDate)) {
    return { valid: false, error: 'Format tanggal tidak valid (harus YYYY-MM-DD).' }
  }

  const parsedDate = new Date(input.transactionDate)
  if (isNaN(parsedDate.getTime())) {
    return { valid: false, error: 'Tanggal transaksi tidak valid.' }
  }

  return { valid: true, error: null }
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
 * Execute a savings contribution atomically.
 *
 * Accounting Semantics:
 * 1. Validates inputs (wallet, goal, positive integer amount, valid date).
 * 2. Derives ownership from authenticated Supabase session.
 * 3. Inserts a transaction into `transactions` with type = 'savings_contribution',
 *    which fires authoritative database triggers:
 *    - `transactions_check_ownership`: rejects cross-user wallet or goal.
 *    - `transactions_check_overdraft`: rejects if source wallet balance < amount.
 *    - `update_wallet_balance_on_tx`: debits source wallet balance by amount.
 *    - `update_goal_balance_on_tx`: credits destination goal current_amount by amount.
 *
 * Client code never mutates wallet balance or goal current_amount directly.
 */
export async function createSavingsContribution(
  input: SavingsContributionInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: any
): Promise<SavingsContributionResult> {
  const validation = validateSavingsContributionInput(input)
  if (!validation.valid) {
    return { data: null, error: validation.error }
  }

  const supabase = supabaseClient || createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return {
      data: null,
      error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.',
    }
  }

  const trimmedDesc = input.description ? input.description.trim() : null

  const { data, error } = await supabase
    .from('transactions')
    .insert({
      user_id: user.id,
      wallet_id: input.walletId,
      goal_id: input.goalId,
      type: 'savings_contribution',
      amount: input.amount,
      description: trimmedDesc,
      transaction_date: input.transactionDate,
    })
    .select('*')
    .single()

  if (error) {
    // Map known database trigger and check violations
    if (
      error.code === '23514' ||
      (error.message && (error.message.includes('insufficient') || error.message.includes('overdraft')))
    ) {
      return {
        data: null,
        error: 'Saldo dompet tidak mencukupi untuk melakukan tabungan ini.',
      }
    }

    if (
      error.code === '23503' ||
      (error.message &&
        (error.message.includes('does not belong') ||
          error.message.includes('foreign_key_violation') ||
          error.message.includes('violates foreign key constraint')))
    ) {
      return {
        data: null,
        error: 'Dompet atau tujuan tabungan tidak valid atau bukan milik Anda.',
      }
    }

    return {
      data: null,
      error: error.message || 'Gagal mengalokasikan tabungan.',
    }
  }

  return {
    data: mapRowToTransaction(data),
    error: null,
  }
}
