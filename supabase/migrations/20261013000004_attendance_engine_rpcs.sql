-- =============================================================================
-- MIGRATION: 20261013000004_attendance_engine_rpcs.sql
-- DESCRIPTION: Atomic Terminal Redemption, Check-in Engines, and Lifecycle RPCs
-- STAKE: Abeokuta Nigeria Obantoko Stake
-- STATUS: Prepared for Review Only (DO NOT EXECUTE IN PHASE 2A)
-- =============================================================================

-- 1. Unambiguous 6-Character Alphanumeric Code Generator
CREATE OR REPLACE FUNCTION public.generate_session_attendance_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_alphabet TEXT := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    v_len INT := length(v_alphabet);
    v_code TEXT := '';
    v_i INT;
    v_bytes BYTEA;
    v_rand_byte INT;
BEGIN
    v_bytes := extensions.gen_random_bytes(6);
    FOR v_i IN 0..5 LOOP
        v_rand_byte := get_byte(v_bytes, v_i);
        v_code := v_code || substr(v_alphabet, (v_rand_byte % v_len) + 1, 1);
    END LOOP;
    RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_session_attendance_code() TO authenticated;

-- 2. Initiate Attendance Session RPC
CREATE OR REPLACE FUNCTION public.initiate_attendance_session(
    p_session_id UUID,
    p_code TEXT,
    p_max_terminals INT,
    p_expiry_minutes INT DEFAULT 240
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_code_hash TEXT;
    v_clean_code TEXT;
    v_expires_at TIMESTAMPTZ;
BEGIN
    v_caller_id := auth.uid();
    IF NOT (public.is_stake_wide_leader(v_caller_id) OR EXISTS (
        SELECT 1 FROM public.user_roles WHERE user_id = v_caller_id AND role_name = 'ysa_leader'
    )) THEN
        RAISE EXCEPTION 'Unauthorized: Only authorized YSA leaders or administrators can initiate attendance.';
    END IF;

    IF p_max_terminals < 1 OR p_max_terminals > 10 THEN
        RAISE EXCEPTION 'Invalid terminal limit: Must be between 1 and 10.';
    END IF;

    v_clean_code := upper(trim(p_code));
    IF length(v_clean_code) != 6 THEN
        RAISE EXCEPTION 'Invalid session code length: Must be exactly 6 characters.';
    END IF;

    v_code_hash := encode(sha256(convert_to(v_clean_code, 'UTF8')), 'hex');
    v_expires_at := timezone('utc'::text, now()) + (p_expiry_minutes || ' minutes')::interval;

    UPDATE public.activity_sessions
    SET status = 'active',
        max_terminals = p_max_terminals,
        code_hash = v_code_hash,
        code_expires_at = v_expires_at,
        initiated_by = v_caller_id,
        initiated_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now())
    WHERE id = p_session_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found.';
    END IF;

    -- Invalidate previous terminals if code was regenerated
    UPDATE public.terminal_authorizations
    SET is_revoked = TRUE,
        revoked_at = timezone('utc'::text, now())
    WHERE session_id = p_session_id AND is_revoked = FALSE;

    INSERT INTO public.audit_logs (actor_id, action, target_record_id, target_table, outcome, metadata)
    VALUES (
        v_caller_id,
        'INITIATE_SESSION',
        p_session_id::text,
        'activity_sessions',
        'success',
        jsonb_build_object('max_terminals', p_max_terminals, 'expiry_minutes', p_expiry_minutes)
    );

    RETURN jsonb_build_object('success', TRUE, 'session_id', p_session_id, 'expires_at', v_expires_at);
END;
$$;

GRANT EXECUTE ON FUNCTION public.initiate_attendance_session(UUID, TEXT, INT, INT) TO authenticated;

