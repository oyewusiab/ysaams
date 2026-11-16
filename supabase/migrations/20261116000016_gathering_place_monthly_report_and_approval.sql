-- ============================================================================
-- YSA Attendance Management System (YSA AMS)
-- Stake: Abeokuta Nigeria Obantoko Stake
-- Module: Gathering Place Monthly Report, Stake Approval & Unit Distribution
-- Migration: 20261116000016_gathering_place_monthly_report_and_approval.sql
-- ============================================================================
-- Purpose:
--   1. Secure Stake President Distinction:
--      - Adds public.user_roles.is_stake_president column with a partial
--        unique constraint ensuring at most one Stake President at a time.
--      - Adds public.is_stake_president(p_user_id) helper.
--      - Adds public.can_approve_gathering_place_report(p_user_id) helper.
--      - Adds public.can_generate_gathering_place_report(p_user_id) helper.
--   2. Stake Leader Signatures & Contact:
--      - Creates public.stake_leader_signatures table for storing transparent
--        PNG signatures and verified contact details with RLS protection.
--   3. Gathering Place Monthly Report Snapshots:
--      - Creates public.gathering_place_monthly_reports table for frozen
--        report configuration, expected visits calculation, leader snapshot,
--        and multi-state approval lifecycle.
--      - Creates public.gathering_place_monthly_report_items for frozen
--        participant rows (S/N, Member Name, Ward/Branch, Class/Group, Total Visits).
--      - Creates public.gathering_place_report_history for immutable audit trail.
--   4. Least-Privilege Unit-Specific Access:
--      - Bishops, Branch Presidents, Ward Clerks, and Branch Clerks can ONLY
--        view and download approved report snapshots for their assigned unit.
--      - Cross-unit, pending, or disapproved reports are strictly denied.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TRANSACTION ENVELOPE: WRAPPED IN A SINGLE TRANSACTION
-- ----------------------------------------------------------------------------
BEGIN;

-- ----------------------------------------------------------------------------
-- PART 1: EXTEND USER ROLES & PROFILES (NON-DESTRUCTIVE)
-- ----------------------------------------------------------------------------

-- 1A. Add is_stake_president flag on user_roles
ALTER TABLE public.user_roles
ADD COLUMN IF NOT EXISTS is_stake_president BOOLEAN NOT NULL DEFAULT FALSE;

-- 1B. Enforce partial unique index so only one active Stake President exists
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_roles_stake_president
ON public.user_roles (role_name)
WHERE role_name = 'stake_presidency' AND is_stake_president = TRUE;

-- 1C. Optional phone number on user_profiles
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS phone_number TEXT DEFAULT NULL;

-- ----------------------------------------------------------------------------
-- PART 2: LEAST-PRIVILEGE AUTHORIZATION HELPERS
-- ----------------------------------------------------------------------------

-- Checks if a user is the verified Stake President
CREATE OR REPLACE FUNCTION public.is_stake_president(p_user_id UUID)
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
          AND role_name = 'stake_presidency'
          AND is_stake_president = TRUE
    );
$$;

REVOKE EXECUTE ON FUNCTION public.is_stake_president(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_stake_president(UUID) TO authenticated, anon;

-- Checks if a user can approve Gathering Place Monthly Reports
-- Only system_admin or verified Stake President can approve reports.
CREATE OR REPLACE FUNCTION public.can_approve_gathering_place_report(p_user_id UUID)
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
          AND (
            role_name = 'system_admin'
            OR (role_name = 'stake_presidency' AND is_stake_president = TRUE)
          )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.can_approve_gathering_place_report(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_approve_gathering_place_report(UUID) TO authenticated, anon;

-- Checks if a user can generate Gathering Place Monthly Reports
-- Allowed roles: system_admin, stake_presidency, stake_clerk
CREATE OR REPLACE FUNCTION public.can_generate_gathering_place_report(p_user_id UUID)
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
          AND role_name IN ('system_admin', 'stake_presidency', 'stake_clerk')
    );
$$;

REVOKE EXECUTE ON FUNCTION public.can_generate_gathering_place_report(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_generate_gathering_place_report(UUID) TO authenticated, anon;

-- ----------------------------------------------------------------------------
-- PART 3: STAKE LEADER SIGNATURES & CONTACT MANAGEMENT
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.stake_leader_signatures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    signature_data_url TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    CONSTRAINT uq_stake_leader_signature_user UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_stake_leader_sig_user ON public.stake_leader_signatures(user_id);
CREATE INDEX IF NOT EXISTS idx_stake_leader_sig_active ON public.stake_leader_signatures(is_active);

ALTER TABLE public.stake_leader_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stake_leader_signatures FORCE ROW LEVEL SECURITY;

-- Signatures RLS:
-- 1. Authorized report generators/approvers and stake leaders can view active signatures
DROP POLICY IF EXISTS policy_stake_leader_signatures_select ON public.stake_leader_signatures;
CREATE POLICY policy_stake_leader_signatures_select
ON public.stake_leader_signatures
FOR SELECT
TO authenticated
USING (
    public.can_generate_gathering_place_report(auth.uid())
    OR auth.uid() = user_id
);

-- 2. Leaders can manage their OWN signature, system_admin can manage any signature
DROP POLICY IF EXISTS policy_stake_leader_signatures_insert ON public.stake_leader_signatures;
CREATE POLICY policy_stake_leader_signatures_insert
ON public.stake_leader_signatures
FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role_name = 'system_admin')
);

