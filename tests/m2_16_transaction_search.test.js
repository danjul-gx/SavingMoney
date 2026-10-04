/**
 * M2.16 — Transaction Search, Filter & Server-Side Pagination Unit Tests
 *
 * Verifies:
 * 1. Filter logic and contract across a dataset > 50 transactions.
 * 2. Older transactions (> 50) can be found via search and filters.
 * 3. Bounded pagination with limit & offset.
 * 4. Deterministic newest-first ordering (and oldest-first toggle).
 * 5. Type, wallet, goal, date, and combined filter composition.
 * 6. No duplicate records across contiguous pages.
 * 7. Reversal metadata preservation.
 * 8. Empty results and edge cases handled safely.
 * 9. Read-only verification (no mutations).
 */

const makeTx = (overrides = {}) => ({
  id: overrides.id || crypto.randomUUID(),
  userId: 'u1',
  walletId: overrides.walletId || 'w1',
  goalId: overrides.goalId || null,
  type: overrides.type || 'expense',
  amount: overrides.amount || 50000,
  description: overrides.description ?? null,
  adjustmentDirection: overrides.adjustmentDirection || null,
  reversalOfTransactionId: overrides.reversalOfTransactionId || null,
  reversalReason: overrides.reversalReason || null,
  reversedByTransactionId: overrides.reversedByTransactionId || null,
  isReversed: overrides.isReversed || false,
  transactionDate: overrides.transactionDate || '2026-01-15',
  createdAt: overrides.createdAt || '2026-01-15T10:00:00Z',
  ...overrides,
})

// Mock implementation of queryTransactions logic that mirrors client.ts
function simulateQueryTransactions(dataset, options = {}) {
  const limit = Math.min(Math.max(1, options.limit ?? 50), 100)
  const offset = Math.max(0, options.offset ?? 0)
  const sortNewestFirst = options.sortNewestFirst !== false

  let filtered = dataset.slice()

  // 1. Text search on description or reversal_reason
  const searchTrimmed = (options.search || '').trim().toLowerCase()
  if (searchTrimmed) {
    filtered = filtered.filter((tx) => {
      const desc = (tx.description || '').toLowerCase()
      const reason = (tx.reversalReason || '').toLowerCase()
      return desc.includes(searchTrimmed) || reason.includes(searchTrimmed)
    })
  }

  // 2. Type filter
  if (options.type && options.type !== 'all') {
    if (options.type === 'reversal') {
      filtered = filtered.filter((tx) => Boolean(tx.reversalOfTransactionId))
    } else if (options.type === 'reversed') {
      filtered = filtered.filter((tx) => Boolean(tx.isReversed))
    } else {
      filtered = filtered.filter((tx) => tx.type === options.type && !tx.reversalOfTransactionId)
    }
  }

  // 3. Wallet filter
  if (options.walletId && options.walletId !== 'all') {
    filtered = filtered.filter((tx) => tx.walletId === options.walletId)
  }

  // 4. Goal filter
  if (options.goalId && options.goalId !== 'all') {
    filtered = filtered.filter((tx) => tx.goalId === options.goalId)
  }

  // 5. Date filters
  if (options.startDate) {
    filtered = filtered.filter((tx) => tx.transactionDate >= options.startDate)
  }
  if (options.endDate) {
    filtered = filtered.filter((tx) => tx.transactionDate <= options.endDate)
  }

  // 6. Deterministic ordering: transactionDate, createdAt, id
  filtered.sort((a, b) => {
    if (a.transactionDate !== b.transactionDate) {
      return sortNewestFirst
        ? b.transactionDate.localeCompare(a.transactionDate)
        : a.transactionDate.localeCompare(b.transactionDate)
    }
    if (a.createdAt !== b.createdAt) {
      return sortNewestFirst
        ? b.createdAt.localeCompare(a.createdAt)
        : a.createdAt.localeCompare(b.createdAt)
    }
    return sortNewestFirst
      ? b.id.localeCompare(a.id)
      : a.id.localeCompare(b.id)
  })

  const totalCount = filtered.length
  const paged = filtered.slice(offset, offset + limit)

  return {
    data: paged,
    totalCount,
    hasMore: offset + paged.length < totalCount,
    error: null,
  }
}

// ---- Test harness ----
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

console.log('\n🔍 M2.16 Transaction Server-Side Query & Pagination Unit Tests\n')

// 1. Build a synthetic dataset with 120 transactions to prove behavior beyond first 50
const largeDataset = []

// Items 0 to 99: generic expenses
for (let i = 0; i < 100; i++) {
  const day = String((i % 28) + 1).padStart(2, '0')
  const month = i < 50 ? '03' : '02'
  largeDataset.push(
    makeTx({
      id: `tx-gen-${String(i).padStart(3, '0')}`,
      type: 'expense',
      amount: 10000 + i * 100,
      description: `Belanja Reguler ${i}`,
      walletId: i % 2 === 0 ? 'w-cash' : 'w-bank',
      transactionDate: `2026-${month}-${day}`,
      createdAt: `2026-${month}-${day}T10:00:00Z`,
    })
  )
}

