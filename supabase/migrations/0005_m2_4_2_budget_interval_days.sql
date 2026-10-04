-- =============================================================================
-- Savings & Cashflow Tracker — M2.4.2 Budget Interval-Days Support
-- Migration: 0005_m2_4_2_budget_interval_days.sql
--
-- Applies AFTER 0001 + 0002 + 0003 + 0004. Additive only — no data destruction.
--
-- Changes:
--   1. ALTER TYPE budget_period ADD VALUE IF NOT EXISTS 'interval'
--   2. Add interval_days column to budget_allocations table
--   3. Add constraints:
--      - interval_days IS NOT NULL AND interval_days > 0 when period = 'interval'
--      - interval_days IS NULL when period IN ('weekly', 'monthly')
--   4. Update check_budget_normalization() trigger:
--      - Exact equality validation (no +/-1 slack): NEW.normalized_monthly_amount <> v_expected
--      - Safe NUMERIC arithmetic for interval calculation: ROUND((NEW.original_amount::NUMERIC * 30.0) / NEW.interval_days::NUMERIC)::BIGINT
--      - Preserves weekly (4.3x / user setting) and monthly (1:1) normalization.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend budget_period enum with 'interval'
-- Note: ALTER TYPE ... ADD VALUE cannot run inside a multi-statement transaction block
-- in standard PostgreSQL prior to version 12, but PostgreSQL 12+ supports it.
-- ---------------------------------------------------------------------------
ALTER TYPE budget_period ADD VALUE IF NOT EXISTS 'interval';

-- ---------------------------------------------------------------------------
-- 2. Add interval_days column to budget_allocations
-- ---------------------------------------------------------------------------
ALTER TABLE budget_allocations
  ADD COLUMN IF NOT EXISTS interval_days INTEGER;

-- ---------------------------------------------------------------------------
-- 3. Add constraint for interval_days consistency
-- ---------------------------------------------------------------------------
ALTER TABLE budget_allocations
  DROP CONSTRAINT IF EXISTS budget_interval_days_check;

ALTER TABLE budget_allocations
  ADD CONSTRAINT budget_interval_days_check
  CHECK (
    (period::text = 'interval' AND interval_days IS NOT NULL AND interval_days > 0)
    OR
    (period::text IN ('weekly', 'monthly') AND interval_days IS NULL)
  );


-- ---------------------------------------------------------------------------
-- 4. Update check_budget_normalization() to strictly validate normalization
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_budget_normalization()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_multiplier NUMERIC;
  v_expected   BIGINT;
BEGIN
  -- 1. Monthly period: 1:1 exact equality
  IF NEW.period = 'monthly' THEN
    IF NEW.normalized_monthly_amount <> NEW.original_amount THEN
      RAISE EXCEPTION
        'budget_allocation: monthly period requires normalized_monthly_amount = original_amount (got % vs %)',
        NEW.normalized_monthly_amount, NEW.original_amount
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- 2. Interval period: round_half_up(original_amount * 30 / interval_days) via NUMERIC
  IF NEW.period = 'interval' THEN
    IF NEW.interval_days IS NULL OR NEW.interval_days <= 0 THEN
      RAISE EXCEPTION
        'budget_allocation: interval period requires positive interval_days (got %)',
        NEW.interval_days
        USING ERRCODE = 'check_violation';
    END IF;

    -- Safe NUMERIC arithmetic to avoid BIGINT multiplication overflow
    v_expected := ROUND((NEW.original_amount::NUMERIC * 30.0) / NEW.interval_days::NUMERIC)::BIGINT;

    -- Strict exact equality validation
    IF NEW.normalized_monthly_amount <> v_expected THEN
      RAISE EXCEPTION
        'budget_allocation: normalized_monthly_amount % inconsistent — expected % (original % × 30 / % days)',
        NEW.normalized_monthly_amount, v_expected, NEW.original_amount, NEW.interval_days
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
  END IF;

  -- 3. Weekly period: 4.3x multiplier (from user settings or default 4.3)
  -- Prefer typed settings table, fall back to app_settings text, then default
  SELECT weekly_multiplier INTO v_multiplier
    FROM user_financial_settings WHERE user_id = NEW.user_id;

  IF NOT FOUND THEN
    SELECT COALESCE(value::NUMERIC, 4.3) INTO v_multiplier
      FROM app_settings WHERE user_id = NEW.user_id AND key = 'weekly_multiplier';
  END IF;

  v_multiplier := COALESCE(v_multiplier, 4.3);
  v_expected   := ROUND(NEW.original_amount::NUMERIC * v_multiplier)::BIGINT;

  -- Strict exact equality validation
  IF NEW.normalized_monthly_amount <> v_expected THEN
    RAISE EXCEPTION
      'budget_allocation: normalized_monthly_amount % inconsistent — expected % (original % × %.2f)',
      NEW.normalized_monthly_amount, v_expected, NEW.original_amount, v_multiplier
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
