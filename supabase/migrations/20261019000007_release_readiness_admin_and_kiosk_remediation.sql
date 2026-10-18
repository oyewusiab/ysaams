-- =============================================================================
-- MIGRATION: 20261019000007_release_readiness_admin_and_kiosk_remediation.sql
-- DESCRIPTION: Consolidated Release-Readiness Remediation
--              1. Restores authenticated table-level write grants on stake_units,
--                 user_profiles, user_roles, and user_unit_assignments (strictly
--                 enforced by FORCE ROW LEVEL SECURITY and is_system_admin(auth.uid())).
--              2. Adds automatic auth.users -> public.user_profiles sync trigger
--                 and backfills any existing auth.users rows missing profiles.
--              3. Adds token-validated search_terminal_members RPC so authorized
--                 public kiosks can look up active members in session scope without
--                 granting anon direct SELECT on public.members.
--              4. Enforces participating_units in record_attendance and
--                 visitor_registration_enabled in record_visitor_attendance.
-- STAKE: Abeokuta Nigeria Obantoko Stake
-- STATUS: Staged for Owner Review & Execution Before Production Launch
-- IDEMPOTENT: Non-destructive; safe to run repeatedly
-- =============================================================================

-- =============================================================================
-- PART 1: RESTORE ADMIN TABLE-LEVEL GRANTS GATED BY FORCED RLS
-- =============================================================================
-- Note: Migration 5 revoked ALL on all 12 tables and only granted SELECT on
-- stake_units, user_roles, and user_unit_assignments to authenticated.
-- Without table-level INSERT/UPDATE/DELETE grants to authenticated, PostgreSQL
-- blocks even system_admin before evaluating RLS policies (policy_units_admin_all,
-- policy_roles_admin_write, policy_assignments_admin_write).
-- Anonymous (anon) retains ZERO write privileges on all tables.

GRANT INSERT, UPDATE ON TABLE public.stake_units TO authenticated;
GRANT INSERT ON TABLE public.user_profiles TO authenticated;
GRANT INSERT, DELETE ON TABLE public.user_roles TO authenticated;
GRANT INSERT, DELETE ON TABLE public.user_unit_assignments TO authenticated;

DROP POLICY IF EXISTS policy_profiles_admin_insert ON public.user_profiles;
CREATE POLICY policy_profiles_admin_insert ON public.user_profiles
FOR INSERT TO authenticated
WITH CHECK (public.is_system_admin(auth.uid()));

-- =============================================================================
-- PART 2: AUTOMATIC AUTH.USERS -> PUBLIC.USER_PROFILES SYNC & BACKFILL
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_sync_auth_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_full_name TEXT;
BEGIN
    v_full_name := COALESCE(
        NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
        NULLIF(trim(NEW.raw_user_meta_data->>'name'), ''),
        split_part(COALESCE(NEW.email, 'Leader'), '@', 1)
    );

    INSERT INTO public.user_profiles (id, full_name, email, account_status)
    VALUES (NEW.id, v_full_name, NEW.email, 'active')
    ON CONFLICT (id) DO UPDATE
    SET email = COALESCE(EXCLUDED.email, public.user_profiles.email),
        updated_at = timezone('utc'::text, now());

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
CREATE TRIGGER trg_on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_auth_user_profile();

REVOKE EXECUTE ON FUNCTION public.fn_sync_auth_user_profile() FROM PUBLIC, anon, authenticated;

-- Backfill any existing auth.users identities that do not yet have a user_profiles row
INSERT INTO public.user_profiles (id, full_name, email, account_status)
SELECT
    u.id,
    COALESCE(
        NULLIF(trim(u.raw_user_meta_data->>'full_name'), ''),
        NULLIF(trim(u.raw_user_meta_data->>'name'), ''),
        split_part(COALESCE(u.email, 'Leader'), '@', 1)
    ),
    u.email,
    'active'
