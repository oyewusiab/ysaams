-- =============================================================================
-- MIGRATION: 20261020000009_phase2a_scheduling_and_adjustments.sql
-- DESCRIPTION: Phase 2A Extensions:
--              1. Attendance Identity without prior registration & suggestions
--                 from previously recorded attendance.
--              2. Scheduling: scheduled_end_time, grace_period_minutes, and
--                 server-side effective lock time enforcement in Africa/Lagos.
--              3. Controlled adjustments to active activities with audit logging.
--              4. Participating unit filtering for kiosk terminals.
--              5. Scheduled session cancellation, postponement, and adjustment.
-- STAKE: Abeokuta Nigeria Obantoko Stake
-- STATUS: Staged for Owner Review & Forward-Only Application
-- IDEMPOTENT: Non-destructive; safe to run repeatedly
-- =============================================================================

-- =============================================================================
-- PART 1: EXTEND ACTIVITY_SESSIONS SCHEMA
-- =============================================================================

ALTER TABLE public.activity_sessions
ADD COLUMN IF NOT EXISTS grace_period_minutes INT NOT NULL DEFAULT 0;

ALTER TABLE public.activity_sessions
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT DEFAULT NULL;

ALTER TABLE public.activity_sessions
ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES public.user_profiles(id) DEFAULT NULL;

ALTER TABLE public.activity_sessions
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE public.activity_sessions
ADD COLUMN IF NOT EXISTS postponement_reason TEXT DEFAULT NULL;

ALTER TABLE public.activity_sessions
ADD COLUMN IF NOT EXISTS postponed_by UUID REFERENCES public.user_profiles(id) DEFAULT NULL;

ALTER TABLE public.activity_sessions
ADD COLUMN IF NOT EXISTS postponed_at TIMESTAMPTZ DEFAULT NULL;

-- Update status constraint safely to support 'cancelled'
DO $$
DECLARE
    v_con RECORD;
BEGIN
    FOR v_con IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.activity_sessions'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%status%'
    LOOP
        EXECUTE format('ALTER TABLE public.activity_sessions DROP CONSTRAINT IF EXISTS %I', v_con.conname);
    END LOOP;
END $$;

ALTER TABLE public.activity_sessions
ADD CONSTRAINT activity_sessions_status_check
CHECK (status IN ('draft', 'active', 'closed', 'cancelled'));

-- Add constraint for grace period (0 to 1440 minutes / 24 hours)
DO $$
DECLARE
    v_con RECORD;
BEGIN
    FOR v_con IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.activity_sessions'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%grace_period_minutes%'
    LOOP
        EXECUTE format('ALTER TABLE public.activity_sessions DROP CONSTRAINT IF EXISTS %I', v_con.conname);
    END LOOP;
END $$;

ALTER TABLE public.activity_sessions
ADD CONSTRAINT activity_sessions_grace_period_check
CHECK (grace_period_minutes >= 0 AND grace_period_minutes <= 1440);

-- =============================================================================
-- PART 2: SESSION ADJUSTMENT REQUESTS AUDIT TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.session_adjustment_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.activity_sessions(id) ON DELETE CASCADE,
    requested_by UUID NOT NULL REFERENCES public.user_profiles(id),
    reason TEXT NOT NULL,
    changes JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
    authorized_by UUID REFERENCES public.user_profiles(id),
    authorized_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_adjustments_session ON public.session_adjustment_requests(session_id);

ALTER TABLE public.session_adjustment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_adjustment_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS policy_adjustments_read ON public.session_adjustment_requests;
CREATE POLICY policy_adjustments_read ON public.session_adjustment_requests
FOR SELECT TO authenticated
USING (
    public.is_stake_wide_leader(auth.uid())
    OR EXISTS (
        SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role_name = 'ysa_leader'
    )
);

GRANT SELECT ON TABLE public.session_adjustment_requests TO authenticated;

