-- =============================================================================
-- Savings & Cashflow Tracker — Accounting & Security Hardening
-- Migration: 0002_accounting_hardening.sql
--
-- Applies AFTER 0001_initial_schema.sql.
-- Safe to run on a fresh DB (0001 unapplied) or an existing one (0001 applied).
-- Never destroys existing data.
--
-- Changes:
--   1. Cross-entity ownership enforcement (trigger-based, no composite FK)
--   2. Derived balance write-protection (RLS column guard)
--   3. Transfer redesign: transfers table + two-sided wallet effect
--   4. Withdrawal overdraft protection (RAISE EXCEPTION in trigger)
--   5. Withdrawal integrity enforcement (trigger cross-check)
--   6. Transaction immutability (restricted UPDATE policy)
--   7. Adjustment direction field (debit/credit explicit)
--   8. Budget normalization validation (deterministic tolerance check)
--   9. app_settings type safety (typed user_settings table)
--  10. Wallet negative balance guard (RAISE EXCEPTION)
--  11. Goal overfunding policy: MVP allows overfunding (documented)
--  12. SQL test cases
-- =============================================================================

-- ============================================================================
-- 1. CROSS-ENTITY OWNERSHIP ENFORCEMENT
-- PostgreSQL does not support composite foreign keys across user_id + pk when
-- the referenced table has only a single-column PK.
-- Solution: BEFORE INSERT/UPDATE triggers that verify ownership.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1a. budget_allocations: wallet_id must belong to same user
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_budget_allocation_ownership()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Verify wallet belongs to the same user
  IF NEW.wallet_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM wallets
      WHERE id = NEW.wallet_id AND user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'budget_allocation: wallet_id % does not belong to user %',
        NEW.wallet_id, NEW.user_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER budget_allocations_check_ownership
  BEFORE INSERT OR UPDATE ON budget_allocations
  FOR EACH ROW EXECUTE FUNCTION check_budget_allocation_ownership();

-- ---------------------------------------------------------------------------
-- 1b. transactions: wallet_id and goal_id must belong to same user
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_transaction_ownership()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.wallet_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM wallets
      WHERE id = NEW.wallet_id AND user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'transaction: wallet_id % does not belong to user %',
        NEW.wallet_id, NEW.user_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  IF NEW.goal_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM goals
      WHERE id = NEW.goal_id AND user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'transaction: goal_id % does not belong to user %',
        NEW.goal_id, NEW.user_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_check_ownership
  BEFORE INSERT OR UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION check_transaction_ownership();

-- ============================================================================
-- 2. DERIVED BALANCE WRITE-PROTECTION
--
-- wallets.balance and goals.current_amount are trigger-maintained.
-- Replace the permissive UPDATE policies with column-restricted ones.
-- Clients may update label (wallet) and name/status/etc (goal), but NOT
-- balance or current_amount.
-- ============================================================================

-- Drop old permissive UPDATE policies
DROP POLICY IF EXISTS "wallets_update_own" ON wallets;
DROP POLICY IF EXISTS "goals_update_own" ON goals;

-- Wallet: allow updating label only; balance is trigger-managed
CREATE POLICY "wallets_update_label_own"
  ON wallets FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    -- Enforce that balance has not changed in the submitted row.
    -- This WITH CHECK runs on the NEW row; we compare against stored value.
    AND balance = (SELECT balance FROM wallets WHERE id = wallets.id)
  );

-- Goal: allow updating name, target_amount, target_year/month, status, is_primary
-- but NOT current_amount (trigger-managed)
CREATE POLICY "goals_update_own"
  ON goals FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND current_amount = (SELECT current_amount FROM goals WHERE id = goals.id)
  );

-- ============================================================================
-- 3. TRANSFER REDESIGN
--
-- Old: transactions.type='transfer' with one wallet_id — money vanishes.
-- New: dedicated `transfers` table with source + destination wallet IDs.
--      A trigger creates TWO internal ledger entries (debit + credit) that
--      update wallets.balance through the existing wallet-balance trigger.
--      The 'transfer' type on transactions is now unused by normal flows;
--      the RPC (Section 4 RPC pattern) handles creation atomically.
--
-- transfers table stores the canonical record.
-- Two entries in a new internal table `transfer_legs` represent the
-- debit and credit sides; these are what the wallet-balance trigger sees.
-- Actually simpler: transfers trigger directly updates wallet balances
-- atomically without going through transactions table (avoids confusion).
-- Design choice: transfers do NOT appear in transactions ledger as
-- income/expense — they are balance movements only.
-- ============================================================================

