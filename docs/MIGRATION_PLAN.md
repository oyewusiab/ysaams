# YSA AMS — Database Migration Plan & Governance
**Abeokuta Nigeria Obantoko Stake | The Church of Jesus Christ of Latter-day Saints**
**Document Version:** 1.0.0 (Phase 2A Baseline Design)  
**Status:** Prepared for Review (No Migrations Applied in Phase 2A)

---

## 1. Migration Sequence Overview

| Migration File | Primary Responsibility | Re-run Safety / Guard |
| :--- | :--- | :--- |
| `20261013000001_core_identity_and_units.sql` | `pgcrypto`, `stake_units`, `user_profiles`, `user_roles`, `user_unit_assignments`, `audit_logs`, append-only & last-admin triggers. | `CREATE TABLE IF NOT EXISTS`, `DROP TRIGGER IF EXISTS` |
| `20261013000002_core_rls_policies.sql` | Enables & forces RLS on core tables. Role helper functions (`is_system_admin`, `is_stake_wide_leader`, `get_user_assigned_units`). | `DROP POLICY IF EXISTS`, `CREATE OR REPLACE FUNCTION` |
| `20261013000003_activity_and_attendance_schema.sql` | `members`, `activities`, `activity_sessions`, `terminal_authorizations`, `attendance_records`, `session_visitors`, `session_reopening_requests`. RLS policies. | `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` |
| `20261013000004_attendance_engine_rpcs.sql` | Cryptographic code generator, atomic `authorize_terminal` (row-locked), `heartbeat_terminal_lease`, `release_terminal`, check-in writes, session lifecycle RPCs. | `CREATE OR REPLACE FUNCTION`, `GRANT EXECUTE` |

---

## 2. Idempotency & Partial-Failure Analysis

1. **Why `IF NOT EXISTS` is not universally idempotent:**
   - While `CREATE TABLE IF NOT EXISTS` prevents an error if a table already exists, it does NOT alter existing columns, update conflicting constraints, or repair mismatched data types.
   - For policies and triggers, we explicitly execute `DROP POLICY IF EXISTS` and `DROP TRIGGER IF EXISTS` before re-creating to guarantee clean state updates without duplicate definition conflicts.
2. **Transaction Boundaries:**
   - Supabase CLI and PostgreSQL execute each `.sql` file within a single transactional block (`BEGIN ... COMMIT`).
   - If any statement in a migration fails, the entire transaction is rolled back, preventing orphaned or half-configured database states.
3. **Non-Destructive Strategy:**
   - No `DROP TABLE`, `DROP COLUMN`, or `TRUNCATE` statements exist in this sequence. Existing application data is preserved.

---

## 3. Rollback & Recovery Considerations

If a migration must be reverted in a development or staging environment:
1. **Migration 4 Reversal:**
   ```sql
   DROP FUNCTION IF EXISTS public.reopen_attendance_session(UUID, TEXT, INT);
   DROP FUNCTION IF EXISTS public.close_attendance_session(UUID);
   DROP FUNCTION IF EXISTS public.record_visitor_attendance(UUID, TEXT, TEXT, BOOLEAN, UUID, TEXT);
   DROP FUNCTION IF EXISTS public.record_attendance(UUID, UUID, TEXT);
   DROP FUNCTION IF EXISTS public.release_terminal(TEXT);
   DROP FUNCTION IF EXISTS public.heartbeat_terminal_lease(TEXT);
   DROP FUNCTION IF EXISTS public.authorize_terminal(TEXT, TEXT, TEXT);
   DROP FUNCTION IF EXISTS public.initiate_attendance_session(UUID, TEXT, INT, INT);
   DROP FUNCTION IF EXISTS public.generate_session_attendance_code();
   ```
2. **Migration 3 Reversal:**
   ```sql
   DROP TABLE IF EXISTS public.session_reopening_requests CASCADE;
   DROP TABLE IF EXISTS public.session_visitors CASCADE;
   DROP TABLE IF EXISTS public.attendance_records CASCADE;
   DROP TABLE IF EXISTS public.terminal_authorizations CASCADE;
   DROP TABLE IF EXISTS public.activity_sessions CASCADE;
   DROP TABLE IF EXISTS public.activities CASCADE;
   DROP TABLE IF EXISTS public.members CASCADE;
   ```
3. **Migration 2 Reversal:**
   ```sql
   DROP FUNCTION IF EXISTS public.get_user_assigned_units(UUID);
   DROP FUNCTION IF EXISTS public.is_stake_wide_leader(UUID);
   DROP FUNCTION IF EXISTS public.is_system_admin(UUID);
   ```
4. **Migration 1 Reversal:**
   ```sql
   DROP TABLE IF EXISTS public.audit_logs CASCADE;
   DROP TABLE IF EXISTS public.user_unit_assignments CASCADE;
   DROP TABLE IF EXISTS public.user_roles CASCADE;
   DROP TABLE IF EXISTS public.user_profiles CASCADE;
   DROP TABLE IF EXISTS public.stake_units CASCADE;
   ```