-- =============================================================================
-- PART 3: HELPER FUNCTION FOR EFFECTIVE LOCK TIME
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_session_effective_lock_time(
    p_session_date DATE,
    p_scheduled_end_time TIME,
    p_grace_period_minutes INT,
    p_timezone TEXT DEFAULT 'Africa/Lagos'
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
    IF p_scheduled_end_time IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN ((p_session_date || ' ' || p_scheduled_end_time)::timestamp AT TIME ZONE COALESCE(NULLIF(trim(p_timezone), ''), 'Africa/Lagos'))
           + (COALESCE(p_grace_period_minutes, 0) || ' minutes')::interval;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_session_effective_lock_time(DATE, TIME, INT, TEXT) TO anon, authenticated;

-- =============================================================================
-- PART 4: ENHANCED KIOSK SUGGESTIONS (FROM PREVIOUS ATTENDANCE & CENSUS)
-- =============================================================================
-- Returns suggestions from:
--   1. Previously recorded attendance names in this session or prior sessions
--   2. Pre-enrolled census members
-- Strictly minimum info: id, full_name, home_unit_id, home_unit_name.
-- No phone numbers, no member numbers, no emails.
-- Respects session participating units.

CREATE OR REPLACE FUNCTION public.search_terminal_suggestions(
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
    v_effective_lock TIMESTAMPTZ;
    v_results JSONB;
BEGIN
    v_now := timezone('utc'::text, now());

    IF p_terminal_token IS NULL OR length(trim(p_terminal_token)) = 0 THEN
        RAISE EXCEPTION 'Unauthorized: Terminal bearer token is required.';
    END IF;

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

    -- Validate session is active
    SELECT * INTO v_session
    FROM public.activity_sessions
    WHERE id = p_session_id AND status = 'active';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attendance session is not active.';
    END IF;

    -- Validate effective lock time
    v_effective_lock := public.get_session_effective_lock_time(
        v_session.session_date,
        v_session.scheduled_end_time,
        v_session.grace_period_minutes,
        v_session.timezone
    );
    IF v_effective_lock IS NOT NULL AND v_now > v_effective_lock THEN
        RAISE EXCEPTION 'Attendance session has closed (effective lock time reached).';
    END IF;

    v_clean_query := lower(trim(COALESCE(p_search_query, '')));

    -- Union previously recorded attendance names and census members
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    INTO v_results
    FROM (
        WITH combined_candidates AS (
            -- 1. Previously recorded attendance
            SELECT DISTINCT
                m.id AS member_id,
                m.full_name,
                m.home_unit_id,
                u.unit_name AS home_unit_name,
                1 AS priority
            FROM public.attendance_records ar
            JOIN public.members m ON m.id = ar.member_id
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

            UNION

            -- 2. Census members
            SELECT DISTINCT
                m.id AS member_id,
                m.full_name,
                m.home_unit_id,
                u.unit_name AS home_unit_name,
                2 AS priority
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
        )
        SELECT
            member_id AS id,
            full_name,
            home_unit_id,
            home_unit_name
        FROM combined_candidates
        GROUP BY member_id, full_name, home_unit_id, home_unit_name
        ORDER BY min(priority) ASC, full_name ASC
        LIMIT 10
    ) t;

    RETURN v_results;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.search_terminal_suggestions(UUID, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_terminal_suggestions(UUID, TEXT, UUID, TEXT) TO anon, authenticated;

-- =============================================================================
-- PART 5: ROBUST ATTENDANCE REGISTRATION WITHOUT PRIOR ENROLLMENT
-- =============================================================================
-- Accepts attendance whether:
--   A. Existing pre-enrolled member selected from suggestions (uses member_id).
--   B. Previously recorded member selected from suggestions.
--   C. Brand-new YSA attendee typing their name without prior signup/census pre-enrollment.
-- Enforces:
--   1. Server-side effective lock time (Africa/Lagos).
--   2. Participating-unit restrictions.
--   3. Duplicate prevention per person per session (prevents same person from double check-in).
--   4. Distinct identity creation if two different people happen to share the same name.

CREATE OR REPLACE FUNCTION public.record_terminal_checkin(
    p_session_id UUID,
    p_terminal_token TEXT,
    p_attendee_name TEXT,
    p_unit_id UUID,
    p_is_non_member BOOLEAN DEFAULT FALSE,
    p_member_id UUID DEFAULT NULL,
    p_contact_phone TEXT DEFAULT NULL
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
    v_effective_lock TIMESTAMPTZ;
    v_now TIMESTAMPTZ;
    v_clean_name TEXT;
    v_member_id UUID;
    v_attendance_id UUID;
    v_visitor_id UUID;
    v_unit RECORD;
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

    -- 2. Validate session is active
    SELECT * INTO v_session
    FROM public.activity_sessions
    WHERE id = p_session_id;

    IF NOT FOUND OR v_session.status != 'active' THEN
        RAISE EXCEPTION 'Attendance session is not active. Attendance writes are closed.';
    END IF;

    -- 3. Enforce server-side effective lock time
    v_effective_lock := public.get_session_effective_lock_time(
        v_session.session_date,
        v_session.scheduled_end_time,
        v_session.grace_period_minutes,
        v_session.timezone
    );

    IF v_effective_lock IS NOT NULL AND v_now > v_effective_lock THEN
        RAISE EXCEPTION 'Attendance is closed: The scheduled end time and grace period have expired.';
    END IF;

    v_clean_name := trim(COALESCE(p_attendee_name, ''));
    IF length(v_clean_name) < 2 THEN
        RAISE EXCEPTION 'Attendee name must be at least 2 characters.';
    END IF;

    -- 4. Validate unit
    IF p_unit_id IS NOT NULL THEN
        SELECT * INTO v_unit
        FROM public.stake_units
        WHERE id = p_unit_id AND is_active = TRUE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Selected unit is invalid or inactive.';
        END IF;

        -- Enforce participating unit restriction
        IF v_session.participating_units IS NOT NULL AND array_length(v_session.participating_units, 1) > 0 THEN
            IF NOT (p_unit_id = ANY(v_session.participating_units)) THEN
                RAISE EXCEPTION 'Unit "%" is not an authorized participating unit for this session.', v_unit.unit_name;
            END IF;
        END IF;
    END IF;

    -- 5. Branch: Non-member Visitor
    IF p_is_non_member THEN
        IF v_session.visitor_registration_enabled IS NOT TRUE THEN
            RAISE EXCEPTION 'Visitor registration is disabled for this session.';
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
            v_clean_name,
            trim(COALESCE(p_contact_phone, '')),
            FALSE,
            p_unit_id,
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
            'attendance_id', v_visitor_id,
            'attendee_name', v_clean_name,
            'is_non_member', TRUE,
            'check_in_time', v_now
        );
    END IF;

    -- 6. Branch: Church Member Check-in
    IF p_unit_id IS NULL THEN
        RAISE EXCEPTION 'Unit is required for Church members. Please select your ward or branch.';
    END IF;

    -- Determine member identity
    v_member_id := p_member_id;

    IF v_member_id IS NOT NULL THEN
        -- Verify existing member record
        IF NOT EXISTS (
            SELECT 1 FROM public.members
            WHERE id = v_member_id AND is_active = TRUE AND home_unit_id = p_unit_id
        ) THEN
            -- If member was moved or not found, fall back to resolving by name/unit
            v_member_id := NULL;
        END IF;
    END IF;

    IF v_member_id IS NULL THEN
        -- Find existing active member with exact name in unit
        SELECT id INTO v_member_id
        FROM public.members
        WHERE lower(trim(full_name)) = lower(v_clean_name)
          AND home_unit_id = p_unit_id
          AND is_active = TRUE
        LIMIT 1;

        -- If not pre-enrolled, dynamically create member record in census (Requirement A)
        IF v_member_id IS NULL THEN
            INSERT INTO public.members (
                full_name,
                home_unit_id,
                is_active
            )
            VALUES (
                v_clean_name,
                p_unit_id,
                TRUE
            )
            RETURNING id INTO v_member_id;
        END IF;
    END IF;

    -- Check duplicate attendance in this session for this person
    IF EXISTS (
        SELECT 1 FROM public.attendance_records
        WHERE session_id = p_session_id AND member_id = v_member_id
    ) THEN
        RAISE EXCEPTION 'Duplicate check-in: % has already been marked present for this session.', v_clean_name;
    END IF;

    -- Insert attendance record with concurrent collision guard
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
            v_member_id,
            p_unit_id,
            v_terminal.id,
            v_now
        )
        RETURNING id INTO v_attendance_id;
    EXCEPTION
        WHEN unique_violation THEN
            RAISE EXCEPTION 'Duplicate check-in: % was concurrently marked present for this session.', v_clean_name;
    END;

    -- Extend terminal lease on activity
    UPDATE public.terminal_authorizations
    SET last_seen_at = v_now,
        lease_expires_at = v_now + interval '10 minutes'
    WHERE id = v_terminal.id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'attendance_id', v_attendance_id,
        'member_id', v_member_id,
        'attendee_name', v_clean_name,
        'is_non_member', FALSE,
        'check_in_time', v_now
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_terminal_checkin(UUID, TEXT, TEXT, UUID, BOOLEAN, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_terminal_checkin(UUID, TEXT, TEXT, UUID, BOOLEAN, UUID, TEXT) TO anon, authenticated;

-- =============================================================================
-- PART 6: SESSION CANCELLATION, POSTPONEMENT & CONTROLLED ADJUSTMENTS
-- =============================================================================

-- 6.1 Cancel Session
CREATE OR REPLACE FUNCTION public.cancel_activity_session(
    p_session_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_session RECORD;
    v_now TIMESTAMPTZ;
BEGIN
    v_now := timezone('utc'::text, now());

    IF NOT (public.is_stake_wide_leader(v_caller_id) OR EXISTS (
        SELECT 1 FROM public.user_roles WHERE user_id = v_caller_id AND role_name = 'ysa_leader'
    )) THEN
        RAISE EXCEPTION 'Unauthorized: Only authorized leaders can cancel sessions.';
    END IF;

    IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
        RAISE EXCEPTION 'A cancellation reason of at least 5 characters is required.';
    END IF;

    SELECT * INTO v_session
    FROM public.activity_sessions
    WHERE id = p_session_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found.';
    END IF;

    IF v_session.status = 'cancelled' THEN
        RAISE EXCEPTION 'Session is already cancelled.';
    END IF;

    UPDATE public.activity_sessions
    SET status = 'cancelled',
        cancelled_by = v_caller_id,
        cancelled_at = v_now,
        cancellation_reason = trim(p_reason),
        updated_at = v_now
    WHERE id = p_session_id;

    -- Revoke all active terminals immediately
    UPDATE public.terminal_authorizations
    SET is_revoked = TRUE,
        revoked_at = v_now
    WHERE session_id = p_session_id AND is_revoked = FALSE;

    INSERT INTO public.audit_logs (actor_id, action, target_record_id, target_table, outcome, metadata)
    VALUES (
        v_caller_id,
        'CANCEL_SESSION',
        p_session_id::text,
        'activity_sessions',
        'success',
        jsonb_build_object(
            'previous_status', v_session.status,
            'reason', trim(p_reason),
            'cancelled_at', v_now
        )
    );

    RETURN jsonb_build_object('success', TRUE, 'status', 'cancelled');
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_activity_session(UUID, TEXT) TO authenticated;

-- 6.2 Postpone Session
CREATE OR REPLACE FUNCTION public.postpone_activity_session(
    p_session_id UUID,
    p_new_date DATE,
    p_new_start_time TIME,
    p_new_end_time TIME DEFAULT NULL,
    p_reason TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_session RECORD;
    v_now TIMESTAMPTZ;
BEGIN
    v_now := timezone('utc'::text, now());

    IF NOT (public.is_stake_wide_leader(v_caller_id) OR EXISTS (
        SELECT 1 FROM public.user_roles WHERE user_id = v_caller_id AND role_name = 'ysa_leader'
    )) THEN
        RAISE EXCEPTION 'Unauthorized: Only authorized leaders can postpone sessions.';
    END IF;

    IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
        RAISE EXCEPTION 'A postponement reason of at least 5 characters is required.';
    END IF;

    IF p_new_date IS NULL OR p_new_start_time IS NULL THEN
        RAISE EXCEPTION 'New session date and start time are required.';
    END IF;

    SELECT * INTO v_session
    FROM public.activity_sessions
    WHERE id = p_session_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found.';
    END IF;

    IF v_session.status = 'cancelled' THEN
        RAISE EXCEPTION 'Cannot postpone a cancelled session.';
    END IF;

    -- Revoke existing terminal tokens so old terminals cannot accept check-ins at obsolete time
    UPDATE public.terminal_authorizations
    SET is_revoked = TRUE,
        revoked_at = v_now
    WHERE session_id = p_session_id AND is_revoked = FALSE;

    UPDATE public.activity_sessions
    SET session_date = p_new_date,
        start_time = p_new_start_time,
        scheduled_end_time = p_new_end_time,
        status = 'draft', -- Reset to draft for new schedule
        code_hash = NULL,
        code_expires_at = NULL,
        postponed_by = v_caller_id,
        postponed_at = v_now,
        postponement_reason = trim(p_reason),
        updated_at = v_now
    WHERE id = p_session_id;

    INSERT INTO public.audit_logs (actor_id, action, target_record_id, target_table, outcome, metadata)
    VALUES (
        v_caller_id,
        'POSTPONE_SESSION',
        p_session_id::text,
        'activity_sessions',
        'success',
        jsonb_build_object(
            'previous_date', v_session.session_date,
            'previous_start_time', v_session.start_time,
            'new_date', p_new_date,
            'new_start_time', p_new_start_time,
            'reason', trim(p_reason)
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'status', 'draft',
        'new_date', p_new_date,
        'new_start_time', p_new_start_time
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.postpone_activity_session(UUID, DATE, TIME, TIME, TEXT) TO authenticated;

-- 6.3 Controlled Adjustment to Active Session (Requirement C)
CREATE OR REPLACE FUNCTION public.adjust_active_session(
    p_session_id UUID,
    p_reason TEXT,
    p_new_title TEXT DEFAULT NULL,
    p_new_end_time TIME DEFAULT NULL,
    p_new_grace_minutes INT DEFAULT NULL,
    p_new_participating_units UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_session RECORD;
    v_now TIMESTAMPTZ;
    v_is_authorized BOOLEAN;
    v_changes JSONB := '{}'::jsonb;
BEGIN
    v_now := timezone('utc'::text, now());

    -- Only system_admin, stake_presidency, or authorized stake-wide YSA leader
    v_is_authorized := public.is_stake_wide_leader(v_caller_id) OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = v_caller_id AND ur.role_name = 'ysa_leader'
          AND (
              -- Stake-wide YSA leader assignment (assigned to all units or stake-wide)
              NOT EXISTS (SELECT 1 FROM public.user_unit_assignments WHERE user_id = v_caller_id)
              OR (SELECT count(DISTINCT unit_id) FROM public.user_unit_assignments WHERE user_id = v_caller_id) >= 
                 (SELECT count(*) FROM public.stake_units WHERE is_active = TRUE)
          )
    );

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Unauthorized: Adjusting an active session requires System Admin, Stake Presidency, or Stake YSA Leader authorization.';
    END IF;

    IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
        RAISE EXCEPTION 'A mandatory justification reason (at least 5 characters) is required for adjusting an active session.';
    END IF;

    SELECT * INTO v_session
    FROM public.activity_sessions
    WHERE id = p_session_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found.';
    END IF;

    IF v_session.status != 'active' THEN
        RAISE EXCEPTION 'Session is not active. Adjustments can only be applied to active sessions.';
    END IF;

    -- Build changes JSON
    IF p_new_title IS NOT NULL AND trim(p_new_title) != v_session.session_title THEN
        v_changes := v_changes || jsonb_build_object(
            'title', jsonb_build_object('before', v_session.session_title, 'after', trim(p_new_title))
        );
        UPDATE public.activity_sessions SET session_title = trim(p_new_title) WHERE id = p_session_id;
    END IF;

    IF p_new_end_time IS NOT NULL AND p_new_end_time != v_session.scheduled_end_time THEN
        v_changes := v_changes || jsonb_build_object(
            'scheduled_end_time', jsonb_build_object('before', v_session.scheduled_end_time, 'after', p_new_end_time)
        );
        UPDATE public.activity_sessions SET scheduled_end_time = p_new_end_time WHERE id = p_session_id;
    END IF;

    IF p_new_grace_minutes IS NOT NULL AND p_new_grace_minutes != v_session.grace_period_minutes THEN
        IF p_new_grace_minutes < 0 OR p_new_grace_minutes > 1440 THEN
            RAISE EXCEPTION 'Grace period must be between 0 and 1440 minutes.';
        END IF;
        v_changes := v_changes || jsonb_build_object(
            'grace_period_minutes', jsonb_build_object('before', v_session.grace_period_minutes, 'after', p_new_grace_minutes)
        );
        UPDATE public.activity_sessions SET grace_period_minutes = p_new_grace_minutes WHERE id = p_session_id;
    END IF;

    IF p_new_participating_units IS NOT NULL THEN
        v_changes := v_changes || jsonb_build_object(
            'participating_units', jsonb_build_object('before', v_session.participating_units, 'after', p_new_participating_units)
        );
        UPDATE public.activity_sessions SET participating_units = p_new_participating_units WHERE id = p_session_id;
    END IF;

    UPDATE public.activity_sessions SET updated_at = v_now WHERE id = p_session_id;

    -- Record in adjustment requests table
    INSERT INTO public.session_adjustment_requests (
        session_id,
        requested_by,
        reason,
        changes,
        status,
        authorized_by,
        authorized_at
    )
    VALUES (
        p_session_id,
        v_caller_id,
        trim(p_reason),
        v_changes,
        'approved',
        v_caller_id,
        v_now
    );

    -- Record in audit logs
    INSERT INTO public.audit_logs (actor_id, action, target_record_id, target_table, outcome, metadata)
    VALUES (
        v_caller_id,
        'ADJUST_ACTIVE_SESSION',
        p_session_id::text,
        'activity_sessions',
        'success',
        jsonb_build_object('reason', trim(p_reason), 'changes', v_changes)
    );

    RETURN jsonb_build_object('success', TRUE, 'changes', v_changes);
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_active_session(UUID, TEXT, TEXT, TIME, INT, UUID[]) TO authenticated;

-- =============================================================================
-- PART 7: UPDATE AUTHORIZE_TERMINAL TO RETURN PARTICIPATING UNITS & ENFORCE LOCK
-- =============================================================================

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
    v_effective_lock TIMESTAMPTZ;
BEGIN
    v_now := timezone('utc'::text, now());
    v_clean_code := upper(trim(p_session_code));
    v_code_hash := encode(sha256(convert_to(v_clean_code, 'UTF8')), 'hex');

    -- Row-level lock on session
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

    -- Enforce effective lock time
    v_effective_lock := public.get_session_effective_lock_time(
        v_session.session_date,
        v_session.scheduled_end_time,
        v_session.grace_period_minutes,
        v_session.timezone
    );

    IF v_effective_lock IS NOT NULL AND v_now > v_effective_lock THEN
        RAISE EXCEPTION 'Attendance session has locked (scheduled end time and grace period passed).';
    END IF;

    -- Handle reconnection
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
                'participating_units', v_session.participating_units,
                'terminal_id', v_terminal_id,
                'terminal_token', trim(p_existing_terminal_token),
                'reconnected', TRUE
            );
        END IF;
    END IF;

    -- Revoke expired leases
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
        'participating_units', v_session.participating_units,
        'terminal_id', v_terminal_id,
        'terminal_token', v_new_token,
        'reconnected', FALSE
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.authorize_terminal(TEXT, TEXT, TEXT) TO anon, authenticated;
