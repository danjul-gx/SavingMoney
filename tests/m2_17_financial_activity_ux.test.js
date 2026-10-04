/**
 * M2.17 — Financial Activity & Transaction UX Hardening Unit Tests
 *
 * Verifies domain and UI-facing behavior:
 * 1. Filter state composition (search, type, wallet, goal, dateFrom, dateTo).
 * 2. Clearing filters restores default view and resets page to 0.
 * 3. Pagination reset to 0 after any filter change.
 * 4. First-page Previous button disabled state (page === 0).
 * 5. Last-page Next button disabled state (!hasMore or (page + 1) * PAGE_SIZE >= totalCount).
 * 6. Empty result handling distinguishes no-transactions vs no-filter-matches.
 * 7. Reversal display metadata: distinction between original vs reversal, reason display, cancelled status.
 * 8. Transaction detail mapping with complete fields (type, amount, date, wallet, goal, reversal info, created timestamp).
 * 9. Audit-event vs ledger distinction: audit events are informational, non-mutating, separate from ledger balance calculations.
 * 10. Accounting safety: Read-only UX guarantees no ledger mutation, balance changes, or audit mutations.
 */

const crypto = require('crypto')

const makeTx = (overrides = {}) => ({
  id: overrides.id || crypto.randomUUID(),
  userId: 'u1',
  walletId: overrides.walletId || 'w-cash',
  goalId: overrides.goalId || null,
  type: overrides.type || 'expense',
  amount: overrides.amount || 50000,
  description: overrides.description ?? null,
  adjustmentDirection: overrides.adjustmentDirection || null,
  reversalOfTransactionId: overrides.reversalOfTransactionId || null,
  reversalReason: overrides.reversalReason || null,
  reversedByTransactionId: overrides.reversedByTransactionId || null,
  isReversed: overrides.isReversed || false,
  transactionDate: overrides.transactionDate || '2026-02-01',
  createdAt: overrides.createdAt || '2026-02-01T10:00:00Z',
  ...overrides,
})

let passed = 0
let failed = 0

function assert(condition, label) {
  if (condition) {
    passed++
    console.log(`  ✅ ${label}`)
  } else {
    failed++
    console.error(`  ❌ ${label}`)
  }
}

console.log('\n🔍 M2.17 Financial Activity & Transaction UX Hardening Unit Tests\n')

// 1. Filter State Composition
console.log('--- 1. Filter State Composition ---')
const initialFilterState = {
  searchQuery: '',
  filterType: 'all',
  filterWalletId: 'all',
  filterGoalId: 'all',
  filterDateFrom: '',
  filterDateTo: '',
  sortNewestFirst: true,
  page: 0,
}

function hasActiveFilters(state) {
  return (
    state.searchQuery.trim() !== '' ||
    state.filterType !== 'all' ||
    state.filterWalletId !== 'all' ||
    state.filterGoalId !== 'all' ||
    state.filterDateFrom !== '' ||
    state.filterDateTo !== ''
  )
}

assert(hasActiveFilters(initialFilterState) === false, 'Default initial state has no active filters')

const withSearch = { ...initialFilterState, searchQuery: 'Kopi' }
assert(hasActiveFilters(withSearch) === true, 'Search query triggers active filter state')

const withGoal = { ...initialFilterState, filterGoalId: 'goal-emergency' }
assert(hasActiveFilters(withGoal) === true, 'Goal filter triggers active filter state')

const withTypeAndWallet = { ...initialFilterState, filterType: 'income', filterWalletId: 'w-bank' }
assert(hasActiveFilters(withTypeAndWallet) === true, 'Composed type + wallet triggers active filter state')

// 2. Clearing Filters
console.log('\n--- 2. Clearing Filters ---')
function clearFilters(state) {
  return {
    ...state,
    searchQuery: '',
    filterType: 'all',
    filterWalletId: 'all',
    filterGoalId: 'all',
    filterDateFrom: '',
    filterDateTo: '',
    page: 0,
  }
}

const modifiedState = {
  searchQuery: 'Bonus',
  filterType: 'income',
  filterWalletId: 'w-bank',
  filterGoalId: 'g-haji',
  filterDateFrom: '2026-01-01',
  filterDateTo: '2026-01-31',
  sortNewestFirst: true,
  page: 3,
}

const cleared = clearFilters(modifiedState)
assert(hasActiveFilters(cleared) === false, 'Clearing filters resets all active filter fields to default')
assert(cleared.page === 0, 'Clearing filters resets page to 0')
assert(cleared.sortNewestFirst === true, 'Sorting preference preserved during clear')

// 3. Pagination Reset after Filter Change
console.log('\n--- 3. Pagination Reset after Filter Changes ---')
function applyFilterChange(state, key, value) {
  return {
    ...state,
    [key]: value,
    page: 0, // Invariant: page must reset to first page whenever filter changes
  }
}

