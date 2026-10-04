/**
 * M2.22 — Production Observability & Operational Diagnostics Unit Tests
 *
 * Covers:
 * 1. Error Classification (validation, auth, authorization, accounting_rejection, network, unexpected)
 * 2. Sensitive Data Redaction (passwords, tokens, keys, bearer headers, service-role)
 * 3. Correlation ID Generation & Propagation
 * 4. User-Facing Safe Error Mapping (never leaks raw SQL or Postgres internals)
 * 5. Diagnostic Event Buffering & Structure
 * 6. Financial Diagnostics Coverage (reverseTransaction, createSavingsWithdrawal)
 */

const assert = require('assert');
const {
  OperationalError,
  generateCorrelationId,
  redactSensitiveData,
  classifyOperationalError,
  recordDiagnosticEvent,
  getRecentDiagnosticEvents,
  clearDiagnosticEventBuffer,
} = require('../src/lib/diagnostics');

console.log('=== M2.22 Production Observability & Diagnostics Unit Tests ===\n');

let passedCount = 0;
let failedCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failedCount++;
  }
}

// ============================================================================
// 1. Correlation ID Generation
// ============================================================================
console.log('--- 1. Correlation ID Generation ---');

test('generateCorrelationId produces non-empty unique strings', () => {
  const id1 = generateCorrelationId();
  const id2 = generateCorrelationId();
  assert.ok(id1 && typeof id1 === 'string', 'ID1 must be a non-empty string');
  assert.ok(id2 && typeof id2 === 'string', 'ID2 must be a non-empty string');
  assert.notStrictEqual(id1, id2, 'Successive IDs must be unique');
});

// ============================================================================
// 2. Sensitive Data Redaction
// ============================================================================
console.log('\n--- 2. Sensitive Data Redaction ---');

test('redacts password fields in objects', () => {
  const payload = { email: 'user@example.com', password: 'SuperSecretPassword123!' };
  const redacted = redactSensitiveData(payload);
  assert.strictEqual(redacted.email, 'user@example.com');
  assert.strictEqual(redacted.password, '[REDACTED]');
});

test('redacts auth tokens and api keys', () => {
  const payload = {
    apiKey: 'sbp_1234567890abcdef',
    service_role_key: 'secret-service-role-key',
    authToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature',
  };
  const redacted = redactSensitiveData(payload);
  assert.strictEqual(redacted.apiKey, '[REDACTED]');
  assert.strictEqual(redacted.service_role_key, '[REDACTED]');
  assert.strictEqual(redacted.authToken, '[REDACTED]');
});

test('redacts nested sensitive fields inside arrays and child objects', () => {
  const nested = {
    user: {
      id: 'usr_1',
      credentials: {
        accessToken: 'secret_token_val',
        refreshToken: 'refresh_val',
      },
    },
    items: [{ id: '1', secret: 'hide_me' }, { id: '2', label: 'public' }],
  };
  const redacted = redactSensitiveData(nested);
  assert.strictEqual(redacted.user.id, 'usr_1');
  assert.strictEqual(redacted.user.credentials, '[REDACTED]');
  assert.strictEqual(redacted.items[0].secret, '[REDACTED]');
  assert.strictEqual(redacted.items[1].label, 'public');
});

test('leaves safe financial identifiers and categories unredacted', () => {
  const safeData = {
    operation: 'reverse_transaction',
    transactionId: 'tx_12345',
    walletId: 'w_9876',
    category: 'food',
    amount: 50000,
  };
  const redacted = redactSensitiveData(safeData);
  assert.deepStrictEqual(redacted, safeData);
});

// ============================================================================
// 3. Error Classification
// ============================================================================
console.log('\n--- 3. Error Classification & Safe User Messages ---');

test('classifies authentication/session errors cleanly', () => {
  const rawErr = new Error('unauthorized: authentication required');
  const classified = classifyOperationalError(rawErr, 'req_test_1');
  assert.strictEqual(classified.category, 'authentication');
  assert.strictEqual(classified.code, 'AUTH_REQUIRED');
  assert.strictEqual(classified.userMessage, 'Sesi Anda telah berakhir. Silakan login kembali.');
  assert.strictEqual(classified.correlationId, 'req_test_1');
});

