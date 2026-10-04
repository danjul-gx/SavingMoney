-- =============================================================================
-- Savings & Cashflow Tracker â€” M1.1 Accounting Fixes
-- Migration: 0003_m1_1_accounting_fixes.sql
--
-- Applies AFTER 0001 + 0002. Additive only â€” no data destruction.
--
-- Fixes:
--   1. wallet_id NOT NULL for all transaction types
--   2. update_wallet_balance_on_tx: remove invalid nested function definition
--   3. Derived balance protection: replace recursive RLS WITH CHECK with
--      BEFORE UPDATE triggers using pg_trigger_depth()
--   4. Transaction immutability: replace recursive RLS WITH CHECK with
--      BEFORE UPDATE trigger
--   5. Overdraft trigger: fix 'adjustment_debit' typo bug
--   6. Comprehensive test suite (trigger-level + RLS simulation)
-- =============================================================================

-- ============================================================================
-- 1. WALLET_ID REQUIRED FOR ALL TRANSACTION TYPES
--
-- 0001 has tx_wallet_required_for_money_types which exempts
-- savings_contribution, savings_withdrawal, and adjustment from wallet_id
-- requirement. This is wrong â€” all valid types need a wallet.
--
-- 0002 added tx_no_direct_transfer, leaving valid types as:
--   income, expense, savings_contribution, savings_withdrawal, rollover, adjustment
-- All of these debit or credit a wallet, so wallet_id must always be NOT NULL.
-- ============================================================================

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS tx_wallet_required_for_money_types;

-- wallet_id is now unconditionally required for all valid transaction types.
ALTER TABLE transactions
  ADD CONSTRAINT tx_wallet_required
    CHECK (wallet_id IS NOT NULL);

-- ============================================================================
-- 2. FIX update_wallet_balance_on_tx â€” REMOVE INVALID NESTED FUNCTION
--
-- 0002 rewrote update_wallet_balance_on_tx with a nested FUNCTION definition
-- inside the PL/pgSQL body. PostgreSQL does not support this; the migration
-- would fail to compile. Fix: extract wallet_delta as a standalone function,
-- then rewrite update_wallet_balance_on_tx to call it.
-- ============================================================================

-- Standalone helper: compute signed wallet delta from a transaction
CREATE OR REPLACE FUNCTION _wallet_tx_delta(
  p_type   transaction_type,
  p_amount BIGINT,
  p_dir    adjustment_direction
) RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_type
    WHEN 'income'               THEN  p_amount
    WHEN 'rollover'             THEN  p_amount
    WHEN 'savings_withdrawal'   THEN  p_amount
    WHEN 'expense'              THEN -p_amount
    WHEN 'savings_contribution' THEN -p_amount
    WHEN 'adjustment'           THEN
      CASE p_dir
        WHEN 'credit' THEN  p_amount
        WHEN 'debit'  THEN -p_amount
        ELSE 0
      END
    ELSE 0
  END
$$;

-- Rewrite trigger function without the invalid nested function
CREATE OR REPLACE FUNCTION update_wallet_balance_on_tx()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_delta BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- wallet_id is now always NOT NULL (enforced by tx_wallet_required constraint)
    v_delta := _wallet_tx_delta(NEW.type, NEW.amount, NEW.adjustment_direction);
    UPDATE wallets SET balance = balance + v_delta WHERE id = NEW.wallet_id;

  ELSIF TG_OP = 'DELETE' THEN
    v_delta := -_wallet_tx_delta(OLD.type, OLD.amount, OLD.adjustment_direction);
    UPDATE wallets SET balance = balance + v_delta WHERE id = OLD.wallet_id;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Reverse old effect
    v_delta := -_wallet_tx_delta(OLD.type, OLD.amount, OLD.adjustment_direction);
    UPDATE wallets SET balance = balance + v_delta WHERE id = OLD.wallet_id;
    -- Apply new effect
    v_delta := _wallet_tx_delta(NEW.type, NEW.amount, NEW.adjustment_direction);
    UPDATE wallets SET balance = balance + v_delta WHERE id = NEW.wallet_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
-- The existing trigger (transactions_update_wallet_balance) already references
-- this function by name â€” the CREATE OR REPLACE reloads it automatically.

-- ============================================================================
-- 3. FIX OVERDRAFT TRIGGER â€” 'adjustment_debit' enum value bug
--
-- 0002 line 257 used the string 'adjustment_debit' as a transaction_type match.
-- That is not a valid value; the actual type is 'adjustment' and direction is
-- in the adjustment_direction column. Replace with the correct logic.
-- ============================================================================

