-- =============================================================================
-- MIGRATION: 20261013000001_core_identity_and_units.sql
-- DESCRIPTION: Phase 2 Core Identity, Stake Units, and Audit Logging
-- STAKE: Abeokuta Nigeria Obantoko Stake
-- STATUS: Prepared for Review Only (DO NOT EXECUTE IN PHASE 2A)
-- =============================================================================

-- 1. Enable Cryptographic Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Stake Units Table (Wards and Branches)
CREATE TABLE IF NOT EXISTS public.stake_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_name TEXT NOT NULL UNIQUE,
    unit_type TEXT NOT NULL CHECK (unit_type IN ('ward', 'branch')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_stake_units_type ON public.stake_units(unit_type);
CREATE INDEX IF NOT EXISTS idx_stake_units_active ON public.stake_units(is_active);

-- 3. User Profiles Table (Linked to auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT,
    account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'deactivated', 'pending')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_status ON public.user_profiles(account_status);

-- 4. User Roles Table
CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    role_name TEXT NOT NULL CHECK (
        role_name IN ('system_admin', 'ysa_leader', 'stake_presidency', 'bishop', 'branch_president')
    ),
    assigned_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_user_role UNIQUE (user_id, role_name)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON public.user_roles(role_name);

-- 5. User Unit Assignments (Bishops, Branch Presidents, Unit YSA Leaders)
CREATE TABLE IF NOT EXISTS public.user_unit_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES public.stake_units(id) ON DELETE CASCADE,
    assigned_role TEXT NOT NULL CHECK (
        assigned_role IN ('bishop', 'branch_president', 'ysa_leader')
    ),
    assigned_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_user_unit_role UNIQUE (user_id, unit_id, assigned_role)
);

CREATE INDEX IF NOT EXISTS idx_unit_assignments_user ON public.user_unit_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_unit_assignments_unit ON public.user_unit_assignments(unit_id);

-- 6. Audit Logs Table (Append-Only)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_record_id TEXT,
    target_table TEXT,
    outcome TEXT NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'failure')),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);

-- 7. Trigger: Enforce Append-Only Immutability on Audit Logs
CREATE OR REPLACE FUNCTION public.fn_prevent_audit_log_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Audit records are strictly append-only and cannot be altered or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_audit_logs ON public.audit_logs;
CREATE TRIGGER trg_protect_audit_logs
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW
EXECUTE FUNCTION public.fn_prevent_audit_log_modification();

-- 8. Trigger: Prevent Removal of Final System Administrator
CREATE OR REPLACE FUNCTION public.fn_prevent_last_admin_removal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_admin_count INT;
BEGIN
    IF OLD.role_name = 'system_admin' THEN
        SELECT count(*) INTO v_admin_count 
        FROM public.user_roles 
        WHERE role_name = 'system_admin';

        IF v_admin_count <= 1 THEN
            RAISE EXCEPTION 'Operation rejected: Cannot remove or revoke the last remaining system administrator.';
        END IF;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_last_admin_removal ON public.user_roles;
CREATE TRIGGER trg_prevent_last_admin_removal
BEFORE DELETE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.fn_prevent_last_admin_removal();

-- =============================================================================
-- VERIFICATION QUERIES (RUN AFTER EXECUTION TO VERIFY HEALTH)
-- =============================================================================
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
-- SELECT proname FROM pg_proc WHERE proname IN ('fn_prevent_audit_log_modification', 'fn_prevent_last_admin_removal');
