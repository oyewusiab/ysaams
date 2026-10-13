-- =============================================================================
-- MIGRATION: 20261013000003_activity_and_attendance_schema.sql
-- DESCRIPTION: Phase 2 Activity Engine, Members Registry, and Attendance Model
-- STAKE: Abeokuta Nigeria Obantoko Stake
-- STATUS: Prepared for Review Only (DO NOT EXECUTE IN PHASE 2A)
-- =============================================================================

-- 1. Members Register (Unit-Scoped, Preserves Historical Attendance)
CREATE TABLE IF NOT EXISTS public.members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_number TEXT UNIQUE,
    full_name TEXT NOT NULL,
    preferred_name TEXT,
    gender TEXT CHECK (gender IN ('male', 'female')),
    phone_number TEXT,
    email TEXT,
    home_unit_id UUID NOT NULL REFERENCES public.stake_units(id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_members_home_unit ON public.members(home_unit_id);
CREATE INDEX IF NOT EXISTS idx_members_active ON public.members(is_active);
CREATE INDEX IF NOT EXISTS idx_members_name ON public.members(full_name);

-- 2. Activities (Definitions & Templates)
CREATE TABLE IF NOT EXISTS public.activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL CHECK (
        category IN ('spiritual', 'social', 'service', 'sports', 'temple', 'educational', 'other')
    ),
    default_participating_units UUID[] DEFAULT NULL,
    created_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_activities_category ON public.activities(category);
CREATE INDEX IF NOT EXISTS idx_activities_created_by ON public.activities(created_by);

-- 3. Activity Sessions (Live Attendance Instances)
CREATE TABLE IF NOT EXISTS public.activity_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_id UUID NOT NULL REFERENCES public.activities(id) ON DELETE RESTRICT,
    session_title TEXT NOT NULL,
    session_date DATE NOT NULL,
    start_time TIME NOT NULL,
    scheduled_end_time TIME,
    timezone TEXT NOT NULL DEFAULT 'Africa/Lagos',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
    participating_units UUID[] DEFAULT NULL,
    visitor_registration_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    max_terminals INT NOT NULL DEFAULT 1 CHECK (max_terminals >= 1 AND max_terminals <= 10),
    code_hash TEXT,
    code_expires_at TIMESTAMPTZ,
    initiated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    initiated_at TIMESTAMPTZ,
    closed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_sessions_activity ON public.activity_sessions(activity_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON public.activity_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON public.activity_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_sessions_code_hash ON public.activity_sessions(code_hash);

-- 4. Terminal Authorizations (Lease-Based Kiosks)
CREATE TABLE IF NOT EXISTS public.terminal_authorizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.activity_sessions(id) ON DELETE CASCADE,
    terminal_token_hash TEXT NOT NULL UNIQUE,
    terminal_label TEXT NOT NULL,
    lease_expires_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc'::text, now()) + interval '10 minutes'),
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_terminals_session ON public.terminal_authorizations(session_id);
CREATE INDEX IF NOT EXISTS idx_terminals_token_hash ON public.terminal_authorizations(terminal_token_hash);
CREATE INDEX IF NOT EXISTS idx_terminals_lease ON public.terminal_authorizations(lease_expires_at);

-- 5. Attendance Records (Registered Church Members)
CREATE TABLE IF NOT EXISTS public.attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.activity_sessions(id) ON DELETE RESTRICT,
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    recorded_unit_id UUID NOT NULL REFERENCES public.stake_units(id) ON DELETE RESTRICT,
    recorded_by_terminal_id UUID REFERENCES public.terminal_authorizations(id) ON DELETE SET NULL,
    check_in_time TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_session_member_attendance UNIQUE (session_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_session ON public.attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_member ON public.attendance_records(member_id);
CREATE INDEX IF NOT EXISTS idx_attendance_recorded_unit ON public.attendance_records(recorded_unit_id);

-- 6. Session Visitors (Non-Members & Friends)
CREATE TABLE IF NOT EXISTS public.session_visitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.activity_sessions(id) ON DELETE RESTRICT,
    full_name TEXT NOT NULL,
    contact_phone TEXT,
    is_church_member BOOLEAN NOT NULL DEFAULT FALSE,
    inviting_unit_id UUID REFERENCES public.stake_units(id) ON DELETE SET NULL,
    recorded_by_terminal_id UUID REFERENCES public.terminal_authorizations(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_visitors_session ON public.session_visitors(session_id);
CREATE INDEX IF NOT EXISTS idx_visitors_inviting_unit ON public.session_visitors(inviting_unit_id);

-- 7. Session Reopening Requests
CREATE TABLE IF NOT EXISTS public.session_reopening_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.activity_sessions(id) ON DELETE CASCADE,
    requested_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL,
    authorized_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    authorized_at TIMESTAMPTZ,
    reopen_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_reopening_session ON public.session_reopening_requests(session_id);

-- 8. Enable Row-Level Security on Attendance Tables
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members FORCE ROW LEVEL SECURITY;

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities FORCE ROW LEVEL SECURITY;

ALTER TABLE public.activity_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.terminal_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terminal_authorizations FORCE ROW LEVEL SECURITY;

ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records FORCE ROW LEVEL SECURITY;

ALTER TABLE public.session_visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_visitors FORCE ROW LEVEL SECURITY;

ALTER TABLE public.session_reopening_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_reopening_requests FORCE ROW LEVEL SECURITY;

-- 9. RLS Policies for Members (Unit-Scoped)
CREATE POLICY policy_members_view ON public.members
FOR SELECT TO authenticated
USING (
    public.is_stake_wide_leader(auth.uid()) 
    OR home_unit_id IN (SELECT unit_id FROM public.get_user_assigned_units(auth.uid()))
);

CREATE POLICY policy_members_manage ON public.members
FOR ALL TO authenticated
USING (
    public.is_stake_wide_leader(auth.uid()) 
    OR home_unit_id IN (SELECT unit_id FROM public.get_user_assigned_units(auth.uid()))
)
WITH CHECK (
    public.is_stake_wide_leader(auth.uid()) 
    OR home_unit_id IN (SELECT unit_id FROM public.get_user_assigned_units(auth.uid()))
);

-- 10. RLS Policies for Activities & Sessions
CREATE POLICY policy_activities_read ON public.activities
FOR SELECT TO authenticated
USING (TRUE);

CREATE POLICY policy_activities_write ON public.activities
FOR ALL TO authenticated
USING (public.is_stake_wide_leader(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role_name = 'ysa_leader'
))
WITH CHECK (public.is_stake_wide_leader(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role_name = 'ysa_leader'
));

CREATE POLICY policy_sessions_read ON public.activity_sessions
FOR SELECT TO authenticated
USING (TRUE);

CREATE POLICY policy_sessions_write ON public.activity_sessions
FOR ALL TO authenticated
USING (public.is_stake_wide_leader(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role_name = 'ysa_leader'
))
WITH CHECK (public.is_stake_wide_leader(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role_name = 'ysa_leader'
));

-- 11. RLS Policies for Attendance Records (Unit-Scoped)
CREATE POLICY policy_attendance_view ON public.attendance_records
FOR SELECT TO authenticated
USING (
    public.is_stake_wide_leader(auth.uid()) 
    OR recorded_unit_id IN (SELECT unit_id FROM public.get_user_assigned_units(auth.uid()))
);

CREATE POLICY policy_visitors_view ON public.session_visitors
FOR SELECT TO authenticated
USING (
    public.is_stake_wide_leader(auth.uid()) 
    OR inviting_unit_id IS NULL
    OR inviting_unit_id IN (SELECT unit_id FROM public.get_user_assigned_units(auth.uid()))
);
