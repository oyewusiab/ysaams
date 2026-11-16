-- ============================================================================
-- YSA Attendance Management System (YSA AMS)
-- Stake: Abeokuta Nigeria Obantoko Stake
-- Module: Gathering Place Sign-Off & Audited Attendance Adjustment Workflow
-- Migration: 20261116000017_gathering_place_signoff_and_attendance_adjustment.sql
-- ============================================================================
-- Purpose:
--   1. Flexible Stake YSA Leader Sign-Off:
--      - Adds public.can_sign_gathering_place_report(UUID) restricting eligible
--        signatories strictly to 'stake_presidency' and 'ysa_leader'.
--      - Explicitly excludes 'system_admin' from sign-off unless they also
--        hold one of these two roles.
--      - Adds signatory role tracking and revision triggers on reports.
--   2. Non-Destructive Attendance History Preservation:
--      - Alters public.attendance_records with voiding audit columns:
--        is_voided, voided_at, voided_by, void_reason, adjustment_id, is_manual_adjustment.
--      - Replaces table-level unique constraint with a partial unique index
--        excluding voided records to support reversible corrections.
--   3. Audited Attendance Adjustment Workflow:
--      - Creates public.attendance_adjustments table for individual, multi-attendee,
--        and bulk adjustments with full lifecycle tracking.
--      - Adds public.can_manage_attendance_adjustments(UUID) and
--        public.can_approve_attendance_adjustments(UUID) authorization helpers.
--      - Validates session occurrence integrity (no future, cancelled, postponed,
--        or draft sessions; must have actually occurred).
--      - Validates class correlation against configured activity class options.
--      - Enforces Stake Clerk pending approval queue and blocks self-approval.
--      - Automatic revision flagging for previously approved reports when adjustments apply.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- PART 1: AUTHORIZATION HELPERS
-- ----------------------------------------------------------------------------

-- 1A. Eligible Stake YSA Leader Signatories
-- Strictly: stake_presidency OR ysa_leader.
-- System Admin is NOT an eligible signatory unless they hold one of these two roles.
CREATE OR REPLACE FUNCTION public.can_sign_gathering_place_report(p_user_id UUID)
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
          AND role_name IN ('stake_presidency', 'ysa_leader')
    );
$$;

