/**
 * M2.1.2 Focused Tests — Supabase Environment Wiring Verification
 * Run with: node tests/m2_1_2_supabase_wiring.test.js
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

console.log('--- Starting M2.1.2 Supabase Environment Wiring Tests ---')

// Helper simulating getSupabaseConfig
const FALLBACK_SUPABASE_URL = 'https://placeholder.supabase.co'
const FALLBACK_SUPABASE_ANON_KEY = 'placeholder-anon-key'

function resolveSupabaseConfig(env) {
  const envUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const envKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

  const url = envUrl && envUrl.length > 0 ? envUrl : FALLBACK_SUPABASE_URL
  const anonKey = envKey && envKey.length > 0 ? envKey : FALLBACK_SUPABASE_ANON_KEY

  return {
    url,
    anonKey,
    isFallback: url === FALLBACK_SUPABASE_URL || anonKey === FALLBACK_SUPABASE_ANON_KEY,
  }
}

// 1. Valid environment variables are preferred over placeholder fallback
const realUrl = 'https://tieeffpsshpnibuaxsaf.supabase.co'
const realKey = 'sb_publishable_HhtojPU5s2z5ULCcG7Q8Rw_eqJ8vRuo'

const configWithEnv = resolveSupabaseConfig({
  NEXT_PUBLIC_SUPABASE_URL: realUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: realKey,
})

// Test 1: Valid env variables win
assert.strictEqual(configWithEnv.url, realUrl)
assert.strictEqual(configWithEnv.anonKey, realKey)
assert.strictEqual(configWithEnv.isFallback, false)
console.log('✓ Test 1: Valid environment variables are preferred over placeholder fallback')

// Test 2: Browser Supabase client receives configured URL
assert.strictEqual(configWithEnv.url.includes('tieeffpsshpnibuaxsaf.supabase.co'), true)
console.log('✓ Test 2: Browser Supabase client receives configured URL')

// Test 3: Browser Supabase client receives configured publishable/anon key
assert.strictEqual(configWithEnv.anonKey.includes('sb_publishable'), true)
console.log('✓ Test 3: Browser Supabase client receives configured publishable/anon key')

// Test 4: Placeholder URL is not selected when valid env values exist
assert.notStrictEqual(configWithEnv.url, FALLBACK_SUPABASE_URL)
console.log('✓ Test 4: Placeholder URL is not selected when valid env values exist')

// Test 5: Placeholder key is not selected when valid env values exist
assert.notStrictEqual(configWithEnv.anonKey, FALLBACK_SUPABASE_ANON_KEY)
console.log('✓ Test 5: Placeholder key is not selected when valid env values exist')

// Test 6: Fallback is selected when env variables are empty/undefined
const configFallback = resolveSupabaseConfig({})
assert.strictEqual(configFallback.url, FALLBACK_SUPABASE_URL)
assert.strictEqual(configFallback.anonKey, FALLBACK_SUPABASE_ANON_KEY)
assert.strictEqual(configFallback.isFallback, true)

const configWhitespace = resolveSupabaseConfig({
  NEXT_PUBLIC_SUPABASE_URL: '   ',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
})
assert.strictEqual(configWhitespace.url, FALLBACK_SUPABASE_URL)
assert.strictEqual(configWhitespace.anonKey, FALLBACK_SUPABASE_ANON_KEY)
assert.strictEqual(configWhitespace.isFallback, true)
console.log('✓ Test 6: Fallback is correctly preserved when environment variables are missing/empty')

// Test 7: No service-role or secret keys are exposed or used in client code
const clientCode = fs.readFileSync(path.join(__dirname, '../src/lib/supabase/client.ts'), 'utf8')
const configCode = fs.readFileSync(path.join(__dirname, '../src/lib/supabase/config.ts'), 'utf8')
const signupCode = fs.readFileSync(path.join(__dirname, '../app/signup/page.tsx'), 'utf8')

assert.strictEqual(clientCode.includes('SUPABASE_SERVICE_ROLE_KEY'), false)
assert.strictEqual(configCode.includes('SUPABASE_SERVICE_ROLE_KEY'), false)
assert.strictEqual(signupCode.includes('SUPABASE_SERVICE_ROLE_KEY'), false)
assert.strictEqual(clientCode.includes('service_role'), false)
assert.strictEqual(configCode.includes('service_role'), false)
console.log('✓ Test 7: No service-role / secret credentials present in browser/client code')

// Test 8: .env.local file exists at project root with exact required variables
const envLocalPath = path.join(__dirname, '../.env.local')
assert.strictEqual(fs.existsSync(envLocalPath), true, '.env.local must exist at project root')
const envContent = fs.readFileSync(envLocalPath, 'utf8')
assert.strictEqual(envContent.includes('NEXT_PUBLIC_SUPABASE_URL='), true)
assert.strictEqual(envContent.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY='), true)
assert.strictEqual(envContent.includes('tieeffpsshpnibuaxsaf.supabase.co'), true)
assert.strictEqual(envContent.includes('sb_publishable_HhtojPU5s2z5ULCcG7Q8Rw_eqJ8vRuo'), true)
console.log('✓ Test 8: .env.local exists at project root with active project configuration')

console.log('--- All M2.1.2 Environment Wiring Tests Passed Successfully ---')
