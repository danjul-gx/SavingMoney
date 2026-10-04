-- =============================================================================
-- Savings & Cashflow Tracker — M2.13 Financial Audit Trail & Activity Integrity
-- Migration: 0008_m2_13_financial_audit.sql
--
-- Applies AFTER 0001 through 0007.
-- Additive only — no destructive changes to existing schema or data.
--
-- Principles:
--   1. Authoritative accounting ledger remains `transactions`.
--   2. Audit events are strictly append-only (UPDATE and DELETE prohibited).
--   3. Strict user-scoped isolation via RLS and auth.uid().
--   4. Atomic recording inside the same database transaction as the financial mutations.
--   5. Triggers on `transactions` and `monthly_summaries` ensure every financial event
--      (direct insert, withdrawal RPC, reversal RPC, rollover finalization)
--      atomically emits an immutable audit event.
-- =============================================================================

-- ============================================================================
-- 1. CREATE FINANCIAL AUDIT EVENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.financial_audit_events (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type             TEXT NOT NULL,
  entity_type            TEXT NOT NULL,
  entity_id              UUID NULL,
  transaction_id         UUID NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
  related_transaction_id UUID NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying by user and chronology
CREATE INDEX IF NOT EXISTS idx_audit_events_user_created
  ON public.financial_audit_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_tx
  ON public.financial_audit_events(transaction_id)
  WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_events_related_tx
  ON public.financial_audit_events(related_transaction_id)
  WHERE related_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_events_entity
  ON public.financial_audit_events(entity_type, entity_id)
  WHERE entity_id IS NOT NULL;

-- ============================================================================
-- 2. APPEND-ONLY PROTECTION: FORBID UPDATE AND DELETE
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_audit_event_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'financial audit events are strictly immutable; UPDATE is forbidden'
      USING ERRCODE = 'insufficient_privilege';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'financial audit events are append-only; DELETE is forbidden'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS audit_events_immutable_trg ON public.financial_audit_events;
CREATE TRIGGER audit_events_immutable_trg
  BEFORE UPDATE OR DELETE ON public.financial_audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();

-- ============================================================================
-- 3. ROW LEVEL SECURITY (RLS) FOR AUDIT EVENTS
-- ============================================================================

ALTER TABLE public.financial_audit_events ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "audit_events_select_own" ON public.financial_audit_events;
DROP POLICY IF EXISTS "audit_events_insert_own" ON public.financial_audit_events;

-- SELECT policy: Users can only read their own audit events
CREATE POLICY "audit_events_select_own"
  ON public.financial_audit_events FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT policy: Insert with check auth.uid() = user_id
CREATE POLICY "audit_events_insert_own"
  ON public.financial_audit_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Explicitly NO update or delete policies (and the BEFORE trigger blocks them anyway)

-- ============================================================================
-- 4. AUTOMATIC ATOMIC AUDIT CREATION TRIGGERS
--
-- Catches:
--   - All transaction creations: income, expense, savings_contribution, savings_withdrawal, rollover, adjustment
--   - All transaction reversals: when reversal_of_transaction_id IS NOT NULL
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_transaction_lifecycle()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_type TEXT;
  v_meta       JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.reversal_of_transaction_id IS NOT NULL THEN
      -- Reversal event
      v_event_type := 'transaction_reversed';
      v_meta := jsonb_build_object(
        'original_transaction_id', NEW.reversal_of_transaction_id,
        'reversal_transaction_id', NEW.id,
        'reversal_type',           NEW.type,
        'amount',                  NEW.amount,
        'wallet_id',               NEW.wallet_id,
        'goal_id',                 NEW.goal_id,
        'reversal_reason',         NEW.reversal_reason,
        'transaction_date',        NEW.transaction_date
      );

      INSERT INTO public.financial_audit_events (
        user_id,
        event_type,
        entity_type,
        entity_id,
        transaction_id,
        related_transaction_id,
        metadata,
        created_at
      ) VALUES (
        NEW.user_id,
        v_event_type,
        'transaction',
        NEW.id,
        NEW.id,
        NEW.reversal_of_transaction_id,
        v_meta,
        NOW()
      );
    ELSE
      -- Standard transaction creation
      v_event_type := CASE NEW.type
        WHEN 'income'               THEN 'income_recorded'
        WHEN 'expense'              THEN 'expense_recorded'
        WHEN 'savings_contribution' THEN 'savings_contribution_recorded'
        WHEN 'savings_withdrawal'   THEN 'savings_withdrawal_recorded'
        WHEN 'rollover'             THEN 'rollover_recorded'
        WHEN 'adjustment'           THEN 'adjustment_recorded'
        ELSE 'transaction_created'
      END;

      v_meta := jsonb_build_object(
        'type',                 NEW.type,
        'amount',               NEW.amount,
        'wallet_id',            NEW.wallet_id,
        'goal_id',              NEW.goal_id,
        'description',          NEW.description,
        'transaction_date',     NEW.transaction_date,
        'adjustment_direction', NEW.adjustment_direction
      );

      INSERT INTO public.financial_audit_events (
        user_id,
        event_type,
        entity_type,
        entity_id,
        transaction_id,
        related_transaction_id,
        metadata,
        created_at
      ) VALUES (
        NEW.user_id,
        v_event_type,
        'transaction',
        NEW.id,
        NEW.id,
        NULL,
        v_meta,
        NOW()
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_transaction_lifecycle ON public.transactions;
CREATE TRIGGER trg_audit_transaction_lifecycle
  AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION audit_transaction_lifecycle();

-- ============================================================================
-- 5. AUDIT FOR SAVINGS WITHDRAWAL METADATA EXECUTION
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_savings_withdrawal_metadata()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.financial_audit_events (
      user_id,
      event_type,
      entity_type,
      entity_id,
      transaction_id,
      related_transaction_id,
      metadata,
      created_at
    ) VALUES (
      NEW.user_id,
      'savings_withdrawal_executed',
      'savings_withdrawal',
      NEW.id,
      NEW.transaction_id,
      NULL,
      jsonb_build_object(
        'withdrawal_id',         NEW.id,
        'goal_id',               NEW.goal_id,
        'destination_wallet_id', NEW.destination_wallet_id,
        'amount',                NEW.amount,
        'reason',                NEW.reason,
        'estimated_delay_days',  NEW.estimated_delay_days
      ),
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_savings_withdrawal_metadata ON public.savings_withdrawals;
CREATE TRIGGER trg_audit_savings_withdrawal_metadata
  AFTER INSERT ON public.savings_withdrawals
  FOR EACH ROW EXECUTE FUNCTION audit_savings_withdrawal_metadata();

-- ============================================================================
-- 6. AUDIT FOR BUDGET ROLLOVER / MONTH FINALIZATION
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_monthly_summary_finalization()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Fires on INSERT or UPDATE when finalized_at transitions to a non-null timestamp
  IF (TG_OP = 'INSERT' AND NEW.finalized_at IS NOT NULL) OR
     (TG_OP = 'UPDATE' AND OLD.finalized_at IS NULL AND NEW.finalized_at IS NOT NULL) THEN
    INSERT INTO public.financial_audit_events (
      user_id,
      event_type,
      entity_type,
      entity_id,
      transaction_id,
      related_transaction_id,
      metadata,
      created_at
    ) VALUES (
      NEW.user_id,
      'budget_rollover_finalized',
      'monthly_summary',
      NEW.id,
      NULL,
      NULL,
      jsonb_build_object(
        'year',                        NEW.year,
        'month',                       NEW.month,
        'rollover_amount',             COALESCE(NEW.rollover_amount, 0),
        'amount_added_to_savings',     COALESCE(NEW.amount_added_to_savings, 0),
        'leftover_operational_budget', COALESCE(NEW.leftover_operational_budget, 0),
        'finalized_at',                NEW.finalized_at
      ),
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_monthly_summary_finalization ON public.monthly_summaries;
CREATE TRIGGER trg_audit_monthly_summary_finalization
  AFTER INSERT OR UPDATE ON public.monthly_summaries
  FOR EACH ROW EXECUTE FUNCTION audit_monthly_summary_finalization();
