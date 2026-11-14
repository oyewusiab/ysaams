-- ============================================================================
-- YSA Attendance Management System (YSA AMS)
-- Migration: 20261114000015_gathering_place_conditional_participation_and_skills.sql
-- Description: Add conditional non-participation reason and motivation fields
--              to gathering_place_assessment_responses, and update submit RPC.
-- ============================================================================

-- 1. Additive Columns to public.gathering_place_assessment_responses
ALTER TABLE public.gathering_place_assessment_responses
    ADD COLUMN IF NOT EXISTS participation_non_participation_reason TEXT,
    ADD COLUMN IF NOT EXISTS participation_non_participation_reason_other TEXT,
    ADD COLUMN IF NOT EXISTS participation_start_motivation TEXT,
    ADD COLUMN IF NOT EXISTS participation_start_motivation_other TEXT;

-- 2. Update Submission RPC with conditional validation
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
    v_reason TEXT;
    v_reason_other TEXT;
    v_motivation TEXT;
    v_motivation_other TEXT;
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

    -- Extract and validate base fields
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
        RAISE EXCEPTION 'Participation status in Gathering Place programs is required.';
    END IF;

    -- Conditional Questions 4a and 4b
    IF v_curr_sr IN ('No', 'I have participated in the past') THEN
        v_reason := btrim(COALESCE(p_response->>'participation_non_participation_reason', ''));
        IF v_reason = '' THEN
            RAISE EXCEPTION 'Please specify the main reason you are not currently participating.';
        END IF;

        v_reason_other := NULLIF(btrim(COALESCE(p_response->>'participation_non_participation_reason_other', '')), '');
        IF (v_reason = 'Other' OR v_reason LIKE 'Other%') AND v_reason_other IS NULL THEN
            -- Check if custom text was prefixed into reason
            IF v_reason = 'Other' THEN
                RAISE EXCEPTION 'Please specify your reason for not participating.';
            END IF;
        END IF;

        v_motivation := btrim(COALESCE(p_response->>'participation_start_motivation', ''));
        IF v_motivation = '' THEN
            RAISE EXCEPTION 'Please specify what would motivate you to register and participate.';
        END IF;

        v_motivation_other := NULLIF(btrim(COALESCE(p_response->>'participation_start_motivation_other', '')), '');
        IF (v_motivation = 'Other' OR v_motivation LIKE 'Other%') AND v_motivation_other IS NULL THEN
            IF v_motivation = 'Other' THEN
                RAISE EXCEPTION 'Please specify what would motivate you to participate.';
            END IF;
        END IF;
    ELSE
        -- When Q4 is 'Yes', clear conditional fields
        v_reason := NULL;
        v_reason_other := NULL;
        v_motivation := NULL;
        v_motivation_other := NULL;
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
        participation_non_participation_reason,
        participation_non_participation_reason_other,
        participation_start_motivation,
        participation_start_motivation_other,
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
        v_reason,
        v_reason_other,
        v_motivation,
        v_motivation_other,
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
