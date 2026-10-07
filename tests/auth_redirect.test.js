/**
 * Auth Confirmation & Callback Redirect Tests
 *
 * Verifies:
 * A. signup provides an explicit redirect target
 * B. redirect target points to /auth/callback
 * C. localhost is not hardcoded in application source
 * D. callback route exists
 * E. callback exchanges authorization code for a session
 * F. callback redirects to safe application destination
 * G. callback failure is handled safely
 * H. middleware allows callback route
 * I. no service-role key is used client-side
 * J. no arbitrary redirect URL is accepted
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

console.log('--- Auth Confirmation Redirect Tests ---')

// A & B: Signup provides an explicit redirect target pointing to /auth/callback
const signupPath = path.join(ROOT, 'app/signup/page.tsx')
assert.ok(fs.existsSync(signupPath), 'Signup page must exist')
const signupCode = fs.readFileSync(signupPath, 'utf8')

assert.ok(
  signupCode.includes('emailRedirectTo:'),
  'signUp options must specify emailRedirectTo'
)
assert.ok(
  signupCode.includes('getAuthCallbackUrl()'),
  'signUp must resolve emailRedirectTo via getAuthCallbackUrl()'
)
console.log('✓ Test A & B: Signup provides explicit redirect target via getAuthCallbackUrl()')

// C: localhost is not hardcoded in application source files
const srcRedirect = fs.readFileSync(path.join(ROOT, 'src/lib/auth/redirect.ts'), 'utf8')
const envExample = fs.readFileSync(path.join(ROOT, '.env.local.example'), 'utf8')

assert.strictEqual(
  srcRedirect.includes('localhost'),
  false,
  'localhost must not be hardcoded in src/lib/auth/redirect.ts'
)
assert.strictEqual(
  signupCode.includes('localhost'),
  false,
  'localhost must not be hardcoded in app/signup/page.tsx'
)
assert.strictEqual(
  envExample.includes('localhost'),
  false,
  'localhost must not appear in .env.local.example'
)
console.log('✓ Test C: No hardcoded localhost in application source or env example')

// D: Callback route exists
const callbackRoutePath = path.join(ROOT, 'app/auth/callback/route.ts')
assert.ok(fs.existsSync(callbackRoutePath), 'Callback route must exist at app/auth/callback/route.ts')
const callbackCode = fs.readFileSync(callbackRoutePath, 'utf8')
console.log('✓ Test D: Auth callback route file exists')

// E: Callback exchanges authorization code for a session using Supabase SSR
assert.ok(
  callbackCode.includes('exchangeCodeForSession(code)'),
  'Callback must call exchangeCodeForSession(code)'
)
assert.ok(
  callbackCode.includes("from '@/lib/supabase/server'"),
  'Callback must use server client helper'
)
console.log('✓ Test E: Callback exchanges code using existing SSR server client')

// F & G & J: Safe destination resolution & failure handling
const { isSafeRedirect, getSiteUrl, getAuthCallbackUrl } = require('../src/lib/auth/redirect.ts')

// Testing redirect resolution logic mirroring route.ts
function resolveCallbackDestination(nextParam, origin = 'https://app.example.com') {
  const destination = nextParam && isSafeRedirect(nextParam) ? nextParam : '/'
  return new URL(destination, origin).toString()
}

// F: Redirects to safe internal destination
assert.strictEqual(
  resolveCallbackDestination('/dashboard'),
  'https://app.example.com/dashboard'
)
assert.strictEqual(
  resolveCallbackDestination(null),
  'https://app.example.com/'
)
console.log('✓ Test F: Callback redirects to safe application destinations')

// G: Failure response structure
assert.ok(
  callbackCode.includes("loginUrl.searchParams.set('error', 'auth_callback_failed')"),
  'Callback redirects to /login?error=auth_callback_failed on failure'
)
console.log('✓ Test G: Callback failure redirects safely to login with error parameter')

// H: Middleware allows callback route
const middlewarePath = path.join(ROOT, 'src/lib/supabase/middleware.ts')
const middlewareCode = fs.readFileSync(middlewarePath, 'utf8')
assert.ok(
  middlewareCode.includes("pathname.startsWith('/auth/callback')"),
  'Middleware must include /auth/callback as public route'
)
console.log('✓ Test H: Middleware permits access to /auth/callback')

// I: No service-role key client-side
const clientCode = fs.readFileSync(path.join(ROOT, 'src/lib/supabase/client.ts'), 'utf8')
assert.strictEqual(clientCode.includes('SUPABASE_SERVICE_ROLE_KEY'), false)
assert.strictEqual(signupCode.includes('SUPABASE_SERVICE_ROLE_KEY'), false)
assert.strictEqual(callbackCode.includes('SUPABASE_SERVICE_ROLE_KEY'), false)
console.log('✓ Test I: No service-role key in client or callback route')

// J: Arbitrary external redirects are rejected
assert.strictEqual(
  resolveCallbackDestination('https://evil.com'),
  'https://app.example.com/'
)
assert.strictEqual(
  resolveCallbackDestination('//evil.com'),
  'https://app.example.com/'
)
assert.strictEqual(
  resolveCallbackDestination('/login'),
  'https://app.example.com/'
)
assert.strictEqual(
  resolveCallbackDestination('/signup'),
  'https://app.example.com/'
)
console.log('✓ Test J: Open redirect vectors and auth loops rejected')

// URL helper tests
assert.ok(typeof getSiteUrl === 'function')
assert.ok(typeof getAuthCallbackUrl === 'function')

console.log('--- All Auth Confirmation Redirect Tests Passed Successfully ---')
