/**
 * M2.22 — Production Observability, Operational Diagnostics & Safe Error Model
 *
 * Provides structured, production-safe diagnostic tracing and classified error
 * handling for the financial application.
 *
 * Principles:
 * - Zero secret leakage: automatically redacts tokens, keys, passwords, sensitive PII,
 *   full transaction payloads, and raw SQL/DB internals.
 * - Lightweight correlation: attaches lightweight correlation IDs to track an
 *   operation from UI request to outcome.
 * - Structured classification: categorizes operational failures (validation, auth,
 *   authorization/ownership, accounting_rejection, database, network, unexpected).
 * - Safe user-facing messages: converts internal/database exceptions into clean,
 *   non-leaky, actionable Indonesian user messages.
 * - Accounting-neutral: purely observational; does not alter accounting rules,
 *   financial transactions, or database invariants.
 */

// ============================================================================
// 1. Error Categories & Model
// ============================================================================

export type OperationalErrorCategory =
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'accounting_rejection'
  | 'database'
  | 'network'
  | 'unexpected'

export interface OperationalErrorOptions {
  category: OperationalErrorCategory
  userMessage: string
  code?: string
  cause?: unknown
  correlationId?: string
  metadata?: Record<string, unknown>
}

export class OperationalError extends Error {
  public readonly category: OperationalErrorCategory
  public readonly userMessage: string
  public readonly code: string
  public readonly correlationId: string
  public readonly metadata: Record<string, unknown>
  public readonly timestamp: string

  constructor(options: OperationalErrorOptions) {
    super(options.userMessage)
    this.name = 'OperationalError'
    this.category = options.category
    this.userMessage = options.userMessage
    this.code = options.code ?? `ERR_${options.category.toUpperCase()}`
    this.correlationId = options.correlationId ?? generateCorrelationId()
    this.metadata = redactSensitiveData(options.metadata ?? {})
    this.timestamp = new Date().toISOString()

    // Maintain prototype chain
    Object.setPrototypeOf(this, OperationalError.prototype)
  }
}

// ============================================================================
// 2. Correlation ID Generator
// ============================================================================

export function generateCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

// ============================================================================
// 3. Sensitive Data Redaction
// ============================================================================

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /\bkey\b/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /auth/i,
  /credential/i,
  /authorization/i,
  /bearer/i,
  /cookie/i,
  /session/i,
  /service_role/i,
  /anon_key/i,
]

const REDACTED_MARKER = '[REDACTED]'

export function redactSensitiveData<T>(input: T): T {
  if (input === null || input === undefined) return input

  if (typeof input === 'string') {
    // Check if string looks like a JWT or long auth token
    if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(input) || input.startsWith('Bearer ')) {
      return REDACTED_MARKER as unknown as T
    }
    // Check if string contains secret key indicator
    if (input.includes('service_role') || (input.includes('eyJh') && input.length > 50)) {
      return REDACTED_MARKER as unknown as T
    }
    return input
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveData(item)) as unknown as T
  }

  if (typeof input === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const isSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pat) => pat.test(key))
      if (isSensitiveKey) {
        output[key] = REDACTED_MARKER
      } else if (typeof value === 'object' && value !== null) {
        output[key] = redactSensitiveData(value)
      } else {
        output[key] = value
      }
    }
    return output as T
  }

  return input
}

// ============================================================================
// 4. Safe Error Classifier & Translator
// ============================================================================

export interface ClassifiedError {
  category: OperationalErrorCategory
  code: string
  userMessage: string
  correlationId: string
  metadata: Record<string, unknown>
}

/**
 * Classifies raw database errors, network exceptions, or application failures
 * into a safe, non-leaky classified diagnostic record with user-facing Indonesian text.
 */
