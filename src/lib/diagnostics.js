/**
 * M2.22 — Production Observability, Operational Diagnostics & Safe Error Model
 * CommonJS implementation for direct Node test runner and universal compatibility.
 */

// ============================================================================
// 1. Correlation ID Generator
// ============================================================================

function generateCorrelationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================================================
// 2. Sensitive Data Redaction
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
];

const REDACTED_MARKER = '[REDACTED]';

function redactSensitiveData(input) {
  if (input === null || input === undefined) return input;

  if (typeof input === 'string') {
    // Check if string looks like a JWT or long auth token
    if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(input) || input.startsWith('Bearer ')) {
      return REDACTED_MARKER;
    }
    // Check if string contains secret key indicator
    if (input.includes('service_role') || (input.includes('eyJh') && input.length > 50)) {
      return REDACTED_MARKER;
    }
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveData(item));
  }

  if (typeof input === 'object') {
    const output = {};
    for (const [key, value] of Object.entries(input)) {
      const isSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pat) => pat.test(key));
      if (isSensitiveKey) {
        output[key] = REDACTED_MARKER;
      } else if (typeof value === 'object' && value !== null) {
        output[key] = redactSensitiveData(value);
      } else {
        output[key] = value;
      }
    }
    return output;
  }

  return input;
}

// ============================================================================
// 3. OperationalError Class
// ============================================================================

class OperationalError extends Error {
  constructor(options) {
    super(options.userMessage);
    this.name = 'OperationalError';
    this.category = options.category;
    this.userMessage = options.userMessage;
    this.code = options.code ?? `ERR_${options.category.toUpperCase()}`;
    this.correlationId = options.correlationId ?? generateCorrelationId();
    this.metadata = redactSensitiveData(options.metadata ?? {});
    this.timestamp = new Date().toISOString();

    Object.setPrototypeOf(this, OperationalError.prototype);
  }
}

// ============================================================================
// 4. Safe Error Classifier & Translator
// ============================================================================

function classifyOperationalError(err, correlationId, contextMetadata) {
  const reqId = correlationId ?? generateCorrelationId();
  const meta = redactSensitiveData(contextMetadata ?? {});

  if (err instanceof OperationalError) {
    return {
      category: err.category,
      code: err.code,
      userMessage: err.userMessage,
      correlationId: err.correlationId,
      metadata: { ...err.metadata, ...meta },
    };
  }

  const rawMessage = (err instanceof Error ? err.message : err?.message) || String(err || '');
  const rawCode = err?.code ? String(err.code) : '';

  // 1. Authentication / Session failures
  if (
    rawMessage.includes('unauthorized: authentication required') ||
    rawMessage.includes('Sesi tidak ditemukan') ||
    rawMessage.includes('JWT') ||
    rawCode === 'PGRST301' ||
    (rawCode === 'insufficient_privilege' && rawMessage.includes('unauthorized'))
  ) {
    return {
      category: 'authentication',
      code: 'AUTH_REQUIRED',
      userMessage: 'Sesi Anda telah berakhir. Silakan login kembali.',
      correlationId: reqId,
      metadata: meta,
    };
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
    };
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
    };
  }

  if (rawMessage.includes('cannot reverse a reversal')) {
    return {
      category: 'accounting_rejection',
      code: 'REVERSAL_OF_REVERSAL_BLOCKED',
      userMessage: 'Tidak dapat membatalkan transaksi yang merupakan hasil pembatalan.',
      correlationId: reqId,
      metadata: meta,
    };
  }

  if (rawMessage.includes('not eligible for reversal')) {
    return {
      category: 'accounting_rejection',
      code: 'TX_NOT_ELIGIBLE_FOR_REVERSAL',
      userMessage: 'Tipe transaksi ini tidak dapat dibatalkan.',
      correlationId: reqId,
      metadata: meta,
    };
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
      };
    }
    return {
      category: 'accounting_rejection',
      code: 'WALLET_BALANCE_INSUFFICIENT',
      userMessage: 'Saldo dompet tidak mencukupi untuk melakukan transaksi ini.',
      correlationId: reqId,
      metadata: meta,
    };
  }

  if (rawMessage.includes('immutable')) {
    return {
      category: 'accounting_rejection',
      code: 'LEDGER_IMMUTABLE',
      userMessage: 'Data transaksi buku besar tidak dapat diubah.',
      correlationId: reqId,
      metadata: meta,
    };
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
    };
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
    };
  }

  // 6. Generic Database / Server Error
  return {
    category: 'unexpected',
    code: 'UNEXPECTED_SERVER_ERROR',
    userMessage: 'Terjadi kesalahan sistem saat memproses transaksi. Silakan coba beberapa saat lagi.',
    correlationId: reqId,
    metadata: meta,
  };
}

// ============================================================================
// 5. Diagnostic Event Logger (Structured & Lightweight)
// ============================================================================

const DIAGNOSTIC_BUFFER_SIZE = 100;
const diagnosticEventBuffer = [];

function recordDiagnosticEvent(event) {
  const safeMeta = redactSensitiveData(event.metadata ?? {});

  const entry = {
    timestamp: new Date().toISOString(),
    correlationId: event.correlationId ?? generateCorrelationId(),
    operation: event.operation,
    severity: event.severity ?? (event.outcome === 'success' ? 'info' : 'error'),
    outcome: event.outcome,
    category: event.category,
    code: event.code,
    durationMs: event.durationMs,
    metadata: safeMeta,
  };

  diagnosticEventBuffer.push(entry);
  if (diagnosticEventBuffer.length > DIAGNOSTIC_BUFFER_SIZE) {
    diagnosticEventBuffer.shift();
  }

  if (process.env.NODE_ENV !== 'production' || entry.severity === 'error') {
    const logPrefix = `[DIAGNOSTICS][${entry.severity.toUpperCase()}][${entry.operation}]`;
    const logPayload = JSON.stringify({
      corrId: entry.correlationId,
      outcome: entry.outcome,
      category: entry.category,
      code: entry.code,
      durationMs: entry.durationMs,
      meta: entry.metadata,
    });

    if (entry.severity === 'error') {
      console.error(`${logPrefix} ${logPayload}`);
    } else if (entry.severity === 'warn') {
      console.warn(`${logPrefix} ${logPayload}`);
    } else {
      console.log(`${logPrefix} ${logPayload}`);
    }
  }

  return entry;
}

function getRecentDiagnosticEvents() {
  return [...diagnosticEventBuffer];
}

function clearDiagnosticEventBuffer() {
  diagnosticEventBuffer.length = 0;
}

module.exports = {
  OperationalError,
  generateCorrelationId,
  redactSensitiveData,
  classifyOperationalError,
  recordDiagnosticEvent,
  getRecentDiagnosticEvents,
  clearDiagnosticEventBuffer,
};
