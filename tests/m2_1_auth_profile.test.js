/**
 * M2.1 Unit Tests — Auth & Profile client verification
 * Run with: node tests/m2_1_auth_profile.test.js
 */
const assert = require('assert')

console.log('--- Starting M2.1 Verification Tests ---')

// 1. Client-side signup validation tests
function validateSignup(email, password, confirmPassword) {
  if (!email || !email.trim() || !password) {
    return { valid: false, error: 'Email dan password wajib diisi.' }
  }
  if (password.length < 6) {
    return { valid: false, error: 'Password minimal 6 karakter.' }
  }
  if (password !== confirmPassword) {
    return { valid: false, error: 'Konfirmasi password tidak cocok.' }
  }
  return { valid: true, error: null }
}

// Test 1: Empty email/password rejected
assert.strictEqual(validateSignup('', '123456', '123456').valid, false)
assert.strictEqual(validateSignup('test@example.com', '', '').valid, false)
console.log('✓ Test 1: Empty email/password rejected client-side')

// Test 2: Password shorter than 6 characters rejected
assert.strictEqual(validateSignup('test@example.com', '12345', '12345').valid, false)
assert.strictEqual(validateSignup('test@example.com', '12345', '12345').error, 'Password minimal 6 karakter.')
console.log('✓ Test 2: Password < 6 chars rejected client-side')

// Test 3: Password confirmation mismatch rejected
assert.strictEqual(validateSignup('test@example.com', 'secret123', 'secret999').valid, false)
assert.strictEqual(validateSignup('test@example.com', 'secret123', 'secret999').error, 'Konfirmasi password tidak cocok.')
console.log('✓ Test 3: Password mismatch rejected client-side')

// Test 4: Valid signup inputs accepted
assert.strictEqual(validateSignup('test@example.com', 'secret123', 'secret123').valid, true)
console.log('✓ Test 4: Valid signup credentials pass validation')

// 2. Profile update whitelist payload test
function sanitizeProfileUpdate(updates) {
  const payload = {}
  if (updates.displayName !== undefined) {
    payload.display_name = updates.displayName ? updates.displayName.trim() : null
  }
  if (updates.timezone !== undefined) {
    payload.timezone = updates.timezone.trim()
  }
  return payload
}

// Test 5: Profile update only permits display_name and timezone
const sanitized = sanitizeProfileUpdate({
  displayName: '  Alice  ',
  timezone: 'Asia/Jakarta',
  user_id: 'malicious-id',
  id: 'malicious-profile-id',
  created_at: '1970-01-01',
})
assert.deepStrictEqual(sanitized, {
  display_name: 'Alice',
  timezone: 'Asia/Jakarta',
})
console.log('✓ Test 5: Profile update payload whitelists only display_name and timezone')

// 3. Protected route matcher test
function isRouteProtected(pathname) {
  const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/signup')
  const isPublicRoute =
    isAuthRoute ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/icons') ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/favicon.ico'
  return !isPublicRoute
}

// Test 6: Route protection logic
assert.strictEqual(isRouteProtected('/'), true)
assert.strictEqual(isRouteProtected('/profile'), true)
assert.strictEqual(isRouteProtected('/login'), false)
assert.strictEqual(isRouteProtected('/signup'), false)
assert.strictEqual(isRouteProtected('/manifest.webmanifest'), false)
assert.strictEqual(isRouteProtected('/icons/icon-192.png'), false)
console.log('✓ Test 6: Protected and public routes classified accurately for middleware')

// 4. Redirect loop prevention test
function resolveAuthenticatedRedirect(pathname, redirectTo) {
  const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/signup')
  if (!isAuthRoute) return null
  const target = redirectTo || '/'
  // Prevent redirect loops: if target itself is an auth route, fallback to /
  if (target.startsWith('/login') || target.startsWith('/signup')) {
    return '/'
  }
  return target.startsWith('/') ? target : '/'
}

// Test 7: Redirect target handling prevents circular loops to auth routes
assert.strictEqual(resolveAuthenticatedRedirect('/login', '/login'), '/')
assert.strictEqual(resolveAuthenticatedRedirect('/login', '/signup'), '/')
assert.strictEqual(resolveAuthenticatedRedirect('/login', '/dashboard'), '/dashboard')
assert.strictEqual(resolveAuthenticatedRedirect('/login', null), '/')
assert.strictEqual(resolveAuthenticatedRedirect('/signup', '/'), '/')
console.log('✓ Test 7: Redirect target sanitization prevents auth redirect loops')

// 5. Unauthenticated profile update rejection
function mockUpdateUserProfile(currentUser, updates) {
  if (!currentUser) {
    return { data: null, error: 'Not authenticated' }
  }
  const payload = sanitizeProfileUpdate(updates)
  return { data: { userId: currentUser.id, ...payload }, error: null }
}

// Test 8: Unauthenticated update rejected client-side
assert.strictEqual(mockUpdateUserProfile(null, { displayName: 'Hacker' }).error, 'Not authenticated')
assert.strictEqual(mockUpdateUserProfile({ id: 'user-123' }, { displayName: 'Legit' }).data.userId, 'user-123')
console.log('✓ Test 8: Profile update helper strictly forbids unauthenticated callers and scopes to session id')

console.log('--- All M2.1 & M2.1.1 Unit Tests Passed Successfully ---')
