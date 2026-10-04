import { createClient } from '@/lib/supabase/client'
import type { Transaction, Rupiah } from '@/types/domain'

export interface ReversalInput {
  transactionId: string
  reason: string
}

export interface ReversalResult {
  data: {
    originalTransaction: Transaction
    reversalTransaction: Transaction
  } | null
  error: string | null
}

export function validateReversalInput(input: ReversalInput): {
  valid: boolean
  error: string | null
} {
  if (!input.transactionId || typeof input.transactionId !== 'string' || !input.transactionId.trim()) {
    return { valid: false, error: 'ID transaksi wajib diisi.' }
  }

  if (!input.reason || typeof input.reason !== 'string' || !input.reason.trim()) {
    return { valid: false, error: 'Alasan pembatalan transaksi wajib diisi.' }
  }

  const trimmed = input.reason.trim()
  if (trimmed.length > 500) {
    return { valid: false, error: 'Alasan pembatalan tidak boleh melebihi 500 karakter.' }
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
 * Reverse an existing financial transaction authoritatively.
 *
 * Requirements & Constraints:
 * 1. Derives authenticated identity from session (never accepts user_id from browser).
 * 2. Original transaction remains completely immutable.
 * 3. Atomic execution via PostgreSQL RPC `reverse_transaction`.
 * 4. Fails atomically if wallet or goal balance cannot support the reversal.
 * 5. Rejects duplicate reversals and cross-user attempts.
 */
import { recordDiagnosticEvent, generateCorrelationId, classifyOperationalError } from '@/lib/diagnostics'

export async function reverseTransaction(
  input: ReversalInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: any
): Promise<ReversalResult> {
  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  const validation = validateReversalInput(input)
  if (!validation.valid) {
    recordDiagnosticEvent({
      operation: 'reverse_transaction',
      outcome: 'rejected',
      category: 'validation',
      code: 'VALIDATION_FAILED',
      correlationId,
      metadata: { targetTxId: input.transactionId },
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
      operation: 'reverse_transaction',
      outcome: 'rejected',
      category: 'authentication',
      code: 'AUTH_REQUIRED',
      correlationId,
      metadata: { targetTxId: input.transactionId },
    })
    return {
      data: null,
      error: authError?.message || 'Sesi tidak ditemukan. Silakan login kembali.',
    }
  }

  const trimmedReason = input.reason.trim()

  const { data, error } = await supabase.rpc('reverse_transaction', {
    p_transaction_id: input.transactionId.trim(),
    p_reason: trimmedReason,
  })

  const durationMs = Date.now() - startTime

  if (error) {
    const classified = classifyOperationalError(error, correlationId, {
      targetTxId: input.transactionId,
    })

    recordDiagnosticEvent({
      operation: 'reverse_transaction',
      outcome: 'failure',
      category: classified.category,
      code: classified.code,
      durationMs,
      correlationId,
      metadata: { targetTxId: input.transactionId },
    })

    // Map known Postgres error codes and trigger error messages
    if (error.code === '23505' || error.message.includes('already been reversed') || error.message.includes('unique_violation')) {
      return {
        data: null,
        error: 'Transaksi ini sudah pernah dibatalkan sebelumnya.',
      }
    }

    if (error.code === '23514' || error.message.includes('insufficient') || error.message.includes('check_violation')) {
      if (error.message.includes('goal balance')) {
        return {
          data: null,
          error: 'Pembatalan ditolak: Saldo tabungan tidak mencukupi untuk membatalkan kontribusi ini.',
        }
      }
      if (error.message.includes('wallet balance')) {
        return {
          data: null,
          error: 'Pembatalan ditolak: Saldo dompet tidak mencukupi untuk membatalkan transaksi ini.',
        }
      }
      if (error.message.includes('cannot reverse a reversal')) {
        return {
          data: null,
          error: 'Tidak dapat membatalkan transaksi yang merupakan hasil pembatalan.',
        }
      }
      if (error.message.includes('not eligible')) {
        return {
          data: null,
          error: 'Tipe transaksi ini tidak dapat dibatalkan.',
        }
      }
      return {
        data: null,
        error: 'Saldo tidak mencukupi untuk melakukan pembatalan transaksi.',
      }
    }

    if (error.code === '23503' || error.code === '42501' || error.message.includes('does not exist or does not belong')) {
      return {
        data: null,
        error: 'Transaksi tidak ditemukan atau tidak memiliki akses.',
      }
    }

    return {
      data: null,
      error: classified.userMessage || 'Gagal membatalkan transaksi.',
    }
  }

  recordDiagnosticEvent({
    operation: 'reverse_transaction',
    outcome: 'success',
    durationMs,
    correlationId,
    metadata: {
      originalTxId: data?.original_transaction?.id,
      reversalTxId: data?.reversal_transaction?.id,
      reversalType: data?.reversal_transaction?.type,
    },
  })

  if (!data || !data.original_transaction || !data.reversal_transaction) {
    return {
      data: null,
      error: 'Respons pembatalan tidak lengkap dari server.',
    }
  }

  const origMapped = mapRowToTransaction(data.original_transaction)
  const revMapped = mapRowToTransaction(data.reversal_transaction)

  // Explicitly link them for client consumers
  origMapped.isReversed = true
  origMapped.reversedByTransactionId = revMapped.id

  return {
    data: {
      originalTransaction: origMapped,
      reversalTransaction: revMapped,
    },
    error: null,
  }
}
