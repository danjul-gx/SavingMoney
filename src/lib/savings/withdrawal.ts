import { createClient } from '@/lib/supabase/client'
import type {
  Transaction,
  SavingsWithdrawal,
  SavingsWithdrawalInput,
  SavingsWithdrawalResult,
  Rupiah,
} from '@/types/domain'

/**
 * Validate savings withdrawal inputs before submitting to the database.
 */
export function validateSavingsWithdrawalInput(input: SavingsWithdrawalInput): {
  valid: boolean
  error: string | null
} {
  if (!input.goalId || !input.goalId.trim()) {
    return { valid: false, error: 'Tujuan tabungan sumber wajib dipilih.' }
  }

  if (!input.walletId || !input.walletId.trim()) {
    return { valid: false, error: 'Dompet tujuan wajib dipilih.' }
  }

  // Amount validations: positive integer only, no float, no zero, no negative
  if (typeof input.amount !== 'number' || isNaN(input.amount)) {
    return { valid: false, error: 'Nominal penarikan tidak valid.' }
  }

  if (!Number.isInteger(input.amount)) {
    return { valid: false, error: 'Nominal penarikan harus berupa bilangan bulat Rupiah.' }
  }

  if (input.amount <= 0) {
    return { valid: false, error: 'Nominal penarikan harus lebih besar dari 0.' }
  }

  // Mandatory reason validation
  if (!input.reason || typeof input.reason !== 'string' || !input.reason.trim()) {
    return { valid: false, error: 'Alasan penarikan tabungan wajib diisi.' }
  }

  if (input.reason.trim().length > 500) {
    return { valid: false, error: 'Alasan penarikan tidak boleh melebihi 500 karakter.' }
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

/**
 * Calculate goal delay estimate based on planned monthly savings.
 * If planned savings is positive, estimate days = round(amount / (plannedMonthlySavings / 30)).
 * If planned savings is 0 or unavailable, returns 0.
 */
export function calculateGoalDelayEstimate(
  withdrawalAmount: number,
  plannedMonthlySavings: number
): number {
  if (!plannedMonthlySavings || plannedMonthlySavings <= 0 || withdrawalAmount <= 0) {
    return 0
  }
  const dailyRate = plannedMonthlySavings / 30
  if (dailyRate <= 0) return 0
  return Math.max(1, Math.round(withdrawalAmount / dailyRate))
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

function mapRowToWithdrawal(row: {
  id: string
  user_id: string
  goal_id: string
  destination_wallet_id: string
  transaction_id: string
  amount: number
  reason: string
  estimated_delay_days: number
  created_at: string
}): SavingsWithdrawal {
  return {
    id: row.id,
    userId: row.user_id,
    goalId: row.goal_id,
    destinationWalletId: row.destination_wallet_id,
    transactionId: row.transaction_id,
    amount: Math.trunc(row.amount) as Rupiah,
    reason: row.reason,
    estimatedDelayDays: row.estimated_delay_days,
    createdAt: row.created_at,
  }
}

/**
 * Execute a savings withdrawal atomically.
 *
 * M2.8.1 Atomicity Hardening:
 * 1. Validates inputs on client side.
 * 2. Derives ownership from authenticated Supabase session.
 * 3. Calls the database RPC `execute_savings_withdrawal`.
 *    Inside PostgreSQL, this:
 *    - Acquires row-level locks on goal and destination wallet (FOR UPDATE).
 *    - Validates ownership, positive amount, non-empty reason, and sufficient balance.
 *    - Inserts `transactions` row (which fires balance update triggers for goal and wallet).
 *    - Inserts `savings_withdrawals` metadata row.
 *    - If ANY failure occurs (e.g. metadata failure or constraint violation),
 *      PostgreSQL rolls back the ENTIRE transaction so no partial ledger event or
 *      balance shift is committed.
 * 4. In environments where the RPC is not implemented (e.g. mock test harnesses),
 *    falls back gracefully while maintaining error mapping.
 */
import { recordDiagnosticEvent, generateCorrelationId, classifyOperationalError } from '@/lib/diagnostics'

export async function createSavingsWithdrawal(
  input: SavingsWithdrawalInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: any
): Promise<SavingsWithdrawalResult> {
  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  const validation = validateSavingsWithdrawalInput(input)
  if (!validation.valid) {
    recordDiagnosticEvent({
      operation: 'savings_withdrawal',
      outcome: 'rejected',
      category: 'validation',
      code: 'VALIDATION_FAILED',
      correlationId,
      metadata: { goalId: input.goalId, walletId: input.walletId },
    })
    return { data: null, error: validation.error }
  }

  const supabase = supabaseClient || createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    recordDiagnosticEvent({
      operation: 'savings_withdrawal',
      outcome: 'rejected',
      category: 'authentication',
      code: 'AUTH_REQUIRED',
      correlationId,
      metadata: { goalId: input.goalId, walletId: input.walletId },
    })
    return {
      data: null,
      error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.',
    }
  }

  const trimmedReason = input.reason.trim()

  // Try RPC first for single-transaction database atomicity
  if (typeof supabase.rpc === 'function') {
    const { data: rpcData, error: rpcError } = await supabase.rpc('execute_savings_withdrawal', {
      p_goal_id: input.goalId,
      p_destination_wallet_id: input.walletId,
      p_amount: input.amount,
      p_reason: trimmedReason,
      p_transaction_date: input.transactionDate,
      p_estimated_delay_days: input.estimatedDelayDays || 0,
    })

    const durationMs = Date.now() - startTime

    if (!rpcError && rpcData) {
      recordDiagnosticEvent({
        operation: 'savings_withdrawal',
        outcome: 'success',
        durationMs,
        correlationId,
        metadata: {
          txId: rpcData.transaction?.id,
          goalId: input.goalId,
          walletId: input.walletId,
        },
      })
      return {
        data: {
          transaction: mapRowToTransaction(rpcData.transaction),
          withdrawal: mapRowToWithdrawal(rpcData.withdrawal),
        },
        error: null,
      }
    }

    // If RPC returned a specific database error, map and return it directly
    if (rpcError && rpcError.code !== 'PGRST202') { // PGRST202 is function not found
      const classified = classifyOperationalError(rpcError, correlationId, {
        goalId: input.goalId,
        walletId: input.walletId,
      })

      recordDiagnosticEvent({
        operation: 'savings_withdrawal',
        outcome: 'failure',
        category: classified.category,
        code: classified.code,
        durationMs,
        correlationId,
        metadata: { goalId: input.goalId, walletId: input.walletId },
      })

      if (
        rpcError.code === '23514' ||
        (rpcError.message &&
          (rpcError.message.includes('insufficient') ||
            rpcError.message.includes('overdraft') ||
            rpcError.message.includes('goal balance')))
      ) {
        return {
          data: null,
          error: 'Saldo tujuan tabungan tidak mencukupi untuk melakukan penarikan ini.',
        }
      }

      if (
        rpcError.code === '23503' ||
        (rpcError.message &&
          (rpcError.message.includes('does not belong') ||
            rpcError.message.includes('foreign_key_violation') ||
            rpcError.message.includes('violates foreign key constraint') ||
            rpcError.message.includes('does not exist')))
      ) {
        return {
          data: null,
          error: 'Dompet tujuan atau tujuan tabungan tidak valid atau bukan milik Anda.',
        }
      }

      return {
        data: null,
        error: classified.userMessage || 'Gagal memproses penarikan tabungan secara atomik.',
      }
    }
  }

  // Fallback for mock/test harness where RPC is not implemented
  // 1. Insert transaction
  const { data: txData, error: txError } = await supabase
    .from('transactions')
    .insert({
      user_id: user.id,
      wallet_id: input.walletId,
      goal_id: input.goalId,
      type: 'savings_withdrawal',
      amount: input.amount,
      description: `Penarikan Tabungan: ${trimmedReason}`,
      transaction_date: input.transactionDate,
    })
    .select('*')
    .single()

  if (txError) {
    if (
      txError.code === '23514' ||
      (txError.message &&
        (txError.message.includes('insufficient') ||
          txError.message.includes('overdraft') ||
          txError.message.includes('goal balance')))
    ) {
      return {
        data: null,
        error: 'Saldo tujuan tabungan tidak mencukupi untuk melakukan penarikan ini.',
      }
    }

    if (
      txError.code === '23503' ||
      (txError.message &&
        (txError.message.includes('does not belong') ||
          txError.message.includes('foreign_key_violation') ||
          txError.message.includes('violates foreign key constraint')))
    ) {
      return {
        data: null,
        error: 'Dompet tujuan atau tujuan tabungan tidak valid atau bukan milik Anda.',
      }
    }

    return {
      data: null,
      error: txError.message || 'Gagal memproses transaksi penarikan.',
    }
  }

  // 2. Insert withdrawal metadata
  const { data: swData, error: swError } = await supabase
    .from('savings_withdrawals')
    .insert({
      user_id: user.id,
      goal_id: input.goalId,
      destination_wallet_id: input.walletId,
      transaction_id: txData.id,
      amount: input.amount,
      reason: trimmedReason,
      estimated_delay_days: input.estimatedDelayDays || 0,
    })
    .select('*')
    .single()

  if (swError) {
    return {
      data: null,
      error: swError.message || 'Gagal menyimpan detail penarikan tabungan.',
    }
  }

  return {
    data: {
      transaction: mapRowToTransaction(txData),
      withdrawal: mapRowToWithdrawal(swData),
    },
    error: null,
  }
}
