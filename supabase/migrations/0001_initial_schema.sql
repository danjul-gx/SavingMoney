-- =============================================================================
-- Savings & Cashflow Tracker — Initial Schema
-- Migration: 0001_initial_schema.sql
-- All monetary values stored as BIGINT in Rupiah (no floating point)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE wallet_type AS ENUM ('cash', 'digital');

CREATE TYPE goal_status AS ENUM ('active', 'completed', 'archived');

CREATE TYPE budget_category AS ENUM ('transport', 'food', 'other');

CREATE TYPE budget_period AS ENUM ('weekly', 'monthly');

CREATE TYPE transaction_type AS ENUM (
  'income',
  'expense',
  'savings_contribution',
  'savings_withdrawal',
  'rollover',
  'transfer',
  'adjustment'
);

-- ---------------------------------------------------------------------------
-- Helper: auto-update updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Table: profiles
-- 1:1 with auth.users. Stores display preferences and timezone.
-- ---------------------------------------------------------------------------
CREATE TABLE profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT,
  timezone      TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_profiles_user_id ON profiles(user_id);

-- ---------------------------------------------------------------------------
-- Table: goals
-- Savings goals. is_primary enforced to at-most-one via partial unique index.
-- ---------------------------------------------------------------------------
CREATE TABLE goals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  target_amount  BIGINT NOT NULL CHECK (target_amount > 0),
  current_amount BIGINT NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
  target_year    INTEGER,
  target_month   INTEGER CHECK (target_month BETWEEN 1 AND 12),
  status         goal_status NOT NULL DEFAULT 'active',
  is_primary     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one primary goal per user at a time
CREATE UNIQUE INDEX idx_goals_one_primary_per_user
  ON goals(user_id)
  WHERE is_primary = TRUE AND status = 'active';

CREATE TRIGGER goals_updated_at
  BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_goals_user_id ON goals(user_id);
CREATE INDEX idx_goals_status ON goals(user_id, status);

-- ---------------------------------------------------------------------------
-- Table: wallets
-- MVP: one cash + one digital per user enforced via unique partial indexes.
-- ---------------------------------------------------------------------------
CREATE TABLE wallets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       wallet_type NOT NULL,
  label      TEXT NOT NULL,
  balance    BIGINT NOT NULL DEFAULT 0, -- cached; source of truth is transactions
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce MVP one-wallet-per-type-per-user
CREATE UNIQUE INDEX idx_wallets_one_cash_per_user
  ON wallets(user_id) WHERE type = 'cash';
CREATE UNIQUE INDEX idx_wallets_one_digital_per_user
  ON wallets(user_id) WHERE type = 'digital';

CREATE TRIGGER wallets_updated_at
  BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_wallets_user_id ON wallets(user_id);

-- ---------------------------------------------------------------------------
-- Table: app_settings
-- Per-user key/value config. Stores weekly_multiplier (default 4.3).
-- ---------------------------------------------------------------------------
CREATE TABLE app_settings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT app_settings_unique_key UNIQUE (user_id, key)
);

CREATE TRIGGER app_settings_updated_at
  BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_app_settings_user_key ON app_settings(user_id, key);

-- ---------------------------------------------------------------------------
-- Table: budget_allocations
-- Stores per-month budgets. Amounts in Rupiah (BIGINT).
-- normalized_monthly_amount computed by app layer using weekly_multiplier.
-- period_start = YYYY-MM-01 approach rejected; integer year+month chosen
-- for unambiguous calendar-based financial periods.
-- ---------------------------------------------------------------------------
CREATE TABLE budget_allocations (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id                 UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  budget_year               INTEGER NOT NULL CHECK (budget_year >= 2000),
  budget_month              INTEGER NOT NULL CHECK (budget_month BETWEEN 1 AND 12),
  category                  budget_category NOT NULL,
  custom_label              TEXT,  -- required when category = 'other'
  original_amount           BIGINT NOT NULL CHECK (original_amount > 0),
  period                    budget_period NOT NULL,
  normalized_monthly_amount BIGINT NOT NULL CHECK (normalized_monthly_amount > 0),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- custom_label required when category is 'other'
  CONSTRAINT budget_custom_label_required
    CHECK (category <> 'other' OR (custom_label IS NOT NULL AND custom_label <> ''))
);

CREATE TRIGGER budget_allocations_updated_at
  BEFORE UPDATE ON budget_allocations
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_budget_alloc_user_period
  ON budget_allocations(user_id, budget_year, budget_month);
CREATE INDEX idx_budget_alloc_wallet ON budget_allocations(wallet_id);

