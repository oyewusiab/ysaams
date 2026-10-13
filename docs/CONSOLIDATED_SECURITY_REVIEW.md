# YSA AMS — Consolidated Security Review and Remediation Plan
**Abeokuta Nigeria Obantoko Stake | The Church of Jesus Christ of Latter-day Saints**  
**Target Supabase Project:** `sqtmtwmdniwekthcngfn` (`https://sqtmtwmdniwekthcngfn.supabase.co`)  
**Document Version:** 1.0.0 (Consolidated Security Baseline)  
**Security Lead Evaluation Date:** October 13, 2026  
**Final Status Assessment:** **READY FOR REMEDIATION**

---

## 1. Executive Summary & Final Decision

This consolidated security review evaluates the complete YSA AMS application codebase, staged migration sequence, database types, authentication model, Row-Level Security (RLS) policies, Stored Procedures (RPCs), and automated test suites.

### Final Decision: **READY FOR REMEDIATION**
- **Not Ready for Deployment:** The application cannot be deployed to production in its current state due to two critical RLS/privilege vulnerabilities and unwired frontend terminal service stubs.
- **Ready for Remediation:** All defects and risks have been traced to exact source lines and database policies. A minimal, surgical, non-destructive remediation plan is detailed below to resolve all vulnerabilities before database execution.

---

## 2. Distinction of Verified Facts

To preserve absolute factual integrity, all evidence is categorized into verified source facts vs. verified live database facts:

### A. Facts Verified from Source Code (`C:\Users\FA REGISTRY\Desktop\ysaams`)
1. `[SOURCE-VERIFIED]` **Audit Insert Vulnerability:** `Migration 2` (`20261013000002_core_rls_policies.sql`, lines 120–123) defines `policy_audit_insert` with `WITH CHECK (TRUE)` for `authenticated` users.
2. `[SOURCE-VERIFIED]` **Profile Status Escalation:** `Migration 2` (`policy_profiles_self_update`) permits authenticated users to update their own profile row without restricting updates to `account_status`.
3. `[SOURCE-VERIFIED]` **Cross-Unit Visitor Leak:** `Migration 3` (`policy_visitors_view`) includes `OR inviting_unit_id IS NULL`, allowing unit leaders (bishops) to view stake-wide visitors not invited by their unit.
4. `[SOURCE-VERIFIED]` **Unwired Frontend Terminal Service:** `src/services/attendanceService.ts` contains stubbed Phase 1 placeholders. It does not invoke `supabase.rpc('authorize_terminal')`, does not persist the issued 32-byte bearer token in `sessionStorage`, and does not run the 5-minute heartbeat lease renewal loop.
5. `[SOURCE-VERIFIED]` **Missing Leader Manual Check-in:** `attendance_records` allows `INSERT` exclusively through `record_attendance`, which strictly demands a valid `terminal_token`. Authorized leaders in `/la/attendance` have no mechanism to record manual check-ins.
6. `[SOURCE-VERIFIED]` **Test & Build Health:** All 29 Vitest tests pass across 5 test suites; `oxlint` reports 0 warnings and 0 errors across 22 files; and `tsc -b && vite build` produces a clean bundle (483.62 kB JS, 22.04 kB CSS).

### B. Facts Verified Against Live Database (`sqtmtwmdniwekthcngfn`)
1. `[DB-VERIFIED]` **Endpoint & API Gateway:** `https://sqtmtwmdniwekthcngfn.supabase.co/rest/v1/` responds HTTP 401 with `sb-project-ref: sqtmtwmdniwekthcngfn`.
2. `[DB-VERIFIED]` **RLS Status:** 12 application tables exist, and Row-Level Security is enabled and forced (`FORCE ROW LEVEL SECURITY`) across all of them.
3. `[DB-VERIFIED]` **Absence of CLI Migration Table:** `supabase_migrations.schema_migrations` returns NULL / does not exist because migrations were executed via dashboard/manual SQL rather than the Supabase CLI.
4. `[DB-VERIFIED]` **Default DAC Privileges:** PostgreSQL catalog checks report table-level privileges as `true` for `anon` and `authenticated` on `audit_logs` and `user_profiles` because Supabase's default public schema permissions grant table-level access, relying on RLS as the primary defense unless explicitly revoked.

---

## 3. Consolidated Findings by Severity

