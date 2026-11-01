-- ============================================================================
-- YSA Attendance Management System (YSA AMS)
-- Stake: Abeokuta Nigeria Obantoko Stake
-- Migration 11: Skill Acquisition Multi-Class Sessions & Strict View-Only Role Enforcement
-- ============================================================================
-- Purpose:
-- 1. Support one Skill Acquisition activity and session with multiple concurrent
--    configurable classes (e.g., Barbing, Tailoring, Shoe Making, Catering, ICT)
--    using a structured TEXT[] representation on activities and activity_sessions.
-- 2. Persist each participant's selected class on attendance_records and
--    session_visitors while preserving historical class attribution when class
--    configurations change.
-- 3. Validate class selection in terminal and manual attendance RPCs:
--    - Require valid configured class for Skill Acquisition sessions.
--    - Reject unconfigured or missing class for Skill Acquisition sessions.
--    - Do not require class selection for ordinary activities.
-- 4. Provide an authorized, audited RPC (update_activity_classes) for managing
--    activity class options without mutating historical attendance records.
-- 5. Enforce strict view-only permissions for bishop, branch_president,
--    ward_clerk, and branch_clerk across RLS policies and backend RPCs while
--    preserving their existing unit scope and preserving all permissions for
--    system_admin, stake_presidency, ysa_leader, and stake_clerk.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. STRUCTURED SCHEMA EXTENSIONS (IDEMPOTENT, FORWARD-ONLY)
-- ----------------------------------------------------------------------------

-- 1A. Activities: structured class_options array (e.g. {'Barbing','Tailoring','Shoe Making','Catering','ICT'})
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS class_options TEXT[] DEFAULT NULL;

-- 1B. Activity Sessions: session-level snapshot/override of configured classes
ALTER TABLE public.activity_sessions
  ADD COLUMN IF NOT EXISTS class_options TEXT[] DEFAULT NULL;

-- 1C. Attendance Records: participant's selected class at check-in (immutable historical attribution)
ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS selected_class TEXT DEFAULT NULL;

-- 1D. Session Visitors: visitor's selected class at check-in (immutable historical attribution)
ALTER TABLE public.session_visitors
  ADD COLUMN IF NOT EXISTS selected_class TEXT DEFAULT NULL;

-- Indexes for fast class-level reporting and filtering
CREATE INDEX IF NOT EXISTS idx_attendance_selected_class
  ON public.attendance_records (session_id, selected_class)
  WHERE selected_class IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_visitors_selected_class
  ON public.session_visitors (session_id, selected_class)
  WHERE selected_class IS NOT NULL;

-- Backfill session class_options from parent activity where session has none yet
UPDATE public.activity_sessions s
SET class_options = a.class_options
FROM public.activities a
WHERE s.activity_id = a.id
  AND s.class_options IS NULL
  AND a.class_options IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. HELPER FUNCTIONS FOR SKILL ACQUISITION CLASS VALIDATION
-- ----------------------------------------------------------------------------

