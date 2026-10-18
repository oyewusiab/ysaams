-- =============================================================================
-- MIGRATION: 20261013000005_security_and_privilege_remediation.sql
-- DESCRIPTION: Post-Audit Security Hardening, Table Privilege Revocations,
--              Profile Column Protection, Visitor Scoping, and Manual Check-in RPC
-- STAKE: Abeokuta Nigeria Obantoko Stake
-- STATUS: Staged for Phase 2B Review (DO NOT EXECUTE UNTIL EXPLICITLY AUTHORIZED)
-- IDEMPOTENT: Safe to run repeatedly; preserves existing tables, data, and constraints
-- =============================================================================

-- =============================================================================
-- PART 1: SEC-01 REMEDIATION — ELIMINATE AUDIT LOG FABRICATION
-- Drop the overly permissive insert policy on audit_logs.
-- Audit log creation is strictly restricted to trusted SECURITY DEFINER RPCs.
-- =============================================================================
DROP POLICY IF EXISTS policy_audit_insert ON public.audit_logs;

-- Ensure audit_logs is readable only by authorized stake-wide leaders
DROP POLICY IF EXISTS policy_audit_read ON public.audit_logs;
CREATE POLICY policy_audit_read ON public.audit_logs
FOR SELECT TO authenticated
USING (public.is_stake_wide_leader(auth.uid()));

-- =============================================================================
-- PART 2: SEC-02 REMEDIATION — COMPREHENSIVE PRIVILEGE HARDENING ACROSS ALL 12 TABLES
-- Strip default Supabase DAC grants (SELECT, INSERT, UPDATE, DELETE) from anon & authenticated.
-- Then grant strictly the minimum required SELECT permissions.
-- All state mutations (INSERT, UPDATE, DELETE) are mediated by RLS policies or
-- dedicated SECURITY DEFINER RPCs with explicit authorization checks.
-- =============================================================================

-- 2.1 Revoke default grants across all public application tables
REVOKE ALL ON TABLE public.stake_units FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.user_profiles FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.user_roles FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.user_unit_assignments FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.audit_logs FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.members FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.activities FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.activity_sessions FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.terminal_authorizations FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.attendance_records FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.session_visitors FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.session_reopening_requests FROM anon, authenticated, public;

-- 2.2 Re-grant targeted, RLS-filtered read access to authenticated role
GRANT SELECT ON TABLE public.stake_units TO anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.user_profiles TO authenticated;
GRANT SELECT ON TABLE public.user_roles TO authenticated;
GRANT SELECT ON TABLE public.user_unit_assignments TO authenticated;
GRANT SELECT ON TABLE public.audit_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.activities TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.activity_sessions TO authenticated;
GRANT SELECT ON TABLE public.attendance_records TO authenticated;
GRANT SELECT ON TABLE public.session_visitors TO authenticated;
GRANT SELECT, INSERT ON TABLE public.session_reopening_requests TO authenticated;

-- Note: terminal_authorizations has NO direct grants to authenticated or anon.
-- It is accessed exclusively via SECURITY DEFINER functions:
-- authorize_terminal, heartbeat_terminal_lease, release_terminal, record_attendance.

-- =============================================================================
-- PART 3: SEC-03 REMEDIATION — PROTECT SENSITIVE USER PROFILE COLUMNS
-- Ordinary authenticated users must never modify account_status or email.
-- Only system_admin can alter these critical governance fields.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_protect_profile_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- If user is NOT a system_admin, prevent modification of account_status and email
    IF NOT public.is_system_admin(auth.uid()) THEN
        IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
            RAISE EXCEPTION 'Unauthorized: Only system administrators can alter account status.';
        END IF;

        IF NEW.email IS DISTINCT FROM OLD.email THEN
            RAISE EXCEPTION 'Unauthorized: Profile email address cannot be changed directly.';
        END IF;
    END IF;

    NEW.updated_at := timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_fields ON public.user_profiles;
CREATE TRIGGER trg_protect_profile_fields
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.fn_protect_profile_fields();

-- =============================================================================
-- PART 4: SEC-04 REMEDIATION — SECURE VISITOR VISIBILITY BOUNDARY
-- Unassigned visitors (inviting_unit_id IS NULL) must NOT be visible to local
-- ward/branch leaders; they are strictly stake-wide assets.
-- =============================================================================
DROP POLICY IF EXISTS policy_visitors_view ON public.session_visitors;
CREATE POLICY policy_visitors_view ON public.session_visitors
FOR SELECT TO authenticated
USING (
    public.is_stake_wide_leader(auth.uid()) 
    OR (
        inviting_unit_id IS NOT NULL 
        AND inviting_unit_id IN (SELECT unit_id FROM public.get_user_assigned_units(auth.uid()))
    )
);