-- ---------------------------------------------------------------------------
-- Table: transactions
-- Financial ledger. amount is always positive; direction encoded in type.
-- wallet_id required for expense/income/rollover/transfer.
-- goal_id required for savings_contribution/savings_withdrawal.
-- ---------------------------------------------------------------------------
CREATE TABLE transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id        UUID REFERENCES wallets(id) ON DELETE RESTRICT,
  goal_id          UUID REFERENCES goals(id) ON DELETE RESTRICT,
  type             transaction_type NOT NULL,
  amount           BIGINT NOT NULL CHECK (amount > 0),
  description      TEXT,
  transaction_date DATE NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Wallet required for money-movement types
  CONSTRAINT tx_wallet_required_for_money_types CHECK (
    type IN ('savings_contribution', 'savings_withdrawal', 'adjustment')
    OR wallet_id IS NOT NULL
  ),
  -- Goal required for savings types
  CONSTRAINT tx_goal_required_for_savings CHECK (
    type NOT IN ('savings_contribution', 'savings_withdrawal')
    OR goal_id IS NOT NULL
  )
);

CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_user_date ON transactions(user_id, transaction_date DESC);
CREATE INDEX idx_transactions_wallet ON transactions(wallet_id);
CREATE INDEX idx_transactions_goal ON transactions(goal_id);
CREATE INDEX idx_transactions_type ON transactions(user_id, type);

-- ---------------------------------------------------------------------------
-- Trigger: maintain wallets.balance cache on transaction changes
-- Income/rollover/savings_withdrawal → +amount to wallet
-- Expense/savings_contribution/transfer → -amount from wallet
-- ---------------------------------------------------------------------------
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
      WHEN 'transfer'            THEN -NEW.amount
      WHEN 'adjustment'          THEN  NEW.amount  -- sign convention: positive = credit
      ELSE 0
    END;
    UPDATE wallets SET balance = balance + v_delta WHERE id = NEW.wallet_id;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.wallet_id IS NULL THEN RETURN OLD; END IF;
    -- Reverse the original effect
    v_delta := CASE OLD.type
      WHEN 'income'              THEN -OLD.amount
      WHEN 'rollover'            THEN -OLD.amount
      WHEN 'savings_withdrawal'  THEN -OLD.amount
      WHEN 'expense'             THEN  OLD.amount
      WHEN 'savings_contribution'THEN  OLD.amount
      WHEN 'transfer'            THEN  OLD.amount
      WHEN 'adjustment'          THEN -OLD.amount
      ELSE 0
    END;
    UPDATE wallets SET balance = balance + v_delta WHERE id = OLD.wallet_id;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Reverse old, apply new (handles wallet_id and type changes too)
    IF OLD.wallet_id IS NOT NULL THEN
      v_delta := CASE OLD.type
        WHEN 'income'              THEN -OLD.amount
        WHEN 'rollover'            THEN -OLD.amount
        WHEN 'savings_withdrawal'  THEN -OLD.amount
        WHEN 'expense'             THEN  OLD.amount
        WHEN 'savings_contribution'THEN  OLD.amount
        WHEN 'transfer'            THEN  OLD.amount
        WHEN 'adjustment'          THEN -OLD.amount
        ELSE 0
      END;
      UPDATE wallets SET balance = balance + v_delta WHERE id = OLD.wallet_id;
    END IF;
    IF NEW.wallet_id IS NOT NULL THEN
      v_delta := CASE NEW.type
        WHEN 'income'              THEN  NEW.amount
        WHEN 'rollover'            THEN  NEW.amount
        WHEN 'savings_withdrawal'  THEN  NEW.amount
        WHEN 'expense'             THEN -NEW.amount
        WHEN 'savings_contribution'THEN -NEW.amount
        WHEN 'transfer'            THEN -NEW.amount
        WHEN 'adjustment'          THEN  NEW.amount
        ELSE 0
      END;
      UPDATE wallets SET balance = balance + v_delta WHERE id = NEW.wallet_id;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER transactions_update_wallet_balance
  AFTER INSERT OR UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_wallet_balance_on_tx();

-- ---------------------------------------------------------------------------
-- Trigger: maintain goals.current_amount on savings transactions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_goal_balance_on_tx()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.goal_id IS NULL THEN RETURN NEW; END IF;
    IF NEW.type = 'savings_contribution' THEN
      UPDATE goals SET current_amount = current_amount + NEW.amount WHERE id = NEW.goal_id;
    ELSIF NEW.type = 'savings_withdrawal' THEN
      UPDATE goals SET current_amount = GREATEST(0, current_amount - NEW.amount) WHERE id = NEW.goal_id;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.goal_id IS NULL THEN RETURN OLD; END IF;
    IF OLD.type = 'savings_contribution' THEN
      UPDATE goals SET current_amount = GREATEST(0, current_amount - OLD.amount) WHERE id = OLD.goal_id;
    ELSIF OLD.type = 'savings_withdrawal' THEN
      UPDATE goals SET current_amount = current_amount + OLD.amount WHERE id = OLD.goal_id;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Reverse old
    IF OLD.goal_id IS NOT NULL THEN
      IF OLD.type = 'savings_contribution' THEN
        UPDATE goals SET current_amount = GREATEST(0, current_amount - OLD.amount) WHERE id = OLD.goal_id;
      ELSIF OLD.type = 'savings_withdrawal' THEN
        UPDATE goals SET current_amount = current_amount + OLD.amount WHERE id = OLD.goal_id;
      END IF;
    END IF;
    -- Apply new
    IF NEW.goal_id IS NOT NULL THEN
      IF NEW.type = 'savings_contribution' THEN
        UPDATE goals SET current_amount = current_amount + NEW.amount WHERE id = NEW.goal_id;
      ELSIF NEW.type = 'savings_withdrawal' THEN
        UPDATE goals SET current_amount = GREATEST(0, current_amount - NEW.amount) WHERE id = NEW.goal_id;
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER transactions_update_goal_balance
  AFTER INSERT OR UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_goal_balance_on_tx();

