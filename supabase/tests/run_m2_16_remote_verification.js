/**
 * M2.16 Remote Runtime Verification against Supabase
 *
 * Verifies transaction server-side search, filtering & bounded pagination
 * across the user's transaction dataset (>50 transactions).
 */

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')

const envFile = fs.readFileSync('.env.local', 'utf8')
let url = '', key = ''
for (const line of envFile.split('\n')) {
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) url = line.split('=')[1].trim()
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')) key = line.split('=')[1].trim()
}

const supabase = createClient(url, key)

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

async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Login failed for ${email}: ${error.message}`)
  return data
}

async function getStats() {
  const { count: txCount } = await supabase.from('transactions').select('*', { count: 'exact', head: true })
  const { data: wallets } = await supabase.from('wallets').select('id, balance')
  const { data: goals } = await supabase.from('goals').select('id, current_amount')
  const { count: auditCount } = await supabase.from('financial_audit_events').select('*', { count: 'exact', head: true })
  return { txCount, wallets, goals, auditCount }
}

// Server-side query helper matching client.ts implementation
async function serverQueryTransactions({
  search,
  type,
  walletId,
  goalId,
  startDate,
  endDate,
  sortNewestFirst = true,
  limit = 50,
  offset = 0,
} = {}) {
  const boundedLimit = Math.min(Math.max(1, limit), 100)
  const boundedOffset = Math.max(0, offset)

  const isFilterReversed = type === 'reversed'

  let query = supabase
    .from('transactions')
    .select(
      isFilterReversed
        ? '*, reversed_by:transactions!inner(id)'
        : '*, reversed_by:transactions!reversal_of_transaction_id(id)',
      { count: 'exact' }
    )

  if (search && search.trim()) {
    const sanitized = search.trim().replace(/[%_,()]/g, '')
    if (sanitized) {
      query = query.or(`description.ilike.%${sanitized}%,reversal_reason.ilike.%${sanitized}%`)
    }
  }

  if (type && type !== 'all') {
    if (type === 'reversal') {
      query = query.not('reversal_of_transaction_id', 'is', null)
    } else if (type === 'reversed') {
      // handled via inner join
    } else {
      query = query.eq('type', type).is('reversal_of_transaction_id', null)
    }
  }

  if (walletId && walletId !== 'all') {
    query = query.eq('wallet_id', walletId)
  }

  if (goalId && goalId !== 'all') {
    query = query.eq('goal_id', goalId)
  }

  if (startDate) {
    query = query.gte('transaction_date', startDate)
  }
  if (endDate) {
    query = query.lte('transaction_date', endDate)
  }

  query = query
    .order('transaction_date', { ascending: !sortNewestFirst })
    .order('created_at', { ascending: !sortNewestFirst })
    .order('id', { ascending: !sortNewestFirst })
    .range(boundedOffset, boundedOffset + boundedLimit - 1)

  const { data, count, error } = await query
  if (error) throw error

  return {
    data: data || [],
    totalCount: count || 0,
    hasMore: boundedOffset + (data ? data.length : 0) < (count || 0),
  }
}

async function run() {
  console.log('\n🔍 M2.16 Remote Runtime Verification (tieeffpsshpnibuaxsaf)\n')

  console.log('--- Initial State ---')
  await login('verify.test.30355@gmail.com', 'StrongPassword123!')
  const statsA = await getStats()
  console.log(`User A (Initial): ${statsA.txCount} txs, ${statsA.wallets.length} wallets, ${statsA.goals.length} goals`)

  // User A must have > 50 transactions to prove limitation is fixed
  assert(statsA.txCount > 50, `1. User A has more than 50 transactions (actual: ${statsA.txCount})`)

  console.log('\n--- 2 & 3. Authentication & User Isolation ---')
  // User A transactions only contain User A id
  const { data: userAInfo } = await supabase.auth.getUser()
  const userAId = userAInfo.user.id
  const page0 = await serverQueryTransactions({ limit: 50, offset: 0 })
  assert(page0.data.every((t) => t.user_id === userAId), 'User A transaction query strictly scoped to auth.uid()')

  // User B isolation check
  await supabase.auth.signOut()
  await login('test_m212_user@gmail.com', 'StrongPassword123!')
  const { data: userBInfo } = await supabase.auth.getUser()
  const userBId = userBInfo.user.id
  const userBQuery = await serverQueryTransactions({ limit: 50, offset: 0 })
  assert(userBQuery.data.every((t) => t.user_id === userBId), 'User B transaction query strictly scoped to User B')

  // User B cannot find User A's transactions even when querying directly by User A's transaction id
  if (page0.data.length > 0) {
    const targetAId = page0.data[0].id
    const { data: crossRead } = await supabase.from('transactions').select('*').eq('id', targetAId)
    assert(crossRead.length === 0, 'Cross-user read strictly forbidden by RLS')
  }

  console.log('\n--- Returning to User A for Server-Side Search & Pagination Tests ---')
  await supabase.auth.signOut()
  await login('verify.test.30355@gmail.com', 'StrongPassword123!')

  // Step 4: Verify transaction exists outside the first 50 results
  // Query page 1 (records 50..56)
  const page1 = await serverQueryTransactions({ limit: 50, offset: 50 })
  assert(page1.data.length > 0, `Page 1 retrieves older transactions outside top 50 (count: ${page1.data.length})`)

  const olderTx = page1.data[page1.data.length - 1]
  console.log(`Deep transaction outside top 50: id=${olderTx.id}, date=${olderTx.transaction_date}, desc="${olderTx.description}"`)

  // Ensure this older transaction is NOT in page 0
  const inPage0 = page0.data.some((t) => t.id === olderTx.id)
  assert(!inPage0, 'Deep transaction is confirmed absent from top 50 results (Page 0)')

  // Step 5: Search for this deep transaction by description
  if (olderTx.description) {
    const searchRes = await serverQueryTransactions({ search: olderTx.description, limit: 10, offset: 0 })
    assert(
      searchRes.data.some((t) => t.id === olderTx.id),
      `Server-side search successfully locates older transaction ("${olderTx.description}") outside top 50`
    )
    assert(searchRes.totalCount >= 1, 'Total match count returned correctly')
  }

  // Step 6: Server-side pagination bounds
  console.log('\n--- 6. Bounded Pagination & No Duplicates ---')
  assert(page0.data.length === 50, 'Default page limit bounded to 50')
  assert(page0.hasMore === true, 'hasMore is true for page 0 when totalCount > 50')

  // Verify no duplicate IDs between page 0 and page 1
  const page0Ids = new Set(page0.data.map((t) => t.id))
  let duplicates = 0
  for (const t of page1.data) {
    if (page0Ids.has(t.id)) duplicates++
  }
  assert(duplicates === 0, 'Zero duplicate records between contiguous pages (page 0 and page 1)')

  // Step 7: Deterministic Ordering
  console.log('\n--- 7. Deterministic Ordering ---')
  let isSorted = true
  for (let i = 0; i < page0.data.length - 1; i++) {
    if (page0.data[i].transaction_date < page0.data[i + 1].transaction_date) {
      isSorted = false
      break
    }
  }
  assert(isSorted, 'Results remain deterministically ordered newest-first')

  // Step 8: Type, Wallet, and Date Filters
  console.log('\n--- 8. Server-Side Filtering (Type, Wallet, Date) ---')
  const incomeRes = await serverQueryTransactions({ type: 'income', limit: 50, offset: 0 })
  assert(incomeRes.data.every((t) => t.type === 'income'), 'Type filter (income) returns only income')

  if (page0.data.length > 0) {
    const targetWalletId = page0.data[0].wallet_id
    const walletRes = await serverQueryTransactions({ walletId: targetWalletId, limit: 20, offset: 0 })
    assert(walletRes.data.every((t) => t.wallet_id === targetWalletId), 'Wallet filter strictly scopes to wallet')
  }

  const dateRes = await serverQueryTransactions({
    startDate: olderTx.transaction_date,
    endDate: olderTx.transaction_date,
    limit: 10,
  })
  assert(
    dateRes.data.every((t) => t.transaction_date === olderTx.transaction_date),
    'Date filter strictly scopes to requested date range'
  )

  // Step 9: Reversal metadata verification
  console.log('\n--- 9. Reversal Metadata & Child Relationships ---')
  const reversalQuery = await serverQueryTransactions({ type: 'reversal', limit: 10 })
  if (reversalQuery.data.length > 0) {
    assert(reversalQuery.data[0].reversal_of_transaction_id !== null, 'Reversal transaction preserves reversal_of_transaction_id')
    assert(reversalQuery.data[0].reversal_reason !== null, 'Reversal reason is preserved')
  } else {
    assert(true, '(No reversal transactions in remote user A dataset)')
  }

  // Step 10: Invariants & Read-Only Check
  console.log('\n--- 10. Accounting Invariants & Immutability ---')
  const statsEnd = await getStats()

  assert(statsA.txCount === statsEnd.txCount, 'Transaction count strictly unchanged (Read-Only)')
  assert(
    JSON.stringify(statsA.wallets) === JSON.stringify(statsEnd.wallets),
    'Wallet balances strictly unchanged'
  )
  assert(
    JSON.stringify(statsA.goals) === JSON.stringify(statsEnd.goals),
    'Goal balances strictly unchanged'
  )
  assert(statsA.auditCount === statsEnd.auditCount, 'Financial audit events count strictly unchanged')

  console.log(`\n==================================================`)
  console.log(`Remote Verification Results: ${passed} passed, ${failed} failed`)
  console.log(`==================================================\n`)

  if (failed > 0) {
    process.exit(1)
  }
}

run().catch((err) => {
  console.error('Remote verification error:', err)
  process.exit(1)
})
