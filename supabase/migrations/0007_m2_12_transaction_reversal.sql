-- =============================================================================
-- Savings & Cashflow Tracker — M2.12 Transaction Management & Reversal
-- Migration: 0007_m2_12_transaction_reversal.sql
--
-- Applies AFTER 0001 + 0002 + 0003 + 0004 + 0005 + 0006.
-- Additive only — no destructive changes to existing schema or data.
--
-- Principles:
--   1. Historical transactions remain strictly immutable.
--   2. A reversal is an authoritative new transaction that links to the original.
--   3. Exactly one reversal per transaction (enforced by partial unique index).
--   4. Reversal reason is mandatory and trimmed.
--   5. Execution is completely atomic via an authoritative RPC `reverse_transaction`.
--   6. Overdraft and negative balances strictly prohibited (no clamping).
--   7. RLS / auth.uid() ownership strictly enforced.
-- =============================================================================

-- ============================================================================
-- 1. SCHEMA ADDITIONS TO TRANSACTIONS TABLE
-- ============================================================================

-- Add reversal reference and reversal reason columns
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS reversal_of_transaction_id UUID REFERENCES transactions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

-- Self-reference disallowance: a transaction cannot be a reversal of itself
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_reversal_not_self'
  ) THEN
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_reversal_not_self
      CHECK (reversal_of_transaction_id IS NULL OR reversal_of_transaction_id <> id);
  END IF;
END $$;

-- Enforce reason when reversal reference is present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_reversal_reason_required'
  ) THEN
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_reversal_reason_required
      CHECK (
        (reversal_of_transaction_id IS NULL) OR
        (reversal_reason IS NOT NULL AND TRIM(reversal_reason) <> '')
      );
  END IF;
END $$;

-- Enforce exactly one reversal per transaction via a partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_unique_reversal
  ON transactions(reversal_of_transaction_id)
  WHERE reversal_of_transaction_id IS NOT NULL;

-- Fast lookup for reversals of any transaction
CREATE INDEX IF NOT EXISTS idx_transactions_reversal_of
  ON transactions(reversal_of_transaction_id)
  WHERE reversal_of_transaction_id IS NOT NULL;

-- ============================================================================
-- 2. HARDEN IMMUTABILITY TRIGGER
--
-- Reversal columns (reversal_of_transaction_id, reversal_reason) are set at
-- INSERT time and MUST NEVER be mutated afterwards.
-- ============================================================================

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
  IF NEW.reversal_of_transaction_id IS DISTINCT FROM OLD.reversal_of_transaction_id THEN
    RAISE EXCEPTION 'transaction.reversal_of_transaction_id is immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.reversal_reason IS DISTINCT FROM OLD.reversal_reason THEN
    RAISE EXCEPTION 'transaction.reversal_reason is immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 3. AUTHORITATIVE REVERSAL RPC FUNCTION
--
-- Single-operation atomic reversal for eligible transactions:
--   - income
--   - expense
--   - savings_contribution
--   - savings_withdrawal
--
-- Rollover, transfer, and adjustment transactions are NOT reversible in M2.12.
-- Reversal of an existing reversal is strictly rejected.
-- ============================================================================