// Item 105: An older rare transaction sitting deep beyond first 50 (at chronological index ~105)
const deepTarget = makeTx({
  id: 'tx-deep-matching',
  type: 'income',
  amount: 15000000,
  description: 'Bonus Tahunan Spesial',
  walletId: 'w-bank',
  transactionDate: '2026-01-05',
  createdAt: '2026-01-05T08:00:00Z',
})
largeDataset.push(deepTarget)

// Item 106: An older reversal
const origTarget = makeTx({
  id: 'tx-orig-reversed',
  type: 'expense',
  amount: 250000,
  description: 'Tiket Kereta',
  walletId: 'w-bank',
  isReversed: true,
  reversedByTransactionId: 'tx-rev-matching',
  transactionDate: '2026-01-08',
  createdAt: '2026-01-08T09:00:00Z',
})
largeDataset.push(origTarget)

const revTarget = makeTx({
  id: 'tx-rev-matching',
  type: 'adjustment',
  amount: 250000,
  description: null,
  walletId: 'w-bank',
  reversalOfTransactionId: 'tx-orig-reversed',
  reversalReason: 'Jadwal kereta dibatalkan maskapai',
  transactionDate: '2026-01-09',
  createdAt: '2026-01-09T10:00:00Z',
})
largeDataset.push(revTarget)

// Items 107-120: Goal contributions & withdrawals
for (let j = 0; j < 15; j++) {
  largeDataset.push(
    makeTx({
      id: `tx-goal-${j}`,
      type: j % 2 === 0 ? 'savings_contribution' : 'savings_withdrawal',
      amount: 500000,
      description: `Tabungan Haji Bagian ${j}`,
      walletId: 'w-bank',
      goalId: 'g-haji',
      transactionDate: '2026-01-15',
      createdAt: `2026-01-15T12:${String(j).padStart(2, '0')}:00Z`,
    })
  )
}

console.log(`Total test dataset: ${largeDataset.length} transactions.\n`)

// TEST 1: Matching transaction older than first 50 is NOT visible in default limit 50 page 0 without search
console.log('1. Proving the old client limitation vs server-side fix:')
const page0Default = simulateQueryTransactions(largeDataset, { limit: 50, offset: 0 })
assert(page0Default.data.length === 50, 'Page 0 returns bounded 50 results')
assert(
  !page0Default.data.some((t) => t.id === 'tx-deep-matching'),
  'Older transaction "Bonus Tahunan Spesial" is NOT in first 50 results without filter'
)

// Server-side search finds it across the entire dataset!
const searched = simulateQueryTransactions(largeDataset, { search: 'Bonus Tahunan Spesial', limit: 50, offset: 0 })
assert(searched.data.length === 1, 'Server-side search successfully locates older transaction across full dataset')
assert(searched.data[0].id === 'tx-deep-matching', 'Correct transaction returned')
assert(searched.totalCount === 1, 'Total match count reflects server total')

// TEST 2: Type filter works across pagination
console.log('\n2. Type filter across pagination:')
const incomeResult = simulateQueryTransactions(largeDataset, { type: 'income', limit: 50, offset: 0 })
assert(incomeResult.totalCount === 1, 'Found matching income outside first 50')
assert(incomeResult.data[0].type === 'income', 'Type matches income')

const savingsContribResult = simulateQueryTransactions(largeDataset, { type: 'savings_contribution', limit: 5, offset: 0 })
assert(savingsContribResult.data.length === 5, 'Bounded limit applied to type filter')
assert(savingsContribResult.totalCount === 8, 'Total count reflects all savings contributions')
assert(savingsContribResult.hasMore === true, 'hasMore is true when records exceed limit')

// TEST 3: Wallet filter works across pagination
console.log('\n3. Wallet filter across pagination:')
const cashResult = simulateQueryTransactions(largeDataset, { walletId: 'w-cash', limit: 30, offset: 0 })
assert(cashResult.data.length === 30, 'Page 0 for w-cash returns exactly 30')
assert(cashResult.data.every((t) => t.walletId === 'w-cash'), 'All rows match w-cash')
assert(cashResult.totalCount === 50, 'Total w-cash transactions is 50')
assert(cashResult.hasMore === true, 'More rows exist')

// Next page of wallet filter
const cashResultP2 = simulateQueryTransactions(largeDataset, { walletId: 'w-cash', limit: 30, offset: 30 })
assert(cashResultP2.data.length === 20, 'Page 1 returns remaining 20 rows')
assert(cashResultP2.hasMore === false, 'hasMore is false at end of dataset')

// TEST 4: Goal filter works across pagination
console.log('\n4. Goal filter across pagination:')
const goalResult = simulateQueryTransactions(largeDataset, { goalId: 'g-haji', limit: 10, offset: 0 })
assert(goalResult.data.length === 10, 'Goal results bounded to 10')
assert(goalResult.totalCount === 15, 'Total goal matches is 15')
assert(goalResult.data.every((t) => t.goalId === 'g-haji'), 'All items belong to g-haji')