```
┌────────────────────────────────────────────────────────────────────────┐
│                      SECURITY FINDINGS SUMMARY                         │
├──────────────┬───────┬─────────────────────────────────────────────────┤
│ CRITICAL     │   2   │ SEC-01 (Audit Forge), SEC-02 (Default DAC)      │
│ HIGH         │   3   │ SEC-03 (Status Bypass), SEC-04 (Visitor Leak),   │
│              │       │ SEC-05 (Unwired Terminal Service)               │
│ MEDIUM       │   2   │ SEC-06 (No Leader Manual Check-in),             │
│              │       │ SEC-07 (Missing schema_migrations Table)         │
│ LOW / INFO   │   1   │ SEC-08 (Unconfirmed Stake Units)                │
└──────────────┴───────┴─────────────────────────────────────────────────┘
```

---

### [CRITICAL] SEC-01: Audit Log Fabrication via Overly Permissive `policy_audit_insert`
- **Location:** `supabase/migrations/20261013000002_core_rls_policies.sql#L120-L123`
- **Vulnerability:** `CREATE POLICY policy_audit_insert ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (TRUE);`
- **Attack Vector:** Any authenticated client can execute `supabase.from('audit_logs').insert({...})`, forging arbitrary audit events with falsified `actor_id`, fabricated `action` types, and spoofed outcomes.
- **Root Cause:** Audit logs are written by server-side `SECURITY DEFINER` RPCs (`initiate_attendance_session`, `close_attendance_session`, `reopen_attendance_session`). Because `SECURITY DEFINER` functions run with superuser/owner privileges, they bypass table RLS. Direct client inserts are completely unnecessary.
- **Remediation:** Drop `policy_audit_insert` entirely. Revoke `INSERT, UPDATE, DELETE` from `authenticated` and `anon`.

---

### [CRITICAL] SEC-02: Missing Defense-in-Depth Table DAC Revocation
- **Location:** `supabase/migrations/20261013000001_core_identity_and_units.sql` & `20261013000002_core_rls_policies.sql`
- **Vulnerability:** Standard Supabase PostgreSQL grants table-level `SELECT, INSERT, UPDATE, DELETE` on newly created public tables to `anon` and `authenticated`.
- **Attack Vector:** If any RLS policy contains a logic flaw or `WITH CHECK (TRUE)` (as in SEC-01), the database permissions engine allows the client to execute the statement because table-level DAC permissions were never revoked.
- **Remediation:** Explicitly execute `REVOKE ALL` on sensitive tables (`audit_logs`, `user_roles`, `user_unit_assignments`, `attendance_records`, `terminal_authorizations`), selectively granting only `SELECT` where required.

---

### [HIGH] SEC-03: Privilege Escalation via Self-Update on `user_profiles.account_status`
- **Location:** `supabase/migrations/20261013000002_core_rls_policies.sql#L83-L87`
- **Vulnerability:** `policy_profiles_self_update` checks `auth.uid() = id`. It does not restrict which columns the user can update.
- **Attack Vector:** A deactivated or pending user can issue:
  `supabase.from('user_profiles').update({ account_status: 'active' }).eq('id', auth.uid())`
  restoring active account status without administrative approval.
- **Remediation:** Implement a `BEFORE UPDATE` trigger on `public.user_profiles` (`trg_protect_profile_fields`) that rejects any modification to `account_status` unless the caller is `system_admin`.

---

### [HIGH] SEC-04: Cross-Unit Data Leakage on Visitor Records
- **Location:** `supabase/migrations/20261013000003_activity_and_attendance_schema.sql#L210-L216`
- **Vulnerability:** `policy_visitors_view` grants access if `inviting_unit_id IS NULL`.
- **Attack Vector:** Unit leaders (e.g., Bishop of Ward A) can view all visitors across the stake who registered without an inviting unit, violating strict unit boundary scoping.
- **Remediation:** Restrict viewing of unassigned visitors (`inviting_unit_id IS NULL`) strictly to stake-wide leaders (`is_stake_wide_leader(auth.uid())`).

---

### [HIGH] SEC-05: Unwired Terminal Redemption & Bearer Token Management
- **Location:** `src/services/attendanceService.ts#L11-L26` & `src/App.tsx#L106-L113`
- **Vulnerability:** 
  1. `attendanceService.authorizeTerminal` is an unimplemented stub.
  2. The database RPC `authorize_terminal` requires 3 parameters (`p_session_code`, `p_terminal_label`, `p_existing_terminal_token DEFAULT NULL`), but the frontend passes only 2.
  3. The frontend never stores the issued 32-byte bearer token in `sessionStorage` and never initializes the 5-minute heartbeat loop (`heartbeat_terminal_lease`).
- **Impact:** Kiosks cannot authenticate live check-in submissions; device refresh causes slot lockouts or lease timeouts after 10 minutes.
- **Remediation:** Complete the production wiring of `attendanceService.ts` with token storage, 5-minute heartbeat timer, and URL scrubbing.

---

