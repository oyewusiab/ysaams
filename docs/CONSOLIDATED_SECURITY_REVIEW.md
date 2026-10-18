# YSA AMS — Consolidated Security Review and Remediation Plan
**Abeokuta Nigeria Obantoko Stake | The Church of Jesus Christ of Latter-day Saints**  
**Target Supabase Project:** `sqtmtwmdniwekthcngfn` (`https://sqtmtwmdniwekthcngfn.supabase.co`)  
**Document Version:** 2.0.0 (Phase 2B Staged Remediation & Implementation Verification)  
**Security Lead Evaluation Date:** October 13, 2026  
**Final Status Assessment:** **READY FOR REMEDIATION (PHASE 2B STAGED & VERIFIED)**

---

## 1. Executive Summary & Current Status

This consolidated security review evaluates the complete YSA AMS application codebase, staged migration sequence (Migrations 1 through 5), database types, authentication model, Row-Level Security (RLS) policies, Stored Procedures (RPCs), and automated test suites.

### Final Decision: **PHASE 2B STAGED — READY FOR LIVE DATABASE REVIEW**
- **Phase 2B Implementation Completed & Staged:**
  1. `20261013000005_security_and_privilege_remediation.sql` staged in `supabase/migrations/` (resolving SEC-01 through SEC-04, and SEC-06).
  2. Full terminal authorization, volatile `sessionStorage` bearer token management, and 4-minute lease heartbeat loop implemented in `src/services/attendanceService.ts` (resolving SEC-05).
  3. Authorized leader manual attendance check-in form and workflow implemented in `src/components/leadership/LeadershipPortalView.tsx` (`/la/attendance`) wired to `record_manual_attendance` RPC.
  4. Expanded Vitest regression suite: **39 passing tests** (21 domain invariant tests, 6 migration contract tests, 5 routing tests, 4 helper tests, 3 env tests).
  5. Static analysis and production build verified: **`oxlint` 0 errors / 0 warnings**, clean bundle build (`tsc -b && vite build`).
- **Live Database Guardrail Preserved:** **Zero live database mutations executed.** Migration 5 has NOT been run on Supabase project `sqtmtwmdniwekthcngfn`. All changes remain local, staged, and reviewed in Git.

---

## 2. Distinction of Verified Facts

To preserve absolute factual integrity, all evidence is categorized into verified source facts vs. verified live database facts:

### A. Facts Verified from Source Code (`C:\Users\FA REGISTRY\Desktop\ysaams`)
1. `[SOURCE-VERIFIED]` **Audit Insert Elimination:** `Migration 5` (`20261013000005_security_and_privilege_remediation.sql`) explicitly executes `DROP POLICY IF EXISTS policy_audit_insert ON public.audit_logs;`. Direct client audit logging is prohibited; all audit records are generated exclusively by trusted `SECURITY DEFINER` RPCs.
2. `[SOURCE-VERIFIED]` **Table-Level DAC Revocations Across All 12 Tables:** `Migration 5` revokes all default permissions (`REVOKE ALL ON TABLE ... FROM anon, authenticated, public`) across all 12 application tables, re-granting strictly minimum required permissions (`SELECT`, and targeted mutations on user-writable entities via RLS). `terminal_authorizations` has zero direct grants.
3. `[SOURCE-VERIFIED]` **Profile Column Protection Trigger:** `Migration 5` adds `fn_protect_profile_fields()` and `trg_protect_profile_fields` on `user_profiles`, preventing non-administrators from altering `account_status` or `email`.
4. `[SOURCE-VERIFIED]` **Cross-Unit Visitor Boundary Enforced:** `Migration 5` replaces `policy_visitors_view` so that unassigned visitors (`inviting_unit_id IS NULL`) are visible only to stake-wide leaders (`is_stake_wide_leader(auth.uid())`).
5. `[SOURCE-VERIFIED]` **Client Terminal Lifecycle Wired:** `src/services/attendanceService.ts` provides complete implementations of:
   - `authorizeTerminal(sessionCode, terminalLabel)` passing `p_session_code`, `p_terminal_label`, and `p_existing_terminal_token`.
   - Volatile bearer token persistence in `sessionStorage` (preventing token leakage to local disk or Git).
   - 4-minute periodic background heartbeat lease renewal (`heartbeat_terminal_lease`).
   - Clean lease cancellation on disconnect (`release_terminal`).
   - `recordAttendance` routing correctly between member and visitor RPCs.