-- ---------------------------------------------------------------------------
-- Table: savings_withdrawals
-- Domain-specific metadata for withdrawals.
-- transaction_id FK points to the ONE transactions row for this withdrawal.
-- No second transactions row is created — no double counting.
-- ---------------------------------------------------------------------------
CREATE TABLE savings_withdrawals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_id               UUID NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  destination_wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  transaction_id        UUID NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
  amount                BIGINT NOT NULL CHECK (amount > 0),
  reason                TEXT NOT NULL CHECK (reason <> ''),
  estimated_delay_days  INTEGER NOT NULL DEFAULT 0 CHECK (estimated_delay_days >= 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_savings_withdrawals_user ON savings_withdrawals(user_id);
CREATE INDEX idx_savings_withdrawals_goal ON savings_withdrawals(goal_id);

-- ---------------------------------------------------------------------------
-- Table: monthly_summaries
-- Snapshot per user per calendar month.
-- Unique: one summary per user per year+month.
-- saved_vs_budget = planned_operational_budget - actual_operational_spending (can be negative)
-- ---------------------------------------------------------------------------
CREATE TABLE monthly_summaries (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year                        INTEGER NOT NULL CHECK (year >= 2000),
  month                       INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  total_income                BIGINT NOT NULL DEFAULT 0,
  planned_operational_budget  BIGINT NOT NULL DEFAULT 0,
  actual_operational_spending BIGINT NOT NULL DEFAULT 0,
  planned_savings             BIGINT NOT NULL DEFAULT 0,
  actual_savings              BIGINT NOT NULL DEFAULT 0,
  savings_withdrawn           BIGINT NOT NULL DEFAULT 0,
  leftover_operational_budget BIGINT NOT NULL DEFAULT 0,
  amount_added_to_savings     BIGINT NOT NULL DEFAULT 0,
  rollover_amount             BIGINT NOT NULL DEFAULT 0,
  -- Can be negative when overspending
  saved_vs_budget             BIGINT NOT NULL DEFAULT 0,
  finalized_at                TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT monthly_summaries_unique_period UNIQUE (user_id, year, month)
);

CREATE TRIGGER monthly_summaries_updated_at
  BEFORE UPDATE ON monthly_summaries
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_monthly_summaries_user ON monthly_summaries(user_id, year DESC, month DESC);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals               ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_allocations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_summaries   ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- profiles RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "profiles_insert_own"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Profiles are not deletable directly; cascade from auth.users delete.

-- ---------------------------------------------------------------------------
-- goals RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "goals_select_own"
  ON goals FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "goals_insert_own"
  ON goals FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "goals_update_own"
  ON goals FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "goals_delete_own"
  ON goals FOR DELETE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- wallets RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "wallets_select_own"
  ON wallets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "wallets_insert_own"
  ON wallets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "wallets_update_own"
  ON wallets FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Wallets not deletable (RESTRICT on transactions FK protects ledger integrity).

-- ---------------------------------------------------------------------------
-- app_settings RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "app_settings_select_own"
  ON app_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "app_settings_insert_own"
  ON app_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "app_settings_update_own"
  ON app_settings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- budget_allocations RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "budget_allocations_select_own"
  ON budget_allocations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "budget_allocations_insert_own"
  ON budget_allocations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "budget_allocations_update_own"
  ON budget_allocations FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "budget_allocations_delete_own"
  ON budget_allocations FOR DELETE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- transactions RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "transactions_select_own"
  ON transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "transactions_insert_own"
  ON transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "transactions_update_own"
  ON transactions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Transactions are immutable in principle; delete restricted to admin workflows.
-- Not exposing a DELETE policy here — use 'adjustment' type for corrections.

-- ---------------------------------------------------------------------------
-- savings_withdrawals RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "savings_withdrawals_select_own"
  ON savings_withdrawals FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "savings_withdrawals_insert_own"
  ON savings_withdrawals FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Withdrawals are not updatable or deletable — ledger integrity.

-- ---------------------------------------------------------------------------
-- monthly_summaries RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "monthly_summaries_select_own"
  ON monthly_summaries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "monthly_summaries_insert_own"
  ON monthly_summaries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "monthly_summaries_update_own"
  ON monthly_summaries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