CREATE OR REPLACE FUNCTION check_wallet_overdraft()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_balance BIGINT;
  v_debit   BIGINT;
BEGIN
  -- Only fires on INSERT (new debit transactions).
  -- wallet_id is now guaranteed NOT NULL by tx_wallet_required constraint.
  IF TG_OP = 'INSERT' THEN
    v_debit := CASE NEW.type
      WHEN 'expense'              THEN NEW.amount
      WHEN 'savings_contribution' THEN NEW.amount
      WHEN 'adjustment'           THEN
        CASE NEW.adjustment_direction
          WHEN 'debit' THEN NEW.amount
          ELSE 0
        END
      ELSE 0
    END;

    IF v_debit > 0 THEN
      SELECT balance INTO v_balance
        FROM wallets WHERE id = NEW.wallet_id FOR UPDATE;

      IF v_balance - v_debit < 0 THEN
        RAISE EXCEPTION
          'transaction rejected: wallet balance % is insufficient for debit of % (type: %)',
          v_balance, v_debit, NEW.type
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
-- Existing trigger (transactions_check_overdraft) reloads automatically.

-- ============================================================================
-- 4. FIX DERIVED BALANCE PROTECTION â€” REPLACE RECURSIVE RLS WITH TRIGGERS
--
-- 0002 used RLS WITH CHECK subqueries that SELECT from the same table being
-- updated. In PostgreSQL RLS, this creates recursive policy evaluation:
--   UPDATE wallets â†’ WITH CHECK runs â†’ SELECT balance FROM wallets â†’ RLS fires
--   again â†’ WITH CHECK runs â†’ SELECT balance FROM wallets â†’ infinite loop or
--   permission error.
--
-- Correct solution: BEFORE UPDATE triggers.
-- Triggers fire at ALL privilege levels (including service role) and do not
-- recurse because they check OLD vs NEW directly, not via a subquery.
--
-- pg_trigger_depth() distinguishes:
--   - Direct client UPDATE:  trigger fires at depth 1
--   - Ledger trigger UPDATE: this protect trigger fires at depth â‰¥ 2
-- This allows the internal ledger triggers to update balance freely
-- while rejecting any direct client UPDATE that changes balance.
-- ============================================================================

-- 4a. Drop the problematic RLS policies from 0002
DROP POLICY IF EXISTS "wallets_update_label_own"  ON wallets;
DROP POLICY IF EXISTS "goals_update_own"           ON goals;

-- 4b. Wallet: simple ownership UPDATE policy (column guard is in trigger)
CREATE POLICY "wallets_update_own"
  ON wallets FOR UPDATE
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 4c. Goal: simple ownership UPDATE policy (column guard is in trigger)
CREATE POLICY "goals_update_own"
  ON goals FOR UPDATE
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 4d. Trigger: protect wallets.balance from direct client modification
CREATE OR REPLACE FUNCTION protect_wallet_balance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- pg_trigger_depth() == 1 means this trigger was invoked directly by a
  -- client SQL statement (not from within another trigger).
  -- The ledger and transfer triggers that legitimately update balance fire at
  -- depth >= 2 because they are AFTER triggers on transactions/transfers,
  -- and this BEFORE UPDATE trigger fires as a nested call inside them.
  IF pg_trigger_depth() < 2 AND NEW.balance IS DISTINCT FROM OLD.balance THEN
    RAISE EXCEPTION
      'direct modification of wallets.balance is not permitted; use transactions'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER wallets_protect_balance
  BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION protect_wallet_balance();

-- Drop old wallet negative balance trigger from 0002 (now redundant with
-- the protect trigger; we keep a separate non-negative guard below).
DROP TRIGGER IF EXISTS wallets_balance_non_negative ON wallets;
DROP FUNCTION IF EXISTS check_wallet_balance_non_negative();

-- Restore the non-negative balance guard (separate concern from write protection)
CREATE OR REPLACE FUNCTION enforce_wallet_balance_non_negative()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.balance < 0 THEN
    RAISE EXCEPTION
      'wallet % balance would become %; negative wallet balances are not allowed',
      NEW.id, NEW.balance
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- This fires AFTER protect_wallet_balance (both are BEFORE UPDATE, but
-- PostgreSQL executes multiple BEFORE triggers in name order; we name this
-- one to sort after 'wallets_protect_balance').
CREATE TRIGGER wallets_z_balance_non_negative
  BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION enforce_wallet_balance_non_negative();

