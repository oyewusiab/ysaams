-- ============================================================================
-- YSA Attendance Management System (YSA AMS)
-- Stake: Abeokuta Nigeria Obantoko Stake
-- Module: YSA Gathering Place — Skills & Self-Reliance Needs Assessment
-- Migration: 20261111000014_gathering_place_assessment_schema_and_rls.sql
-- ============================================================================
-- Purpose:
--   1. Create helper public.is_gathering_place_authorized(p_user_id UUID)
--      restricting access to Admin, Stake Presidency, Stake Clerk, and
--      Stake YSA Leaders (and strictly excluding Bishops, Branch Presidents,
--      Ward YSA Leaders, Ward/Branch Clerks, and General Attendees).
--   2. Create public.gathering_place_assessments for assessment lifecycle.
--   3. Create public.gathering_place_assessment_responses for survey data.
--   4. Enforce check constraints (distinct hard skills, max 3 soft skills, etc.).
--   5. Configure strict RLS policies:
--      - Public respondents can submit anonymously to active assessments.
--      - ONLY authorized Stake leadership can SELECT/view survey responses.
--   6. Provide secure submission and status RPCs with server-side validation.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Authorization Helper: public.is_gathering_place_authorized(UUID)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_gathering_place_authorized(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        -- Admin, Stake Presidency, Stake Clerk
        SELECT 1 FROM public.user_roles
        WHERE user_id = p_user_id
          AND role_name IN ('system_admin', 'stake_presidency', 'stake_clerk')
    )
    OR EXISTS (
        -- Stake YSA Leader: holds 'ysa_leader' AND is either stake-wide unconstrained
        -- (no unit assignments) or assigned to all active stake units.
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = p_user_id
          AND ur.role_name = 'ysa_leader'
          AND (
              NOT EXISTS (SELECT 1 FROM public.user_unit_assignments WHERE user_id = p_user_id)
              OR (SELECT count(DISTINCT unit_id) FROM public.user_unit_assignments WHERE user_id = p_user_id AND assigned_role = 'ysa_leader') >=
                 (SELECT count(*) FROM public.stake_units WHERE is_active = TRUE)
          )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.is_gathering_place_authorized(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_gathering_place_authorized(UUID) TO authenticated, anon;

-- ----------------------------------------------------------------------------
-- 2. Assessment Table: public.gathering_place_assessments
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gathering_place_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    assessment_year INTEGER NOT NULL DEFAULT 2027,
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'closed', 'archived')) DEFAULT 'active',
    public_slug TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    closed_at TIMESTAMPTZ
);

-- Seed initial 2027 Gathering Place Assessment if not already present
INSERT INTO public.gathering_place_assessments (
    id,
    title,
    description,
    assessment_year,
    status,
    public_slug
)
VALUES (
    'e7a00000-0000-0000-0000-000000000001',
    'YSA Gathering Place: Skills & Self-Reliance Needs Assessment',
    'Abeokuta Nigeria Obantoko Stake | 2027 Gathering Place Planning',
    2027,
    'active',
    '2027-skills-assessment'
)
ON CONFLICT (public_slug) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Responses Table: public.gathering_place_assessment_responses
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gathering_place_assessment_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES public.gathering_place_assessments(id) ON DELETE CASCADE,
    ward_branch TEXT NOT NULL,
    current_status TEXT NOT NULL,
    education_level TEXT NOT NULL,
    current_self_reliance_participation TEXT NOT NULL,
    hard_skill_first_choice TEXT NOT NULL,
    hard_skill_second_choice TEXT NOT NULL,
    hard_skill_third_choice TEXT NOT NULL,
    soft_skills TEXT[] NOT NULL,
    self_reliance_class_interest TEXT NOT NULL,
    desired_outcomes TEXT[] NOT NULL,
    experience_level TEXT NOT NULL,
    desired_5_6_month_outcome TEXT,
    additional_skills_suggestions TEXT,
    gathering_place_suggestions TEXT,
    preferred_days TEXT[] NOT NULL,
    preferred_time_periods TEXT[] NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),

    -- Server-side Validation Constraints
    CONSTRAINT check_distinct_hard_skills CHECK (
        hard_skill_first_choice <> hard_skill_second_choice AND
        hard_skill_first_choice <> hard_skill_third_choice AND
        hard_skill_second_choice <> hard_skill_third_choice
    ),
    CONSTRAINT check_soft_skills_count CHECK (
        array_length(soft_skills, 1) >= 1 AND
        array_length(soft_skills, 1) <= 3
    ),
    CONSTRAINT check_desired_outcomes_count CHECK (
        array_length(desired_outcomes, 1) >= 1 AND
        array_length(desired_outcomes, 1) <= 3
    ),
    CONSTRAINT check_preferred_days_not_empty CHECK (
        array_length(preferred_days, 1) >= 1
    ),
    CONSTRAINT check_preferred_time_periods_not_empty CHECK (
        array_length(preferred_time_periods, 1) >= 1
    )
);