FROM auth.users u
WHERE NOT EXISTS (
    SELECT 1 FROM public.user_profiles p WHERE p.id = u.id
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- PART 3: TOKEN-VALIDATED KIOSK MEMBER LOOKUP RPC
-- =============================================================================
-- Allows an authorized kiosk possessing a valid, non-revoked, non-expired
-- terminal bearer token for an active session to search active members within
-- the session's participating units without exposing public.members to anon.

CREATE OR REPLACE FUNCTION public.search_terminal_members(
    p_session_id UUID,
    p_terminal_token TEXT,
    p_unit_id UUID DEFAULT NULL,
    p_search_query TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_token_hash TEXT;
    v_terminal RECORD;
    v_session RECORD;
    v_now TIMESTAMPTZ;
    v_clean_query TEXT;
    v_results JSONB;
BEGIN
    v_now := timezone('utc'::text, now());

    IF p_terminal_token IS NULL OR length(trim(p_terminal_token)) = 0 THEN
        RAISE EXCEPTION 'Unauthorized: Terminal bearer token is required.';
    END IF;

    v_token_hash := encode(sha256(convert_to(trim(p_terminal_token), 'UTF8')), 'hex');

    SELECT * INTO v_terminal
    FROM public.terminal_authorizations
    WHERE terminal_token_hash = v_token_hash
      AND session_id = p_session_id
      AND is_revoked = FALSE
      AND lease_expires_at >= v_now;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unauthorized terminal token, terminal revoked, or terminal lease expired.';
    END IF;

    SELECT * INTO v_session
    FROM public.activity_sessions
    WHERE id = p_session_id AND status = 'active';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attendance session is not active.';
    END IF;

    v_clean_query := lower(trim(COALESCE(p_search_query, '')));

    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    INTO v_results
    FROM (
        SELECT
            m.id,
            m.full_name,
            m.preferred_name,
            m.home_unit_id,
            u.unit_name AS home_unit_name
        FROM public.members m
        JOIN public.stake_units u ON u.id = m.home_unit_id
        WHERE m.is_active = TRUE
          AND u.is_active = TRUE
          AND (p_unit_id IS NULL OR m.home_unit_id = p_unit_id)
          AND (
              v_session.participating_units IS NULL
              OR array_length(v_session.participating_units, 1) IS NULL
              OR m.home_unit_id = ANY(v_session.participating_units)
          )
          AND (
              v_clean_query = ''
              OR lower(m.full_name) LIKE '%' || v_clean_query || '%'
              OR (m.preferred_name IS NOT NULL AND lower(m.preferred_name) LIKE '%' || v_clean_query || '%')
          )
        ORDER BY m.full_name ASC
        LIMIT 10
    ) t;

    RETURN v_results;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.search_terminal_members(UUID, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_terminal_members(UUID, TEXT, UUID, TEXT) TO anon, authenticated;

-- =============================================================================
-- PART 4: ENFORCE PARTICIPATING UNITS & VISITOR TOGGLE IN KIOSK CHECK-IN RPCS
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_attendance(
    p_session_id UUID,
    p_member_id UUID,
    p_terminal_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_token_hash TEXT;
    v_terminal RECORD;
    v_session RECORD;
    v_member RECORD;
    v_now TIMESTAMPTZ;
    v_attendance_id UUID;
BEGIN
    v_now := timezone('utc'::text, now());

    IF p_terminal_token IS NULL OR length(trim(p_terminal_token)) = 0 THEN
        RAISE EXCEPTION 'Unauthorized: Terminal bearer token is required.';
    END IF;

    v_token_hash := encode(sha256(convert_to(trim(p_terminal_token), 'UTF8')), 'hex');

    -- 1. Validate terminal token
    SELECT * INTO v_terminal
    FROM public.terminal_authorizations
    WHERE terminal_token_hash = v_token_hash
      AND session_id = p_session_id
      AND is_revoked = FALSE
      AND lease_expires_at >= v_now;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unauthorized terminal token, terminal revoked, or terminal lease expired.';
    END IF;

    -- 2. Validate session status
    SELECT * INTO v_session
    FROM public.activity_sessions
    WHERE id = p_session_id;

    IF NOT FOUND OR v_session.status != 'active' THEN
        RAISE EXCEPTION 'Session is not active. Attendance writes are closed.';
    END IF;

    -- 3. Validate member exists and is active
    SELECT * INTO v_member
    FROM public.members
    WHERE id = p_member_id AND is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Member record not found or inactive.';
    END IF;

    -- 4. Validate participating_units restriction (if restricted)
    IF v_session.participating_units IS NOT NULL AND array_length(v_session.participating_units, 1) > 0 THEN
        IF NOT (v_member.home_unit_id = ANY(v_session.participating_units)) THEN
            RAISE EXCEPTION 'Member home unit is not authorized for this session (participating units restriction).';
        END IF;
    END IF;

    -- 5. Pre-check duplicate prevention
    IF EXISTS (
        SELECT 1 FROM public.attendance_records
        WHERE session_id = p_session_id AND member_id = p_member_id
    ) THEN
        RAISE EXCEPTION 'Duplicate check-in: % has already been marked present for this session.', v_member.full_name;
    END IF;

    -- 6. Record attendance with concurrent unique constraint trap
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
            v_terminal.id,
            v_now
        )
        RETURNING id INTO v_attendance_id;
    EXCEPTION
        WHEN unique_violation THEN
            RAISE EXCEPTION 'Duplicate check-in: % was concurrently marked present for this session.', v_member.full_name;
    END;

    -- 7. Extend terminal lease on activity
    UPDATE public.terminal_authorizations
    SET last_seen_at = v_now,
        lease_expires_at = v_now + interval '10 minutes'
    WHERE id = v_terminal.id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'attendance_id', v_attendance_id,
        'member_name', v_member.full_name,
        'check_in_time', v_now
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_attendance(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_attendance(UUID, UUID, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_visitor_attendance(
    p_session_id UUID,
    p_full_name TEXT,
    p_contact_phone TEXT,
    p_is_church_member BOOLEAN,
    p_inviting_unit_id UUID,
    p_terminal_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_token_hash TEXT;
    v_terminal RECORD;
    v_session RECORD;
    v_now TIMESTAMPTZ;
    v_visitor_id UUID;
BEGIN
    v_now := timezone('utc'::text, now());

    IF p_terminal_token IS NULL OR length(trim(p_terminal_token)) = 0 THEN
        RAISE EXCEPTION 'Unauthorized: Terminal bearer token is required.';
    END IF;

    v_token_hash := encode(sha256(convert_to(trim(p_terminal_token), 'UTF8')), 'hex');

    -- 1. Validate terminal token
    SELECT * INTO v_terminal
    FROM public.terminal_authorizations
    WHERE terminal_token_hash = v_token_hash
      AND session_id = p_session_id
      AND is_revoked = FALSE
      AND lease_expires_at >= v_now;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unauthorized terminal token, terminal revoked, or terminal lease expired.';
    END IF;

    -- 2. Validate session status and visitor_registration_enabled flag
    SELECT * INTO v_session
    FROM public.activity_sessions
    WHERE id = p_session_id;

    IF NOT FOUND OR v_session.status != 'active' THEN
        RAISE EXCEPTION 'Session is not active.';
    END IF;

    IF v_session.visitor_registration_enabled IS NOT TRUE THEN
        RAISE EXCEPTION 'Visitor registration is disabled for this session.';
    END IF;

    IF trim(p_full_name) IS NULL OR length(trim(p_full_name)) < 2 THEN
        RAISE EXCEPTION 'Visitor full name is required (at least 2 characters).';
    END IF;

    -- 3. Optional inviting unit validation (including participating_units scope)
    IF p_inviting_unit_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.stake_units WHERE id = p_inviting_unit_id AND is_active = TRUE) THEN
            RAISE EXCEPTION 'Selected inviting unit is invalid or inactive.';
        END IF;

        IF v_session.participating_units IS NOT NULL AND array_length(v_session.participating_units, 1) > 0 THEN
            IF NOT (p_inviting_unit_id = ANY(v_session.participating_units)) THEN
                RAISE EXCEPTION 'Selected inviting unit is not authorized for this session (participating units restriction).';
            END IF;
        END IF;
    END IF;

    INSERT INTO public.session_visitors (
        session_id,
        full_name,
        contact_phone,
        is_church_member,
        inviting_unit_id,
        recorded_by_terminal_id,
        created_at
    )
    VALUES (
        p_session_id,
        trim(p_full_name),
        trim(p_contact_phone),
        COALESCE(p_is_church_member, FALSE),
        p_inviting_unit_id,
        v_terminal.id,
        v_now
    )
    RETURNING id INTO v_visitor_id;

    -- 4. Extend lease
    UPDATE public.terminal_authorizations
    SET last_seen_at = v_now,
        lease_expires_at = v_now + interval '10 minutes'
    WHERE id = v_terminal.id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'visitor_id', v_visitor_id,
        'full_name', trim(p_full_name),
        'check_in_time', v_now
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_visitor_attendance(UUID, TEXT, TEXT, BOOLEAN, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_visitor_attendance(UUID, TEXT, TEXT, BOOLEAN, UUID, TEXT) TO anon, authenticated;