-- Determines whether a session is a Skill Acquisition / multi-class session
CREATE OR REPLACE FUNCTION public.is_skill_acquisition_session(
  p_activity_category TEXT,
  p_activity_title TEXT,
  p_effective_classes TEXT[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF p_effective_classes IS NOT NULL AND COALESCE(array_length(p_effective_classes, 1), 0) > 0 THEN
    RETURN TRUE;
  END IF;

  IF LOWER(BTRIM(COALESCE(p_activity_category, ''))) = 'skill acquisition'
     OR LOWER(BTRIM(COALESCE(p_activity_title, ''))) = 'skill acquisition' THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_skill_acquisition_session(TEXT, TEXT, TEXT[]) TO anon, authenticated;

-- Validates and resolves the canonical class name for a session check-in.
-- - For Skill Acquisition sessions: requires a non-empty class selection that matches
--   one of the session's configured classes (case-insensitive, trimmed), returning
--   the canonical configured class name.
-- - For ordinary (non-Skill Acquisition) sessions: returns NULL if no class is provided,
--   or raises an exception if an unconfigured class is supplied.
CREATE OR REPLACE FUNCTION public.validate_and_resolve_session_class(
  p_session_id UUID,
  p_selected_class TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_session RECORD;
  v_effective_classes TEXT[];
  v_is_skill_acq BOOLEAN;
  v_clean_input TEXT;
  v_class_item TEXT;
BEGIN
  SELECT
    s.id,
    s.class_options AS session_classes,
    a.title AS activity_title,
    a.category AS activity_category,
    a.class_options AS activity_classes
  INTO v_session
  FROM public.activity_sessions s
  JOIN public.activities a ON a.id = s.activity_id
  WHERE s.id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance session does not exist.';
  END IF;

  v_effective_classes := COALESCE(v_session.session_classes, v_session.activity_classes);
  v_is_skill_acq := public.is_skill_acquisition_session(
    v_session.activity_category,
    v_session.activity_title,
    v_effective_classes
  );

  v_clean_input := NULLIF(BTRIM(COALESCE(p_selected_class, '')), '');

  IF v_is_skill_acq THEN
    IF v_effective_classes IS NULL OR COALESCE(array_length(v_effective_classes, 1), 0) = 0 THEN
      RAISE EXCEPTION 'No classes are configured for this Skill Acquisition session. Please contact a session leader.';
    END IF;

    IF v_clean_input IS NULL THEN
      RAISE EXCEPTION 'Please select a Skill Acquisition class to check in.';
    END IF;

    FOREACH v_class_item IN ARRAY v_effective_classes LOOP
      IF LOWER(BTRIM(v_class_item)) = LOWER(v_clean_input) THEN
        RETURN BTRIM(v_class_item);
      END IF;
    END LOOP;

    RAISE EXCEPTION 'Selected class "%" is not configured or available for this Skill Acquisition session.', v_clean_input;
  ELSE
    -- Non-Skill Acquisition activity: class selection is not required
    IF v_clean_input IS NOT NULL THEN
      RAISE EXCEPTION 'Class selection is not applicable for this activity session.';
    END IF;
    RETURN NULL;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_and_resolve_session_class(UUID, TEXT) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. AUTHORIZED & AUDITED CLASS CONFIGURATION UPDATE RPC
-- ----------------------------------------------------------------------------
-- Helper function to check if a user holds a specific role in public.user_roles.
CREATE OR REPLACE FUNCTION public.has_role(
  p_user_id UUID,
  p_role_name TEXT
)
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
      AND role_name = p_role_name
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_role(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, TEXT) TO authenticated;

-- Allows authorized leaders (system_admin, stake_presidency, ysa_leader) to
-- configure or update an activity's class_options (and optionally propagate to
-- active/draft sessions) with full audit logging, without modifying historical
-- attendance records.

CREATE OR REPLACE FUNCTION public.update_activity_classes(
  p_activity_id UUID,
  p_class_options TEXT[],
  p_reason TEXT DEFAULT 'Updated Skill Acquisition class configuration'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_activity RECORD;
  v_clean_classes TEXT[] := ARRAY[]::TEXT[];
  v_raw_item TEXT;
  v_trimmed TEXT;
  v_exists BOOLEAN;
  v_existing_item TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF NOT (
    public.is_stake_wide_leader(v_caller_id)
    OR EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = v_caller_id
        AND role_name = 'ysa_leader'
    )
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Your role has view-only access and cannot modify activity class configurations.';
  END IF;

  SELECT * INTO v_activity
  FROM public.activities
  WHERE id = p_activity_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Activity not found.';
  END IF;

  IF p_class_options IS NOT NULL THEN
    FOREACH v_raw_item IN ARRAY p_class_options LOOP
      v_trimmed := BTRIM(COALESCE(v_raw_item, ''));
      IF v_trimmed != '' THEN
        v_exists := FALSE;
        FOREACH v_existing_item IN ARRAY v_clean_classes LOOP
          IF LOWER(v_existing_item) = LOWER(v_trimmed) THEN
            v_exists := TRUE;
            EXIT;
          END IF;
        END LOOP;
        IF NOT v_exists THEN
          v_clean_classes := array_append(v_clean_classes, v_trimmed);
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF (
    LOWER(BTRIM(COALESCE(v_activity.category, ''))) = 'skill acquisition'
    OR LOWER(BTRIM(COALESCE(v_activity.title, ''))) = 'skill acquisition'
  ) AND COALESCE(array_length(v_clean_classes, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Skill Acquisition activities must have at least one configured class.';
  END IF;

  IF COALESCE(array_length(v_clean_classes, 1), 0) = 0 THEN
    v_clean_classes := NULL;
  END IF;

  UPDATE public.activities
  SET class_options = v_clean_classes,
      updated_at = timezone('utc'::text, now())
  WHERE id = p_activity_id;

  -- Propagate updated class options only to draft or active sessions so closed
  -- historical sessions and historical attendance records remain untouched.
  UPDATE public.activity_sessions
  SET class_options = v_clean_classes,
      updated_at = timezone('utc'::text, now())
  WHERE activity_id = p_activity_id
    AND status IN ('draft', 'active');

  INSERT INTO public.audit_logs (
    actor_id,
    action,
    target_table,
    target_record_id,
    outcome,
    metadata
  ) VALUES (
    v_caller_id,
    'UPDATE_ACTIVITY_CLASSES',
    'activities',
    p_activity_id::text,
    'success',
    jsonb_build_object(
      'activity_title', v_activity.title,
      'previous_classes', v_activity.class_options,
      'new_classes', v_clean_classes,
      'reason', COALESCE(NULLIF(BTRIM(p_reason), ''), 'Updated Skill Acquisition class configuration')
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'activity_id', p_activity_id,
    'class_options', v_clean_classes
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_activity_classes(UUID, TEXT[], TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_activity_classes(UUID, TEXT[], TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. UPDATE authorize_terminal TO RETURN ACTIVITY & CLASS METADATA
-- ----------------------------------------------------------------------------
-- Preserves exact input parameter names (p_session_code, p_terminal_label, p_existing_terminal_token)
-- from Migration 9 so CREATE OR REPLACE FUNCTION succeeds without dropping.

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
  v_activity RECORD;
  v_effective_classes TEXT[];
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
  v_clean_code := upper(trim(coalesce(p_session_code, '')));

  IF length(v_clean_code) != 6 THEN
    RAISE EXCEPTION 'Invalid attendance code format. Expected 6-character code.';
  END IF;

  v_code_hash := encode(sha256(convert_to(v_clean_code, 'UTF8')), 'hex');

  -- Row-level lock on session
  SELECT * INTO v_session
  FROM public.activity_sessions
  WHERE code_hash = v_code_hash
    AND status = 'active'
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

  SELECT id, title, category, class_options
  INTO v_activity
  FROM public.activities
  WHERE id = v_session.activity_id;

  v_effective_classes := COALESCE(v_session.class_options, v_activity.class_options);

  -- Handle reconnection if caller already has an active lease token for this session
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
        'activity_id', v_activity.id,
        'activity_title', v_activity.title,
        'activity_category', v_activity.category,
        'class_options', v_effective_classes,
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
    'activity_id', v_activity.id,
    'activity_title', v_activity.title,
    'activity_category', v_activity.category,
    'class_options', v_effective_classes,
    'terminal_id', v_terminal_id,
    'terminal_token', v_new_token,
    'reconnected', FALSE
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.authorize_terminal(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. UPDATE ATTENDANCE CHECK-IN RPCS TO VALIDATE & PERSIST selected_class
-- ----------------------------------------------------------------------------

-- 5A. record_terminal_checkin (unified terminal check-in for members & visitors)
DROP FUNCTION IF EXISTS public.record_terminal_checkin(UUID, TEXT, TEXT, UUID, BOOLEAN, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.record_terminal_checkin(
  p_session_id UUID,
  p_terminal_token TEXT,
  p_attendee_name TEXT,
  p_unit_id UUID,
  p_is_non_member BOOLEAN DEFAULT FALSE,
  p_member_id UUID DEFAULT NULL,
  p_contact_phone TEXT DEFAULT NULL,
  p_selected_class TEXT DEFAULT NULL
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
  v_resolved_class TEXT;
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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance session does not exist.';
  END IF;

  IF v_session.status = 'cancelled' THEN
    RAISE EXCEPTION 'This activity session was cancelled and cannot accept attendance.';
  END IF;

  IF v_session.status != 'active' THEN
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

  -- 4. Validate and resolve Skill Acquisition class selection
  v_resolved_class := public.validate_and_resolve_session_class(p_session_id, p_selected_class);

  -- 5. Validate unit
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

  -- 6. Branch: Non-member Visitor
  IF p_is_non_member IS TRUE THEN
    IF v_session.visitor_registration_enabled IS NOT TRUE THEN
      RAISE EXCEPTION 'Visitor registration is disabled for this session.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.session_visitors
      WHERE session_id = p_session_id
        AND lower(trim(full_name)) = lower(v_clean_name)
        AND coalesce(inviting_unit_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) THEN
      RAISE EXCEPTION 'Duplicate check-in: % is already checked in for this session.', v_clean_name;
    END IF;

    INSERT INTO public.session_visitors (
      session_id,
      full_name,
      contact_phone,
      is_church_member,
      inviting_unit_id,
      recorded_by_terminal_id,
      selected_class,
      created_at
    )
    VALUES (
      p_session_id,
      v_clean_name,
      trim(COALESCE(p_contact_phone, '')),
      FALSE,
      p_unit_id,
      v_terminal.id,
      v_resolved_class,
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
      'visitor_id', v_visitor_id,
      'attendee_name', v_clean_name,
      'is_non_member', TRUE,
      'selected_class', v_resolved_class,
      'check_in_time', v_now
    );
  END IF;

  -- 7. Branch: Church Member Check-in
  IF p_unit_id IS NULL THEN
    RAISE EXCEPTION 'Unit is required for Church members. Please select your ward or branch.';
  END IF;

  v_member_id := p_member_id;

  IF v_member_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.members
      WHERE id = v_member_id AND is_active = TRUE AND home_unit_id = p_unit_id
    ) THEN
      v_member_id := NULL;
    END IF;
  END IF;

  IF v_member_id IS NULL THEN
    SELECT id INTO v_member_id
    FROM public.members
    WHERE lower(trim(full_name)) = lower(v_clean_name)
      AND home_unit_id = p_unit_id
      AND is_active = TRUE
    LIMIT 1;

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
      selected_class,
      check_in_time
    )
    VALUES (
      p_session_id,
      v_member_id,
      p_unit_id,
      v_terminal.id,
      v_resolved_class,
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
    'selected_class', v_resolved_class,
    'check_in_time', v_now
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_terminal_checkin(UUID, TEXT, TEXT, UUID, BOOLEAN, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_terminal_checkin(UUID, TEXT, TEXT, UUID, BOOLEAN, UUID, TEXT, TEXT) TO anon, authenticated;

-- 5B. record_attendance (member check-in fallback RPC)
DROP FUNCTION IF EXISTS public.record_attendance(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.record_attendance(
  p_session_id UUID,
  p_member_id UUID,
  p_terminal_token TEXT,
  p_selected_class TEXT DEFAULT NULL
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
  v_resolved_class TEXT;
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
  WHERE id = p_session_id;

  IF NOT FOUND OR v_session.status != 'active' THEN
    RAISE EXCEPTION 'Session is not active. Attendance writes are closed.';
  END IF;

  SELECT * INTO v_member
  FROM public.members
  WHERE id = p_member_id AND is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member record not found or inactive.';
  END IF;

  IF v_session.participating_units IS NOT NULL AND array_length(v_session.participating_units, 1) > 0 THEN
    IF NOT (v_member.home_unit_id = ANY(v_session.participating_units)) THEN
      RAISE EXCEPTION 'Member home unit is not authorized for this session (participating units restriction).';
    END IF;
  END IF;

  v_resolved_class := public.validate_and_resolve_session_class(p_session_id, p_selected_class);

  IF EXISTS (
    SELECT 1 FROM public.attendance_records
    WHERE session_id = p_session_id AND member_id = p_member_id
  ) THEN
    RAISE EXCEPTION 'Duplicate check-in: % has already been marked present for this session.', v_member.full_name;
  END IF;

  BEGIN
    INSERT INTO public.attendance_records (
      session_id,
      member_id,
      recorded_unit_id,
      recorded_by_terminal_id,
      selected_class,
      check_in_time
    )
    VALUES (
      p_session_id,
      p_member_id,
      v_member.home_unit_id,
      v_terminal.id,
      v_resolved_class,
      v_now
    )
    RETURNING id INTO v_attendance_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Duplicate check-in: % was concurrently marked present for this session.', v_member.full_name;
  END;

  UPDATE public.terminal_authorizations
  SET last_seen_at = v_now,
      lease_expires_at = v_now + interval '10 minutes'
  WHERE id = v_terminal.id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'attendance_id', v_attendance_id,
    'member_name', v_member.full_name,
    'selected_class', v_resolved_class,
    'check_in_time', v_now
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_attendance(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_attendance(UUID, UUID, TEXT, TEXT) TO anon, authenticated;

-- 5C. record_visitor_attendance (visitor check-in fallback RPC)
DROP FUNCTION IF EXISTS public.record_visitor_attendance(UUID, TEXT, TEXT, BOOLEAN, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.record_visitor_attendance(
  p_session_id UUID,
  p_full_name TEXT,
  p_contact_phone TEXT,
  p_is_church_member BOOLEAN,
  p_inviting_unit_id UUID,
  p_terminal_token TEXT,
  p_selected_class TEXT DEFAULT NULL
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
  v_resolved_class TEXT;
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

  v_resolved_class := public.validate_and_resolve_session_class(p_session_id, p_selected_class);

  INSERT INTO public.session_visitors (
    session_id,
    full_name,
    contact_phone,
    is_church_member,
    inviting_unit_id,
    recorded_by_terminal_id,
    selected_class,
    created_at
  )
  VALUES (
    p_session_id,
    trim(p_full_name),
    trim(COALESCE(p_contact_phone, '')),
    COALESCE(p_is_church_member, FALSE),
    p_inviting_unit_id,
    v_terminal.id,
    v_resolved_class,
    v_now
  )
  RETURNING id INTO v_visitor_id;

  UPDATE public.terminal_authorizations
  SET last_seen_at = v_now,
      lease_expires_at = v_now + interval '10 minutes'
  WHERE id = v_terminal.id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'visitor_id', v_visitor_id,
    'full_name', trim(p_full_name),
    'selected_class', v_resolved_class,
    'check_in_time', v_now
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_visitor_attendance(UUID, TEXT, TEXT, BOOLEAN, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_visitor_attendance(UUID, TEXT, TEXT, BOOLEAN, UUID, TEXT, TEXT) TO anon, authenticated;

-- 5D. record_manual_attendance (Enforces strict view-only restriction on bishop, branch_president, ward_clerk, branch_clerk)
DROP FUNCTION IF EXISTS public.record_manual_attendance(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.record_manual_attendance(
  p_session_id UUID,
  p_member_id UUID,
  p_notes TEXT DEFAULT NULL,
  p_selected_class TEXT DEFAULT NULL
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
  v_is_authorized_leader BOOLEAN := FALSE;
  v_resolved_class TEXT;
BEGIN
  -- 1. Verify authenticated caller
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: Anonymous callers cannot record manual attendance.';
  END IF;

  -- 2. Verify caller account_status is active
  SELECT account_status INTO v_caller_status
  FROM public.user_profiles
  WHERE id = v_caller_id;

  IF NOT FOUND OR v_caller_status != 'active' THEN
    RAISE EXCEPTION 'Unauthorized: Caller account is deactivated, pending, or does not exist.';
  END IF;

  v_now := timezone('utc'::text, now());

  -- 3. Verify session exists and is currently active
  SELECT * INTO v_session
  FROM public.activity_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Activity session not found.';
  END IF;

  IF v_session.status != 'active' THEN
    RAISE EXCEPTION 'Attendance session is % and cannot accept check-ins.', v_session.status;
  END IF;

  -- 4. Verify member exists and is active
  SELECT * INTO v_member
  FROM public.members
  WHERE id = p_member_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found.';
  END IF;

  IF v_member.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Member is inactive and cannot be checked in.';
  END IF;

  -- 5. Enforce session participating_units restriction (if configured)
  IF v_session.participating_units IS NOT NULL AND array_length(v_session.participating_units, 1) > 0 THEN
    IF NOT (v_member.home_unit_id = ANY(v_session.participating_units)) THEN
      RAISE EXCEPTION 'Member home unit is not authorized for this session (participating units restriction).';
    END IF;
  END IF;

  -- 6. Strict Role & Unit Authorization Check (Requirement 6):
  --    - Stake-wide leaders (system_admin, stake_presidency) are authorized for any unit.
  --    - Assigned YSA Leaders (ysa_leader) are authorized ONLY if they hold both the active
  --      role in user_roles AND a matching unit assignment in user_unit_assignments
  --      for v_member.home_unit_id.
  --    - bishop, branch_president, ward_clerk, branch_clerk, and stake_clerk are strictly
  --      prohibited from manual attendance mutations.
  IF public.is_stake_wide_leader(v_caller_id) THEN
    v_is_authorized_leader := TRUE;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.user_unit_assignments uua
        ON uua.user_id = ur.user_id
       AND uua.assigned_role = ur.role_name
      WHERE ur.user_id = v_caller_id
        AND ur.role_name = 'ysa_leader'
        AND uua.unit_id = v_member.home_unit_id
    ) INTO v_is_authorized_leader;
  END IF;

  IF NOT v_is_authorized_leader THEN
    RAISE EXCEPTION 'Unauthorized: Your role has view-only access or is not authorized to record manual attendance for this unit.';
  END IF;

  -- 7. Validate and resolve Skill Acquisition class selection
  v_resolved_class := public.validate_and_resolve_session_class(p_session_id, p_selected_class);

  -- 8. Pre-check duplicate attendance
  IF EXISTS (
    SELECT 1 FROM public.attendance_records
    WHERE session_id = p_session_id AND member_id = p_member_id
  ) THEN
    RAISE EXCEPTION 'Duplicate check-in: % is already marked present for this session.', v_member.full_name;
  END IF;

  -- 9. Insert attendance record with race-condition unique_violation trap
  BEGIN
    INSERT INTO public.attendance_records (
      session_id,
      member_id,
      recorded_unit_id,
      recorded_by_terminal_id,
      selected_class,
      check_in_time
    ) VALUES (
      p_session_id,
      p_member_id,
      v_member.home_unit_id,
      NULL,
      v_resolved_class,
      v_now
    )
    RETURNING id INTO v_attendance_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Duplicate check-in: % was concurrently marked present for this session.', v_member.full_name;
  END;

  -- 10. Write immutable audit log entry
  INSERT INTO public.audit_logs (
    actor_id,
    action,
    target_record_id,
    target_table,
    outcome,
    metadata
  ) VALUES (
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
      'selected_class', v_resolved_class,
      'notes', NULLIF(trim(COALESCE(p_notes, '')), '')
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'attendance_id', v_attendance_id,
    'member_name', v_member.full_name,
    'selected_class', v_resolved_class,
    'check_in_time', v_now,
    'manual', TRUE
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_manual_attendance(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_manual_attendance(UUID, UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_manual_attendance(UUID, UUID, TEXT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. STRICT VIEW-ONLY RLS ENFORCEMENT FOR BISHOP, BRANCH_PRESIDENT, WARD_CLERK, BRANCH_CLERK
-- ----------------------------------------------------------------------------
-- Requirement 6:
--   bishop, branch_president, ward_clerk, and branch_clerk must have strict
--   view-only access within their existing assigned unit scope.
--   They must NOT create, edit, or delete member identity records or perform
--   any other mutation on operational data.
--   system_admin, stake_presidency, ysa_leader, and stake_clerk retain their
--   exact existing permissions.

-- 6A. Replace policy_members_manage on public.members so only stake-wide leaders
--     (system_admin, stake_presidency) or unit-assigned ysa_leader can mutate members.
--     bishop, branch_president, ward_clerk, branch_clerk, and stake_clerk are strictly view-only.
DROP POLICY IF EXISTS policy_members_manage ON public.members;

CREATE POLICY policy_members_manage ON public.members
  FOR ALL
  TO authenticated
  USING (
    public.is_stake_wide_leader(auth.uid())
    OR (
      EXISTS (
        SELECT 1
        FROM public.user_profiles up
        JOIN public.user_roles ur
          ON ur.user_id = up.id
        JOIN public.user_unit_assignments uua
          ON uua.user_id = up.id
         AND uua.assigned_role = ur.role_name
        WHERE up.id = auth.uid()
          AND up.account_status = 'active'
          AND ur.role_name = 'ysa_leader'
          AND uua.unit_id = public.members.home_unit_id
      )
    )
  )
  WITH CHECK (
    public.is_stake_wide_leader(auth.uid())
    OR (
      EXISTS (
        SELECT 1
        FROM public.user_profiles up
        JOIN public.user_roles ur
          ON ur.user_id = up.id
        JOIN public.user_unit_assignments uua
          ON uua.user_id = up.id
         AND uua.assigned_role = ur.role_name
        WHERE up.id = auth.uid()
          AND up.account_status = 'active'
          AND ur.role_name = 'ysa_leader'
          AND uua.unit_id = public.members.home_unit_id
      )
    )
  );