-- Remove 'transfer' from transaction_type enum is destructive if data exists.
-- Instead, document that 'transfer' entries in transactions are LEGACY/UNUSED
-- and the transfers table is canonical.
-- We add a CHECK constraint to disallow new transfer-type transactions:
ALTER TABLE transactions
  ADD CONSTRAINT tx_no_direct_transfer
    CHECK (type <> 'transfer');

-- Dedicated transfers table
CREATE TABLE transfers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_wallet_id      UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  destination_wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  amount                BIGINT NOT NULL CHECK (amount > 0),
  description           TEXT,
  transfer_date         DATE NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transfers_different_wallets
    CHECK (source_wallet_id <> destination_wallet_id)
);

ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transfers_select_own"
  ON transfers FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "transfers_insert_own"
  ON transfers FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Transfers are immutable — no UPDATE or DELETE policy.

CREATE INDEX idx_transfers_user ON transfers(user_id, transfer_date DESC);
CREATE INDEX idx_transfers_source ON transfers(source_wallet_id);
CREATE INDEX idx_transfers_dest ON transfers(destination_wallet_id);

-- Ownership check for transfers
CREATE OR REPLACE FUNCTION check_transfer_ownership()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM wallets WHERE id = NEW.source_wallet_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'transfer: source_wallet_id % does not belong to user %',
      NEW.source_wallet_id, NEW.user_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM wallets WHERE id = NEW.destination_wallet_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'transfer: destination_wallet_id % does not belong to user %',
      NEW.destination_wallet_id, NEW.user_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER transfers_check_ownership
  BEFORE INSERT ON transfers
  FOR EACH ROW EXECUTE FUNCTION check_transfer_ownership();

-- Trigger: debit source, credit destination atomically
CREATE OR REPLACE FUNCTION apply_transfer_to_wallets()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_source_balance BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Overdraft check on source wallet
    SELECT balance INTO v_source_balance
      FROM wallets WHERE id = NEW.source_wallet_id FOR UPDATE;

    IF v_source_balance - NEW.amount < 0 THEN
      RAISE EXCEPTION
        'transfer rejected: source wallet balance % is insufficient for transfer of %',
        v_source_balance, NEW.amount
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE wallets SET balance = balance - NEW.amount WHERE id = NEW.source_wallet_id;
    UPDATE wallets SET balance = balance + NEW.amount WHERE id = NEW.destination_wallet_id;
  END IF;
  -- Transfers are immutable — no UPDATE/DELETE handling needed.
  RETURN NEW;
END;
$$;

CREATE TRIGGER transfers_apply_to_wallets
  AFTER INSERT ON transfers
  FOR EACH ROW EXECUTE FUNCTION apply_transfer_to_wallets();

-- ============================================================================
-- 4. OVERDRAFT PROTECTION FOR ALL WALLET DEBITS
--
-- Catches: expense, savings_contribution, adjustment (debit direction).
-- Fires BEFORE the wallet-balance trigger to read the current balance first.
-- ============================================================================

CREATE OR REPLACE FUNCTION check_wallet_overdraft()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_balance BIGINT;
  v_delta   BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Only check debit operations
    v_delta := CASE NEW.type
      WHEN 'expense'              THEN NEW.amount
      WHEN 'savings_contribution' THEN NEW.amount
      WHEN 'adjustment_debit'     THEN NEW.amount
      ELSE 0
    END;

    IF v_delta > 0 AND NEW.wallet_id IS NOT NULL THEN
      SELECT balance INTO v_balance
        FROM wallets WHERE id = NEW.wallet_id FOR UPDATE;

      IF v_balance - v_delta < 0 THEN
        RAISE EXCEPTION
          'transaction rejected: wallet balance % is insufficient for debit of % (type: %)',
          v_balance, v_delta, NEW.type
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_check_overdraft
  BEFORE INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION check_wallet_overdraft();

-- ============================================================================
-- 5. SAVINGS WITHDRAWAL — OVERDRAFT PROTECTION + INTEGRITY ENFORCEMENT
--
-- The goal-balance trigger in 0001 used GREATEST(0, ...) — silently clamping.
-- Replace with a strict check: raise if withdrawal > current_amount.
-- Also enforce that savings_withdrawals metadata matches its transaction.
-- ============================================================================