DROP POLICY IF EXISTS policy_stake_leader_signatures_update ON public.stake_leader_signatures;
CREATE POLICY policy_stake_leader_signatures_update
ON public.stake_leader_signatures
FOR UPDATE
TO authenticated
USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role_name = 'system_admin')
)
WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role_name = 'system_admin')
);

DROP POLICY IF EXISTS policy_stake_leader_signatures_delete ON public.stake_leader_signatures;
CREATE POLICY policy_stake_leader_signatures_delete
ON public.stake_leader_signatures
FOR DELETE
TO authenticated
USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role_name = 'system_admin')
);

-- ----------------------------------------------------------------------------
-- PART 4: GATHERING PLACE MONTHLY REPORTS (SNAPSHOT & APPROVAL LIFECYCLE)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.gathering_place_monthly_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_title TEXT NOT NULL,
    reporting_year INT NOT NULL,
    reporting_month INT NOT NULL,
    month_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('draft', 'generated_pending_approval', 'correction_requested', 'approved', 'disapproved', 'archived')
    ) DEFAULT 'generated_pending_approval',
    version INT NOT NULL DEFAULT 1,
    expected_visits_per_ya INT NOT NULL DEFAULT 0,
    total_eligible_occurrences INT NOT NULL DEFAULT 0,
    minimum_visit_threshold INT NOT NULL DEFAULT 0,
    filter_criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
    leader_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    summary_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    unit_ids UUID[] NOT NULL DEFAULT '{}',
    generated_by UUID NOT NULL REFERENCES public.user_profiles(id),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    approved_by UUID REFERENCES public.user_profiles(id),
    approved_at TIMESTAMPTZ,
    approval_note TEXT,
    disapproved_by UUID REFERENCES public.user_profiles(id),
    disapproved_at TIMESTAMPTZ,
    disapproval_reason TEXT,
    correction_requested_by UUID REFERENCES public.user_profiles(id),
    correction_requested_at TIMESTAMPTZ,
    correction_comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_gp_reports_period ON public.gathering_place_monthly_reports(reporting_year, reporting_month);
CREATE INDEX IF NOT EXISTS idx_gp_reports_status ON public.gathering_place_monthly_reports(status);
CREATE INDEX IF NOT EXISTS idx_gp_reports_generated_by ON public.gathering_place_monthly_reports(generated_by);

ALTER TABLE public.gathering_place_monthly_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gathering_place_monthly_reports FORCE ROW LEVEL SECURITY;