test('classifies authorization/ownership rejections without leaking foreign data', () => {
  const rawErr = new Error('transaction does not exist or does not belong to the authenticated user');
  const classified = classifyOperationalError(rawErr);
  assert.strictEqual(classified.category, 'authorization');
  assert.strictEqual(classified.code, 'FORBIDDEN_ACCESS');
  assert.strictEqual(classified.userMessage, 'Anda tidak memiliki akses ke data atau operasi ini.');
  assert.ok(!classified.userMessage.includes('transaction does not exist'), 'Must not leak database wording');
});

test('classifies duplicate reversal as accounting_rejection', () => {
  const rawErr = { code: '23505', message: 'transaction has already been reversed' };
  const classified = classifyOperationalError(rawErr);
  assert.strictEqual(classified.category, 'accounting_rejection');
  assert.strictEqual(classified.code, 'TX_ALREADY_REVERSED');
  assert.strictEqual(classified.userMessage, 'Transaksi ini sudah pernah dibatalkan sebelumnya.');
});

test('classifies reversal-of-reversal attempt as accounting_rejection', () => {
  const rawErr = new Error('cannot reverse a reversal transaction');
  const classified = classifyOperationalError(rawErr);
  assert.strictEqual(classified.category, 'accounting_rejection');
  assert.strictEqual(classified.code, 'REVERSAL_OF_REVERSAL_BLOCKED');
  assert.strictEqual(classified.userMessage, 'Tidak dapat membatalkan transaksi yang merupakan hasil pembatalan.');
});

test('classifies insufficient goal balance as accounting_rejection', () => {
  const rawErr = { code: '23514', message: 'savings withdrawal rejected: goal balance is insufficient' };
  const classified = classifyOperationalError(rawErr);
  assert.strictEqual(classified.category, 'accounting_rejection');
  assert.strictEqual(classified.code, 'GOAL_BALANCE_INSUFFICIENT');
  assert.strictEqual(classified.userMessage, 'Saldo tujuan tabungan tidak mencukupi untuk penarikan ini.');
});

test('classifies overdraft / insufficient wallet balance as accounting_rejection', () => {
  const rawErr = { code: '23514', message: 'insufficient wallet balance for transaction' };
  const classified = classifyOperationalError(rawErr);
  assert.strictEqual(classified.category, 'accounting_rejection');
  assert.strictEqual(classified.code, 'WALLET_BALANCE_INSUFFICIENT');
  assert.strictEqual(classified.userMessage, 'Saldo dompet tidak mencukupi untuk melakukan transaksi ini.');
});

test('classifies ledger immutability violation as accounting_rejection', () => {
  const rawErr = new Error('transaction.amount is immutable');
  const classified = classifyOperationalError(rawErr);
  assert.strictEqual(classified.category, 'accounting_rejection');
  assert.strictEqual(classified.code, 'LEDGER_IMMUTABLE');
  assert.strictEqual(classified.userMessage, 'Data transaksi buku besar tidak dapat diubah.');
});

test('classifies network connection failure cleanly', () => {
  const rawErr = new Error('Failed to fetch');
  const classified = classifyOperationalError(rawErr);
  assert.strictEqual(classified.category, 'network');
  assert.strictEqual(classified.code, 'NETWORK_TIMEOUT_OR_DISCONNECTED');
  assert.strictEqual(classified.userMessage, 'Koneksi jaringan terganggu. Silakan periksa koneksi Anda dan coba lagi.');
});

test('classifies validation error and preserves actionable input feedback', () => {
  const rawErr = new Error('Nominal transaksi wajib diisi');
  const classified = classifyOperationalError(rawErr);
  assert.strictEqual(classified.category, 'validation');
  assert.strictEqual(classified.code, 'VALIDATION_FAILED');
  assert.strictEqual(classified.userMessage, 'Nominal transaksi wajib diisi');
});

test('classifies unknown internal database errors safely without exposing SQL', () => {
  const rawErr = new Error('SELECT * FROM secret_table WHERE id = 123; syntax error at line 4');
  const classified = classifyOperationalError(rawErr);
  assert.strictEqual(classified.category, 'unexpected');
  assert.strictEqual(classified.code, 'UNEXPECTED_SERVER_ERROR');
  assert.ok(!classified.userMessage.includes('secret_table'), 'Must NEVER leak SQL table names');
  assert.ok(!classified.userMessage.includes('syntax error'), 'Must NEVER leak SQL syntax errors');
  assert.strictEqual(classified.userMessage, 'Terjadi kesalahan sistem saat memproses transaksi. Silakan coba beberapa saat lagi.');
});