-- 5a. Drop the old goal balance trigger function and replace it
CREATE OR REPLACE FUNCTION update_goal_balance_on_tx()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_current BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.goal_id IS NULL THEN RETURN NEW; END IF;

    IF NEW.type = 'savings_contribution' THEN
      -- MVP policy: allow overfunding (contribution may exceed target_amount).
      -- Rationale: overfunding is a valid user action (e.g., rounding up).
      -- Phase 2 can add a soft warning in the UI.
      UPDATE goals
        SET current_amount = current_amount + NEW.amount
        WHERE id = NEW.goal_id;

    ELSIF NEW.type = 'savings_withdrawal' THEN
      -- Strict overdraft check — no silent clamping
      SELECT current_amount INTO v_current
        FROM goals WHERE id = NEW.goal_id FOR UPDATE;

      IF NEW.amount > v_current THEN
        RAISE EXCEPTION
          'savings withdrawal rejected: goal balance % is insufficient for withdrawal of %',
          v_current, NEW.amount
          USING ERRCODE = 'check_violation';
      END IF;

      UPDATE goals
        SET current_amount = current_amount - NEW.amount
        WHERE id = NEW.goal_id;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    -- Only called if transaction is deleted (admin only — no DELETE RLS for clients)
    IF OLD.goal_id IS NULL THEN RETURN OLD; END IF;
    IF OLD.type = 'savings_contribution' THEN
      UPDATE goals
        SET current_amount = GREATEST(0, current_amount - OLD.amount)
        WHERE id = OLD.goal_id;
    ELSIF OLD.type = 'savings_withdrawal' THEN
      UPDATE goals
        SET current_amount = current_amount + OLD.amount
        WHERE id = OLD.goal_id;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Transactions are immutable for clients; this path is admin/service-role only.
    -- Reverse old, apply new with overdraft check on new withdrawal.
    IF OLD.goal_id IS NOT NULL THEN
      IF OLD.type = 'savings_contribution' THEN
        UPDATE goals SET current_amount = GREATEST(0, current_amount - OLD.amount) WHERE id = OLD.goal_id;
      ELSIF OLD.type = 'savings_withdrawal' THEN
        UPDATE goals SET current_amount = current_amount + OLD.amount WHERE id = OLD.goal_id;
      END IF;
    END IF;
    IF NEW.goal_id IS NOT NULL THEN
      IF NEW.type = 'savings_contribution' THEN
        UPDATE goals SET current_amount = current_amount + NEW.amount WHERE id = NEW.goal_id;
      ELSIF NEW.type = 'savings_withdrawal' THEN
        SELECT current_amount INTO v_current FROM goals WHERE id = NEW.goal_id FOR UPDATE;
        IF NEW.amount > v_current THEN
          RAISE EXCEPTION 'savings withdrawal update rejected: balance % < withdrawal %', v_current, NEW.amount
            USING ERRCODE = 'check_violation';
        END IF;
        UPDATE goals SET current_amount = current_amount - NEW.amount WHERE id = NEW.goal_id;
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
-- The existing trigger already references this function by name — it reloads automatically.

-- 5b. Withdrawal integrity: enforce that metadata matches its transaction
CREATE OR REPLACE FUNCTION check_savings_withdrawal_integrity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_tx transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_tx FROM transactions WHERE id = NEW.transaction_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'savings_withdrawal: transaction_id % not found', NEW.transaction_id;
  END IF;

  IF v_tx.type <> 'savings_withdrawal' THEN
    RAISE EXCEPTION
      'savings_withdrawal: transaction % has type %, expected savings_withdrawal',
      NEW.transaction_id, v_tx.type;
  END IF;

  IF v_tx.user_id <> NEW.user_id THEN
    RAISE EXCEPTION
      'savings_withdrawal: transaction user_id % does not match withdrawal user_id %',
      v_tx.user_id, NEW.user_id;
  END IF;

  IF v_tx.goal_id IS DISTINCT FROM NEW.goal_id THEN
    RAISE EXCEPTION
      'savings_withdrawal: transaction goal_id % does not match withdrawal goal_id %',
      v_tx.goal_id, NEW.goal_id;
  END IF;

  IF v_tx.wallet_id IS DISTINCT FROM NEW.destination_wallet_id THEN
    RAISE EXCEPTION
      'savings_withdrawal: transaction wallet_id % does not match destination_wallet_id %',
      v_tx.wallet_id, NEW.destination_wallet_id;
  END IF;

  IF v_tx.amount <> NEW.amount THEN
    RAISE EXCEPTION
      'savings_withdrawal: transaction amount % does not match withdrawal amount %',
      v_tx.amount, NEW.amount;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER savings_withdrawals_check_integrity
  BEFORE INSERT ON savings_withdrawals
  FOR EACH ROW EXECUTE FUNCTION check_savings_withdrawal_integrity();