-- =============================================================================
-- PART 5: SEC-06 REMEDIATION — LEADER MANUAL CHECK-IN RPC
-- Enables authorized leaders to mark members present directly without a terminal token.
-- Validates:
-- 1. Caller is an authenticated leader (stake_presidency, system_admin, or ysa_leader)
-- 2. Session is active (or authorized for the activity)
-- 3. Member belongs to an authorized unit (or caller is stake-wide)
-- 4. Session is open for attendance
-- 5. Duplicate check-in is strictly prevented
-- 6. Immutably records audit log with actor_id and rationale
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_manual_attendance(
    p_session_id UUID,
    p_member_id UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_session RECORD;
    v_member RECORD;
    v_now TIMESTAMPTZ;
    v_attendance_id UUID;
    v_is_stake_leader BOOLEAN;
    v_is_unit_leader BOOLEAN;
BEGIN
    v_caller_id := auth.uid();
    v_now := timezone('utc'::text, now());

    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- Validate session exists and is active
    SELECT * INTO v_session
    FROM public.activity_sessions
    WHERE id = p_session_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Activity session not found.';
    END IF;

    IF v_session.status != 'active' THEN
        RAISE EXCEPTION 'Attendance session is % and cannot accept check-ins.', v_session.status;
    END IF;

    -- Validate member exists and is active
    SELECT * INTO v_member
    FROM public.members
    WHERE id = p_member_id AND is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Member not found or inactive.';
    END IF;

    -- Authorization check: Stake-wide leader OR unit-assigned leader for member's unit
    v_is_stake_leader := public.is_stake_wide_leader(v_caller_id);
    v_is_unit_leader := EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = v_caller_id AND ur.role_name = 'ysa_leader'
    ) OR EXISTS (
        SELECT 1 FROM public.user_unit_assignments uua
        WHERE uua.user_id = v_caller_id AND uua.unit_id = v_member.home_unit_id
    );

    IF NOT (v_is_stake_leader OR v_is_unit_leader) THEN
        RAISE EXCEPTION 'Unauthorized: You do not have permission to check in members for this unit.';
    END IF;

    -- Duplicate check-in prevention
    IF EXISTS (
        SELECT 1 FROM public.attendance_records
        WHERE session_id = p_session_id AND member_id = p_member_id
    ) THEN
        RAISE EXCEPTION 'Duplicate check-in: % is already marked present for this session.', v_member.full_name;
    END IF;

    -- Record attendance with recorded_by_terminal_id set to NULL for manual check-ins
    INSERT INTO public.attendance_records (
        session_id,
        member_id,
        recorded_unit_id,
        recorded_by_terminal_id,
        check_in_time
    )
    VALUES (
        p_session_id,
        p_member_id,
        v_member.home_unit_id,
        NULL,
        v_now
    )
    RETURNING id INTO v_attendance_id;

    -- Write audit log record
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        target_record_id,
        target_table,
        outcome,
        metadata
    )
    VALUES (
        v_caller_id,
        'MANUAL_ATTENDANCE_CHECKIN',
        v_attendance_id::text,
        'attendance_records',
        'success',
        jsonb_build_object(
            'session_id', p_session_id,
            'member_id', p_member_id,
            'member_name', v_member.full_name,
            'notes', NULLIF(trim(p_notes), '')
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'attendance_id', v_attendance_id,
        'member_name', v_member.full_name,
        'check_in_time', v_now,
        'manual', TRUE
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_manual_attendance(UUID, UUID, TEXT) TO authenticated;

-- =============================================================================
-- PART 6: REMEDIATION VERIFICATION QUERIES
-- =============================================================================
-- 1. Confirm policy_audit_insert is gone:
--    SELECT policyname FROM pg_policies WHERE tablename = 'audit_logs';
-- 2. Confirm default DAC permissions revoked:
--    SELECT table_name, privilege_type, grantee FROM information_schema.table_privileges
--    WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated');
-- 3. Confirm profile protection trigger exists:
--    SELECT tgname FROM pg_trigger WHERE tgname = 'trg_protect_profile_fields';
-- 4. Confirm manual check-in RPC exists:
--    SELECT proname, prosecdef FROM pg_proc WHERE proname = 'record_manual_attendance';