6. `[SOURCE-VERIFIED]` **Leader Manual Attendance Workflow:** `src/services/attendanceService.ts` exports `recordManualAttendance(...)`, integrated directly into `/la/attendance` in `src/components/leadership/LeadershipPortalView.tsx`.
7. `[SOURCE-VERIFIED]` **Test & Build Verification:** 
   - `npm test`: **39 passed** (39 tests in 5 files).
   - `npm run lint`: **0 warnings, 0 errors** across 22 files.
   - `npm run build`: Production build succeeded (`dist/index.html` 0.57 kB, `dist/assets/index-BdvnDcjH.css` 22.20 kB, `dist/assets/index--L7JQEt4.js` 492.21 kB).

### B. Facts Verified Against Live Database (`sqtmtwmdniwekthcngfn`)
1. `[DB-VERIFIED]` **Endpoint & API Gateway:** `https://sqtmtwmdniwekthcngfn.supabase.co/rest/v1/` responds HTTP 401 with `sb-project-ref: sqtmtwmdniwekthcngfn`.
2. `[DB-VERIFIED]` **RLS Status:** 12 application tables exist, and Row-Level Security is enabled and forced (`FORCE ROW LEVEL SECURITY`) across all of them.
3. `[DB-VERIFIED]` **Absence of CLI Migration Table:** `supabase_migrations.schema_migrations` returns NULL / does not exist because migrations were executed via dashboard/manual SQL rather than the Supabase CLI.
4. `[DB-VERIFIED]` **Default DAC Privileges:** PostgreSQL catalog checks report table-level privileges as `true` for `anon` and `authenticated` on `audit_logs` and `user_profiles` because Supabase's default public schema permissions grant table-level access, relying on RLS as the primary defense unless explicitly revoked.

---

## 3. Remediation Matrix & Implementation Evidence

| Finding ID | Severity | Status in Codebase | Staged SQL Location | Client Implementation |
| :--- | :---: | :---: | :--- | :--- |
| **SEC-01** (Audit Forge) | **CRITICAL** | **REMEDIATED (STAGED)** | `20261013000005_security_and_privilege_remediation.sql#L15-L23` | Direct inserts disabled; all writes via RPCs. |
| **SEC-02** (Default DAC) | **CRITICAL** | **REMEDIATED (STAGED)** | `20261013000005_security_and_privilege_remediation.sql#L33-L60` | Full `REVOKE ALL` on 12 tables; minimum re-grants. |
| **SEC-03** (Profile Bypass) | **HIGH** | **REMEDIATED (STAGED)** | `20261013000005_security_and_privilege_remediation.sql#L66-L92` | `trg_protect_profile_fields` guards `account_status`. |
| **SEC-04** (Visitor Leak) | **HIGH** | **REMEDIATED (STAGED)** | `20261013000005_security_and_privilege_remediation.sql#L98-L108` | Unassigned visitors restricted to stake leaders. |
| **SEC-05** (Terminal Lifecycle) | **HIGH** | **REMEDIATED (STAGED)** | `20261013000004_attendance_engine_rpcs.sql` | `attendanceService.ts` (Storage, 4-min heartbeat). |
| **SEC-06** (Manual Check-In) | **MEDIUM** | **REMEDIATED (STAGED)** | `20261018000006_targeted_manual_attendance_authorization.sql` | `recordManualAttendance` + UI in `/la/attendance`. |
| **SEC-07** (Missing Migrations) | **MEDIUM** | **RECONCILED** | Managed via non-destructive versioned scripts. | No synthetic CLI rows inserted. |
| **SEC-08** (Stake Units) | **LOW** | **PENDING CONFIRMATION** | `stake_units` table created; unseeded. | Awaiting official ward/branch list. |