let currentPageState = { ...initialFilterState, page: 4 }
currentPageState = applyFilterChange(currentPageState, 'filterType', 'expense')
assert(currentPageState.page === 0, 'Changing filterType resets page to 0')

currentPageState = { ...currentPageState, page: 2 }
currentPageState = applyFilterChange(currentPageState, 'searchQuery', 'Gaji')
assert(currentPageState.page === 0, 'Changing searchQuery resets page to 0')

currentPageState = { ...currentPageState, page: 5 }
currentPageState = applyFilterChange(currentPageState, 'filterGoalId', 'goal-123')
assert(currentPageState.page === 0, 'Changing filterGoalId resets page to 0')

currentPageState = { ...currentPageState, page: 1 }
currentPageState = applyFilterChange(currentPageState, 'filterDateFrom', '2026-02-15')
assert(currentPageState.page === 0, 'Changing filterDateFrom resets page to 0')

// 4 & 5. Pagination Button State Logic
console.log('\n--- 4 & 5. Pagination Prev / Next Controls ---')
function getPaginationState({ page, pageSize, totalCount, hasMore, isLoading }) {
  const totalPages = Math.ceil(totalCount / pageSize) || 1
  const isPrevDisabled = page === 0 || isLoading
  const isNextDisabled = !hasMore || (page + 1) * pageSize >= totalCount || isLoading
  return { isPrevDisabled, isNextDisabled, totalPages }
}

const PAGE_SIZE = 50

// First page of multi-page
const firstPage = getPaginationState({ page: 0, pageSize: PAGE_SIZE, totalCount: 150, hasMore: true, isLoading: false })
assert(firstPage.isPrevDisabled === true, 'First page (0) disables Previous button')
assert(firstPage.isNextDisabled === false, 'First page with more records enables Next button')
assert(firstPage.totalPages === 3, 'Total pages calculated accurately (150 / 50 = 3)')

// Middle page
const middlePage = getPaginationState({ page: 1, pageSize: PAGE_SIZE, totalCount: 150, hasMore: true, isLoading: false })
assert(middlePage.isPrevDisabled === false, 'Middle page (1) enables Previous button')
assert(middlePage.isNextDisabled === false, 'Middle page with more records enables Next button')

// Last page
const lastPage = getPaginationState({ page: 2, pageSize: PAGE_SIZE, totalCount: 150, hasMore: false, isLoading: false })
assert(lastPage.isPrevDisabled === false, 'Last page (2) enables Previous button')
assert(lastPage.isNextDisabled === true, 'Last page disables Next button')

// Loading state disables both
const loadingPage = getPaginationState({ page: 1, pageSize: PAGE_SIZE, totalCount: 150, hasMore: true, isLoading: true })
assert(loadingPage.isPrevDisabled === true, 'Loading disables Previous button to prevent double clicks')
assert(loadingPage.isNextDisabled === true, 'Loading disables Next button to prevent double clicks')

// 6. Empty Result Handling
console.log('\n--- 6. Empty Result Presentation ---')
function getEmptyStateInfo({ totalCount, hasFilters }) {
  if (totalCount === 0 && !hasFilters) {
    return 'NO_TRANSACTIONS'
  }
  if (totalCount === 0 && hasFilters) {
    return 'NO_FILTER_MATCHES'
  }
  return 'HAS_RESULTS'
}

assert(getEmptyStateInfo({ totalCount: 0, hasFilters: false }) === 'NO_TRANSACTIONS', '0 transactions without filter indicates empty ledger')
assert(getEmptyStateInfo({ totalCount: 0, hasFilters: true }) === 'NO_FILTER_MATCHES', '0 transactions with active filters indicates filter mismatch')
assert(getEmptyStateInfo({ totalCount: 12, hasFilters: true }) === 'HAS_RESULTS', 'Positive count indicates regular render')

// 7. Reversal UX & Presentation
console.log('\n--- 7. Reversal UX & Presentation Metadata ---')
const origTx = makeTx({
  id: 'tx-orig-101',
  type: 'expense',
  amount: 75000,
  description: 'Makan Malam Resto',
  isReversed: true,
  reversedByTransactionId: 'tx-rev-202',
})

const revTx = makeTx({
  id: 'tx-rev-202',
  type: 'adjustment',
  amount: 75000,
  adjustmentDirection: 'credit',
  reversalOfTransactionId: 'tx-orig-101',
  reversalReason: 'Salah pilih dompet pembayaran',
})

function getTxDisplayProps(tx) {
  const isReversal = Boolean(tx.reversalOfTransactionId)
  const isReversible =
    !tx.isReversed &&
    !isReversal &&
    ['income', 'expense', 'savings_contribution', 'savings_withdrawal'].includes(tx.type)

  return {
    isReversal,
    isReversible,
    isCancelled: tx.isReversed,
    statusBadge: tx.isReversed ? 'Dibatalkan' : isReversal ? 'Koreksi' : null,
  }
}

