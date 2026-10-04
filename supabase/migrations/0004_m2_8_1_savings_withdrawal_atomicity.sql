-- =============================================================================
-- Savings & Cashflow Tracker — M2.8.1 Savings Withdrawal Atomicity Hardening
-- Migration: 0004_m2_8_1_savings_withdrawal_atomicity.sql
--
-- Applies AFTER 0001 + 0002 + 0003. Additive and hardening only.
--
-- Purpose:
--   Guarantees that a savings withdrawal ledger transaction and its corresponding
--   savings_withdrawals metadata row are executed atomically inside a single
--   PostgreSQL transaction via an authoritative RPC function:
--   `execute_savings_withdrawal`.
--
--   Prevents the vulnerability where:
--   1. Transaction is committed and balances change, but metadata insert fails.
--   2. Retry causes duplicate balance movements.
--   3. Orphan transactions or orphan metadata can exist.
--
-- Invariants Preserved:
--   - Strict overdraft check on goal.current_amount (raises check_violation)
--   - Non-negative wallet balances enforced
--   - Cross-entity ownership strictly enforced
--   - Integer Rupiah (BIGINT)
--   - Security: SECURITY DEFINER with search_path = public, auth.uid() check
-- =============================================================================

CREATE OR REPLACE FUNCTION execute_savings_withdrawal(
  p_goal_id               UUID,
  p_destination_wallet_id UUID,
  p_amount                BIGINT,
  p_reason                TEXT,
  p_transaction_date      DATE,
  p_estimated_delay_days  INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id   UUID;
  v_goal      public.goals%ROWTYPE;
  v_wallet    public.wallets%ROWTYPE;
  v_tx_id     UUID;
  v_tx        public.transactions%ROWTYPE;
  v_sw        public.savings_withdrawals%ROWTYPE;
  v_trimmed_reason TEXT;
BEGIN
  -- 1. Derive authenticated user from Supabase auth session
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized: authentication required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Validate inputs
  IF p_goal_id IS NULL THEN
    RAISE EXCEPTION 'goal_id is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_destination_wallet_id IS NULL THEN
    RAISE EXCEPTION 'destination_wallet_id is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be a positive integer' USING ERRCODE = 'check_violation';
  END IF;

  v_trimmed_reason := TRIM(COALESCE(p_reason, ''));
  IF v_trimmed_reason = '' THEN
    RAISE EXCEPTION 'withdrawal reason cannot be empty' USING ERRCODE = 'check_violation';
  END IF;

  IF LENGTH(v_trimmed_reason) > 500 THEN
    RAISE EXCEPTION 'withdrawal reason cannot exceed 500 characters' USING ERRCODE = 'check_violation';
  END IF;

  IF p_transaction_date IS NULL THEN
    RAISE EXCEPTION 'transaction_date is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 3. Verify Goal existence and ownership with FOR UPDATE lock
  SELECT * INTO v_goal
    FROM public.goals
    WHERE id = p_goal_id AND user_id = v_user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'goal does not exist or does not belong to the authenticated user'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Verify Goal balance (prevents balance leakage to unauthorized callers)
  IF v_goal.current_amount < p_amount THEN
    RAISE EXCEPTION 'savings withdrawal rejected: goal balance is insufficient for this withdrawal'
      USING ERRCODE = 'check_violation';
  END IF;

  -- 4. Verify Wallet existence and ownership with FOR UPDATE lock
  SELECT * INTO v_wallet
    FROM public.wallets
    WHERE id = p_destination_wallet_id AND user_id = v_user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'destination wallet does not exist or does not belong to the authenticated user'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- 5. Insert transaction (fires triggers: update_goal_balance_on_tx, update_wallet_balance_on_tx)
  INSERT INTO public.transactions (
    user_id,
    wallet_id,
    goal_id,
    type,
    amount,
    description,
    transaction_date
  ) VALUES (
    v_user_id,
    p_destination_wallet_id,
    p_goal_id,
    'savings_withdrawal',
    p_amount,
    'Penarikan Tabungan: ' || v_trimmed_reason,
    p_transaction_date
  )
  RETURNING * INTO v_tx;

  -- 6. Insert savings_withdrawals metadata within the EXACT SAME transaction
  -- Triggers check_savings_withdrawal_integrity and check_savings_withdrawal_ownership will fire and pass
  INSERT INTO public.savings_withdrawals (
    user_id,
    goal_id,
    destination_wallet_id,
    transaction_id,
    amount,
    reason,
    estimated_delay_days
  ) VALUES (
    v_user_id,
    p_goal_id,
    p_destination_wallet_id,
    v_tx.id,
    p_amount,
    v_trimmed_reason,
    COALESCE(p_estimated_delay_days, 0)
  )
  RETURNING * INTO v_sw;

  -- 7. Return atomic composite result
  RETURN jsonb_build_object(
    'transaction', to_jsonb(v_tx),
    'withdrawal', to_jsonb(v_sw)
  );
END;
$$;

-- Security Hardening: Revoke default execute privileges
REVOKE EXECUTE ON FUNCTION execute_savings_withdrawal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION execute_savings_withdrawal FROM anon;

-- Grant execution strictly to authenticated users and service_role
GRANT EXECUTE ON FUNCTION execute_savings_withdrawal TO authenticated;
GRANT EXECUTE ON FUNCTION execute_savings_withdrawal TO service_role;