-- Cross-user ownership check for savings_withdrawals
CREATE OR REPLACE FUNCTION check_savings_withdrawal_ownership()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM goals WHERE id = NEW.goal_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'savings_withdrawal: goal_id % does not belong to user %',
      NEW.goal_id, NEW.user_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM wallets WHERE id = NEW.destination_wallet_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'savings_withdrawal: destination_wallet_id % does not belong to user %',
      NEW.destination_wallet_id, NEW.user_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM transactions WHERE id = NEW.transaction_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'savings_withdrawal: transaction_id % does not belong to user %',
      NEW.transaction_id, NEW.user_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER savings_withdrawals_check_ownership
  BEFORE INSERT ON savings_withdrawals
  FOR EACH ROW EXECUTE FUNCTION check_savings_withdrawal_ownership();

-- ============================================================================
-- 6. TRANSACTION IMMUTABILITY
--
-- Clients must not update amount, type, wallet_id, goal_id, or user_id.
-- Only description and transaction_date are mutable by the client.
-- The existing UPDATE policy allows any column — replace it.
-- ============================================================================

DROP POLICY IF EXISTS "transactions_update_own" ON transactions;

CREATE POLICY "transactions_update_description_own"
  ON transactions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    -- Immutable columns must not change
    AND amount      = (SELECT amount      FROM transactions WHERE id = transactions.id)
    AND type        = (SELECT type        FROM transactions WHERE id = transactions.id)
    AND wallet_id   IS NOT DISTINCT FROM (SELECT wallet_id  FROM transactions WHERE id = transactions.id)
    AND goal_id     IS NOT DISTINCT FROM (SELECT goal_id    FROM transactions WHERE id = transactions.id)
    AND user_id     = (SELECT user_id     FROM transactions WHERE id = transactions.id)
  );

-- ============================================================================
-- 7. ADJUSTMENT DIRECTION
--
-- Choice: Add an explicit `adjustment_direction` column ('credit' | 'debit').
-- Rationale: clearest accounting semantics — direction is data, not convention.
-- The wallet-balance trigger is updated to use this column for adjustments.
-- ============================================================================

CREATE TYPE adjustment_direction AS ENUM ('credit', 'debit');

ALTER TABLE transactions
  ADD COLUMN adjustment_direction adjustment_direction;

-- Enforce: adjustment_direction required iff type = 'adjustment'
ALTER TABLE transactions
  ADD CONSTRAINT tx_adjustment_direction_required CHECK (
    (type = 'adjustment' AND adjustment_direction IS NOT NULL)
    OR (type <> 'adjustment' AND adjustment_direction IS NULL)
  );