// ============================================================================
// 4. OperationalError Class Behavior
// ============================================================================
console.log('\n--- 4. OperationalError Class Invariants ---');

test('OperationalError automatically redacts metadata upon construction', () => {
  const opErr = new OperationalError({
    category: 'accounting_rejection',
    userMessage: 'Saldo tidak mencukupi.',
    code: 'INSUFFICIENT_FUNDS',
    metadata: {
      walletId: 'w_1',
      userSecretToken: 'should_be_hidden',
    },
  });
  assert.strictEqual(opErr.category, 'accounting_rejection');
  assert.strictEqual(opErr.code, 'INSUFFICIENT_FUNDS');
  assert.strictEqual(opErr.metadata.walletId, 'w_1');
  assert.strictEqual(opErr.metadata.userSecretToken, '[REDACTED]');
  assert.ok(opErr.correlationId, 'Must assign correlationId');
  assert.ok(opErr.timestamp, 'Must record timestamp');
});

// ============================================================================
// 5. Diagnostic Event Buffering & Ring Buffer
// ============================================================================
console.log('\n--- 5. Diagnostic Event Logging & Buffering ---');

test('recordDiagnosticEvent records structured events into the buffer', () => {
  clearDiagnosticEventBuffer();
  recordDiagnosticEvent({
    operation: 'test_op_1',
    outcome: 'success',
    durationMs: 45,
    metadata: { testKey: 'testVal' },
  });

  const events = getRecentDiagnosticEvents();
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].operation, 'test_op_1');
  assert.strictEqual(events[0].outcome, 'success');
  assert.strictEqual(events[0].durationMs, 45);
  assert.strictEqual(events[0].metadata.testKey, 'testVal');
});

test('recordDiagnosticEvent automatically redacts secrets in event metadata', () => {
  clearDiagnosticEventBuffer();
  recordDiagnosticEvent({
    operation: 'auth_attempt',
    outcome: 'failure',
    metadata: {
      username: 'danjul',
      password: 'mypassword123',
    },
  });

  const events = getRecentDiagnosticEvents();
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].metadata.username, 'danjul');
  assert.strictEqual(events[0].metadata.password, '[REDACTED]');
});

test('ring buffer respects bounded limit of 100 items', () => {
  clearDiagnosticEventBuffer();
  for (let i = 0; i < 110; i++) {
    recordDiagnosticEvent({
      operation: `op_${i}`,
      outcome: 'success',
    });
  }

  const events = getRecentDiagnosticEvents();
  assert.strictEqual(events.length, 100);
  assert.strictEqual(events[0].operation, 'op_10');
  assert.strictEqual(events[99].operation, 'op_109');
});

// ============================================================================
// 6. Security Review: No Leakage of Credentials or Internal Keys
// ============================================================================
console.log('\n--- 6. Security & Secret Leakage Verification ---');

test('redaction handles bearer authorization tokens in headers', () => {
  const headers = {
    authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    accept: 'application/json',
  };
  const safeHeaders = redactSensitiveData(headers);
  assert.strictEqual(safeHeaders.authorization, '[REDACTED]');
  assert.strictEqual(safeHeaders.accept, 'application/json');
});

test('classified error does not echo sensitive metadata in error code or userMessage', () => {
  const secretMeta = { token: 'super_secret', password: '123' };
  const classified = classifyOperationalError(new Error('Unknown failure'), 'req_99', secretMeta);
  assert.ok(!classified.userMessage.includes('super_secret'));
  assert.ok(!classified.userMessage.includes('123'));
  assert.strictEqual(classified.metadata.token, '[REDACTED]');
  assert.strictEqual(classified.metadata.password, '[REDACTED]');
});

// ============================================================================
// Summary
// ============================================================================
console.log(`\n=== M2.22 Unit Test Results: ${passedCount} passed, ${failedCount} failed ===\n`);

if (failedCount > 0) {
  process.exit(1);
}