REVOKE EXECUTE ON FUNCTION public.can_sign_gathering_place_report(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_sign_gathering_place_report(UUID) TO authenticated, anon;

-- 1B. Can initiate / manage attendance adjustments
-- Allowed: system_admin, stake_presidency, stake_clerk
CREATE OR REPLACE FUNCTION public.can_manage_attendance_adjustments(p_user_id UUID)
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

REVOKE EXECUTE ON FUNCTION public.can_manage_attendance_adjustments(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_attendance_adjustments(UUID) TO authenticated, anon;

-- 1C. Can approve / direct-apply attendance adjustments
-- Strictly: system_admin, stake_presidency
-- Stake Clerk cannot approve or direct-apply.
CREATE OR REPLACE FUNCTION public.can_approve_attendance_adjustments(p_user_id UUID)
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
          AND role_name IN ('system_admin', 'stake_presidency')
    );
$$;

REVOKE EXECUTE ON FUNCTION public.can_approve_attendance_adjustments(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_approve_attendance_adjustments(UUID) TO authenticated, anon;


-- ----------------------------------------------------------------------------
-- PART 2: EXTEND GATHERING PLACE MONTHLY REPORTS
-- ----------------------------------------------------------------------------

ALTER TABLE public.gathering_place_monthly_reports
ADD COLUMN IF NOT EXISTS has_pending_revision BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS revision_trigger_reason TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS signatory_role TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_gp_reports_revision
ON public.gathering_place_monthly_reports(reporting_year, reporting_month, has_pending_revision);


-- ----------------------------------------------------------------------------
-- PART 3: NON-DESTRUCTIVE ATTENDANCE HISTORY IN ATTENDANCE_RECORDS
-- ----------------------------------------------------------------------------

-- Add voiding and adjustment audit columns
ALTER TABLE public.attendance_records
ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS void_reason TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS adjustment_id UUID DEFAULT NULL,
ADD COLUMN IF NOT EXISTS is_manual_adjustment BOOLEAN NOT NULL DEFAULT FALSE;

-- Drop table-level unique constraint to allow historical voided records
ALTER TABLE public.attendance_records
DROP CONSTRAINT IF EXISTS uq_session_member_attendance;

-- Partial unique index ensuring uniqueness only among ACTIVE (non-voided) records
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_session_member_attendance
ON public.attendance_records (session_id, member_id)
WHERE is_voided = FALSE;

CREATE INDEX IF NOT EXISTS idx_attendance_records_is_voided
ON public.attendance_records (is_voided);

CREATE INDEX IF NOT EXISTS idx_attendance_records_adjustment_id
ON public.attendance_records (adjustment_id);


-- ----------------------------------------------------------------------------
-- PART 4: ATTENDANCE ADJUSTMENTS TABLE
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.attendance_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.activity_sessions(id) ON DELETE RESTRICT,
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('add_attendance', 'remove_attendance')),
    class_name TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'approved', 'rejected', 'applied')),
    requested_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    reviewed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ DEFAULT NULL,
    applied_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    applied_at TIMESTAMPTZ DEFAULT NULL,
    reason TEXT NOT NULL CHECK (char_length(trim(reason)) >= 5),
    review_comment TEXT DEFAULT NULL,
    batch_id UUID DEFAULT NULL,
    affected_record_id UUID REFERENCES public.attendance_records(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Foreign key from attendance_records.adjustment_id to attendance_adjustments.id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'fk_attendance_records_adjustment'
    ) THEN
        ALTER TABLE public.attendance_records
        ADD CONSTRAINT fk_attendance_records_adjustment
        FOREIGN KEY (adjustment_id) REFERENCES public.attendance_adjustments(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_attendance_adjustments_session ON public.attendance_adjustments(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_adjustments_member ON public.attendance_adjustments(member_id);
CREATE INDEX IF NOT EXISTS idx_attendance_adjustments_status ON public.attendance_adjustments(status);
CREATE INDEX IF NOT EXISTS idx_attendance_adjustments_batch ON public.attendance_adjustments(batch_id);
CREATE INDEX IF NOT EXISTS idx_attendance_adjustments_requested_by ON public.attendance_adjustments(requested_by);

-- ----------------------------------------------------------------------------
-- PART 5: RLS POLICIES FOR ATTENDANCE ADJUSTMENTS
-- ----------------------------------------------------------------------------

ALTER TABLE public.attendance_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_adjustments FORCE ROW LEVEL SECURITY;

-- 5A. SELECT: Stake Leaders, Clerks, or Requester
CREATE POLICY policy_attendance_adjustments_select ON public.attendance_adjustments
FOR SELECT TO authenticated
USING (
    public.can_manage_attendance_adjustments(auth.uid())
    OR requested_by = auth.uid()
);

-- 5B. INSERT: Stake Leaders or Clerks
CREATE POLICY policy_attendance_adjustments_insert ON public.attendance_adjustments
FOR INSERT TO authenticated
WITH CHECK (
    public.can_manage_attendance_adjustments(auth.uid())
    AND requested_by = auth.uid()
);

-- 5C. UPDATE: Stake Leaders (system_admin or stake_presidency)
CREATE POLICY policy_attendance_adjustments_update ON public.attendance_adjustments
FOR UPDATE TO authenticated
USING (
    public.can_approve_attendance_adjustments(auth.uid())
)
WITH CHECK (
    public.can_approve_attendance_adjustments(auth.uid())
);

-- 5D. DELETE: Strictly denied to ensure immutable auditability
CREATE POLICY policy_attendance_adjustments_delete ON public.attendance_adjustments
FOR DELETE TO authenticated
USING (FALSE);


-- ----------------------------------------------------------------------------
-- PART 6: STORED PROCEDURES & RPCS
-- ----------------------------------------------------------------------------

-- 6A. RPC: Submit Attendance Adjustment (Batch Atomicity & Session Validation)
CREATE OR REPLACE FUNCTION public.rpc_submit_attendance_adjustment(
    p_adjustments JSONB,
    p_direct_apply BOOLEAN,
    p_batch_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_can_manage BOOLEAN;
    v_can_approve BOOLEAN;
    v_batch_id UUID;
    v_item JSONB;
    v_session_id UUID;
    v_member_id UUID;
    v_adj_type TEXT;
    v_class_name TEXT;
    v_session RECORD;
    v_activity RECORD;
    v_member RECORD;
    v_existing_record RECORD;
    v_new_record_id UUID;
    v_adj_id UUID;
    v_inserted_count INT := 0;
    v_target_status TEXT;
    v_lagos_today DATE;
    v_session_year INT;
    v_session_month INT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- Validate caller management permission
    v_can_manage := public.can_manage_attendance_adjustments(v_caller_id);
    IF NOT v_can_manage THEN
        RAISE EXCEPTION 'Permission denied. Only System Administrator, Stake Presidency, or Stake Clerk may initiate adjustments.';
    END IF;

    v_can_approve := public.can_approve_attendance_adjustments(v_caller_id);

    -- Stake Clerk cannot direct-apply
    IF p_direct_apply AND NOT v_can_approve THEN
        RAISE EXCEPTION 'Permission denied: Stake Clerks cannot directly apply adjustments. Submissions must enter the pending approval queue.';
    END IF;

    -- Validate reason
    IF p_batch_reason IS NULL OR char_length(trim(p_batch_reason)) < 5 THEN
        RAISE EXCEPTION 'A valid adjustment reason (minimum 5 characters) is required.';
    END IF;

    IF p_adjustments IS NULL OR jsonb_array_length(p_adjustments) = 0 THEN
        RAISE EXCEPTION 'Adjustment payload cannot be empty.';
    END IF;

    v_batch_id := gen_random_uuid();
    v_target_status := CASE WHEN p_direct_apply AND v_can_approve THEN 'applied' ELSE 'pending_approval' END;
    v_lagos_today := (timezone('Africa/Lagos', now()))::date;

    -- Iterate and validate all items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_adjustments)
    LOOP
        v_session_id := (v_item->>'session_id')::UUID;
        v_member_id := (v_item->>'member_id')::UUID;
        v_adj_type := v_item->>'adjustment_type';
        v_class_name := NULLIF(trim(v_item->>'class_name'), '');

        IF v_session_id IS NULL OR v_member_id IS NULL OR v_adj_type IS NULL THEN
            RAISE EXCEPTION 'Malformed adjustment entry: session_id, member_id, and adjustment_type are required.';
        END IF;

        IF v_adj_type NOT IN ('add_attendance', 'remove_attendance') THEN
            RAISE EXCEPTION 'Invalid adjustment type: %', v_adj_type;
        END IF;

        -- 1. Validate Session Occurrence & Eligibility
        SELECT * INTO v_session FROM public.activity_sessions WHERE id = v_session_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Activity session with ID % does not exist.', v_session_id;
        END IF;

        IF v_session.status = 'cancelled' OR v_session.cancelled_at IS NOT NULL THEN
            RAISE EXCEPTION 'Cannot adjust attendance for cancelled session: "%".', v_session.session_title;
        END IF;

        IF v_session.postponed_at IS NOT NULL THEN
            RAISE EXCEPTION 'Cannot adjust attendance for postponed session: "%".', v_session.session_title;
        END IF;

        IF v_session.status = 'draft' THEN
            RAISE EXCEPTION 'Cannot adjust attendance for draft session: "%".', v_session.session_title;
        END IF;

        IF v_session.session_date > v_lagos_today THEN
            RAISE EXCEPTION 'Cannot adjust attendance for future session date (%): "%".', v_session.session_date, v_session.session_title;
        END IF;

        -- Session must have occurred: initiated, closed, or already has records
        IF v_session.initiated_at IS NULL AND v_session.status != 'closed' AND NOT EXISTS (
            SELECT 1 FROM public.attendance_records WHERE session_id = v_session.id
        ) THEN
            RAISE EXCEPTION 'Session "%" has no record of having actually occurred (neither initiated, closed, nor attended).', v_session.session_title;
        END IF;

        -- 2. Validate Member
        SELECT * INTO v_member FROM public.members WHERE id = v_member_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Member with ID % does not exist.', v_member_id;
        END IF;

        -- 3. Validate Class Correlation if provided
        SELECT * INTO v_activity FROM public.activities WHERE id = v_session.activity_id;
        IF v_class_name IS NOT NULL THEN
            IF NOT (
                (v_session.class_options IS NOT NULL AND v_class_name = ANY(v_session.class_options))
                OR (v_activity.class_options IS NOT NULL AND v_class_name = ANY(v_activity.class_options))
            ) THEN
                RAISE EXCEPTION 'Class "%" is not a configured class option for activity "%".', v_class_name, v_session.session_title;
            END IF;
        END IF;

        -- 4. Check Existing Active Record
        SELECT * INTO v_existing_record
        FROM public.attendance_records
        WHERE session_id = v_session_id AND member_id = v_member_id AND is_voided = FALSE;

        IF v_adj_type = 'add_attendance' THEN
            IF FOUND THEN
                RAISE EXCEPTION 'Member "%" already has an active attendance record for session "%". Duplicate manual attendance is prohibited.',
                    v_member.full_name, v_session.session_title;
            END IF;
        ELSIF v_adj_type = 'remove_attendance' THEN
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Member "%" does not have an active attendance record for session "%" to remove.',
                    v_member.full_name, v_session.session_title;
            END IF;
        END IF;

        -- 5. Insert Adjustment Record
        INSERT INTO public.attendance_adjustments (
            session_id,
            member_id,
            adjustment_type,
            class_name,
            status,
            requested_by,
            requested_at,
            reviewed_by,
            reviewed_at,
            applied_by,
            applied_at,
            reason,
            batch_id,
            affected_record_id,
            metadata
        )
        VALUES (
            v_session_id,
            v_member_id,
            v_adj_type,
            v_class_name,
            v_target_status,
            v_caller_id,
            now(),
            CASE WHEN v_target_status = 'applied' THEN v_caller_id ELSE NULL END,
            CASE WHEN v_target_status = 'applied' THEN now() ELSE NULL END,
            CASE WHEN v_target_status = 'applied' THEN v_caller_id ELSE NULL END,
            CASE WHEN v_target_status = 'applied' THEN now() ELSE NULL END,
            trim(p_batch_reason),
            v_batch_id,
            v_existing_record.id,
            jsonb_build_object(
                'session_title', v_session.session_title,
                'session_date', v_session.session_date,
                'member_name', v_member.full_name,
                'home_unit_id', v_member.home_unit_id
            )
        )
        RETURNING id INTO v_adj_id;

        -- 6. Apply Immediately if Direct Apply Authorized
        IF v_target_status = 'applied' THEN
            IF v_adj_type = 'add_attendance' THEN
                INSERT INTO public.attendance_records (
                    session_id,
                    member_id,
                    recorded_unit_id,
                    selected_class,
                    check_in_time,
                    is_manual_adjustment,
                    adjustment_id
                )
                VALUES (
                    v_session_id,
                    v_member_id,
                    v_member.home_unit_id,
                    v_class_name,
                    v_session.session_date::timestamptz,
                    TRUE,
                    v_adj_id
                )
                RETURNING id INTO v_new_record_id;

                UPDATE public.attendance_adjustments
                SET affected_record_id = v_new_record_id
                WHERE id = v_adj_id;
            ELSIF v_adj_type = 'remove_attendance' THEN
                UPDATE public.attendance_records
                SET is_voided = TRUE,
                    voided_at = now(),
                    voided_by = v_caller_id,
                    void_reason = trim(p_batch_reason),
                    adjustment_id = v_adj_id
                WHERE id = v_existing_record.id;
            END IF;

            -- Trigger revision flag on any previously approved reports for this month
            v_session_year := EXTRACT(YEAR FROM v_session.session_date)::INT;
            v_session_month := EXTRACT(MONTH FROM v_session.session_date)::INT;

            UPDATE public.gathering_place_monthly_reports
            SET has_pending_revision = TRUE,
                revision_trigger_reason = 'Direct attendance adjustment applied on ' || (timezone('Africa/Lagos', now()))::date
            WHERE reporting_year = v_session_year
              AND reporting_month = v_session_month
              AND status = 'approved'
              AND has_pending_revision = FALSE;
        END IF;

        v_inserted_count := v_inserted_count + 1;
    END LOOP;

    -- Audit Log Entry
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
        CASE WHEN v_target_status = 'applied' THEN 'ATTENDANCE_ADJUSTMENT_DIRECT_APPLIED' ELSE 'ATTENDANCE_ADJUSTMENT_SUBMITTED' END,
        v_batch_id::TEXT,
        'attendance_adjustments',
        'success',
        jsonb_build_object(
            'batch_id', v_batch_id,
            'count', v_inserted_count,
            'status', v_target_status,
            'direct_apply', p_direct_apply,
            'reason', p_batch_reason
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'batch_id', v_batch_id,
        'count', v_inserted_count,
        'status', v_target_status
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_submit_attendance_adjustment(JSONB, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_submit_attendance_adjustment(JSONB, BOOLEAN, TEXT) TO authenticated;


-- 6B. RPC: Review Attendance Adjustments (Approve / Reject Pending Requests)
CREATE OR REPLACE FUNCTION public.rpc_review_attendance_adjustment(
    p_adjustment_ids UUID[],
    p_action TEXT,
    p_comment TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_can_approve BOOLEAN;
    v_adj RECORD;
    v_session RECORD;
    v_member RECORD;
    v_existing_record RECORD;
    v_new_record_id UUID;
    v_reviewed_count INT := 0;
    v_session_year INT;
    v_session_month INT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    v_can_approve := public.can_approve_attendance_adjustments(v_caller_id);
    IF NOT v_can_approve THEN
        RAISE EXCEPTION 'Permission denied. Only System Administrator or Stake Presidency may review attendance adjustments.';
    END IF;

    IF p_action NOT IN ('approve', 'reject') THEN
        RAISE EXCEPTION 'Invalid review action: %. Allowed actions are approve or reject.', p_action;
    END IF;

    IF p_action = 'reject' AND (p_comment IS NULL OR char_length(trim(p_comment)) < 3) THEN
        RAISE EXCEPTION 'A comment explaining the rejection is required.';
    END IF;

    -- Block Self-Approval: Caller cannot approve requests they submitted
    IF p_action = 'approve' AND EXISTS (
        SELECT 1 FROM public.attendance_adjustments
        WHERE id = ANY(p_adjustment_ids) AND requested_by = v_caller_id
    ) THEN
        RAISE EXCEPTION 'Self-approval is strictly prohibited. You cannot approve attendance adjustments that you requested.';
    END IF;

    -- Process Each Adjustment
    FOR v_adj IN
        SELECT * FROM public.attendance_adjustments
        WHERE id = ANY(p_adjustment_ids) AND status = 'pending_approval'
        FOR UPDATE
    LOOP
        SELECT * INTO v_session FROM public.activity_sessions WHERE id = v_adj.session_id;
        SELECT * INTO v_member FROM public.members WHERE id = v_adj.member_id;

        IF p_action = 'reject' THEN
            UPDATE public.attendance_adjustments
            SET status = 'rejected',
                reviewed_by = v_caller_id,
                reviewed_at = now(),
                review_comment = trim(p_comment),
                updated_at = now()
            WHERE id = v_adj.id;
        ELSIF p_action = 'approve' THEN
            IF v_adj.adjustment_type = 'add_attendance' THEN
                -- Ensure no conflict before applying
                SELECT * INTO v_existing_record
                FROM public.attendance_records
                WHERE session_id = v_adj.session_id AND member_id = v_adj.member_id AND is_voided = FALSE;

                IF FOUND THEN
                    RAISE EXCEPTION 'Cannot approve: Member "%" already has an active attendance record for session "%".',
                        v_member.full_name, v_session.session_title;
                END IF;

                INSERT INTO public.attendance_records (
                    session_id,
                    member_id,
                    recorded_unit_id,
                    selected_class,
                    check_in_time,
                    is_manual_adjustment,
                    adjustment_id
                )
                VALUES (
                    v_adj.session_id,
                    v_adj.member_id,
                    v_member.home_unit_id,
                    v_adj.class_name,
                    v_session.session_date::timestamptz,
                    TRUE,
                    v_adj.id
                )
                RETURNING id INTO v_new_record_id;

                UPDATE public.attendance_adjustments
                SET status = 'applied',
                    reviewed_by = v_caller_id,
                    reviewed_at = now(),
                    applied_by = v_caller_id,
                    applied_at = now(),
                    review_comment = p_comment,
                    affected_record_id = v_new_record_id,
                    updated_at = now()
                WHERE id = v_adj.id;

            ELSIF v_adj.adjustment_type = 'remove_attendance' THEN
                SELECT * INTO v_existing_record
                FROM public.attendance_records
                WHERE session_id = v_adj.session_id AND member_id = v_adj.member_id AND is_voided = FALSE;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'Cannot approve: Active attendance record no longer exists for member "%" in session "%".',
                        v_member.full_name, v_session.session_title;
                END IF;

                UPDATE public.attendance_records
                SET is_voided = TRUE,
                    voided_at = now(),
                    voided_by = v_caller_id,
                    void_reason = v_adj.reason,
                    adjustment_id = v_adj.id
                WHERE id = v_existing_record.id;

                UPDATE public.attendance_adjustments
                SET status = 'applied',
                    reviewed_by = v_caller_id,
                    reviewed_at = now(),
                    applied_by = v_caller_id,
                    applied_at = now(),
                    review_comment = p_comment,
                    affected_record_id = v_existing_record.id,
                    updated_at = now()
                WHERE id = v_adj.id;
            END IF;

            -- Trigger revision flag on any previously approved reports for this month
            v_session_year := EXTRACT(YEAR FROM v_session.session_date)::INT;
            v_session_month := EXTRACT(MONTH FROM v_session.session_date)::INT;

            UPDATE public.gathering_place_monthly_reports
            SET has_pending_revision = TRUE,
                revision_trigger_reason = 'Approved attendance adjustment applied on ' || (timezone('Africa/Lagos', now()))::date
            WHERE reporting_year = v_session_year
              AND reporting_month = v_session_month
              AND status = 'approved'
              AND has_pending_revision = FALSE;
        END IF;

        v_reviewed_count := v_reviewed_count + 1;
    END LOOP;

    -- Audit log
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
        CASE WHEN p_action = 'approve' THEN 'ATTENDANCE_ADJUSTMENTS_APPROVED' ELSE 'ATTENDANCE_ADJUSTMENTS_REJECTED' END,
        v_caller_id::TEXT,
        'attendance_adjustments',
        'success',
        jsonb_build_object(
            'action', p_action,
            'count', v_reviewed_count,
            'comment', p_comment
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'count', v_reviewed_count,
        'action', p_action
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_review_attendance_adjustment(UUID[], TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_review_attendance_adjustment(UUID[], TEXT, TEXT) TO authenticated;

COMMIT;