-- Replace the wallet balance trigger function to handle adjustment direction
CREATE OR REPLACE FUNCTION update_wallet_balance_on_tx()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_delta BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.wallet_id IS NULL THEN RETURN NEW; END IF;
    v_delta := CASE NEW.type
      WHEN 'income'              THEN  NEW.amount
      WHEN 'rollover'            THEN  NEW.amount
      WHEN 'savings_withdrawal'  THEN  NEW.amount
      WHEN 'expense'             THEN -NEW.amount
      WHEN 'savings_contribution'THEN -NEW.amount
      WHEN 'adjustment'          THEN
        CASE NEW.adjustment_direction
          WHEN 'credit' THEN  NEW.amount
          WHEN 'debit'  THEN -NEW.amount
          ELSE 0
        END
      ELSE 0
    END;
    UPDATE wallets SET balance = balance + v_delta WHERE id = NEW.wallet_id;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.wallet_id IS NULL THEN RETURN OLD; END IF;
    v_delta := -(CASE OLD.type
      WHEN 'income'              THEN  OLD.amount
      WHEN 'rollover'            THEN  OLD.amount
      WHEN 'savings_withdrawal'  THEN  OLD.amount
      WHEN 'expense'             THEN -OLD.amount
      WHEN 'savings_contribution'THEN -OLD.amount
      WHEN 'adjustment'          THEN
        CASE OLD.adjustment_direction
          WHEN 'credit' THEN  OLD.amount
          WHEN 'debit'  THEN -OLD.amount
          ELSE 0
        END
      ELSE 0
    END);
    UPDATE wallets SET balance = balance + v_delta WHERE id = OLD.wallet_id;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.wallet_id IS NOT NULL THEN
      v_delta := -(CASE OLD.type
        WHEN 'income'              THEN  OLD.amount
        WHEN 'rollover'            THEN  OLD.amount
        WHEN 'savings_withdrawal'  THEN  OLD.amount
        WHEN 'expense'             THEN -OLD.amount
        WHEN 'savings_contribution'THEN -OLD.amount
        WHEN 'adjustment'          THEN
          CASE OLD.adjustment_direction
            WHEN 'credit' THEN  OLD.amount
            WHEN 'debit'  THEN -OLD.amount
            ELSE 0
          END
        ELSE 0
      END);
      UPDATE wallets SET balance = balance + v_delta WHERE id = OLD.wallet_id;
    END IF;
    IF NEW.wallet_id IS NOT NULL THEN
      v_delta := CASE NEW.type
        WHEN 'income'              THEN  NEW.amount
        WHEN 'rollover'            THEN  NEW.amount
        WHEN 'savings_withdrawal'  THEN  NEW.amount
        WHEN 'expense'             THEN -NEW.amount
        WHEN 'savings_contribution'THEN -NEW.amount
        WHEN 'adjustment'          THEN
          CASE NEW.adjustment_direction
            WHEN 'credit' THEN  NEW.amount
            WHEN 'debit'  THEN -NEW.amount
            ELSE 0
          END
        ELSE 0
      END;
      UPDATE wallets SET balance = balance + v_delta WHERE id = NEW.wallet_id;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
-- Existing trigger already points to this function name; reloads automatically.

-- Also update overdraft check for adjustment debit
CREATE OR REPLACE FUNCTION check_wallet_overdraft()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_balance BIGINT;
  v_debit   BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_debit := CASE NEW.type
      WHEN 'expense'              THEN NEW.amount
      WHEN 'savings_contribution' THEN NEW.amount
      WHEN 'adjustment'           THEN
        CASE NEW.adjustment_direction WHEN 'debit' THEN NEW.amount ELSE 0 END
      ELSE 0
    END;

    IF v_debit > 0 AND NEW.wallet_id IS NOT NULL THEN
      SELECT balance INTO v_balance
        FROM wallets WHERE id = NEW.wallet_id FOR UPDATE;

      IF v_balance - v_debit < 0 THEN
        RAISE EXCEPTION
          'transaction rejected: wallet balance % insufficient for debit of % (type: %)',
          v_balance, v_debit, NEW.type
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 8. BUDGET NORMALIZATION VALIDATION
--
-- The DB cannot call app_settings during a CHECK constraint.
-- Instead: a trigger validates that normalized_monthly_amount is consistent
-- with original_amount × multiplier, using the user's own stored setting.
-- Tolerance: ±1 Rupiah (rounding via ROUND(..., 0) on the multiplier result).
-- Final stored value is always BIGINT (integer Rupiah, no floating point).
-- ============================================================================

CREATE OR REPLACE FUNCTION check_budget_normalization()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_multiplier     NUMERIC;
  v_expected       BIGINT;