-- 3. Atomic Terminal Authorization RPC (Row-Locked)
CREATE OR REPLACE FUNCTION public.authorize_terminal(
    p_session_code TEXT,
    p_terminal_label TEXT,
    p_existing_terminal_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_clean_code TEXT;
    v_code_hash TEXT;
    v_session RECORD;
    v_now TIMESTAMPTZ;
    v_lease_duration INTERVAL := interval '10 minutes';
    v_existing_token_hash TEXT;
    v_terminal_id UUID;
    v_active_terminal_count INT;
    v_new_token TEXT;
    v_new_token_hash TEXT;
BEGIN
    v_now := timezone('utc'::text, now());
    v_clean_code := upper(trim(p_session_code));
    v_code_hash := encode(sha256(convert_to(v_clean_code, 'UTF8')), 'hex');

    -- Row-level lock on session to serialize concurrent redemptions
    SELECT * INTO v_session
    FROM public.activity_sessions
    WHERE code_hash = v_code_hash AND status = 'active'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid attendance code or session is not active.';
    END IF;

    IF v_session.code_expires_at IS NOT NULL AND v_session.code_expires_at < v_now THEN
        RAISE EXCEPTION 'Attendance session code has expired.';
    END IF;

    -- Handle existing token reconnection without consuming an extra slot
    IF p_existing_terminal_token IS NOT NULL AND length(trim(p_existing_terminal_token)) > 0 THEN
        v_existing_token_hash := encode(sha256(convert_to(trim(p_existing_terminal_token), 'UTF8')), 'hex');
        SELECT id INTO v_terminal_id
        FROM public.terminal_authorizations
        WHERE terminal_token_hash = v_existing_token_hash
          AND session_id = v_session.id
          AND is_revoked = FALSE;

        IF FOUND THEN
            UPDATE public.terminal_authorizations
            SET last_seen_at = v_now,
                lease_expires_at = v_now + v_lease_duration
            WHERE id = v_terminal_id;

            RETURN jsonb_build_object(
                'success', TRUE,
                'session_id', v_session.id,
                'session_title', v_session.session_title,
                'session_date', v_session.session_date,
                'terminal_id', v_terminal_id,
                'terminal_token', trim(p_existing_terminal_token),
                'reconnected', TRUE
            );
        END IF;
    END IF;

    -- Revoke expired leases to free abandoned tab capacity
    UPDATE public.terminal_authorizations
    SET is_revoked = TRUE,
        revoked_at = v_now
    WHERE session_id = v_session.id
      AND is_revoked = FALSE
      AND lease_expires_at < v_now;

    -- Count active non-expired terminals
    SELECT count(*) INTO v_active_terminal_count
    FROM public.terminal_authorizations
    WHERE session_id = v_session.id
      AND is_revoked = FALSE
      AND lease_expires_at >= v_now;

    IF v_active_terminal_count >= v_session.max_terminals THEN
        RAISE EXCEPTION 'Terminal limit reached (% of % active). Please contact the session administrator.',
            v_active_terminal_count, v_session.max_terminals;
    END IF;

    -- Issue 32-byte cryptographically random bearer token
    v_new_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_new_token_hash := encode(sha256(convert_to(v_new_token, 'UTF8')), 'hex');

    INSERT INTO public.terminal_authorizations (
        session_id,
        terminal_token_hash,
        terminal_label,
        last_seen_at,
        lease_expires_at
    )
    VALUES (
        v_session.id,
        v_new_token_hash,
        COALESCE(NULLIF(trim(p_terminal_label), ''), 'Attendance Terminal'),
        v_now,
        v_now + v_lease_duration
    )
    RETURNING id INTO v_terminal_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'session_id', v_session.id,
        'session_title', v_session.session_title,
        'session_date', v_session.session_date,
        'terminal_id', v_terminal_id,
        'terminal_token', v_new_token,
        'reconnected', FALSE
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.authorize_terminal(TEXT, TEXT, TEXT) TO anon, authenticated;

-- 4. Terminal Lease Heartbeat RPC
CREATE OR REPLACE FUNCTION public.heartbeat_terminal_lease(p_terminal_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_token_hash TEXT;
    v_terminal RECORD;
    v_now TIMESTAMPTZ;
BEGIN
    v_now := timezone('utc'::text, now());
    v_token_hash := encode(sha256(convert_to(trim(p_terminal_token), 'UTF8')), 'hex');

    SELECT t.*, s.status AS session_status INTO v_terminal
    FROM public.terminal_authorizations t
    JOIN public.activity_sessions s ON s.id = t.session_id
    WHERE t.terminal_token_hash = v_token_hash
      AND t.is_revoked = FALSE;

    IF NOT FOUND OR v_terminal.session_status != 'active' THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Terminal lease revoked or session not active');
    END IF;

    UPDATE public.terminal_authorizations
    SET last_seen_at = v_now,
        lease_expires_at = v_now + interval '10 minutes'
    WHERE id = v_terminal.id;

    RETURN jsonb_build_object('success', TRUE, 'lease_expires_at', v_now + interval '10 minutes');
END;
$$;

GRANT EXECUTE ON FUNCTION public.heartbeat_terminal_lease(TEXT) TO anon, authenticated;

-- 5. Terminal Release RPC (Immediate Slot Deallocation)
CREATE OR REPLACE FUNCTION public.release_terminal(p_terminal_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_token_hash TEXT;
BEGIN
    v_token_hash := encode(sha256(convert_to(trim(p_terminal_token), 'UTF8')), 'hex');

    UPDATE public.terminal_authorizations
    SET is_revoked = TRUE,
        revoked_at = timezone('utc'::text, now())
    WHERE terminal_token_hash = v_token_hash
      AND is_revoked = FALSE;

    RETURN jsonb_build_object('success', TRUE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_terminal(TEXT) TO anon, authenticated;

-- 6. Record Member Attendance RPC
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
    v_token_hash := encode(sha256(convert_to(trim(p_terminal_token), 'UTF8')), 'hex');

    -- Validate terminal token
    SELECT * INTO v_terminal
    FROM public.terminal_authorizations
    WHERE terminal_token_hash = v_token_hash
      AND session_id = p_session_id
      AND is_revoked = FALSE
      AND lease_expires_at >= v_now;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unauthorized terminal token, terminal revoked, or terminal lease expired.';
    END IF;

    -- Validate session status
    SELECT * INTO v_session
    FROM public.activity_sessions
    WHERE id = p_session_id;

    IF NOT FOUND OR v_session.status != 'active' THEN
        RAISE EXCEPTION 'Session is not active. Attendance writes are closed.';
    END IF;

    -- Validate member exists
    SELECT * INTO v_member
    FROM public.members
    WHERE id = p_member_id AND is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Member record not found or inactive.';
    END IF;

    -- Check duplicate prevention
    IF EXISTS (
        SELECT 1 FROM public.attendance_records
        WHERE session_id = p_session_id AND member_id = p_member_id
    ) THEN
        RAISE EXCEPTION 'Duplicate check-in: % has already been marked present for this session.', v_member.full_name;
    END IF;

    -- Record attendance with historical unit attribution
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

    -- Extend terminal lease on activity
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

GRANT EXECUTE ON FUNCTION public.record_attendance(UUID, UUID, TEXT) TO anon, authenticated;

-- 7. Record Visitor Attendance RPC
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
    v_token_hash := encode(sha256(convert_to(trim(p_terminal_token), 'UTF8')), 'hex');

    -- Validate terminal token
    SELECT * INTO v_terminal
    FROM public.terminal_authorizations
    WHERE terminal_token_hash = v_token_hash
      AND session_id = p_session_id
      AND is_revoked = FALSE
      AND lease_expires_at >= v_now;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unauthorized terminal token, terminal revoked, or terminal lease expired.';
    END IF;

    -- Validate session
    SELECT * INTO v_session
    FROM public.activity_sessions
    WHERE id = p_session_id;

    IF NOT FOUND OR v_session.status != 'active' THEN
        RAISE EXCEPTION 'Session is not active.';
    END IF;

    IF trim(p_full_name) IS NULL OR length(trim(p_full_name)) < 2 THEN
        RAISE EXCEPTION 'Visitor full name is required (at least 2 characters).';
    END IF;

    -- Optional inviting unit validation
    IF p_inviting_unit_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.stake_units WHERE id = p_inviting_unit_id AND is_active = TRUE) THEN
            RAISE EXCEPTION 'Selected inviting unit is invalid or inactive.';
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

    -- Extend lease
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

GRANT EXECUTE ON FUNCTION public.record_visitor_attendance(UUID, TEXT, TEXT, BOOLEAN, UUID, TEXT) TO anon, authenticated;

-- 8. Close and Reopen Session RPCs
CREATE OR REPLACE FUNCTION public.close_attendance_session(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
BEGIN
    IF NOT (public.is_stake_wide_leader(v_caller_id) OR EXISTS (
        SELECT 1 FROM public.user_roles WHERE user_id = v_caller_id AND role_name = 'ysa_leader'
    )) THEN
        RAISE EXCEPTION 'Unauthorized to close attendance session.';
    END IF;

    UPDATE public.activity_sessions
    SET status = 'closed',
        closed_by = v_caller_id,
        closed_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now())
    WHERE id = p_session_id;

    -- Revoke all active terminals immediately
    UPDATE public.terminal_authorizations
    SET is_revoked = TRUE,
        revoked_at = timezone('utc'::text, now())
    WHERE session_id = p_session_id AND is_revoked = FALSE;

    INSERT INTO public.audit_logs (actor_id, action, target_record_id, target_table, outcome, metadata)
    VALUES (
        v_caller_id,
        'CLOSE_SESSION',
        p_session_id::text,
        'activity_sessions',
        'success',
        jsonb_build_object('timestamp', timezone('utc'::text, now()))
    );

    RETURN jsonb_build_object('success', TRUE, 'status', 'closed');
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_attendance_session(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reopen_attendance_session(
    p_session_id UUID,
    p_reason TEXT,
    p_duration_minutes INT DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_reopen_until TIMESTAMPTZ;
BEGIN
    IF NOT public.is_stake_wide_leader(v_caller_id) THEN
        RAISE EXCEPTION 'Unauthorized: Reopening a closed session requires System Admin or Stake Presidency authorization.';
    END IF;

    IF trim(p_reason) IS NULL OR length(trim(p_reason)) < 5 THEN
        RAISE EXCEPTION 'A mandatory justification reason (at least 5 characters) is required to reopen a closed session.';
    END IF;

    v_reopen_until := timezone('utc'::text, now()) + (p_duration_minutes || ' minutes')::interval;

    UPDATE public.activity_sessions
    SET status = 'active',
        code_expires_at = v_reopen_until,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_session_id;

    INSERT INTO public.session_reopening_requests (
        session_id,
        requested_by,
        reason,
        authorized_by,
        authorized_at,
        reopen_until
    )
    VALUES (
        p_session_id,
        v_caller_id,
        trim(p_reason),
        v_caller_id,
        timezone('utc'::text, now()),
        v_reopen_until
    );

    INSERT INTO public.audit_logs (actor_id, action, target_record_id, target_table, outcome, metadata)
    VALUES (
        v_caller_id,
        'REOPEN_SESSION',
        p_session_id::text,
        'activity_sessions',
        'success',
        jsonb_build_object('reason', trim(p_reason), 'reopen_until', v_reopen_until)
    );

    RETURN jsonb_build_object('success', TRUE, 'status', 'active', 'reopen_until', v_reopen_until);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_attendance_session(UUID, TEXT, INT) TO authenticated;
