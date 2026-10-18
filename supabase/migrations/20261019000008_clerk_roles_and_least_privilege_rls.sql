-- =============================================================================
-- MIGRATION: 20261019000008_clerk_roles_and_least_privilege_rls.sql
-- DESCRIPTION: Forward-Only Addition of Least-Privilege Clerk Roles
--              1. Extends public.user_roles.role_name constraint to support
--                 'stake_clerk', 'ward_clerk', and 'branch_clerk'.
--              2. Extends public.user_unit_assignments.assigned_role constraint
--                 to support 'ward_clerk' and 'branch_clerk'.
--              3. Adds SECURITY DEFINER helper public.is_stake_clerk(UUID) and
--                 updates public.get_user_assigned_units(UUID) to require an
--                 active matching role in public.user_roles.
--              4. Updates SELECT policies on members, attendance_records, and
--                 session_visitors to allow read-only reporting access for
--                 stake_clerk (stake-wide) and ward_clerk / branch_clerk
--                 (assigned unit only).
--              5. Replaces policy_members_manage on public.members so that
--                 INSERT/UPDATE/DELETE require executive/YSA leadership roles
--                 ('system_admin', 'stake_presidency', 'ysa_leader', 'bishop',
--                 'branch_president') and strictly exclude clerk roles.
-- STAKE: Abeokuta Nigeria Obantoko Stake
-- STATUS: Staged for Owner Review & Execution Before Production Launch
-- IDEMPOTENT: Non-destructive; safe to run repeatedly
-- =============================================================================

-- =============================================================================
-- PART 1: EXTEND ROLE CONSTRAINTS (NON-DESTRUCTIVE)
-- =============================================================================
DO $$
DECLARE
    v_con RECORD;
BEGIN
    -- Drop existing role_name CHECK constraint(s) on public.user_roles
    FOR v_con IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.user_roles'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%role_name%'
    LOOP
        EXECUTE format('ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS %I', v_con.conname);
    END LOOP;

    -- Drop existing assigned_role CHECK constraint(s) on public.user_unit_assignments
    FOR v_con IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.user_unit_assignments'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%assigned_role%'
    LOOP
        EXECUTE format('ALTER TABLE public.user_unit_assignments DROP CONSTRAINT IF EXISTS %I', v_con.conname);
    END LOOP;
END $$;

ALTER TABLE public.user_roles
ADD CONSTRAINT user_roles_role_name_check CHECK (
    role_name IN (
        'system_admin',
        'ysa_leader',
        'stake_presidency',
        'bishop',
        'branch_president',
        'stake_clerk',
        'ward_clerk',
        'branch_clerk'
    )
);

ALTER TABLE public.user_unit_assignments
ADD CONSTRAINT user_unit_assignments_assigned_role_check CHECK (
    assigned_role IN (
        'bishop',
        'branch_president',
        'ysa_leader',
        'ward_clerk',
        'branch_clerk'
    )
);

-- =============================================================================
-- PART 2: LEAST-PRIVILEGE HELPER FUNCTIONS
-- =============================================================================
-- Note: public.is_stake_wide_leader(p_user_id) remains strictly restricted to
-- ('system_admin', 'stake_presidency') so that stake_clerk NEVER gains access
-- to security audit logs, user governance, or session reopening.

CREATE OR REPLACE FUNCTION public.is_stake_clerk(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = p_user_id
          AND role_name = 'stake_clerk'
    );
$$;

REVOKE EXECUTE ON FUNCTION public.is_stake_clerk(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_stake_clerk(UUID) TO authenticated;

-- Harden get_user_assigned_units so unit access requires an active matching role
-- in public.user_roles paired with the unit assignment in public.user_unit_assignments.
CREATE OR REPLACE FUNCTION public.get_user_assigned_units(p_user_id UUID)
RETURNS TABLE (unit_id UUID)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT DISTINCT uua.unit_id
    FROM public.user_unit_assignments uua
    JOIN public.user_roles ur
      ON ur.user_id = uua.user_id
     AND ur.role_name = uua.assigned_role
    WHERE uua.user_id = p_user_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_assigned_units(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_assigned_units(UUID) TO authenticated;

-- =============================================================================
-- PART 3: READ-ONLY REPORTING & CENSUS RLS POLICIES FOR CLERKS
-- =============================================================================

-- 3.1 Members: Read access for stake-wide leaders, stake_clerk, or unit-assigned roles (including ward/branch clerks)
DROP POLICY IF EXISTS policy_members_view ON public.members;
CREATE POLICY policy_members_view ON public.members
FOR SELECT TO authenticated
USING (
    public.is_stake_wide_leader(auth.uid())
    OR public.is_stake_clerk(auth.uid())
    OR home_unit_id IN (SELECT unit_id FROM public.get_user_assigned_units(auth.uid()))
);

-- 3.2 Members: Write access (INSERT, UPDATE, DELETE) strictly excludes all clerk roles
DROP POLICY IF EXISTS policy_members_manage ON public.members;
CREATE POLICY policy_members_manage ON public.members
FOR ALL TO authenticated
USING (
    public.is_stake_wide_leader(auth.uid())
    OR EXISTS (
        SELECT 1
        FROM public.user_unit_assignments uua
        JOIN public.user_roles ur
          ON ur.user_id = uua.user_id
         AND ur.role_name = uua.assigned_role
        WHERE uua.user_id = auth.uid()
          AND uua.unit_id = public.members.home_unit_id
          AND uua.assigned_role IN ('bishop', 'branch_president', 'ysa_leader')
    )
)
WITH CHECK (
    public.is_stake_wide_leader(auth.uid())
    OR EXISTS (
        SELECT 1
        FROM public.user_unit_assignments uua
        JOIN public.user_roles ur
          ON ur.user_id = uua.user_id
         AND ur.role_name = uua.assigned_role
        WHERE uua.user_id = auth.uid()
          AND uua.unit_id = public.members.home_unit_id
          AND uua.assigned_role IN ('bishop', 'branch_president', 'ysa_leader')
    )
);

-- 3.3 Attendance Records: Read access for stake-wide leaders, stake_clerk, or unit-assigned roles
DROP POLICY IF EXISTS policy_attendance_view ON public.attendance_records;
CREATE POLICY policy_attendance_view ON public.attendance_records
FOR SELECT TO authenticated
USING (
    public.is_stake_wide_leader(auth.uid())
    OR public.is_stake_clerk(auth.uid())
    OR recorded_unit_id IN (SELECT unit_id FROM public.get_user_assigned_units(auth.uid()))
);

-- 3.4 Session Visitors: Read access for stake-wide leaders, stake_clerk, or unit-assigned roles (invited by their unit)
DROP POLICY IF EXISTS policy_visitors_view ON public.session_visitors;
CREATE POLICY policy_visitors_view ON public.session_visitors
FOR SELECT TO authenticated
USING (
    public.is_stake_wide_leader(auth.uid())
    OR public.is_stake_clerk(auth.uid())
    OR (
        inviting_unit_id IS NOT NULL
        AND inviting_unit_id IN (SELECT unit_id FROM public.get_user_assigned_units(auth.uid()))
    )
);