-- Analytics & Filtering Indexes
CREATE INDEX IF NOT EXISTS idx_gp_responses_assessment_id
    ON public.gathering_place_assessment_responses(assessment_id);

CREATE INDEX IF NOT EXISTS idx_gp_responses_ward_branch
    ON public.gathering_place_assessment_responses(ward_branch);

CREATE INDEX IF NOT EXISTS idx_gp_responses_submitted_at
    ON public.gathering_place_assessment_responses(submitted_at DESC);

-- ----------------------------------------------------------------------------
-- 4. Row Level Security (RLS)
-- ----------------------------------------------------------------------------
ALTER TABLE public.gathering_place_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gathering_place_assessment_responses ENABLE ROW LEVEL SECURITY;

-- Assessments: Read is public (so respondents can view title and active state)
DROP POLICY IF EXISTS policy_gp_assessments_read ON public.gathering_place_assessments;
CREATE POLICY policy_gp_assessments_read
    ON public.gathering_place_assessments
    FOR SELECT
    TO anon, authenticated
    USING (TRUE);

-- Assessments: Insert / Update / Delete strictly restricted to authorized Stake leadership
DROP POLICY IF EXISTS policy_gp_assessments_manage ON public.gathering_place_assessments;
CREATE POLICY policy_gp_assessments_manage
    ON public.gathering_place_assessments
    FOR ALL
    TO authenticated
    USING (public.is_gathering_place_authorized(auth.uid()))
    WITH CHECK (public.is_gathering_place_authorized(auth.uid()));

-- Responses: SELECT is strictly restricted to authorized Stake leadership
-- (Anonymous respondents and unauthorized roles CANNOT read responses)
DROP POLICY IF EXISTS policy_gp_responses_select ON public.gathering_place_assessment_responses;
CREATE POLICY policy_gp_responses_select
    ON public.gathering_place_assessment_responses
    FOR SELECT
    TO authenticated
    USING (public.is_gathering_place_authorized(auth.uid()));

-- Responses: INSERT is permitted for anonymous or authenticated users ONLY IF the assessment is active
DROP POLICY IF EXISTS policy_gp_responses_insert ON public.gathering_place_assessment_responses;
CREATE POLICY policy_gp_responses_insert
    ON public.gathering_place_assessment_responses
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.gathering_place_assessments a
            WHERE a.id = assessment_id AND a.status = 'active'
        )
    );

-- Responses: UPDATE / DELETE strictly restricted to authorized Stake leadership
DROP POLICY IF EXISTS policy_gp_responses_manage ON public.gathering_place_assessment_responses;
CREATE POLICY policy_gp_responses_manage
    ON public.gathering_place_assessment_responses
    FOR ALL
    TO authenticated
    USING (public.is_gathering_place_authorized(auth.uid()))
    WITH CHECK (public.is_gathering_place_authorized(auth.uid()));

-- ----------------------------------------------------------------------------
-- 5. Stored Procedures: Public Submission & Leadership Status Management
-- ----------------------------------------------------------------------------