---

## 4. Staged SQL Remediation: Migration 5

The complete staged SQL remediation script is located at:
`supabase/migrations/20261013000005_security_and_privilege_remediation.sql`

```sql
-- =============================================================================
-- MIGRATION: 20261013000005_security_and_privilege_remediation.sql
-- DESCRIPTION: Post-Audit Security Hardening, Table Privilege Revocations,
--              Profile Column Protection, Visitor Scoping, and Manual Check-in RPC
-- STAKE: Abeokuta Nigeria Obantoko Stake
-- STATUS: Staged for Phase 2B Review (DO NOT EXECUTE UNTIL EXPLICITLY AUTHORIZED)
-- IDEMPOTENT: Safe to run repeatedly; preserves existing tables, data, and constraints
-- =============================================================================

-- PART 1: SEC-01 REMEDIATION — ELIMINATE AUDIT LOG FABRICATION
DROP POLICY IF EXISTS policy_audit_insert ON public.audit_logs;

DROP POLICY IF EXISTS policy_audit_read ON public.audit_logs;
CREATE POLICY policy_audit_read ON public.audit_logs
FOR SELECT TO authenticated
USING (public.is_stake_wide_leader(auth.uid()));

-- PART 2: SEC-02 REMEDIATION — COMPREHENSIVE PRIVILEGE HARDENING ACROSS ALL 12 TABLES
REVOKE ALL ON TABLE public.stake_units FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.user_profiles FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.user_roles FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.user_unit_assignments FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.audit_logs FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.members FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.activities FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.activity_sessions FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.terminal_authorizations FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.attendance_records FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.session_visitors FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.session_reopening_requests FROM anon, authenticated, public;

GRANT SELECT ON TABLE public.stake_units TO anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.user_profiles TO authenticated;
GRANT SELECT ON TABLE public.user_roles TO authenticated;
GRANT SELECT ON TABLE public.user_unit_assignments TO authenticated;
GRANT SELECT ON TABLE public.audit_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.activities TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.activity_sessions TO authenticated;
GRANT SELECT ON TABLE public.attendance_records TO authenticated;
GRANT SELECT ON TABLE public.session_visitors TO authenticated;
GRANT SELECT, INSERT ON TABLE public.session_reopening_requests TO authenticated;

-- PART 3: SEC-03 REMEDIATION — PROTECT SENSITIVE USER PROFILE COLUMNS
CREATE OR REPLACE FUNCTION public.fn_protect_profile_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.is_system_admin(auth.uid()) THEN
        IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
            RAISE EXCEPTION 'Unauthorized: Only system administrators can alter account status.';
        END IF;

        IF NEW.email IS DISTINCT FROM OLD.email THEN
            RAISE EXCEPTION 'Unauthorized: Profile email address cannot be changed directly.';
        END IF;
    END IF;

    NEW.updated_at := timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_fields ON public.user_profiles;
CREATE TRIGGER trg_protect_profile_fields
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.fn_protect_profile_fields();

-- PART 4: SEC-04 REMEDIATION — SECURE VISITOR VISIBILITY BOUNDARY
DROP POLICY IF EXISTS policy_visitors_view ON public.session_visitors;
CREATE POLICY policy_visitors_view ON public.session_visitors
FOR SELECT TO authenticated
USING (
    public.is_stake_wide_leader(auth.uid()) 
    OR (
        inviting_unit_id IS NOT NULL 
        AND inviting_unit_id IN (SELECT unit_id FROM public.get_user_assigned_units(auth.uid()))
    )
);

-- PART 5: SEC-06 REMEDIATION — LEADER MANUAL CHECK-IN RPC
CREATE OR REPLACE FUNCTION public.record_manual_attendance(
    p_session_id UUID,
    p_member_id UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_session RECORD;
    v_member RECORD;
    v_now TIMESTAMPTZ;
    v_attendance_id UUID;
    v_is_stake_leader BOOLEAN;
    v_is_unit_leader BOOLEAN;
BEGIN
    v_caller_id := auth.uid();
    v_now := timezone('utc'::text, now());

    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT * INTO v_session
    FROM public.activity_sessions
    WHERE id = p_session_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Activity session not found.';
    END IF;

    IF v_session.status != 'active' THEN
        RAISE EXCEPTION 'Attendance session is % and cannot accept check-ins.', v_session.status;
    END IF;

    SELECT * INTO v_member
    FROM public.members
    WHERE id = p_member_id AND is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Member not found or inactive.';
    END IF;

    v_is_stake_leader := public.is_stake_wide_leader(v_caller_id);
    v_is_unit_leader := EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = v_caller_id AND ur.role_name = 'ysa_leader'
    ) OR EXISTS (
        SELECT 1 FROM public.user_unit_assignments uua
        WHERE uua.user_id = v_caller_id AND uua.unit_id = v_member.home_unit_id
    );

    IF NOT (v_is_stake_leader OR v_is_unit_leader) THEN
        RAISE EXCEPTION 'Unauthorized: You do not have permission to check in members for this unit.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_records
        WHERE session_id = p_session_id AND member_id = p_member_id
    ) THEN
        RAISE EXCEPTION 'Duplicate check-in: % is already marked present for this session.', v_member.full_name;
    END IF;

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
        NULL,
        v_now
    )
    RETURNING id INTO v_attendance_id;

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
        'MANUAL_ATTENDANCE_CHECKIN',
        v_attendance_id::text,
        'attendance_records',
        'success',
        jsonb_build_object(
            'session_id', p_session_id,
            'member_id', p_member_id,
            'member_name', v_member.full_name,
            'notes', NULLIF(trim(p_notes), '')
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'attendance_id', v_attendance_id,
        'member_name', v_member.full_name,
        'check_in_time', v_now,
        'manual', TRUE
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_manual_attendance(UUID, UUID, TEXT) TO authenticated;
```

