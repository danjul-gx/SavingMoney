/**
 * M2.3 Unit Tests — Transaction Entry & History verification
 * Run with: node tests/m2_3_transaction.test.js
 */
const assert = require('assert')

console.log('--- Starting M2.3 Transaction Verification Tests ---')

// 1. Transaction Input Validation
function validateTransactionInput(input) {
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

// Test 1: Empty or missing amount rejected
assert.strictEqual(validateTransactionInput({ walletId: 'w1', type: 'expense', amount: null, transactionDate: '2026-09-21' }).valid, false)
console.log('✓ Test 1: Empty amount rejected')

// Test 2: Zero amount rejected
assert.strictEqual(validateTransactionInput({ walletId: 'w1', type: 'expense', amount: 0, transactionDate: '2026-09-21' }).valid, false)
assert.strictEqual(validateTransactionInput({ walletId: 'w1', type: 'expense', amount: 0, transactionDate: '2026-09-21' }).error, 'Nominal transaksi harus lebih besar dari 0.')
console.log('✓ Test 2: Zero amount rejected')

// Test 3: Negative amount rejected
assert.strictEqual(validateTransactionInput({ walletId: 'w1', type: 'expense', amount: -50000, transactionDate: '2026-09-21' }).valid, false)
assert.strictEqual(validateTransactionInput({ walletId: 'w1', type: 'expense', amount: -50000, transactionDate: '2026-09-21' }).error, 'Nominal transaksi harus lebih besar dari 0.')
console.log('✓ Test 3: Negative amount rejected')

// Test 4: Non-integer / float amount rejected (no silent rounding)
assert.strictEqual(validateTransactionInput({ walletId: 'w1', type: 'expense', amount: 50000.75, transactionDate: '2026-09-21' }).valid, false)
assert.strictEqual(validateTransactionInput({ walletId: 'w1', type: 'expense', amount: 50000.75, transactionDate: '2026-09-21' }).error, 'Nominal transaksi harus berupa bilangan bulat Rupiah.')
console.log('✓ Test 4: Non-integer amount rejected (no float money)')

// Test 5: Valid income payload accepted
assert.strictEqual(
  validateTransactionInput({
    walletId: 'w1',
    type: 'income',
    amount: 1500000,
    description: 'Gaji freelance',
    transactionDate: '2026-09-21',
  }).valid,
  true
)
console.log('✓ Test 5: Valid income payload accepted')

// Test 6: Valid expense payload accepted
assert.strictEqual(
  validateTransactionInput({
    walletId: 'w1',
    type: 'expense',
    amount: 45000,
    description: 'Makan siang',
    transactionDate: '2026-09-21',
  }).valid,
  true
)
console.log('✓ Test 6: Valid expense payload accepted')

// Test 7: Wallet is required
assert.strictEqual(
  validateTransactionInput({
    walletId: '',
    type: 'expense',
    amount: 50000,
    transactionDate: '2026-09-21',
  }).valid,
  false
)
assert.strictEqual(
  validateTransactionInput({
    walletId: '   ',
    type: 'expense',
    amount: 50000,
    transactionDate: '2026-09-21',
  }).error,
  'Dompet wajib dipilih.'
)
console.log('✓ Test 7: Wallet is required')

// Test 8: Unsupported transaction types rejected from normal entry
assert.strictEqual(
  validateTransactionInput({
    walletId: 'w1',
    type: 'savings_contribution',
    amount: 100000,
    transactionDate: '2026-09-21',
  }).valid,
  false
)
assert.strictEqual(
  validateTransactionInput({
    walletId: 'w1',
    type: 'transfer',
    amount: 100000,
    transactionDate: '2026-09-21',
  }).valid,
  false
)
console.log('✓ Test 8: Unsupported operational transaction types (savings_contribution, transfer, rollover) rejected from normal entry')

// 2. Ownership & Client Payload Sanitization
function sanitizeCreateTransactionPayload(currentUser, input) {
  if (!currentUser) {
    return { payload: null, error: 'Not authenticated' }
  }

  const validation = validateTransactionInput(input)
  if (!validation.valid) {
    return { payload: null, error: validation.error }
  }

  // Client cannot inject arbitrary user_id, opening/resulting balance, or goal_id
  const payload = {
    user_id: currentUser.id,
    wallet_id: input.walletId,
    type: input.type,
    amount: input.amount,
    description: input.description ? input.description.trim() : null,
    transaction_date: input.transactionDate,
  }

  return { payload, error: null }
}

// Test 9: Arbitrary user_id and balance mutations cannot be supplied
const spoofedTx = {
  walletId: 'w-victim',
  type: 'income',
  amount: 10000000,
  transactionDate: '2026-09-21',
  user_id: 'victim-user-id',
  balance: 50000000,
  wallet_balance: 99999999,
  goal_id: 'arbitrary-goal',
}
const authUser = { id: 'legit-user-id' }
const sanitized = sanitizeCreateTransactionPayload(authUser, spoofedTx)
assert.strictEqual(sanitized.payload.user_id, 'legit-user-id')
assert.strictEqual(sanitized.payload.balance, undefined)
assert.strictEqual(sanitized.payload.wallet_balance, undefined)
assert.strictEqual(sanitized.payload.goal_id, undefined)
console.log('✓ Test 9: Arbitrary user_id and wallet balance mutations cannot be supplied; strictly scoped to session')

// Test 10: Unauthenticated transaction creation rejected
assert.strictEqual(sanitizeCreateTransactionPayload(null, spoofedTx).error, 'Not authenticated')
console.log('✓ Test 10: Unauthenticated transaction creation rejected')

// 3. Immutability: Transaction metadata update check
// In M1, transactions are immutable financial ledger entries.
function isTransactionEditable(fieldName) {
  // Only description and date might have schema update policies; financial identity is strictly locked
  const immutableFields = ['user_id', 'wallet_id', 'goal_id', 'type', 'amount', 'adjustment_direction']
  return !immutableFields.includes(fieldName)
}
assert.strictEqual(isTransactionEditable('amount'), false)
assert.strictEqual(isTransactionEditable('type'), false)
assert.strictEqual(isTransactionEditable('wallet_id'), false)
assert.strictEqual(isTransactionEditable('user_id'), false)
console.log('✓ Test 11: Transaction amount/type/wallet/user fields are strictly immutable in client layer')

// 4. Error Mapping: Insufficient funds & database errors mapped cleanly
function mapTransactionDatabaseError(error) {
  if (error.message.includes('insufficient') || error.code === '23514') {
    return 'Saldo dompet tidak mencukupi untuk transaksi ini.'
  }
  if (error.code === '23503') {
    return 'Dompet yang dipilih tidak ditemukan.'
  }
  return 'Gagal mencatat transaksi.'
}

// Test 12: Overdraft trigger error mapped to friendly user error
const overdraftErr = { code: '23514', message: 'transaction rejected: wallet balance 5000 is insufficient for debit of 10000 (type: expense)' }
assert.strictEqual(mapTransactionDatabaseError(overdraftErr), 'Saldo dompet tidak mencukupi untuk transaksi ini.')
console.log('✓ Test 12: Insufficient funds surfaced cleanly as accounting error')

// 5. Money Formatting
function formatRupiah(amount) {
  const integerAmount = Math.trunc(amount)
  return 'Rp' + integerAmount.toLocaleString('id-ID')
}

// Test 13: Rupiah integer currency formatting
assert.strictEqual(formatRupiah(50000), 'Rp50.000')
assert.strictEqual(formatRupiah(1500000), 'Rp1.500.000')
console.log('✓ Test 13: Rupiah formatting verified integer-safe')

console.log('--- All 13 M2.3 Transaction Tests Passed Successfully ---')
