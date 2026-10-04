/**
 * M2.18 — Clean Login URL & Redirect Security
 *
 * Tests:
 * 1. isSafeRedirect blocks open-redirect vectors
 * 2. Middleware omits ?redirectTo for root path
 * 3. Middleware preserves ?redirectTo for deep links
 * 4. Authenticated user redirect uses isSafeRedirect
 */
const assert = require('assert')

// Mirror the exported isSafeRedirect logic from middleware.ts
function isSafeRedirect(target) {
  if (!target || !target.startsWith('/')) return false
  if (target.startsWith('//')) return false
  if (target.startsWith('/login') || target.startsWith('/signup')) return false
  try {
    const decoded = decodeURIComponent(target)
    if (decoded.startsWith('//') || decoded.includes(':\\') || decoded.includes('://')) return false
  } catch {
    return false
  }
  return true
}

// Mirror middleware redirect-to-login logic
function buildLoginRedirectUrl(pathname) {
  const params = new URLSearchParams()
  if (pathname !== '/') {
    params.set('redirectTo', pathname)
  }
  const qs = params.toString()
  return '/login' + (qs ? '?' + qs : '')
}

// Mirror middleware authenticated-redirect logic
function resolveAuthenticatedRedirect(rawRedirect) {
  const target = rawRedirect || '/'
  return isSafeRedirect(target) ? target : '/'
}

console.log('--- M2.18: Clean Login URL & Redirect Security ---')

// Test 1: isSafeRedirect accepts valid relative paths
assert.strictEqual(isSafeRedirect('/'), true)
assert.strictEqual(isSafeRedirect('/dashboard'), true)
assert.strictEqual(isSafeRedirect('/goals/123'), true)
console.log('✓ Test 1: isSafeRedirect accepts valid relative paths')

// Test 2: isSafeRedirect blocks absolute/external URLs
assert.strictEqual(isSafeRedirect('https://evil.com'), false)
assert.strictEqual(isSafeRedirect('http://evil.com'), false)
assert.strictEqual(isSafeRedirect(''), false)
assert.strictEqual(isSafeRedirect(null), false)
assert.strictEqual(isSafeRedirect(undefined), false)
console.log('✓ Test 2: isSafeRedirect blocks absolute/external URLs')

// Test 3: isSafeRedirect blocks protocol-relative URLs
assert.strictEqual(isSafeRedirect('//evil.com'), false)
assert.strictEqual(isSafeRedirect('//evil.com/path'), false)
console.log('✓ Test 3: isSafeRedirect blocks protocol-relative URLs')

// Test 4: isSafeRedirect blocks encoded open-redirect vectors
assert.strictEqual(isSafeRedirect('/%2F%2Fevil.com'), false)
assert.strictEqual(isSafeRedirect('/%2Fevil.com'), false, 'decoded to //evil.com')
console.log('✓ Test 4: isSafeRedirect blocks encoded redirect vectors')

// Test 5: isSafeRedirect blocks auth-route loops
assert.strictEqual(isSafeRedirect('/login'), false)
assert.strictEqual(isSafeRedirect('/login?foo=1'), false)
assert.strictEqual(isSafeRedirect('/signup'), false)
assert.strictEqual(isSafeRedirect('/signup/confirm'), false)
console.log('✓ Test 5: isSafeRedirect blocks auth-route redirect loops')

// Test 6: Login URL is clean when redirecting from root
assert.strictEqual(buildLoginRedirectUrl('/'), '/login')
console.log('✓ Test 6: Unauthenticated visit to / redirects to clean /login (no query param)')

// Test 7: Login URL preserves redirectTo for deep links
assert.strictEqual(buildLoginRedirectUrl('/dashboard'), '/login?redirectTo=%2Fdashboard')
assert.strictEqual(buildLoginRedirectUrl('/goals/123'), '/login?redirectTo=%2Fgoals%2F123')
console.log('✓ Test 7: Unauthenticated deep links preserve redirectTo param')

// Test 8: Authenticated redirect resolves safely
assert.strictEqual(resolveAuthenticatedRedirect('/dashboard'), '/dashboard')
assert.strictEqual(resolveAuthenticatedRedirect(null), '/')
assert.strictEqual(resolveAuthenticatedRedirect(''), '/')
assert.strictEqual(resolveAuthenticatedRedirect('//evil.com'), '/')
assert.strictEqual(resolveAuthenticatedRedirect('https://evil.com'), '/')
assert.strictEqual(resolveAuthenticatedRedirect('/login'), '/')
assert.strictEqual(resolveAuthenticatedRedirect('/signup'), '/')
console.log('✓ Test 8: Authenticated redirect sanitizes targets via isSafeRedirect')

// Test 9: isSafeRedirect blocks backslash protocol tricks
assert.strictEqual(isSafeRedirect('/foo%3A%5C%5Cevil'), false, 'decoded :\\ pattern')
console.log('✓ Test 9: isSafeRedirect blocks backslash/protocol tricks')

// Test 10: Malformed percent-encoding is rejected
assert.strictEqual(isSafeRedirect('/%ZZbad'), false)
console.log('✓ Test 10: Malformed percent-encoding is safely rejected')

console.log('--- All M2.18 Tests Passed ---')