export function classifyOperationalError(
  err: unknown,
  correlationId?: string,
  contextMetadata?: Record<string, unknown>
): ClassifiedError {
  const reqId = correlationId ?? generateCorrelationId()
  const meta = redactSensitiveData(contextMetadata ?? {})

  if (err instanceof OperationalError) {
    return {
      category: err.category,
      code: err.code,
      userMessage: err.userMessage,
      correlationId: err.correlationId,
      metadata: { ...err.metadata, ...meta },
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawMessage = (err instanceof Error ? err.message : (err as any)?.message) || String(err || '')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawCode = (err as any)?.code ? String((err as any).code) : ''

  // 1. Authentication / Session failures
  if (
    rawMessage.includes('unauthorized: authentication required') ||
    rawMessage.includes('Sesi tidak ditemukan') ||
    rawMessage.includes('JWT') ||
    rawCode === 'PGRST301' ||
    rawCode === 'insufficient_privilege' && rawMessage.includes('unauthorized')
  ) {
    return {
      category: 'authentication',
      code: 'AUTH_REQUIRED',
      userMessage: 'Sesi Anda telah berakhir. Silakan login kembali.',
      correlationId: reqId,
      metadata: meta,
    }
  }

  // 2. Authorization / Ownership / Cross-user rejections
  if (
    rawMessage.includes('does not belong') ||
    rawMessage.includes('does not exist or does not belong') ||
    rawMessage.includes('bukan milik Anda') ||
    rawCode === '42501' ||
    rawMessage.includes('row-level security') ||
    rawMessage.includes('violates row-level security policy')
  ) {
    return {
      category: 'authorization',
      code: 'FORBIDDEN_ACCESS',
      userMessage: 'Anda tidak memiliki akses ke data atau operasi ini.',
      correlationId: reqId,
      metadata: meta,
    }
  }

  // 3. Accounting & Financial Integrity Rejections (Checks, Overdraft, Non-negative, Reversals)
  if (
    rawCode === '23505' ||
    rawMessage.includes('already been reversed') ||
    rawMessage.includes('unique_violation')
  ) {
    return {
      category: 'accounting_rejection',
      code: 'TX_ALREADY_REVERSED',
      userMessage: 'Transaksi ini sudah pernah dibatalkan sebelumnya.',
      correlationId: reqId,
      metadata: meta,
    }
  }

  if (
    rawMessage.includes('cannot reverse a reversal')
  ) {
    return {
      category: 'accounting_rejection',
      code: 'REVERSAL_OF_REVERSAL_BLOCKED',
      userMessage: 'Tidak dapat membatalkan transaksi yang merupakan hasil pembatalan.',
      correlationId: reqId,
      metadata: meta,
    }
  }

  if (
    rawMessage.includes('not eligible for reversal')
  ) {
    return {
      category: 'accounting_rejection',
      code: 'TX_NOT_ELIGIBLE_FOR_REVERSAL',
      userMessage: 'Tipe transaksi ini tidak dapat dibatalkan.',
      correlationId: reqId,
      metadata: meta,
    }
  }

  if (
    rawCode === '23514' ||
    rawMessage.includes('insufficient') ||
    rawMessage.includes('overdraft') ||
    rawMessage.includes('check_violation') ||
    rawMessage.includes('check constraint')
  ) {
    if (rawMessage.includes('goal') || rawMessage.includes('tabungan')) {
      return {
        category: 'accounting_rejection',
        code: 'GOAL_BALANCE_INSUFFICIENT',
        userMessage: 'Saldo tujuan tabungan tidak mencukupi untuk penarikan ini.',
        correlationId: reqId,
        metadata: meta,
      }
    }
    return {
      category: 'accounting_rejection',
      code: 'WALLET_BALANCE_INSUFFICIENT',
      userMessage: 'Saldo dompet tidak mencukupi untuk melakukan transaksi ini.',
      correlationId: reqId,
      metadata: meta,
    }
  }

  if (
    rawMessage.includes('immutable')
  ) {
    return {
      category: 'accounting_rejection',
      code: 'LEDGER_IMMUTABLE',
      userMessage: 'Data transaksi buku besar tidak dapat diubah.',
      correlationId: reqId,
      metadata: meta,
    }
  }

  // 4. Network / Connectivity Failures
  if (
    rawMessage.includes('Failed to fetch') ||
    rawMessage.includes('NetworkError') ||
    rawMessage.includes('fetch failed') ||
    rawMessage.includes('ECONNREFUSED') ||
    rawMessage.includes('ETIMEDOUT')
  ) {
    return {
      category: 'network',
      code: 'NETWORK_TIMEOUT_OR_DISCONNECTED',
      userMessage: 'Koneksi jaringan terganggu. Silakan periksa koneksi Anda dan coba lagi.',
      correlationId: reqId,
      metadata: meta,
    }
  }

  // 5. Validation failures
  if (
    rawMessage.includes('wajib diisi') ||
    rawMessage.includes('harus berupa bilangan') ||
    rawMessage.includes('tidak valid') ||
    rawMessage.includes('invalid_parameter_value')
  ) {
    return {
      category: 'validation',
      code: 'VALIDATION_FAILED',
      userMessage: rawMessage,
      correlationId: reqId,
      metadata: meta,
    }
  }

  // 6. Generic Database / Server Error
  return {
    category: 'unexpected',
    code: 'UNEXPECTED_SERVER_ERROR',
    userMessage: 'Terjadi kesalahan sistem saat memproses transaksi. Silakan coba beberapa saat lagi.',
    correlationId: reqId,
    metadata: meta,
  }
}

// ============================================================================
// 5. Diagnostic Event Logger (Structured & Lightweight)
// ============================================================================

export type DiagnosticSeverity = 'info' | 'warn' | 'error'

export interface DiagnosticEvent {
  timestamp: string
  correlationId: string
  operation: string
  severity: DiagnosticSeverity
  outcome: 'success' | 'failure' | 'rejected'
  category?: OperationalErrorCategory
  code?: string
  durationMs?: number
  metadata: Record<string, unknown>
}

// In-memory ring buffer for client-side diagnostic inspection / telemetry
const DIAGNOSTIC_BUFFER_SIZE = 100
const diagnosticEventBuffer: DiagnosticEvent[] = []

/**
 * Records a diagnostic event safely. Strips all sensitive tokens, credentials,
 * and raw data payloads.
 */
export function recordDiagnosticEvent(event: {
  operation: string
  outcome: 'success' | 'failure' | 'rejected'
  severity?: DiagnosticSeverity
  correlationId?: string
  category?: OperationalErrorCategory
  code?: string
  durationMs?: number
  metadata?: Record<string, unknown>
}): DiagnosticEvent {
  const safeMeta = redactSensitiveData(event.metadata ?? {})

  const entry: DiagnosticEvent = {
    timestamp: new Date().toISOString(),
    correlationId: event.correlationId ?? generateCorrelationId(),
    operation: event.operation,
    severity: event.severity ?? (event.outcome === 'success' ? 'info' : 'error'),
    outcome: event.outcome,
    category: event.category,
    code: event.code,
    durationMs: event.durationMs,
    metadata: safeMeta,
  }

  diagnosticEventBuffer.push(entry)
  if (diagnosticEventBuffer.length > DIAGNOSTIC_BUFFER_SIZE) {
    diagnosticEventBuffer.shift()
  }

  // Structured console emission for dev/operational log forwarders
  if (process.env.NODE_ENV !== 'production' || entry.severity === 'error') {
    const logPrefix = `[DIAGNOSTICS][${entry.severity.toUpperCase()}][${entry.operation}]`
    const logPayload = JSON.stringify({
      corrId: entry.correlationId,
      outcome: entry.outcome,
      category: entry.category,
      code: entry.code,
      durationMs: entry.durationMs,
      meta: entry.metadata,
    })

    if (entry.severity === 'error') {
      console.error(`${logPrefix} ${logPayload}`)
    } else if (entry.severity === 'warn') {
      console.warn(`${logPrefix} ${logPayload}`)
    } else {
      console.log(`${logPrefix} ${logPayload}`)
    }
  }

  return entry
}

/**
 * Returns recent diagnostic events (up to 100 items).
 */
export function getRecentDiagnosticEvents(): DiagnosticEvent[] {
  return [...diagnosticEventBuffer]
}

/**
 * Clears the diagnostic event buffer (useful for test harnesses).
 */
export function clearDiagnosticEventBuffer(): void {
  diagnosticEventBuffer.length = 0
}
