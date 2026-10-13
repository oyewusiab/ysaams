-- =============================================================================
-- MIGRATION: 20261013000002_core_rls_policies.sql
-- DESCRIPTION: Row Level Security (RLS) Policies for Identity and Stake Units
-- STAKE: Abeokuta Nigeria Obantoko Stake
-- STATUS: Prepared for Review Only (DO NOT EXECUTE IN PHASE 2A)
-- =============================================================================

-- 1. Enable and Force Row Level Security on Core Tables
ALTER TABLE public.stake_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stake_units FORCE ROW LEVEL SECURITY;

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.user_unit_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_unit_assignments FORCE ROW LEVEL SECURITY;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

-- 2. Helper Security Functions
CREATE OR REPLACE FUNCTION public.is_system_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = p_user_id AND role_name = 'system_admin'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_stake_wide_leader(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = p_user_id 
          AND role_name IN ('system_admin', 'stake_presidency')
    );
$$;

CREATE OR REPLACE FUNCTION public.get_user_assigned_units(p_user_id UUID)
RETURNS TABLE (unit_id UUID)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT unit_id 
    FROM public.user_unit_assignments 
    WHERE user_id = p_user_id;
$$;

-- 3. Policies for stake_units
-- Authenticated users can view active units; system_admin can view all and manage
DROP POLICY IF EXISTS policy_units_read ON public.stake_units;
CREATE POLICY policy_units_read ON public.stake_units
FOR SELECT TO authenticated, anon
USING (is_active = TRUE OR public.is_stake_wide_leader(auth.uid()));

DROP POLICY IF EXISTS policy_units_admin_all ON public.stake_units;
CREATE POLICY policy_units_admin_all ON public.stake_units
FOR ALL TO authenticated
USING (public.is_system_admin(auth.uid()))
WITH CHECK (public.is_system_admin(auth.uid()));

-- 4. Policies for user_profiles
DROP POLICY IF EXISTS policy_profiles_read ON public.user_profiles;
CREATE POLICY policy_profiles_read ON public.user_profiles
FOR SELECT TO authenticated
USING (auth.uid() = id OR public.is_stake_wide_leader(auth.uid()));

DROP POLICY IF EXISTS policy_profiles_self_update ON public.user_profiles;
CREATE POLICY policy_profiles_self_update ON public.user_profiles
FOR UPDATE TO authenticated
USING (auth.uid() = id OR public.is_system_admin(auth.uid()))
WITH CHECK (auth.uid() = id OR public.is_system_admin(auth.uid()));

-- 5. Policies for user_roles
DROP POLICY IF EXISTS policy_roles_read ON public.user_roles;
CREATE POLICY policy_roles_read ON public.user_roles
FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.is_stake_wide_leader(auth.uid()));

DROP POLICY IF EXISTS policy_roles_admin_write ON public.user_roles;
CREATE POLICY policy_roles_admin_write ON public.user_roles
FOR ALL TO authenticated
USING (public.is_system_admin(auth.uid()))
WITH CHECK (public.is_system_admin(auth.uid()));

-- 6. Policies for user_unit_assignments
DROP POLICY IF EXISTS policy_assignments_read ON public.user_unit_assignments;
CREATE POLICY policy_assignments_read ON public.user_unit_assignments
FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.is_stake_wide_leader(auth.uid()));

DROP POLICY IF EXISTS policy_assignments_admin_write ON public.user_unit_assignments;
CREATE POLICY policy_assignments_admin_write ON public.user_unit_assignments
FOR ALL TO authenticated
USING (public.is_system_admin(auth.uid()))
WITH CHECK (public.is_system_admin(auth.uid()));

-- 7. Policies for audit_logs
DROP POLICY IF EXISTS policy_audit_read ON public.audit_logs;
CREATE POLICY policy_audit_read ON public.audit_logs
FOR SELECT TO authenticated
USING (public.is_stake_wide_leader(auth.uid()));

-- Inserts are allowed via trusted RPCs or authenticated leaders
DROP POLICY IF EXISTS policy_audit_insert ON public.audit_logs;
CREATE POLICY policy_audit_insert ON public.audit_logs
FOR INSERT TO authenticated
WITH CHECK (TRUE);

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================
-- SELECT tablename, policyname, roles, cmd FROM pg_policies WHERE schemaname = 'public';
