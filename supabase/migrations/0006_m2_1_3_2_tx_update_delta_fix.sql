-- =============================================================================
-- Savings & Cashflow Tracker — M2.1.3.2 Runtime Defect Fix
-- Migration: 0006_m2_1_3_2_tx_update_delta_fix.sql
--
-- Applies AFTER 0001 + 0002 + 0003 + 0004 + 0005. Additive / bug fix only.
--
-- Defect:
--   When updating mutable transaction columns (e.g. description, transaction_date),
--   the trigger update_wallet_balance_on_tx() previously performed two separate
--   UPDATE statements on the same wallet:
--     1) balance = balance - OLD_delta (reversing old effect)
--     2) balance = balance + NEW_delta (applying new effect)
--   When OLD_delta was large (e.g. an income transaction), step 1 caused an
--   intermediate negative balance on the wallet, firing
--   enforce_wallet_balance_non_negative and rejecting valid metadata updates.
--
-- Fix:
--   Compute net delta or handle OLD.wallet_id = NEW.wallet_id in a single
--   atomic update, eliminating transient negative balances.
-- =============================================================================

CREATE OR REPLACE FUNCTION update_wallet_balance_on_tx()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_old_delta BIGINT;
  v_new_delta BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new_delta := _wallet_tx_delta(NEW.type, NEW.amount, NEW.adjustment_direction);
    UPDATE wallets SET balance = balance + v_new_delta WHERE id = NEW.wallet_id;

  ELSIF TG_OP = 'DELETE' THEN
    v_old_delta := -_wallet_tx_delta(OLD.type, OLD.amount, OLD.adjustment_direction);
    UPDATE wallets SET balance = balance + v_old_delta WHERE id = OLD.wallet_id;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.wallet_id = NEW.wallet_id THEN
      -- Same wallet: apply net delta in a single atomic update to prevent transient negative balance
      v_new_delta := _wallet_tx_delta(NEW.type, NEW.amount, NEW.adjustment_direction)
                   - _wallet_tx_delta(OLD.type, OLD.amount, OLD.adjustment_direction);
      IF v_new_delta <> 0 THEN
        UPDATE wallets SET balance = balance + v_new_delta WHERE id = NEW.wallet_id;
      END IF;
    ELSE
      -- Different wallets: reverse from old, apply to new
      v_old_delta := -_wallet_tx_delta(OLD.type, OLD.amount, OLD.adjustment_direction);
      UPDATE wallets SET balance = balance + v_old_delta WHERE id = OLD.wallet_id;

      v_new_delta := _wallet_tx_delta(NEW.type, NEW.amount, NEW.adjustment_direction);
      UPDATE wallets SET balance = balance + v_new_delta WHERE id = NEW.wallet_id;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