-- Report Items Table (Participant Rows Snapshot)
CREATE TABLE IF NOT EXISTS public.gathering_place_monthly_report_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES public.gathering_place_monthly_reports(id) ON DELETE CASCADE,
    serial_number INT NOT NULL,
    member_id UUID REFERENCES public.members(id) ON DELETE SET NULL,
    attendee_name TEXT NOT NULL,
    unit_id UUID NOT NULL REFERENCES public.stake_units(id) ON DELETE RESTRICT,
    unit_name TEXT NOT NULL,
    class_group_display TEXT NOT NULL,
    total_visits INT NOT NULL,
    attended_session_ids UUID[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_gp_items_report ON public.gathering_place_monthly_report_items(report_id);
CREATE INDEX IF NOT EXISTS idx_gp_items_unit ON public.gathering_place_monthly_report_items(unit_id);
CREATE INDEX IF NOT EXISTS idx_gp_items_member ON public.gathering_place_monthly_report_items(member_id);

ALTER TABLE public.gathering_place_monthly_report_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gathering_place_monthly_report_items FORCE ROW LEVEL SECURITY;

-- Report History / Audit Table
CREATE TABLE IF NOT EXISTS public.gathering_place_report_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES public.gathering_place_monthly_reports(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    actor_id UUID NOT NULL REFERENCES public.user_profiles(id),
    actor_role TEXT,
    actor_name TEXT,
    comment TEXT,
    version INT NOT NULL DEFAULT 1,
    snapshot_summary JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_gp_history_report ON public.gathering_place_report_history(report_id);
CREATE INDEX IF NOT EXISTS idx_gp_history_actor ON public.gathering_place_report_history(actor_id);

ALTER TABLE public.gathering_place_report_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gathering_place_report_history FORCE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- PART 5: ROW-LEVEL SECURITY POLICIES FOR REPORTS AND ITEMS
-- ----------------------------------------------------------------------------

-- 5A. SELECT policy for gathering_place_monthly_reports:
-- - Stake Leadership (system_admin, stake_presidency, stake_clerk): can view all reports.
-- - Unit Leadership (bishop, branch_president, ward_clerk, branch_clerk):
--   can ONLY view 'approved' reports where their assigned unit is in unit_ids.
DROP POLICY IF EXISTS policy_gp_monthly_reports_select ON public.gathering_place_monthly_reports;
CREATE POLICY policy_gp_monthly_reports_select
ON public.gathering_place_monthly_reports
FOR SELECT
TO authenticated
USING (
    public.can_generate_gathering_place_report(auth.uid())
    OR (
        status = 'approved'
        AND EXISTS (
            SELECT 1
            FROM public.get_user_assigned_units(auth.uid()) uau
            WHERE uau.unit_id = ANY(gathering_place_monthly_reports.unit_ids)
        )
    )
);

-- 5B. SELECT policy for gathering_place_monthly_report_items:
-- - Stake Leadership: can view all items.
-- - Unit Leadership: can ONLY view items if parent report is 'approved' AND
--   the item's unit_id is in the caller's assigned units.
DROP POLICY IF EXISTS policy_gp_report_items_select ON public.gathering_place_monthly_report_items;
CREATE POLICY policy_gp_report_items_select
ON public.gathering_place_monthly_report_items
FOR SELECT
TO authenticated
USING (
    public.can_generate_gathering_place_report(auth.uid())
    OR (
        EXISTS (
            SELECT 1
            FROM public.gathering_place_monthly_reports r
            WHERE r.id = gathering_place_monthly_report_items.report_id
              AND r.status = 'approved'
        )
        AND EXISTS (
            SELECT 1
            FROM public.get_user_assigned_units(auth.uid()) uau
            WHERE uau.unit_id = gathering_place_monthly_report_items.unit_id
        )
    )
);

-- 5C. SELECT policy for gathering_place_report_history:
-- Stake leadership only (audit transparency for generators & approvers)
DROP POLICY IF EXISTS policy_gp_report_history_select ON public.gathering_place_report_history;
CREATE POLICY policy_gp_report_history_select
ON public.gathering_place_report_history
FOR SELECT
TO authenticated
USING (
    public.can_generate_gathering_place_report(auth.uid())
);

-- ----------------------------------------------------------------------------
-- PART 6: SECURITY DEFINER RPCS FOR REPORT LIFECYCLE & WORKFLOW
-- ----------------------------------------------------------------------------

-- 6A. RPC: Create / Submit Gathering Place Monthly Report
CREATE OR REPLACE FUNCTION public.rpc_create_gathering_place_monthly_report(
    p_report_title TEXT,
    p_reporting_year INT,
    p_reporting_month INT,
    p_month_name TEXT,
    p_expected_visits_per_ya INT,
    p_total_eligible_occurrences INT,
    p_minimum_visit_threshold INT,
    p_filter_criteria JSONB,
    p_leader_snapshot JSONB,
    p_summary_metrics JSONB,
    p_unit_ids UUID[],
    p_items JSONB -- Array of item objects
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_report_id UUID;
    v_is_admin BOOLEAN;
    v_is_president BOOLEAN;
    v_initial_status TEXT;
    v_item RECORD;
    v_caller_profile RECORD;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT public.can_generate_gathering_place_report(v_caller_id) THEN
        RAISE EXCEPTION 'Permission denied. Only System Administrator, Stake Presidency, or Stake Clerk may generate reports.';
    END IF;

    -- Determine direct approval eligibility
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles WHERE user_id = v_caller_id AND role_name = 'system_admin'
    ) INTO v_is_admin;

    SELECT public.is_stake_president(v_caller_id) INTO v_is_president;

    IF v_is_admin OR v_is_president THEN
        v_initial_status := 'approved';
    ELSE
        v_initial_status := 'generated_pending_approval';
    END IF;

    SELECT full_name, email INTO v_caller_profile
    FROM public.user_profiles
    WHERE id = v_caller_id;

    -- Insert report snapshot
    INSERT INTO public.gathering_place_monthly_reports (
        report_title,
        reporting_year,
        reporting_month,
        month_name,
        status,
        version,
        expected_visits_per_ya,
        total_eligible_occurrences,
        minimum_visit_threshold,
        filter_criteria,
        leader_snapshot,
        summary_metrics,
        unit_ids,
        generated_by,
        generated_at,
        approved_by,
        approved_at,
        approval_note
    )
    VALUES (
        p_report_title,
        p_reporting_year,
        p_reporting_month,
        p_month_name,
        v_initial_status,
        1,
        p_expected_visits_per_ya,
        p_total_eligible_occurrences,
        p_minimum_visit_threshold,
        p_filter_criteria,
        p_leader_snapshot,
        p_summary_metrics,
        p_unit_ids,
        v_caller_id,
        timezone('utc'::text, now()),
        CASE WHEN v_initial_status = 'approved' THEN v_caller_id ELSE NULL END,
        CASE WHEN v_initial_status = 'approved' THEN timezone('utc'::text, now()) ELSE NULL END,
        CASE WHEN v_initial_status = 'approved' THEN 'Directly approved upon generation by authorized executive.' ELSE NULL END
    )
    RETURNING id INTO v_report_id;

    -- Insert participant row items
    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
            serial_number INT,
            member_id UUID,
            attendee_name TEXT,
            unit_id UUID,
            unit_name TEXT,
            class_group_display TEXT,
            total_visits INT,
            attended_session_ids UUID[]
        )
        LOOP
            INSERT INTO public.gathering_place_monthly_report_items (
                report_id,
                serial_number,
                member_id,
                attendee_name,
                unit_id,
                unit_name,
                class_group_display,
                total_visits,
                attended_session_ids
            )
            VALUES (
                v_report_id,
                v_item.serial_number,
                v_item.member_id,
                v_item.attendee_name,
                v_item.unit_id,
                v_item.unit_name,
                v_item.class_group_display,
                v_item.total_visits,
                COALESCE(v_item.attended_session_ids, '{}')
            );
        END LOOP;
    END IF;

    -- Record history
    INSERT INTO public.gathering_place_report_history (
        report_id,
        action,
        actor_id,
        actor_role,
        actor_name,
        comment,
        version,
        snapshot_summary
    )
    VALUES (
        v_report_id,
        CASE WHEN v_initial_status = 'approved' THEN 'generated_and_approved' ELSE 'generated' END,
        v_caller_id,
        CASE WHEN v_is_admin THEN 'system_admin' WHEN v_is_president THEN 'stake_president' ELSE 'stake_leadership' END,
        COALESCE(v_caller_profile.full_name, 'Authorized Leader'),
        CASE WHEN v_initial_status = 'approved' THEN 'Report generated and directly approved.' ELSE 'Report generated and submitted for Stake President approval.' END,
        1,
        p_summary_metrics
    );

    -- Append to system audit logs
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
        'GATHERING_PLACE_REPORT_CREATED',
        v_report_id::text,
        'gathering_place_monthly_reports',
        'success',
        jsonb_build_object(
            'title', p_report_title,
            'status', v_initial_status,
            'year', p_reporting_year,
            'month', p_reporting_month,
            'expected_visits', p_expected_visits_per_ya,
            'total_items', jsonb_array_length(p_items)
        )
    );

    RETURN v_report_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_create_gathering_place_monthly_report FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_create_gathering_place_monthly_report TO authenticated;

