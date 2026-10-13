# YSA AMS — Database Security Specification & Matrix
**Abeokuta Nigeria Obantoko Stake | The Church of Jesus Christ of Latter-day Saints**
**Document Version:** 1.0.0 (Phase 2A Baseline Design)

---

## 1. Security Architecture Principles

1. **Zero Trust at Frontend:** Client-side route guards and menu filtering are purely navigational aids. All security boundaries, role verification, and unit boundaries are enforced strictly inside PostgreSQL.
2. **Deny-by-Default (RLS Forced):** Every table in the `public` schema has Row-Level Security enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) and forced (`ALTER TABLE ... FORCE ROW LEVEL SECURITY`). Tables without an explicit granting policy reject all queries.
3. **Restricted Anonymous Surface:** Anonymous (`anon`) users are never granted direct `SELECT`, `INSERT`, `UPDATE`, or `DELETE` permissions on any core application tables (`members`, `user_profiles`, `user_roles`, `attendance_records`, `audit_logs`).
4. **Mediated Public Execution:** All public attendance workflows are mediated exclusively through `SECURITY DEFINER` RPCs that authenticate a valid bearer terminal token or 6-character code, validate session activity, and enforce database constraints.
5. **Fixed Function Search Paths:** Every `SECURITY DEFINER` function explicitly defines `SET search_path = public, extensions, pg_temp` to prevent schema hijacking and privilege escalation attacks.

---

## 2. Table-by-Table Security Matrix

| Table | RLS Status | Permitted Operations | Permitted Roles | Enforcement Mechanism & Scope |
| :--- | :---: | :---: | :--- | :--- |
| **`stake_units`** | Enabled | `SELECT` | `authenticated`, `anon` (active units only for dropdowns) | System Admin can `INSERT`/`UPDATE`. Bishops and leaders read active units. |
| **`user_profiles`** | Enabled | `SELECT`, `UPDATE` | `authenticated` (Self only, or `system_admin`) | `auth.uid() = id` or caller is `system_admin`. Zero `anon` access. |
| **`user_roles`** | Enabled | `SELECT`, `INSERT`, `DELETE` | `system_admin` only | Only system administrators can inspect or modify roles. Last admin protected by trigger. |
| **`user_unit_assignments`**| Enabled | `SELECT`, `INSERT`, `DELETE` | `system_admin`, `stake_presidency` | Scopes unit leaders. Inspected by RLS helper functions. |
| **`members`** | Enabled | `SELECT`, `INSERT`, `UPDATE` | `system_admin`, `stake_presidency`, `ysa_leader`, `bishop`, `branch_president` | Bishops & Branch Presidents strictly scoped to `home_unit_id = assigned_unit_id`. Zero `anon` access. |
| **`activities`** | Enabled | `SELECT`, `INSERT`, `UPDATE` | `system_admin`, `stake_presidency`, `ysa_leader` | Read stake-wide; writes restricted to authorized YSA leaders and admins. |
| **`activity_sessions`** | Enabled | `SELECT`, `INSERT`, `UPDATE` | `system_admin`, `stake_presidency`, `ysa_leader` | Read/write for leaders. `anon` cannot read directly; accessed via RPC. |
| **`terminal_authorizations`**| Enabled | `SELECT` | `system_admin`, `ysa_leader` | All creations and lease checks occur inside `authorize_terminal` RPC. Direct `anon` access denied. |
| **`attendance_records`** | Enabled | `SELECT` | `system_admin`, `stake_presidency`, `ysa_leader`, `bishop`, `branch_president` | Unit leaders see records for their unit. Inserts mediated exclusively via RPC. |
| **`session_visitors`** | Enabled | `SELECT` | `system_admin`, `stake_presidency`, `ysa_leader`, `bishop`, `branch_president` | Inserts mediated via RPC. Zero direct `anon` access. |
| **`session_reopening_requests`**| Enabled | `SELECT`, `INSERT`, `UPDATE`| `system_admin`, `stake_presidency` | Requests logged and approved exclusively by stake presidency or system admin. |
| **`audit_logs`** | Enabled | `SELECT`, `INSERT` (RPC only) | `system_admin`, `stake_presidency` (`SELECT` only) | Append-only. Trigger rejects `UPDATE` and `DELETE` unconditionally. Zero `anon` access. |

---

## 3. Unit-Level Scoping Logic (Bishop & Branch President)

Bishops and Branch Presidents are restricted to viewing attendance and members of their own unit. This is implemented via a secure RLS helper function:

```sql
CREATE OR REPLACE FUNCTION public.get_user_assigned_units(p_user_id UUID)
RETURNS TABLE (unit_id UUID)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT unit_id 
    FROM public.user_unit_assignments
    WHERE user_id = p_user_id;
$$;
```

**RLS Policy on `public.members`:**
```sql
CREATE POLICY policy_members_unit_access ON public.members
FOR SELECT TO authenticated
USING (
    public.is_stake_wide_leader(auth.uid()) 
    OR home_unit_id IN (SELECT unit_id FROM public.get_user_assigned_units(auth.uid()))
);
```

**RLS Policy on `public.attendance_records`:**
```sql
CREATE POLICY policy_attendance_unit_access ON public.attendance_records
FOR SELECT TO authenticated
USING (
    public.is_stake_wide_leader(auth.uid()) 
    OR recorded_unit_id IN (SELECT unit_id FROM public.get_user_assigned_units(auth.uid()))
);
```

---

## 4. Public Attendance Submission & Terminal Protection

Anonymous users accessing the attendance terminal operate under the following multi-layer security barriers:

1. **No Direct Table Grants:** `REVOKE ALL ON public.attendance_records FROM anon, PUBLIC;`
2. **Bearer Token Validation:** The terminal presents a 32-byte secret bearer token issued at redemption.
3. **Lease Expiration Check:** The token's `lease_expires_at` must be greater than `now()`. If the lease expired due to lack of heartbeat, the submission is rejected.
4. **Session Status Check:** The activity session must have `status = 'active'`. If closed or draft, the submission is rejected.
5. **Atomic Quota Enforcement:** Slot quotas (e.g., max 2 devices) are validated inside `authorize_terminal` using row-level locking (`FOR UPDATE`).
6. **Input Normalization & Sanitization:** Attendee names are trimmed and normalized. Member check-ins enforce unit requirements, while visitor check-ins treat inviting unit as optional.

---

## 5. Stored Function & RPC Protection

| Function | Execution Role | Privileges | Security Definer | Fixed Search Path |
| :--- | :---: | :---: | :---: | :---: |
| `generate_session_attendance_code()` | `authenticated` | Restricted to leaders | Yes | Yes |
| `authorize_terminal(code, label, token)` | `anon`, `authenticated` | Public kiosk entry | Yes | Yes |
| `heartbeat_terminal_lease(token)` | `anon`, `authenticated` | Terminal keepalive | Yes | Yes |
| `release_terminal(token)` | `anon`, `authenticated` | Terminal logout | Yes | Yes |
| `record_attendance(session, member, token)` | `anon`, `authenticated` | Check-in write | Yes | Yes |
| `close_attendance_session(session)` | `authenticated` | YSA leaders, Admins | Yes | Yes |
| `reopen_attendance_session(session, reason)`| `authenticated` | System Admin, Stake Pres | Yes | Yes |
| `provision_system_admin(email, name)` | Internal / CLI | Local Superuser only | Yes | Yes |
