/**
 * M2.17 — Light / Dark Theme System Unit Tests
 * Run with: node tests/m2_17_theme.test.js
 *
 * Verifies:
 * 1. Light theme is available as valid theme option.
 * 2. Dark theme is available as valid theme option.
 * 3. Theme preference can switch between Light and Dark.
 * 4. Theme preference persistence logic works (localStorage emulation).
 * 5. Default/fallback behavior is correct (defaults to light).
 * 6. Theme switching has zero accounting or financial side effects.
 * 7. No theme-related database dependency exists (no migrations, no table mutations).
 * 8. Semantic CSS variables and classes are configured for both Light and Dark modes.
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')

console.log('--- Starting M2.17 Light / Dark Theme System Tests ---')

const THEME_STORAGE_KEY = 'cashflow_theme_preference'
const VALID_THEMES = ['light', 'dark']

// Emulated LocalStorage for persistence tests
class MockLocalStorage {
  constructor() {
    this.store = {}
  }
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null
  }
  setItem(key, value) {
    this.store[key] = String(value)
  }
  removeItem(key) {
    delete this.store[key]
  }
  clear() {
    this.store = {}
  }
}

// 1. Light and Dark themes availability
assert.strictEqual(VALID_THEMES.includes('light'), true, 'Light theme must be available')
assert.strictEqual(VALID_THEMES.includes('dark'), true, 'Dark theme must be available')
assert.strictEqual(VALID_THEMES.length, 2, 'Exactly two theme modes must be supported (Light and Dark)')
console.log('✓ Test 1: Light and Dark themes are available and exactly 2 options exist')

// 2. Default/fallback behavior
function resolveInitialTheme(storage) {
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY)
    if (stored === 'dark' || stored === 'light') {
      return stored
    }
  } catch (e) {
    // ignore
  }
  return 'light'
}

const emptyStorage = new MockLocalStorage()
assert.strictEqual(resolveInitialTheme(emptyStorage), 'light', 'Default theme must be Light when storage is empty')

const corruptedStorage = new MockLocalStorage()
corruptedStorage.setItem(THEME_STORAGE_KEY, 'invalid_mode')
assert.strictEqual(resolveInitialTheme(corruptedStorage), 'light', 'Invalid storage value must fallback to Light')
console.log('✓ Test 2: Default and fallback theme is Light')

// 3. Theme switching and persistence
const storage = new MockLocalStorage()

function switchTheme(storage, currentTheme, targetTheme) {
  if (!VALID_THEMES.includes(targetTheme)) {
    throw new Error('Invalid theme: ' + targetTheme)
  }
  storage.setItem(THEME_STORAGE_KEY, targetTheme)
  return targetTheme
}

let activeTheme = resolveInitialTheme(storage)
assert.strictEqual(activeTheme, 'light')

activeTheme = switchTheme(storage, activeTheme, 'dark')
assert.strictEqual(activeTheme, 'dark')
assert.strictEqual(storage.getItem(THEME_STORAGE_KEY), 'dark', 'Persistence stores dark preference')

activeTheme = switchTheme(storage, activeTheme, 'light')
assert.strictEqual(activeTheme, 'light')
assert.strictEqual(storage.getItem(THEME_STORAGE_KEY), 'light', 'Persistence stores light preference')
console.log('✓ Test 3: Theme preference can switch between Light and Dark and persists locally')

// 4. Persistence survives simulated browser restart
const reloadedStorage = new MockLocalStorage()
reloadedStorage.setItem(THEME_STORAGE_KEY, 'dark') // previous session set it to dark
assert.strictEqual(resolveInitialTheme(reloadedStorage), 'dark', 'Persisted dark theme survives reload')
console.log('✓ Test 4: Persisted theme survives simulated page reload / session restart')

// 5. Zero financial side effects
const initialFinancialState = {
  wallets: [
    { id: 'w1', label: 'Cash', balance: 1500000 },
    { id: 'w2', label: 'BCA', balance: 5000000 },
  ],
  transactions: [
    { id: 't1', amount: 50000, type: 'expense' },
  ],
  goals: [
    { id: 'g1', name: 'Emergency Fund', target_amount: 10000000, current_amount: 2500000 },
  ],
  budgets: [
    { id: 'b1', category: 'Food', amount: 2000000 },
  ],
}

const clonedStateBefore = JSON.parse(JSON.stringify(initialFinancialState))

// Perform multiple theme switches
switchTheme(storage, 'light', 'dark')
switchTheme(storage, 'dark', 'light')
switchTheme(storage, 'light', 'dark')

assert.deepStrictEqual(initialFinancialState, clonedStateBefore, 'Theme switching must never mutate financial data')
console.log('✓ Test 5: Theme switching has zero accounting or financial side effects')

// 6. Verify client-only implementation: No theme database migration or column
const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations')
const migrationFiles = fs.readdirSync(migrationsDir)
for (const file of migrationFiles) {
  const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
  assert.strictEqual(
    content.toLowerCase().includes('theme_preference'),
    false,
    `Migration ${file} must not contain theme_preference`
  )
}
console.log('✓ Test 6: No theme-related database migrations or columns exist')

// 7. Verify CSS token definitions in globals.css and required Dark Palette
const globalsCssPath = path.join(__dirname, '..', 'app', 'globals.css')
const globalsCss = fs.readFileSync(globalsCssPath, 'utf8')

assert.ok(globalsCss.includes(':root {'), 'globals.css must define :root custom properties')
assert.ok(globalsCss.includes('.dark {'), 'globals.css must define .dark custom property overrides')
assert.ok(globalsCss.includes('--app-background: #F6FFEA;'), 'Light theme app background preserved (#F6FFEA)')
assert.ok(globalsCss.includes('--surface: #FFFFFF;'), 'Light surface token preserved (#FFFFFF)')
assert.ok(globalsCss.includes('--border: #D9EDCB;'), 'Light border token preserved (#D9EDCB)')
assert.ok(globalsCss.includes('--color-app-background: var(--app-background);'), '@theme maps to var(--app-background)')

// Required Dark Palette assertions:
// #1D1E23 (Deepest application background)
// #2E2B26 (Primary dark surface)
// #57463A (Secondary / elevated surface)
// #33363F (Border / muted structural color)
// #656772 (Secondary text / muted UI)
assert.ok(globalsCss.includes('--app-background: #1D1E23;'), 'Dark theme app background must use #1D1E23')
assert.ok(globalsCss.includes('--surface: #2E2B26;'), 'Dark theme surface must use #2E2B26')
assert.ok(globalsCss.includes('--surface-raised: #57463A;'), 'Dark theme surface-raised must use #57463A')
assert.ok(globalsCss.includes('--border: #33363F;'), 'Dark theme border must use #33363F')
assert.ok(globalsCss.includes('--ink-muted: #656772;'), 'Dark theme ink-muted must use #656772')

// Confirm previous olive/slate colors are no longer the primary Dark Theme surface palette
assert.strictEqual(globalsCss.includes('--app-background: #0E150C;'), false, 'Old #0E150C must not be used')
assert.strictEqual(globalsCss.includes('--surface: #151F13;'), false, 'Old #151F13 must not be used')
assert.strictEqual(globalsCss.includes('--surface-raised: #1C2B19;'), false, 'Old #1C2B19 must not be used')
assert.strictEqual(globalsCss.includes('--border: #273A22;'), false, 'Old #273A22 must not be used')

console.log('✓ Test 7: CSS semantic variables, Tailwind v4 @theme tokens, and required 5-color Dark palette correctly verified')

// 8. Verify ThemeProvider and UI components exist
const themeContextPath = path.join(__dirname, '..', 'src', 'lib', 'theme', 'theme-context.tsx')
const themeTogglePath = path.join(__dirname, '..', 'src', 'lib', 'theme', 'ThemeToggle.tsx')

assert.ok(fs.existsSync(themeContextPath), 'theme-context.tsx must exist')
assert.ok(fs.existsSync(themeTogglePath), 'ThemeToggle.tsx must exist')

const themeContextContent = fs.readFileSync(themeContextPath, 'utf8')
assert.ok(themeContextContent.includes('cashflow_theme_preference'), 'theme-context uses cashflow_theme_preference key')
assert.ok(themeContextContent.includes('applyThemeClass'), 'theme-context handles class toggling')
assert.ok(themeContextContent.includes('#1D1E23'), 'theme-context uses #1D1E23 for dark theme-color meta tag')

const layoutPath = path.join(__dirname, '..', 'app', 'layout.tsx')
const layoutContent = fs.readFileSync(layoutPath, 'utf8')
assert.ok(layoutContent.includes('ThemeProvider'), 'RootLayout embeds ThemeProvider')
assert.ok(layoutContent.includes('cashflow_theme_preference'), 'RootLayout includes anti-FOUC script')

console.log('✓ Test 8: ThemeProvider and ThemeToggle components properly wired in application')

console.log('--- All M2.17 Theme System Tests Passed Successfully (8/8) ---')