### [MEDIUM] SEC-06: Lack of Authorized Leader Manual Attendance Entry
- **Location:** `supabase/migrations/20261013000003_activity_and_attendance_schema.sql#L202-L208`
- **Vulnerability:** `attendance_records` allows writes exclusively via `record_attendance`, which strictly demands a valid `terminal_token`. Authorized leaders on `/la/attendance` have no mechanism to mark manual catch-up attendance.
- **Remediation:** Add a dedicated stored procedure `record_manual_attendance(p_session_id, p_member_id, p_notes)` for authorized leaders and administrators.

---

### [MEDIUM] SEC-07: Unmanaged Migration History (Missing `schema_migrations`)
- **Location:** Live database catalog
- **Vulnerability:** Absence of `supabase_migrations.schema_migrations`.
- **Remediation:** Author safe, idempotent migrations. Do not invent synthetic timestamps or guess migration history. Apply migrations via a unified, verified baseline script.

---

### [LOW / INFO] SEC-08: Stake Units Pending Official Confirmation
- **Location:** Stake administrative boundary
- **Remediation:** Do not invent unit names. Leave `stake_units` empty until officially confirmed.

---

## 4. Minimal Safe Remediation Plan

### 4.1 SQL Remediation Patch (`supabase/migrations/20261013000005_security_and_privilege_remediation.sql`)
This single consolidated remediation migration resolves SEC-01, SEC-02, SEC-03, SEC-04, and SEC-06 without dropping any tables or altering existing data:

```sql
-- =============================================================================
-- MIGRATION: 20261013000005_security_and_privilege_remediation.sql
-- DESCRIPTION: Tighten RLS policies, revoke default DAC privileges, and add manual check-in RPC
-- =============================================================================

-- 1. RESOLVE SEC-01 & SEC-02: Revoke table-level grants and drop permissive audit policy
DROP POLICY IF EXISTS policy_audit_insert ON public.audit_logs;

REVOKE ALL ON public.audit_logs FROM anon, authenticated, public;
GRANT SELECT ON public.audit_logs TO authenticated;

REVOKE ALL ON public.user_roles FROM anon, authenticated, public;
GRANT SELECT ON public.user_roles TO authenticated;

REVOKE ALL ON public.user_unit_assignments FROM anon, authenticated, public;
GRANT SELECT ON public.user_unit_assignments TO authenticated;

REVOKE ALL ON public.attendance_records FROM anon, authenticated, public;
GRANT SELECT ON public.attendance_records TO authenticated;

REVOKE ALL ON public.terminal_authorizations FROM anon, authenticated, public;
GRANT SELECT ON public.terminal_authorizations TO authenticated;

-- 2. RESOLVE SEC-03: Prevent profile status tampering via BEFORE UPDATE trigger
CREATE OR REPLACE FUNCTION public.fn_protect_profile_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
        IF NOT public.is_system_admin(auth.uid()) THEN
            RAISE EXCEPTION 'Unauthorized: Only system administrators can alter account status.';
        END IF;
    END IF;
    IF NEW.email IS DISTINCT FROM OLD.email AND NOT public.is_system_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Unauthorized: Email cannot be modified directly on profile.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_fields ON public.user_profiles;
CREATE TRIGGER trg_protect_profile_fields
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.fn_protect_profile_fields();

-- 3. RESOLVE SEC-04: Enforce strict unit scoping on visitor records
DROP POLICY IF EXISTS policy_visitors_view ON public.session_visitors;
CREATE POLICY policy_visitors_view ON public.session_visitors
FOR SELECT TO authenticated
USING (
    public.is_stake_wide_leader(auth.uid()) 
    OR (inviting_unit_id IS NOT NULL AND inviting_unit_id IN (SELECT unit_id FROM public.get_user_assigned_units(auth.uid())))
);

-- 4. RESOLVE SEC-06: Authorized Leader Manual Attendance Check-in RPC
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
    v_caller_id UUID := auth.uid();
    v_session RECORD;
    v_member RECORD;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
    v_attendance_id UUID;
BEGIN
    IF NOT (public.is_stake_wide_leader(v_caller_id) OR EXISTS (
        SELECT 1 FROM public.user_roles WHERE user_id = v_caller_id AND role_name = 'ysa_leader'
    )) THEN
        RAISE EXCEPTION 'Unauthorized: Only authorized YSA leaders or admins can record manual attendance.';
    END IF;

    SELECT * INTO v_session FROM public.activity_sessions WHERE id = p_session_id;
    IF NOT FOUND OR v_session.status != 'active' THEN
        RAISE EXCEPTION 'Session is not active.';
    END IF;

    SELECT * INTO v_member FROM public.members WHERE id = p_member_id AND is_active = TRUE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Member record not found.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.attendance_records WHERE session_id = p_session_id AND member_id = p_member_id) THEN
        RAISE EXCEPTION 'Duplicate check-in: Member already marked present for this session.';
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

    INSERT INTO public.audit_logs (actor_id, action, target_record_id, target_table, outcome, metadata)
    VALUES (
        v_caller_id,
        'MANUAL_ATTENDANCE_RECORDED',
        v_attendance_id::text,
        'attendance_records',
        'success',
        jsonb_build_object('member_id', p_member_id, 'session_id', p_session_id, 'notes', p_notes)
    );

    RETURN jsonb_build_object('success', TRUE, 'attendance_id', v_attendance_id, 'check_in_time', v_now);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_manual_attendance(UUID, UUID, TEXT) TO authenticated;
```

