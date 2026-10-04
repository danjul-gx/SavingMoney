/**
 * M2.25 Final Release — Production Readiness Assertions
 *
 * Verifies that the release baseline is complete, consistent, and free of
 * accidental secrets or missing artifacts.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

console.log('=== M2.25: Final Production Release Tests ===\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS: ${passed + failed}. ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL: ${passed + failed}. ${name}\n  ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// 1–3: Required release documentation exists
// ---------------------------------------------------------------------------

test('FINAL_RELEASE.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'FINAL_RELEASE.md')));
});

test('RELEASE_CHECKLIST.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'RELEASE_CHECKLIST.md')));
});

test('walkthrough.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'walkthrough.md')));
});

// ---------------------------------------------------------------------------
// 4: All 8 migration files exist
// ---------------------------------------------------------------------------

test('Migrations 0001–0008 all exist', () => {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const expected = [
    '0001_initial_schema.sql',
    '0002_accounting_hardening.sql',
    '0003_m1_1_accounting_fixes.sql',
    '0004_m2_8_1_savings_withdrawal_atomicity.sql',
    '0005_m2_4_2_budget_interval_days.sql',
    '0006_m2_1_3_2_tx_update_delta_fix.sql',
    '0007_m2_12_transaction_reversal.sql',
    '0008_m2_13_financial_audit.sql',
  ];
  for (const f of expected) {
    assert.ok(fs.existsSync(path.join(dir, f)), `Missing migration: ${f}`);
  }
});

// ---------------------------------------------------------------------------
// 5: package.json pins patched Next.js
// ---------------------------------------------------------------------------

test('package.json pins Next.js >= 16.3.8', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const ver = pkg.dependencies.next;
  assert.ok(ver, 'next dependency missing');
  // Accept ^16.3.8, ~16.3.8, or exact 16.3.8+
  assert.ok(
    ver.includes('16.3.8') || ver.includes('16.3.9') || ver.includes('16.4'),
    `Expected patched Next.js (>=16.3.8), got: ${ver}`
  );
});

// ---------------------------------------------------------------------------
// 6: package-lock resolves to patched version
// ---------------------------------------------------------------------------

test('package-lock.json resolves next to >= 16.3.8', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  // npm v3 lockfile: packages["node_modules/next"].version
  const entry = lock.packages && lock.packages['node_modules/next'];
  assert.ok(entry, 'next not found in package-lock');
  const parts = entry.version.split('.').map(Number);
  // 16.3.8+
  assert.ok(
    parts[0] > 16 || (parts[0] === 16 && parts[1] > 3) ||
    (parts[0] === 16 && parts[1] === 3 && parts[2] >= 8),
    `Expected resolved next >= 16.3.8, got: ${entry.version}`
  );
});

// ---------------------------------------------------------------------------
// 7–8: PWA manifest and standalone display
// ---------------------------------------------------------------------------

test('PWA manifest exists and is valid JSON', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'public', 'manifest.webmanifest'), 'utf8');
  const m = JSON.parse(raw);
  assert.ok(m.name, 'manifest missing name');
  assert.ok(m.icons && m.icons.length >= 2, 'manifest missing icons');
});

test('PWA manifest has standalone display', () => {
  const m = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'public', 'manifest.webmanifest'), 'utf8')
  );
  assert.strictEqual(m.display, 'standalone');
});

// ---------------------------------------------------------------------------
// 9: Required PWA icons exist
// ---------------------------------------------------------------------------

test('PWA icons (192, 512, apple-touch) exist', () => {
  const icons = path.join(ROOT, 'public', 'icons');
  assert.ok(fs.existsSync(path.join(icons, 'icon-192.png')), 'icon-192.png missing');
  assert.ok(fs.existsSync(path.join(icons, 'icon-512.png')), 'icon-512.png missing');
  assert.ok(fs.existsSync(path.join(icons, 'apple-touch-icon.png')), 'apple-touch-icon.png missing');
});

// ---------------------------------------------------------------------------
// 10: No service_role secret in client source
// ---------------------------------------------------------------------------

test('No service_role key value in src/ directory (redaction patterns excluded)', () => {
  // diagnostics.js/ts reference service_role only as a SENSITIVE_KEY_PATTERN
  // for redaction — that's a security control, not a leaked credential.
  const REDACTION_FILES = new Set(['diagnostics.js', 'diagnostics.ts']);

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
      if (REDACTION_FILES.has(entry.name)) continue; // security redaction code
      const content = fs.readFileSync(full, 'utf8');
      assert.ok(
        !content.includes('service_role') && !content.includes('SERVICE_ROLE'),
        `service_role reference found in ${full}`
      );
    }
  }
  walk(path.join(ROOT, 'src'));
});


// ---------------------------------------------------------------------------
// 11: .gitignore excludes .env files
// ---------------------------------------------------------------------------

test('.gitignore excludes .env files', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.ok(gi.includes('.env'), '.gitignore does not exclude .env files');
});

// ---------------------------------------------------------------------------
// 12: .env.local.example uses NEXT_PUBLIC variables only
// ---------------------------------------------------------------------------

test('.env.local.example uses only NEXT_PUBLIC_ Supabase variables', () => {
  const env = fs.readFileSync(path.join(ROOT, '.env.local.example'), 'utf8');
  const lines = env.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  for (const line of lines) {
    const varName = line.split('=')[0].trim();
    assert.ok(
      varName.startsWith('NEXT_PUBLIC_'),
      `Non-public env var in example: ${varName}`
    );
  }
});

// ---------------------------------------------------------------------------
// 13: No hardcoded localhost in production config
// ---------------------------------------------------------------------------

test('No localhost URL in .env.local.example', () => {
  const env = fs.readFileSync(path.join(ROOT, '.env.local.example'), 'utf8');
  assert.ok(!env.includes('localhost'), 'localhost found in .env.local.example');
  assert.ok(!env.includes('127.0.0.1'), '127.0.0.1 found in .env.local.example');
});

// ---------------------------------------------------------------------------
// 14: Release accounting smoke test script exists
// ---------------------------------------------------------------------------

test('Release accounting smoke script exists', () => {
  assert.ok(
    fs.existsSync(path.join(ROOT, 'supabase', 'tests', 'run_m2_24_release_smoke.js')),
    'run_m2_24_release_smoke.js missing'
  );
});

// ---------------------------------------------------------------------------
// 15: FINAL_RELEASE.md preserves M2.23 recovery limitations
// ---------------------------------------------------------------------------

test('FINAL_RELEASE.md documents recovery limitations (no false PITR claim)', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'FINAL_RELEASE.md'), 'utf8');
  const docLower = doc.toLowerCase();
  // Must acknowledge the limitation
  assert.ok(
    docLower.includes('not verified') || docLower.includes('unverified'),
    'FINAL_RELEASE.md does not acknowledge unverified physical restore'
  );
  // Must NOT claim PITR was tested
  assert.ok(
    !docLower.includes('pitr verified') && !docLower.includes('pitr: pass') &&
    !docLower.includes('physical restore verified') && !docLower.includes('physical restore: pass'),
    'FINAL_RELEASE.md falsely claims PITR/physical restore was verified'
  );
});

// ---------------------------------------------------------------------------
// 16: RELEASE_CHECKLIST.md documents recovery limitations
// ---------------------------------------------------------------------------

test('RELEASE_CHECKLIST.md documents recovery limitations', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'RELEASE_CHECKLIST.md'), 'utf8');
  assert.ok(
    doc.includes('Unverified') || doc.includes('unverified') ||
    doc.includes('Not verified') || doc.includes('not verified'),
    'RELEASE_CHECKLIST.md does not acknowledge unverified physical restore'
  );
});

// ---------------------------------------------------------------------------

console.log(`\nM2.25 Final Release Tests: ${passed}/${passed + failed} passed.`);
if (failed > 0) process.exit(1);