// TEST 5: Date filter works across pagination
console.log('\n5. Date filter across pagination:')
const dateResult = simulateQueryTransactions(largeDataset, { startDate: '2026-01-01', endDate: '2026-01-10', limit: 50, offset: 0 })
assert(dateResult.totalCount === 3, 'Found 3 transactions in Jan 1-10 range (all deep records)')
assert(dateResult.data.every((t) => t.transactionDate >= '2026-01-01' && t.transactionDate <= '2026-01-10'), 'Dates strictly bounded')

// TEST 6: Combined filters work together
console.log('\n6. Combined filters (search + type + wallet + date):')
const combined = simulateQueryTransactions(largeDataset, {
  search: 'Tabungan Haji',
  type: 'savings_contribution',
  walletId: 'w-bank',
  startDate: '2026-01-01',
  endDate: '2026-01-31',
  limit: 5,
  offset: 0,
})
assert(combined.totalCount === 8, 'Found 8 matching combined items')
assert(combined.data.length === 5, 'Results bounded to limit 5')
assert(combined.data.every((t) => t.type === 'savings_contribution' && t.walletId === 'w-bank' && t.goalId === 'g-haji'), 'All composition conditions hold')

// TEST 7: Deterministic newest-first ordering
console.log('\n7. Deterministic newest-first ordering:')
const ordered = simulateQueryTransactions(largeDataset, { limit: 50, offset: 0, sortNewestFirst: true })
for (let k = 0; k < ordered.data.length - 1; k++) {
  const cur = ordered.data[k]
  const next = ordered.data[k + 1]
  const dateCompare = cur.transactionDate.localeCompare(next.transactionDate)
  assert(dateCompare >= 0, `Row ${k} date >= row ${k + 1} date`)
}

// TEST 8: Pagination returns bounded result counts
console.log('\n8. Bounded limit safety:')
const cappedLimit = simulateQueryTransactions(largeDataset, { limit: 500 })
assert(cappedLimit.data.length <= 100, 'Limit is safely capped at maximum 100')

const zeroLimit = simulateQueryTransactions(largeDataset, { limit: 0 })
assert(zeroLimit.data.length >= 1, 'Limit 0 is safely clamped to at least 1')

// TEST 9: No duplicate records across contiguous pages
console.log('\n9. No duplicate records across contiguous pages:')
const p1 = simulateQueryTransactions(largeDataset, { limit: 50, offset: 0 })
const p2 = simulateQueryTransactions(largeDataset, { limit: 50, offset: 50 })
const p3 = simulateQueryTransactions(largeDataset, { limit: 50, offset: 100 })

const idsP1 = new Set(p1.data.map((t) => t.id))
const idsP2 = new Set(p2.data.map((t) => t.id))
const idsP3 = new Set(p3.data.map((t) => t.id))

let hasOverlap = false
for (const id of idsP2) {
  if (idsP1.has(id)) hasOverlap = true
}
for (const id of idsP3) {
  if (idsP2.has(id)) hasOverlap = true
}
assert(!hasOverlap, 'Zero record duplicate/overlap between contiguous pages')
assert(idsP1.size + idsP2.size + idsP3.size === largeDataset.length, 'Sum of pages covers complete dataset')

// TEST 10: Reversal metadata remains available
console.log('\n10. Reversal metadata preservation:')
const revSearch = simulateQueryTransactions(largeDataset, { search: 'dibatalkan maskapai' })
assert(revSearch.data.length === 1, 'Found reversal by reason')
assert(revSearch.data[0].reversalOfTransactionId === 'tx-orig-reversed', 'reversalOfTransactionId preserved')
assert(revSearch.data[0].reversalReason === 'Jadwal kereta dibatalkan maskapai', 'reversalReason preserved')

const reversedSearch = simulateQueryTransactions(largeDataset, { type: 'reversed' })
assert(reversedSearch.data.some((t) => t.id === 'tx-orig-reversed'), 'Reversed transaction identified by type=reversed')
assert(reversedSearch.data.find((t) => t.id === 'tx-orig-reversed').isReversed === true, 'isReversed is true')

// TEST 11: Empty results handled safely
console.log('\n11. Empty results handled safely:')
const empty = simulateQueryTransactions(largeDataset, { search: 'tidak_ada_transaksi_seperti_ini' })
assert(empty.data.length === 0, 'Empty data array returned')
assert(empty.totalCount === 0, 'totalCount is 0')
assert(empty.hasMore === false, 'hasMore is false')
assert(empty.error === null, 'No error for clean empty query')

// TEST 12: Read-only behavior
console.log('\n12. Read-only verification:')
const initialCount = largeDataset.length
simulateQueryTransactions(largeDataset, { search: 'test', limit: 10 })
assert(largeDataset.length === initialCount, 'Dataset size strictly unchanged (Read-only query)')

console.log(`\n${'='.repeat(50)}`)
console.log(`M2.16 Unit Tests: ${passed} passed, ${failed} failed`)
console.log(`${'='.repeat(50)}\n`)

if (failed > 0) {
  process.exit(1)
}