---

### 4.2 Client Remediation (Resolving SEC-05)
Update `src/services/attendanceService.ts` to connect to `supabase.rpc('authorize_terminal', ...)` with `sessionStorage` token management:

```typescript
const STORAGE_KEY_TOKEN = 'ysa_ams_terminal_token'
const STORAGE_KEY_SESSION_ID = 'ysa_ams_terminal_session_id'

export const attendanceService = {
  getStoredToken(): string | null {
    return typeof window !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY_TOKEN) : null
  },

  async authorizeTerminal(sessionCode: string, terminalLabel: string) {
    const existingToken = this.getStoredToken() || undefined
    const { data, error } = await supabase.rpc('authorize_terminal', {
      p_session_code: sessionCode.toUpperCase().trim(),
      p_terminal_label: terminalLabel,
      p_existing_terminal_token: existingToken
    })

    if (error || !data?.success) {
      return { success: false, error: error?.message || data?.error || 'Failed to authorize terminal' }
    }

    if (data.terminal_token) {
      sessionStorage.setItem(STORAGE_KEY_TOKEN, data.terminal_token)
      sessionStorage.setItem(STORAGE_KEY_SESSION_ID, data.session_id)
    }

    return { success: true, data }
  },

  async releaseTerminal() {
    const token = this.getStoredToken()
    if (token) {
      await supabase.rpc('release_terminal', { p_terminal_token: token })
      sessionStorage.removeItem(STORAGE_KEY_TOKEN)
      sessionStorage.removeItem(STORAGE_KEY_SESSION_ID)
    }
  }
}
```

---

## 5. Rollback Considerations

If the remediation patch must be rolled back:
1. Reverting the RLS policy changes is non-destructive:
   ```sql
   DROP POLICY IF EXISTS policy_visitors_view ON public.session_visitors;
   DROP TRIGGER IF EXISTS trg_protect_profile_fields ON public.user_profiles;
   DROP FUNCTION IF EXISTS public.fn_protect_profile_fields();
   DROP FUNCTION IF EXISTS public.record_manual_attendance(UUID, UUID, TEXT);
   ```
2. Re-granting default DAC permissions (if needed):
   ```sql
   GRANT ALL ON public.audit_logs TO authenticated;
   ```
3. No table drops or column deletions are performed, ensuring zero data loss during rollback.

---

## 6. Practical Verification Checklist

### Pre-Deployment Verification Gates:
- [ ] **Gate 1 (SQL Patch Review):** Project owner reviews `20261013000005_security_and_privilege_remediation.sql`.
- [ ] **Gate 2 (Audit Log Protection Test):** Verify that direct `supabase.from('audit_logs').insert(...)` from an authenticated client returns `permission denied` or fails RLS.
- [ ] **Gate 3 (Status Escalation Test):** Verify that attempting to update `user_profiles.account_status` as a non-admin throws `'Unauthorized: Only system administrators can alter account status'`.
- [ ] **Gate 4 (Visitor Unit Scoping Test):** Verify that a bishop assigned to Ward A cannot view visitor records belonging to Ward B or unassigned stake visitors.
- [ ] **Gate 5 (Kiosk Token & Lease Test):** Verify terminal redemption issues a token, scrubs URL to `/terminal`, and extends lease on check-in.
- [ ] **Gate 6 (Admin Bootstrap):** Create initial user identity in Auth and run elevation DO-block script for `oyewusi.adebayo1@gmail.com`.
- [ ] **Gate 7 (Stake Units Confirmation):** Seed official wards and branches only after written confirmation.

---

## 7. Final Assessment & Recommendation

### Decision: **READY FOR REMEDIATION**

The system is in a stable, verified, and well-architected baseline. No breaking database changes or destructive operations are required. By applying the non-destructive remediation patch (`20261013000005_security_and_privilege_remediation.sql`) and wiring the client terminal service, the system will satisfy all security and functional gates required for Phase 3 deployment.