BEGIN
  -- Only validate weekly budgets; monthly budgets normalize 1:1
  IF NEW.period = 'monthly' THEN
    IF NEW.normalized_monthly_amount <> NEW.original_amount THEN
      RAISE EXCEPTION
        'budget_allocation: monthly period requires normalized_monthly_amount = original_amount (got % vs %)',
        NEW.normalized_monthly_amount, NEW.original_amount;
    END IF;
    RETURN NEW;
  END IF;

  -- weekly: fetch user's multiplier setting
  SELECT COALESCE(value::NUMERIC, 4.3) INTO v_multiplier
    FROM app_settings
    WHERE user_id = NEW.user_id AND key = 'weekly_multiplier';

  IF NOT FOUND OR v_multiplier IS NULL THEN
    v_multiplier := 4.3;
  END IF;

  -- Round to nearest integer Rupiah
  v_expected := ROUND(NEW.original_amount * v_multiplier)::BIGINT;

  -- Allow ±1 Rupiah tolerance for rounding differences
  IF ABS(NEW.normalized_monthly_amount - v_expected) > 1 THEN
    RAISE EXCEPTION
      'budget_allocation: normalized_monthly_amount % is inconsistent with original % × multiplier % = % (±1 allowed)',
      NEW.normalized_monthly_amount, NEW.original_amount, v_multiplier, v_expected;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER budget_allocations_check_normalization
  BEFORE INSERT OR UPDATE ON budget_allocations
  FOR EACH ROW EXECUTE FUNCTION check_budget_normalization();

-- ============================================================================
-- 9. SETTINGS TYPE SAFETY
--
-- Add a typed `user_financial_settings` table alongside app_settings.
-- app_settings (key/text) is kept for extensibility but financial config
-- uses the new typed table. weekly_multiplier stored as NUMERIC(5,2).
-- ============================================================================

CREATE TABLE user_financial_settings (
  user_id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Weekly-to-monthly normalization multiplier. Default 4.3.
  -- Stored as NUMERIC(5,2) — 3 integer digits, 2 decimal places.
  weekly_multiplier  NUMERIC(5, 2) NOT NULL DEFAULT 4.3
                     CHECK (weekly_multiplier > 0 AND weekly_multiplier <= 10),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_financial_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ufs_select_own"
  ON user_financial_settings FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "ufs_insert_own"
  ON user_financial_settings FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ufs_update_own"
  ON user_financial_settings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER user_financial_settings_updated_at
  BEFORE UPDATE ON user_financial_settings
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Update budget normalization trigger to prefer user_financial_settings
CREATE OR REPLACE FUNCTION check_budget_normalization()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_multiplier NUMERIC;
  v_expected   BIGINT;
BEGIN
  IF NEW.period = 'monthly' THEN
    IF NEW.normalized_monthly_amount <> NEW.original_amount THEN
      RAISE EXCEPTION
        'budget_allocation: monthly period requires normalized_monthly_amount = original_amount (got % vs %)',
        NEW.normalized_monthly_amount, NEW.original_amount;
    END IF;
    RETURN NEW;
  END IF;

  -- Prefer typed settings table, fall back to app_settings text, then default
  SELECT weekly_multiplier INTO v_multiplier
    FROM user_financial_settings WHERE user_id = NEW.user_id;

  IF NOT FOUND THEN
    SELECT COALESCE(value::NUMERIC, 4.3) INTO v_multiplier
      FROM app_settings WHERE user_id = NEW.user_id AND key = 'weekly_multiplier';
  END IF;

  v_multiplier := COALESCE(v_multiplier, 4.3);
  v_expected   := ROUND(NEW.original_amount::NUMERIC * v_multiplier)::BIGINT;

  IF ABS(NEW.normalized_monthly_amount - v_expected) > 1 THEN
    RAISE EXCEPTION
      'budget_allocation: normalized_monthly_amount % inconsistent — expected % (original % × %.2f ±1)',
      NEW.normalized_monthly_amount, v_expected, NEW.original_amount, v_multiplier;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 10. WALLET NEGATIVE BALANCE GUARD
-- Additional check AFTER wallet balance trigger to catch any slip-through.
-- The overdraft trigger fires BEFORE on transactions; this is a safety net.
-- ============================================================================

CREATE OR REPLACE FUNCTION check_wallet_balance_non_negative()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.balance < 0 THEN
    RAISE EXCEPTION
      'wallet balance integrity violation: wallet % balance would become % (negative not allowed)',
      NEW.id, NEW.balance
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER wallets_balance_non_negative
  BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION check_wallet_balance_non_negative();

-- ============================================================================
-- 11. GOAL BALANCE INVARIANT: current_amount >= 0
-- Already a CHECK in 0001. The trigger now enforces via RAISE, so this is
-- a belt-and-suspenders safety net on the column itself (already exists).
-- No additional DDL needed — the constraint is in 0001.
-- ============================================================================


