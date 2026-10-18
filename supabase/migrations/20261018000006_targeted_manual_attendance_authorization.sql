-- =============================================================================
-- MIGRATION: 20261018000006_targeted_manual_attendance_authorization.sql
-- DESCRIPTION: Hardened Replacement of record_manual_attendance RPC
--              - Validates caller account_status = 'active'
--              - Restricts stake-wide access strictly to is_stake_wide_leader(auth.uid())
--              - Requires ward/branch leaders to have active matching user_roles AND valid user_unit_assignments
--              - Validates session participating_units restrictions
--              - Safely handles concurrent duplicate submissions via unique constraint trap
--              - Preserves SECURITY DEFINER and secure search_path
--              - Non-destructive (no drops, truncations, or schema loss)
-- STAKE: Abeokuta Nigeria Obantoko Stake
-- STATUS: Staged for Review (DO NOT EXECUTE UNTIL EXPLICITLY AUTHORIZED)
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
    v_caller_status TEXT;
    v_session RECORD;
    v_member RECORD;
    v_now TIMESTAMPTZ;
    v_attendance_id UUID;
    v_is_stake_leader BOOLEAN;
    v_is_unit_leader BOOLEAN;
BEGIN
    -- 1. Authentication check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required: Anonymous callers cannot record manual attendance.';
    END IF;

    -- 2. Verify caller profile exists and is active
    SELECT account_status INTO v_caller_status
    FROM public.user_profiles
    WHERE id = v_caller_id;

    IF NOT FOUND OR v_caller_status != 'active' THEN
        RAISE EXCEPTION 'Unauthorized: Caller account is deactivated, pending, or does not exist.';
    END IF;

    v_now := timezone('utc'::text, now());

    -- 3. Validate activity session exists and is active
    SELECT * INTO v_session
    FROM public.activity_sessions
    WHERE id = p_session_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Activity session not found.';
    END IF;

    IF v_session.status != 'active' THEN
        RAISE EXCEPTION 'Attendance session is % and cannot accept check-ins.', v_session.status;
    END IF;

    -- 4. Validate member exists, is active, and retrieve home unit
    SELECT * INTO v_member
    FROM public.members
    WHERE id = p_member_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Member not found.';
    END IF;

    IF v_member.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'Member is inactive and cannot be checked in.';
    END IF;

    -- 5. Validate session participating_units restriction (if restricted)
    IF v_session.participating_units IS NOT NULL AND array_length(v_session.participating_units, 1) > 0 THEN
        IF NOT (v_member.home_unit_id = ANY(v_session.participating_units)) THEN
            RAISE EXCEPTION 'Member home unit is not authorized for this session (participating units restriction).';
        END IF;
    END IF;

    -- 6. Role & Unit Authorization Check
    -- Stake-wide leader check (system_admin or stake_presidency)
    v_is_stake_leader := public.is_stake_wide_leader(v_caller_id);

    IF v_is_stake_leader THEN
        -- Stake-wide leaders have stake-wide check-in authority
        NULL;
    ELSE
        -- Ward / Branch leaders MUST have:
        -- a) A legitimate unit leader role in public.user_roles ('bishop', 'branch_president', 'ysa_leader')
        -- AND
        -- b) An explicit, matching assignment in public.user_unit_assignments for the member's home unit
        -- with the exact same assigned_role
        SELECT EXISTS (
            SELECT 1
            FROM public.user_roles ur
            JOIN public.user_unit_assignments uua 
              ON uua.user_id = ur.user_id 
             AND uua.assigned_role = ur.role_name
            WHERE ur.user_id = v_caller_id
              AND ur.role_name IN ('bishop', 'branch_president', 'ysa_leader')
              AND uua.unit_id = v_member.home_unit_id
        ) INTO v_is_unit_leader;

        IF NOT v_is_unit_leader THEN
            RAISE EXCEPTION 'Unauthorized: Caller does not have an authorized leadership role assigned to the member unit.';
        END IF;
    END IF;

    -- 7. Pre-check for duplicate attendance
    IF EXISTS (
        SELECT 1 FROM public.attendance_records
        WHERE session_id = p_session_id AND member_id = p_member_id
    ) THEN
        RAISE EXCEPTION 'Duplicate check-in: % is already marked present for this session.', v_member.full_name;
    END IF;

    -- 8. Safe insertion with concurrent duplicate handling via unique constraint trap
    BEGIN
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
    EXCEPTION
        WHEN unique_violation THEN
            RAISE EXCEPTION 'Duplicate check-in: % was concurrently marked present for this session.', v_member.full_name;
    END;

    -- 9. Immutable audit logging
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
            'recorded_unit_id', v_member.home_unit_id,
            'notes', NULLIF(trim(p_notes), '')
        )
    );

    -- 10. Return success response
    RETURN jsonb_build_object(
        'success', TRUE,
        'attendance_id', v_attendance_id,
        'member_name', v_member.full_name,
        'check_in_time', v_now,
        'manual', TRUE
    );
END;
$$;

-- 11. Manage function execution privileges
-- Revoke from PUBLIC and anon; grant explicitly to authenticated users
REVOKE EXECUTE ON FUNCTION public.record_manual_attendance(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_manual_attendance(UUID, UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_manual_attendance(UUID, UUID, TEXT) TO authenticated;