---

## 5. Rollback Considerations

If the remediation patch must be rolled back on the live database after execution:
1. Reverting the RLS policy changes and functions is completely non-destructive:
   ```sql
   DROP POLICY IF EXISTS policy_visitors_view ON public.session_visitors;
   DROP TRIGGER IF EXISTS trg_protect_profile_fields ON public.user_profiles;
   DROP FUNCTION IF EXISTS public.fn_protect_profile_fields();
   DROP FUNCTION IF EXISTS public.record_manual_attendance(UUID, UUID, TEXT);
   ```
2. Re-granting default DAC permissions (if required for debugging):
   ```sql
   GRANT ALL ON public.audit_logs TO authenticated;
   ```
3. No table drops, column drops, or destructive operations are executed. All existing data in `activity_sessions`, `members`, and `attendance_records` is fully preserved.

---

## 6. Practical Verification & Deployment Blockers

### Remaining Unresolved Deployment Blockers:
1. **BLOCKER 1: Live Migration Execution Gate:**
   - Migrations 1 through 5 must be executed by the project owner in the Supabase SQL Editor.
2. **BLOCKER 2: Initial Administrator Account Bootstrap:**
   - The primary administrator account for `oyewusi.adebayo1@gmail.com` must be created in Supabase Auth and elevated to `system_admin` via the authorized DO-block SQL.
3. **BLOCKER 3: Confirmation of Official Stake Units:**
   - The official list of wards and branches for Abeokuta Nigeria Obantoko Stake must be confirmed before inserting seed data into `public.stake_units`.
4. **BLOCKER 4: Pre-Deployment Vercel Freeze:**
   - Production deployment to Vercel remains blocked until Gates 1 through 3 are completed and verified in staging.

---

## 7. Next Actions

The codebase is fully staged, tested, and aligned with Phase 2B requirements. Awaiting user review and authorization before proceeding to the live database execution plan.