CREATE OR REPLACE FUNCTION reverse_transaction(
  p_transaction_id UUID,
  p_reason         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id           UUID;
  v_trimmed_reason    TEXT;
  v_orig_tx           public.transactions%ROWTYPE;
  v_rev_tx            public.transactions%ROWTYPE;
  v_wallet            public.wallets%ROWTYPE;
  v_goal              public.goals%ROWTYPE;
  v_reversal_type     public.transaction_type;
  v_reversal_dir      public.adjustment_direction := NULL;
  v_reversal_desc     TEXT;
  v_now_date          DATE := CURRENT_DATE;
BEGIN
  -- 1. Derive authenticated user from Supabase auth session
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized: authentication required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Validate input parameters
  IF p_transaction_id IS NULL THEN
    RAISE EXCEPTION 'transaction_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_trimmed_reason := TRIM(COALESCE(p_reason, ''));
  IF v_trimmed_reason = '' THEN
    RAISE EXCEPTION 'reversal reason cannot be empty'
      USING ERRCODE = 'check_violation';
  END IF;

  IF LENGTH(v_trimmed_reason) > 500 THEN
    RAISE EXCEPTION 'reversal reason cannot exceed 500 characters'
      USING ERRCODE = 'check_violation';
  END IF;

  -- 3. Acquire exclusive lock on the original transaction and verify ownership
  SELECT * INTO v_orig_tx
    FROM public.transactions
    WHERE id = p_transaction_id AND user_id = v_user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction does not exist or does not belong to the authenticated user'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- 4. Invariant: Reversals themselves cannot be reversed
  IF v_orig_tx.reversal_of_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'cannot reverse a reversal transaction'
      USING ERRCODE = 'check_violation';
  END IF;

  -- 5. Invariant: Check if already reversed (double reversal prevention)
  IF EXISTS (
    SELECT 1 FROM public.transactions
    WHERE reversal_of_transaction_id = v_orig_tx.id
  ) THEN
    RAISE EXCEPTION 'transaction has already been reversed'
      USING ERRCODE = 'unique_violation';
  END IF;

  -- 6. Invariant: Check eligibility of transaction type
  IF v_orig_tx.type NOT IN ('income', 'expense', 'savings_contribution', 'savings_withdrawal') THEN
    RAISE EXCEPTION 'transaction type % is not eligible for reversal', v_orig_tx.type
      USING ERRCODE = 'check_violation';
  END IF;

  -- 7. Acquire lock on associated Wallet
  SELECT * INTO v_wallet
    FROM public.wallets
    WHERE id = v_orig_tx.wallet_id AND user_id = v_user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'associated wallet does not exist or does not belong to user'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- 8. If goal is involved, acquire lock on associated Goal
  IF v_orig_tx.goal_id IS NOT NULL THEN
    SELECT * INTO v_goal
      FROM public.goals
      WHERE id = v_orig_tx.goal_id AND user_id = v_user_id
      FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'associated goal does not exist or does not belong to user'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  -- 9. Determine Reversal Semantics & Enforce Balance Invariants
  CASE v_orig_tx.type
    -- INCOME REVERSAL: Negates +income (+wallet) by debiting wallet (-wallet)
    WHEN 'income' THEN
      IF v_wallet.balance < v_orig_tx.amount THEN
        RAISE EXCEPTION 'reversal rejected: wallet balance % is insufficient for reversal of income of %',
          v_wallet.balance, v_orig_tx.amount
          USING ERRCODE = 'check_violation';
      END IF;
      v_reversal_type := 'adjustment';
      v_reversal_dir  := 'debit';
      v_reversal_desc := 'Koreksi Pemasukan: ' || v_trimmed_reason;

    -- EXPENSE REVERSAL: Negates -expense (-wallet) by crediting wallet (+wallet)
    WHEN 'expense' THEN
      v_reversal_type := 'adjustment';
      v_reversal_dir  := 'credit';
      v_reversal_desc := 'Koreksi Pengeluaran: ' || v_trimmed_reason;

    -- SAVINGS CONTRIBUTION REVERSAL:
    -- Original: wallet -amount, goal +amount
    -- Reversal: wallet +amount, goal -amount
    -- Invariant: Goal current_amount must be >= amount (cannot drop below 0)
    WHEN 'savings_contribution' THEN
      IF v_goal.current_amount < v_orig_tx.amount THEN
        RAISE EXCEPTION 'reversal rejected: goal balance % is insufficient for reversal of contribution of %',
          v_goal.current_amount, v_orig_tx.amount
          USING ERRCODE = 'check_violation';
      END IF;
      v_reversal_type := 'savings_withdrawal';
      v_reversal_desc := 'Koreksi Tabungan: ' || v_trimmed_reason;

    -- SAVINGS WITHDRAWAL REVERSAL:
    -- Original: wallet +amount, goal -amount
    -- Reversal: wallet -amount, goal +amount
    -- Invariant: Wallet balance must be >= amount (cannot create negative wallet balance)
    WHEN 'savings_withdrawal' THEN
      IF v_wallet.balance < v_orig_tx.amount THEN
        RAISE EXCEPTION 'reversal rejected: wallet balance % is insufficient for reversal of withdrawal of %',
          v_wallet.balance, v_orig_tx.amount
          USING ERRCODE = 'check_violation';
      END IF;
      v_reversal_type := 'savings_contribution';
      v_reversal_desc := 'Koreksi Penarikan Tabungan: ' || v_trimmed_reason;

    ELSE
      RAISE EXCEPTION 'unsupported transaction type % for reversal', v_orig_tx.type
        USING ERRCODE = 'check_violation';
  END CASE;

  -- 10. Insert authoritative reversal transaction
  -- Triggers will fire:
  --   - check_transaction_ownership: validates wallet and goal
  --   - check_wallet_overdraft: passes because we already verified balances
  --   - update_wallet_balance_on_tx: accurately adjusts wallet balance
  --   - update_goal_balance_on_tx: accurately adjusts goal balance if contribution/withdrawal
  INSERT INTO public.transactions (
    user_id,
    wallet_id,
    goal_id,
    type,
    amount,
    description,
    transaction_date,
    adjustment_direction,
    reversal_of_transaction_id,
    reversal_reason
  ) VALUES (
    v_user_id,
    v_orig_tx.wallet_id,
    v_orig_tx.goal_id,
    v_reversal_type,
    v_orig_tx.amount,
    v_reversal_desc,
    v_now_date,
    v_reversal_dir,
    v_orig_tx.id,
    v_trimmed_reason
  )
  RETURNING * INTO v_rev_tx;

  -- 11. Return atomic result containing the original and reversal transactions
  RETURN jsonb_build_object(
    'original_transaction', to_jsonb(v_orig_tx),
    'reversal_transaction', to_jsonb(v_rev_tx)
  );
END;
$$;

-- Security Hardening: Revoke default execute privileges
REVOKE EXECUTE ON FUNCTION reverse_transaction FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reverse_transaction FROM anon;
GRANT EXECUTE ON FUNCTION reverse_transaction TO authenticated;