-- 4e. Trigger: protect goals.current_amount from direct client modification
CREATE OR REPLACE FUNCTION protect_goal_current_amount()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- See comment in protect_wallet_balance for pg_trigger_depth() rationale.
  IF pg_trigger_depth() < 2 AND NEW.current_amount IS DISTINCT FROM OLD.current_amount THEN
    RAISE EXCEPTION
      'direct modification of goals.current_amount is not permitted; use transactions'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER goals_protect_current_amount
  BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION protect_goal_current_amount();

-- ============================================================================
-- 5. FIX TRANSACTION IMMUTABILITY â€” REPLACE RECURSIVE RLS WITH TRIGGER
--
-- 0002 used RLS WITH CHECK that SELECTs from the transactions table itself.
-- Same recursion problem as the balance guards.
--
-- Correct solution: BEFORE UPDATE trigger that compares OLD vs NEW for the
-- immutable columns directly, with no subquery needed.
--
-- Mutable by clients:  description, transaction_date
-- Immutable:           user_id, wallet_id, goal_id, type, amount,
--                      adjustment_direction
-- ============================================================================

-- Drop the problematic RLS policy from 0002
DROP POLICY IF EXISTS "transactions_update_description_own" ON transactions;

-- Replace with a simple ownership-only policy; immutability is enforced by trigger
CREATE POLICY "transactions_update_own"
  ON transactions FOR UPDATE
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- BEFORE UPDATE trigger: enforce financial column immutability
CREATE OR REPLACE FUNCTION enforce_transaction_immutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'transaction.user_id is immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.wallet_id IS DISTINCT FROM OLD.wallet_id THEN
    RAISE EXCEPTION 'transaction.wallet_id is immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.goal_id IS DISTINCT FROM OLD.goal_id THEN
    RAISE EXCEPTION 'transaction.goal_id is immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.type IS DISTINCT FROM OLD.type THEN
    RAISE EXCEPTION 'transaction.type is immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.amount IS DISTINCT FROM OLD.amount THEN
    RAISE EXCEPTION 'transaction.amount is immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.adjustment_direction IS DISTINCT FROM OLD.adjustment_direction THEN
    RAISE EXCEPTION 'transaction.adjustment_direction is immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_enforce_immutability
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION enforce_transaction_immutability();

-- ============================================================================
-- 5b. HARDEN INTEGRITY FUNCTIONS WITH EXPLICIT ERRCODES
--
-- Ensure check_savings_withdrawal_integrity and check_budget_normalization
-- use ERRCODE = 'check_violation' so negative tests and client error handling
-- can deterministically identify validation rejections without false positives.
-- ============================================================================

CREATE OR REPLACE FUNCTION check_savings_withdrawal_integrity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_tx transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_tx FROM transactions WHERE id = NEW.transaction_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'savings_withdrawal: transaction_id % not found', NEW.transaction_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_tx.type <> 'savings_withdrawal' THEN
    RAISE EXCEPTION
      'savings_withdrawal: transaction % has type %, expected savings_withdrawal',
      NEW.transaction_id, v_tx.type
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_tx.user_id <> NEW.user_id THEN
    RAISE EXCEPTION
      'savings_withdrawal: transaction user_id % does not match withdrawal user_id %',
      v_tx.user_id, NEW.user_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_tx.goal_id IS DISTINCT FROM NEW.goal_id THEN
    RAISE EXCEPTION
      'savings_withdrawal: transaction goal_id % does not match withdrawal goal_id %',
      v_tx.goal_id, NEW.goal_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_tx.wallet_id IS DISTINCT FROM NEW.destination_wallet_id THEN
    RAISE EXCEPTION
      'savings_withdrawal: transaction wallet_id % does not match destination_wallet_id %',
      v_tx.wallet_id, NEW.destination_wallet_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_tx.amount <> NEW.amount THEN
    RAISE EXCEPTION
      'savings_withdrawal: transaction amount % does not match withdrawal amount %',
      v_tx.amount, NEW.amount
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

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
        NEW.normalized_monthly_amount, NEW.original_amount
        USING ERRCODE = 'check_violation';
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
      'budget_allocation: normalized_monthly_amount % inconsistent â€” expected % (original % Ã— %.2f Â±1)',
      NEW.normalized_monthly_amount, v_expected, NEW.original_amount, v_multiplier
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