-- 6B. RPC: Review Report (Approve, Disapprove, Request Correction)
CREATE OR REPLACE FUNCTION public.rpc_review_gathering_place_monthly_report(
    p_report_id UUID,
    p_action TEXT, -- 'approve', 'disapprove', 'request_correction'
    p_comment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_report RECORD;
    v_caller_profile RECORD;
    v_new_status TEXT;
    v_actor_role TEXT;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT public.can_approve_gathering_place_report(v_caller_id) THEN
        RAISE EXCEPTION 'Permission denied. Only the Stake President or System Administrator can review reports.';
    END IF;

    SELECT * INTO v_report
    FROM public.gathering_place_monthly_reports
    WHERE id = p_report_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Report not found.';
    END IF;

    IF v_report.status = 'approved' AND p_action = 'approve' THEN
        RETURN jsonb_build_object('success', true, 'status', 'approved', 'message', 'Report is already approved.');
    END IF;

    SELECT full_name INTO v_caller_profile
    FROM public.user_profiles
    WHERE id = v_caller_id;

    IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_caller_id AND role_name = 'system_admin') THEN
        v_actor_role := 'system_admin';
    ELSE
        v_actor_role := 'stake_president';
    END IF;

    IF p_action = 'approve' THEN
        v_new_status := 'approved';
        UPDATE public.gathering_place_monthly_reports
        SET status = 'approved',
            approved_by = v_caller_id,
            approved_at = timezone('utc'::text, now()),
            approval_note = p_comment,
            disapproved_by = NULL,
            disapproved_at = NULL,
            disapproval_reason = NULL,
            correction_requested_by = NULL,
            correction_requested_at = NULL,
            correction_comment = NULL,
            updated_at = timezone('utc'::text, now())
        WHERE id = p_report_id;

    ELSIF p_action = 'disapprove' THEN
        IF p_comment IS NULL OR BTRIM(p_comment) = '' THEN
            RAISE EXCEPTION 'A reason is required when disapproving a report.';
        END IF;
        v_new_status := 'disapproved';
        UPDATE public.gathering_place_monthly_reports
        SET status = 'disapproved',
            disapproved_by = v_caller_id,
            disapproved_at = timezone('utc'::text, now()),
            disapproval_reason = p_comment,
            updated_at = timezone('utc'::text, now())
        WHERE id = p_report_id;

    ELSIF p_action = 'request_correction' THEN
        IF p_comment IS NULL OR BTRIM(p_comment) = '' THEN
            RAISE EXCEPTION 'A comment explaining the required correction is required.';
        END IF;
        v_new_status := 'correction_requested';
        UPDATE public.gathering_place_monthly_reports
        SET status = 'correction_requested',
            correction_requested_by = v_caller_id,
            correction_requested_at = timezone('utc'::text, now()),
            correction_comment = p_comment,
            updated_at = timezone('utc'::text, now())
        WHERE id = p_report_id;

    ELSE
        RAISE EXCEPTION 'Invalid review action "%". Must be approve, disapprove, or request_correction.', p_action;
    END IF;

    -- Record history
    INSERT INTO public.gathering_place_report_history (
        report_id,
        action,
        actor_id,
        actor_role,
        actor_name,
        comment,
        version
    )
    VALUES (
        p_report_id,
        v_new_status,
        v_caller_id,
        v_actor_role,
        COALESCE(v_caller_profile.full_name, 'Reviewing Leader'),
        p_comment,
        v_report.version
    );

    -- Append audit log
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
        'GATHERING_PLACE_REPORT_REVIEWED',
        p_report_id::text,
        'gathering_place_monthly_reports',
        'success',
        jsonb_build_object(
            'action', p_action,
            'status', v_new_status,
            'comment', p_comment,
            'version', v_report.version
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'status', v_new_status,
        'reportId', p_report_id,
        'comment', p_comment
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_review_gathering_place_monthly_report FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_review_gathering_place_monthly_report TO authenticated;

-- 6C. RPC: Regenerate Report (Correction Revision)
CREATE OR REPLACE FUNCTION public.rpc_regenerate_gathering_place_monthly_report(
    p_report_id UUID,
    p_expected_visits_per_ya INT,
    p_total_eligible_occurrences INT,
    p_minimum_visit_threshold INT,
    p_filter_criteria JSONB,
    p_leader_snapshot JSONB,
    p_summary_metrics JSONB,
    p_unit_ids UUID[],
    p_items JSONB,
    p_revision_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_report RECORD;
    v_new_version INT;
    v_item RECORD;
    v_caller_profile RECORD;
    v_is_admin BOOLEAN;
    v_is_president BOOLEAN;
    v_new_status TEXT;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT public.can_generate_gathering_place_report(v_caller_id) THEN
        RAISE EXCEPTION 'Permission denied.';
    END IF;

    SELECT * INTO v_report
    FROM public.gathering_place_monthly_reports
    WHERE id = p_report_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Report not found.';
    END IF;

    -- Only generator or admin/president can regenerate
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_caller_id AND role_name = 'system_admin') INTO v_is_admin;
    SELECT public.is_stake_president(v_caller_id) INTO v_is_president;

    IF v_report.generated_by <> v_caller_id AND NOT v_is_admin AND NOT v_is_president THEN
        RAISE EXCEPTION 'Only the report generator, Stake President, or System Administrator can regenerate this report.';
    END IF;

    v_new_version := v_report.version + 1;
    v_new_status := CASE WHEN v_is_admin OR v_is_president THEN 'approved' ELSE 'generated_pending_approval' END;

    -- Update report record
    UPDATE public.gathering_place_monthly_reports
    SET version = v_new_version,
        status = v_new_status,
        expected_visits_per_ya = p_expected_visits_per_ya,
        total_eligible_occurrences = p_total_eligible_occurrences,
        minimum_visit_threshold = p_minimum_visit_threshold,
        filter_criteria = p_filter_criteria,
        leader_snapshot = p_leader_snapshot,
        summary_metrics = p_summary_metrics,
        unit_ids = p_unit_ids,
        approved_by = CASE WHEN v_new_status = 'approved' THEN v_caller_id ELSE NULL END,
        approved_at = CASE WHEN v_new_status = 'approved' THEN timezone('utc'::text, now()) ELSE NULL END,
        approval_note = CASE WHEN v_new_status = 'approved' THEN 'Directly approved upon regeneration.' ELSE NULL END,
        disapproved_by = NULL,
        disapproved_at = NULL,
        disapproval_reason = NULL,
        correction_requested_by = NULL,
        correction_requested_at = NULL,
        correction_comment = NULL,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_report_id;

    -- Replace items
    DELETE FROM public.gathering_place_monthly_report_items WHERE report_id = p_report_id;

    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
            serial_number INT,
            member_id UUID,
            attendee_name TEXT,
            unit_id UUID,
            unit_name TEXT,
            class_group_display TEXT,
            total_visits INT,
            attended_session_ids UUID[]
        )
        LOOP
            INSERT INTO public.gathering_place_monthly_report_items (
                report_id,
                serial_number,
                member_id,
                attendee_name,
                unit_id,
                unit_name,
                class_group_display,
                total_visits,
                attended_session_ids
            )
            VALUES (
                p_report_id,
                v_item.serial_number,
                v_item.member_id,
                v_item.attendee_name,
                v_item.unit_id,
                v_item.unit_name,
                v_item.class_group_display,
                v_item.total_visits,
                COALESCE(v_item.attended_session_ids, '{}')
            );
        END LOOP;
    END IF;

    SELECT full_name INTO v_caller_profile FROM public.user_profiles WHERE id = v_caller_id;

    -- History
    INSERT INTO public.gathering_place_report_history (
        report_id,
        action,
        actor_id,
        actor_role,
        actor_name,
        comment,
        version,
        snapshot_summary
    )
    VALUES (
        p_report_id,
        'regenerated',
        v_caller_id,
        CASE WHEN v_is_admin THEN 'system_admin' WHEN v_is_president THEN 'stake_president' ELSE 'stake_leadership' END,
        COALESCE(v_caller_profile.full_name, 'Authorized Leader'),
        COALESCE(p_revision_note, 'Report regenerated with updated parameters and attendance data.'),
        v_new_version,
        p_summary_metrics
    );

    -- Audit Log
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
        'GATHERING_PLACE_REPORT_REGENERATED',
        p_report_id::text,
        'gathering_place_monthly_reports',
        'success',
        jsonb_build_object(
            'version', v_new_version,
            'status', v_new_status,
            'items_count', jsonb_array_length(p_items)
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'reportId', p_report_id,
        'version', v_new_version,
        'status', v_new_status
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_regenerate_gathering_place_monthly_report FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_regenerate_gathering_place_monthly_report TO authenticated;

-- ----------------------------------------------------------------------------
-- TRANSACTION ENVELOPE: COMMIT ALL CHANGES ATOMICALLY
-- ----------------------------------------------------------------------------
COMMIT;