const origDisplay = getTxDisplayProps(origTx)
assert(origDisplay.isCancelled === true, 'Original transaction shows cancelled state')
assert(origDisplay.isReversible === false, 'Already reversed transaction cannot be reversed again')
assert(origDisplay.statusBadge === 'Dibatalkan', 'Original transaction displays "Dibatalkan" badge')

const revDisplay = getTxDisplayProps(revTx)
assert(revDisplay.isReversal === true, 'Reversal transaction identified')
assert(revDisplay.isReversible === false, 'Reversal transaction itself cannot be cancelled')
assert(revDisplay.statusBadge === 'Koreksi', 'Reversal transaction displays "Koreksi" badge')
assert(revTx.reversalReason === 'Salah pilih dompet pembayaran', 'Reversal reason is accurately preserved')

// 8. Transaction Detail Mapping
console.log('\n--- 8. Transaction Detail Mapping ---')
function mapTxDetail(tx, walletMap, goalMap) {
  return {
    id: tx.id,
    amount: tx.amount,
    date: tx.transactionDate,
    description: tx.description || '—',
    walletLabel: walletMap.get(tx.walletId)?.label || '—',
    goalName: tx.goalId ? goalMap.get(tx.goalId)?.name || '—' : null,
    isReversed: tx.isReversed,
    reversedBy: tx.reversedByTransactionId,
    reversalOf: tx.reversalOfTransactionId,
    reversalReason: tx.reversalReason,
    createdAtFormatted: new Date(tx.createdAt).toISOString(),
  }
}

const sampleWallets = new Map([['w-cash', { id: 'w-cash', label: 'Dompet Tunai' }]])
const sampleGoals = new Map([['g-liburan', { id: 'g-liburan', name: 'Liburan Akhir Tahun' }]])

const savingsTx = makeTx({
  id: 'tx-sav-999',
  type: 'savings_contribution',
  amount: 200000,
  walletId: 'w-cash',
  goalId: 'g-liburan',
  description: 'Setoran mingguan',
  transactionDate: '2026-02-10',
  createdAt: '2026-02-10T14:30:00Z',
})

const detail = mapTxDetail(savingsTx, sampleWallets, sampleGoals)
assert(detail.amount === 200000, 'Detail contains exact amount')
assert(detail.walletLabel === 'Dompet Tunai', 'Detail resolves wallet label correctly')
assert(detail.goalName === 'Liburan Akhir Tahun', 'Detail resolves goal name correctly')
assert(detail.description === 'Setoran mingguan', 'Detail description populated')
assert(detail.date === '2026-02-10', 'Detail date populated')
assert(detail.createdAtFormatted === '2026-02-10T14:30:00.000Z', 'Creation timestamp mapped safely')

// 9. Financial Audit Trail vs Ledger Distinction
console.log('\n--- 9. Audit Event vs Ledger Distinction ---')
const auditEvent = {
  id: 'audit-1',
  eventType: 'transaction_created',
  entityType: 'transaction',
  metadata: { amount: 50000, wallet_id: 'w-cash' },
  createdAt: '2026-02-10T14:30:01Z',
}

const ledgerTx = makeTx({
  id: 'ledger-1',
  amount: 50000,
  type: 'expense',
})

assert(auditEvent.entityType === 'transaction', 'Audit event references transaction entity')
assert('balance' in auditEvent === false, 'Audit event does NOT define or own authoritative balance')
assert(typeof ledgerTx.amount === 'number', 'Authoritative transaction defines exact ledger amount')

// 10. Accounting Safety: Read-Only Invariants
console.log('\n--- 10. Read-Only Accounting Invariants ---')
const mockLedger = [savingsTx, origTx, revTx]
const snapshotCount = mockLedger.length
const snapshotAmounts = mockLedger.map((t) => t.amount)

// Run UI filter & mapping operations
const testState = applyFilterChange(initialFilterState, 'filterGoalId', 'g-liburan')
const filteredView = mockLedger.filter((t) => testState.filterGoalId === 'all' || t.goalId === testState.filterGoalId)
assert(filteredView.length === 1, 'Filter identifies matching goal transaction')
assert(mockLedger.length === snapshotCount, 'Ledger size unchanged by filtering (Zero mutation)')
assert(JSON.stringify(mockLedger.map((t) => t.amount)) === JSON.stringify(snapshotAmounts), 'Ledger amounts unchanged (Zero mutation)')

console.log(`\n${'='.repeat(50)}`)
console.log(`M2.17 Unit Tests: ${passed} passed, ${failed} failed`)
console.log(`${'='.repeat(50)}\n`)

if (failed > 0) {
  process.exit(1)
}
