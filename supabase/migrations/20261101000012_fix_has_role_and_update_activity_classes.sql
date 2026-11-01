-- ============================================================================
-- YSA Attendance Management System (YSA AMS)
-- Stake: Abeokuta Nigeria Obantoko Stake
-- Migration 12: Define public.has_role & Remediate update_activity_classes
-- ============================================================================
-- Fixes: "function public.has_role(uuid, unknown) does not exist" when
-- configuring Skill Acquisition classes via public.update_activity_classes.
-- ============================================================================

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