-- Secure response submission function with full server-side validation
CREATE OR REPLACE FUNCTION public.submit_gathering_place_response(
    p_response JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_assessment_id UUID;
    v_status TEXT;
    v_ward TEXT;
    v_curr_status TEXT;
    v_edu TEXT;
    v_curr_sr TEXT;
    v_hard1 TEXT;
    v_hard2 TEXT;
    v_hard3 TEXT;
    v_soft TEXT[];
    v_sr_class TEXT;
    v_goals TEXT[];
    v_exp TEXT;
    v_outcome56 TEXT;
    v_add_skills TEXT;
    v_suggestions TEXT;
    v_days TEXT[];
    v_times TEXT[];
    v_new_id UUID;
BEGIN
    v_assessment_id := (p_response->>'assessment_id')::UUID;
    IF v_assessment_id IS NULL THEN
        RAISE EXCEPTION 'Assessment ID is required.';
    END IF;

    -- Verify assessment exists and is active
    SELECT status INTO v_status
    FROM public.gathering_place_assessments
    WHERE id = v_assessment_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Assessment not found.';
    END IF;

    IF v_status <> 'active' THEN
        RAISE EXCEPTION 'This assessment is currently closed and no longer accepting submissions.';
    END IF;

    -- Extract and validate fields
    v_ward := btrim(COALESCE(p_response->>'ward_branch', ''));
    IF v_ward = '' THEN
        RAISE EXCEPTION 'Ward or Branch is required.';
    END IF;

    v_curr_status := btrim(COALESCE(p_response->>'current_status', ''));
    IF v_curr_status = '' THEN
        RAISE EXCEPTION 'Current status is required.';
    END IF;

    v_edu := btrim(COALESCE(p_response->>'education_level', ''));
    IF v_edu = '' THEN
        RAISE EXCEPTION 'Highest level of education is required.';
    END IF;

    v_curr_sr := btrim(COALESCE(p_response->>'current_self_reliance_participation', ''));
    IF v_curr_sr = '' THEN
        RAISE EXCEPTION 'Participation in outside programs is required.';
    END IF;

    v_hard1 := btrim(COALESCE(p_response->>'hard_skill_first_choice', ''));
    v_hard2 := btrim(COALESCE(p_response->>'hard_skill_second_choice', ''));
    v_hard3 := btrim(COALESCE(p_response->>'hard_skill_third_choice', ''));

    IF v_hard1 = '' OR v_hard2 = '' OR v_hard3 = '' THEN
        RAISE EXCEPTION 'All three ranked practical skills are required.';
    END IF;

    IF v_hard1 = v_hard2 OR v_hard1 = v_hard3 OR v_hard2 = v_hard3 THEN
        RAISE EXCEPTION 'Please select three different skills for your first, second, and third preferences.';
    END IF;

    SELECT ARRAY(SELECT jsonb_array_elements_text(p_response->'soft_skills')) INTO v_soft;
    IF array_length(v_soft, 1) IS NULL OR array_length(v_soft, 1) < 1 OR array_length(v_soft, 1) > 3 THEN
        RAISE EXCEPTION 'Please select between 1 and 3 soft skills.';
    END IF;

    v_sr_class := btrim(COALESCE(p_response->>'self_reliance_class_interest', ''));
    IF v_sr_class = '' THEN
        RAISE EXCEPTION 'Self-Reliance class interest is required.';
    END IF;

    SELECT ARRAY(SELECT jsonb_array_elements_text(p_response->'desired_outcomes')) INTO v_goals;
    IF array_length(v_goals, 1) IS NULL OR array_length(v_goals, 1) < 1 OR array_length(v_goals, 1) > 3 THEN
        RAISE EXCEPTION 'Please select between 1 and 3 goals.';
    END IF;

    v_exp := btrim(COALESCE(p_response->>'experience_level', ''));
    IF v_exp = '' THEN
        RAISE EXCEPTION 'Experience level is required.';
    END IF;

    v_outcome56 := NULLIF(btrim(COALESCE(p_response->>'desired_5_6_month_outcome', '')), '');
    v_add_skills := NULLIF(btrim(COALESCE(p_response->>'additional_skills_suggestions', '')), '');
    v_suggestions := NULLIF(btrim(COALESCE(p_response->>'gathering_place_suggestions', '')), '');

    SELECT ARRAY(SELECT jsonb_array_elements_text(p_response->'preferred_days')) INTO v_days;
    IF array_length(v_days, 1) IS NULL OR array_length(v_days, 1) < 1 THEN
        RAISE EXCEPTION 'Please select at least one convenient day.';
    END IF;

    SELECT ARRAY(SELECT jsonb_array_elements_text(p_response->'preferred_time_periods')) INTO v_times;
    IF array_length(v_times, 1) IS NULL OR array_length(v_times, 1) < 1 THEN
        RAISE EXCEPTION 'Please select at least one convenient time period.';
    END IF;

    INSERT INTO public.gathering_place_assessment_responses (
        assessment_id,
        ward_branch,
        current_status,
        education_level,
        current_self_reliance_participation,
        hard_skill_first_choice,
        hard_skill_second_choice,
        hard_skill_third_choice,
        soft_skills,
        self_reliance_class_interest,
        desired_outcomes,
        experience_level,
        desired_5_6_month_outcome,
        additional_skills_suggestions,
        gathering_place_suggestions,
        preferred_days,
        preferred_time_periods
    ) VALUES (
        v_assessment_id,
        v_ward,
        v_curr_status,
        v_edu,
        v_curr_sr,
        v_hard1,
        v_hard2,
        v_hard3,
        v_soft,
        v_sr_class,
        v_goals,
        v_exp,
        v_outcome56,
        v_add_skills,
        v_suggestions,
        v_days,
        v_times
    )
    RETURNING id INTO v_new_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'response_id', v_new_id,
        'message', 'Your survey response has been successfully submitted. Thank you for helping shape the Gathering Place!'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_gathering_place_response(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_gathering_place_response(JSONB) TO anon, authenticated;

-- Status management function for authorized Stake leadership
CREATE OR REPLACE FUNCTION public.update_gathering_place_assessment_status(
    p_assessment_id UUID,
    p_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_now TIMESTAMPTZ;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT public.is_gathering_place_authorized(v_caller_id) THEN
        RAISE EXCEPTION 'Unauthorized: Only Admin, Stake Presidency, Stake Clerk, and Stake YSA Leaders can update assessment status.';
    END IF;

    IF p_status NOT IN ('draft', 'active', 'closed', 'archived') THEN
        RAISE EXCEPTION 'Invalid status. Must be draft, active, closed, or archived.';
    END IF;

    v_now := timezone('utc', now());

    UPDATE public.gathering_place_assessments
    SET status = p_status,
        updated_at = v_now,
        closed_at = CASE WHEN p_status = 'closed' THEN v_now ELSE closed_at END
    WHERE id = p_assessment_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Assessment not found.';
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'assessment_id', p_assessment_id,
        'status', p_status,
        'updated_at', v_now
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_gathering_place_assessment_status(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_gathering_place_assessment_status(UUID, TEXT) TO authenticated;
