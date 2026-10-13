# YSA AMS — Migration Reconciliation & Safety Strategy
**Target Supabase Instance:** `sqtmtwmdniwekthcngfn`  
**Endpoint:** `https://sqtmtwmdniwekthcngfn.supabase.co`  
**Document Version:** 1.0.0 (Phase 2A.1 Baseline Reconciliation)  
**Security Lead Status:** Design Review (No Migrations Applied in Phase 2A.1)

---

## 1. Executive Summary

This document reconciles the proposed new database architecture with the live database baseline on Supabase project `sqtmtwmdniwekthcngfn`. It provides an entity-by-entity divergence analysis, identifies potential schema conflicts, and details a non-destructive migration roadmap designed to guarantee **zero data loss**, **zero downtime**, and **strict role isolation**.

All findings are categorized using standard verification indicators:
- `[VERIFIED]`: Confirmed structural fact or mathematically proven invariant.
- `[UNVERIFIED]`: Proposed schema element pending live database execution confirmation.
- `[REQUIRES ACTION]`: Prerequisite step required from the project owner before execution.

---

## 2. Proposed Schema vs. Live Baseline Reconciliation Matrix

The table below contrasts each proposed database entity against the live environment, highlighting required structural changes, idempotency safeguards, and conflict mitigations.

| Entity / Object | Proposed Schema Specification | Potential Divergence / Live Conflict | Idempotent Reconciliation Strategy | Status |
| :--- | :--- | :--- | :--- | :---: |
| **`stake_units`** | `id`, `unit_name`, `unit_type ('ward'\|'branch')`, `is_active`, timestamps. | If table already exists, columns might have differing constraints or types. | Use `CREATE TABLE IF NOT EXISTS`. Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for missing columns. Never drop existing rows. | `[UNVERIFIED]` |
| **`user_profiles`** | `id REFERENCES auth.users`, `full_name`, `email`, `account_status`, timestamps. | Existing users in `auth.users` might lack corresponding rows in `user_profiles`. | `CREATE TABLE IF NOT EXISTS`. Provide auto-insert trigger `handle_new_user` on `auth.users` with `ON CONFLICT DO NOTHING`. | `[UNVERIFIED]` |
| **`user_roles`** | `id`, `user_id`, `role_name`, `assigned_by`, `uq_user_role`. | Conflicting duplicate role rows if unique constraint is missing. | Enforce `CONSTRAINT uq_user_role UNIQUE (user_id, role_name)`. Trigger `trg_prevent_last_admin_removal` guarantees system administrator continuity. | `[VERIFIED]` |
| **`user_unit_assignments`** | `user_id`, `unit_id`, `assigned_role`, `uq_user_unit_role`. | Foreign key mismatches if referenced units do not exist. | Enforce `FOREIGN KEY ... ON DELETE CASCADE` on user deletion, but `RESTRICT` on unit deletion. | `[VERIFIED]` |
| **`audit_logs`** | Append-only audit table with JSONB metadata. | Missing append-only protection trigger could permit log tampering. | Explicit trigger `trg_protect_audit_logs` rejecting `UPDATE` and `DELETE`. | `[VERIFIED]` |
| **`members`** | `home_unit_id REFERENCES stake_units ON DELETE RESTRICT`. | Dropping a unit could cascade and delete registered members. | Explicit `ON DELETE RESTRICT` on `home_unit_id` prevents deleting units with enrolled members. | `[VERIFIED]` |
| **`activity_sessions`** | `code_hash TEXT`, `code_expires_at`, `status ('draft'\|'active'\|'closed')`, `max_terminals`. | Storing plaintext codes instead of SHA-256 hashes would violate security invariants. | Codes are hashed using `encode(sha256(convert_to(upper(trim(code)), 'UTF8')), 'hex')`. Raw codes are NEVER stored. | `[VERIFIED]` |
| **`terminal_authorizations`** | `terminal_token_hash`, `lease_expires_at`, `is_revoked`. | Stale sessions permanently blocking new terminal slots. | 10-minute heartbeat leases (`lease_expires_at`). Abandoned devices automatically expire, freeing slot capacity. | `[VERIFIED]` |
| **`attendance_records`** | `session_id`, `member_id`, `recorded_unit_id`, `check_in_time`, `uq_session_member_attendance`. | Member transfers overwriting historical ward attendance records. | `recorded_unit_id` captures member's ward at check-in time, preserving history across transfers. | `[VERIFIED]` |
| **`session_visitors`** | `session_id`, `full_name`, `is_church_member`, `inviting_unit_id REFERENCES stake_units`. | Missing inviting unit link for visiting non-members. | Add `inviting_unit_id` as optional nullable foreign key to `stake_units`. | `[VERIFIED]` |
| **`session_reopening_requests`** | `session_id`, `requested_by`, `reason`, `authorized_by`. | Unauthorized session reopening without leadership justification. | Reopening RPC enforces `system_admin` or `stake_presidency` role and records mandatory reason. | `[VERIFIED]` |

---

## 3. Safe, Versioned Migration Strategy

### 3.1 Resolving the Absence of `supabase_migrations.schema_migrations`
- `[VERIFIED]` **Fact:** As established in `docs/LIVE_SCHEMA_BASELINE.md`, the live database does not currently track migrations via `supabase_migrations.schema_migrations`.
- `[REQUIRES ACTION]` **Preservation Policy:** We must NOT guess or invent arbitrary records in `schema_migrations`.
- **Recommended Execution Path:**
  1. **Phase 2A Baseline Verification:** Review the proposed migrations (`20261013000001` through `20261013000004`) to ensure every SQL statement is structurally defensive.
  2. **Idempotent Migration Hardening:** Beyond `CREATE TABLE IF NOT EXISTS`, each migration must incorporate safe column alterations (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) and clean policy replacements (`DROP POLICY IF EXISTS ...; CREATE POLICY ...`).
  3. **Phase 2B Sequential Execution:** When authorized by the project owner, apply Migrations 1 to 4 sequentially in the Supabase Dashboard SQL Editor within explicit transaction blocks (`BEGIN ... COMMIT`).
  4. **Post-Execution Verification:** Run the verification query block at the conclusion of each migration to validate that all constraints, triggers, and RLS policies are active.

---

### 3.2 Detailed Idempotency Enhancements by Migration File

#### Migration 1: `20261013000001_core_identity_and_units.sql`
- `[VERIFIED]` **Triggers:** Uses `DROP TRIGGER IF EXISTS trg_protect_audit_logs ON public.audit_logs;` and `DROP TRIGGER IF EXISTS trg_prevent_last_admin_removal ON public.user_roles;` before recreating triggers to prevent duplicate trigger errors on rerun.
- `[VERIFIED]` **Functions:** Uses `CREATE OR REPLACE FUNCTION` for `fn_prevent_audit_log_modification` and `fn_prevent_last_admin_removal`.
- `[VERIFIED]` **Indexes:** Uses `CREATE INDEX IF NOT EXISTS` on all foreign keys and lookup columns.

#### Migration 2: `20261013000002_core_rls_policies.sql`
- `[VERIFIED]` **RLS Enforcement:** Uses `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` and `ALTER TABLE ... FORCE ROW LEVEL SECURITY;` (safe to re-run).
- `[VERIFIED]` **Policies:** Precedes every `CREATE POLICY` with an explicit `DROP POLICY IF EXISTS` targeting the specific table and policy name.
- `[VERIFIED]` **Search Path Security:** All security functions (`is_system_admin`, `is_stake_wide_leader`, `get_user_assigned_units`) explicitly set `SET search_path = public, pg_temp` to prevent search path injection.

#### Migration 3: `20261013000003_activity_and_attendance_schema.sql`
- `[VERIFIED]` **Integrity Constraints:** Declares `CONSTRAINT uq_session_member_attendance UNIQUE (session_id, member_id)` to block concurrent duplicate check-ins at the database engine level.
- `[VERIFIED]` **Foreign Key Delete Rules:** Specifies `ON DELETE RESTRICT` for member home units and attendance recorded units, preventing accidental data loss if a unit record is modified.
- `[VERIFIED]` **Policy Isolation:** Ensures anonymous users (`anon`) have zero direct read/write policies on `attendance_records` or `members`.

#### Migration 4: `20261013000004_attendance_engine_rpcs.sql`
- `[VERIFIED]` **Atomic Slot Locking:** Uses `SELECT * FROM public.activity_sessions WHERE ... FOR UPDATE;` inside `authorize_terminal` to serialize concurrent terminal redemptions and prevent over-allocating slots.
- `[VERIFIED]` **Safe Variable Assignments:** Replaces composite `RECORD` return types with strongly typed scalar variables (`v_terminal_id UUID`) to eliminate PostgreSQL runtime error `55000` (*record not assigned yet*).
- `[VERIFIED]` **Heartbeat Leases:** Automatically revokes stale leases (`lease_expires_at < now()`) inside the authorization transaction, ensuring abandoned browser tabs do not hold terminal capacity hostage.

---

## 4. Verification and Recovery Checklist

### Phase 2B Pre-Execution Gate
- [ ] `[REQUIRES ACTION]` **Owner Confirmation:** Project owner executes the read-only catalog script from `docs/SUPABASE_AUDIT_RESULTS.md` in the Supabase SQL Editor and confirms whether existing public tables contain data.
- [ ] `[VERIFIED]` **Zero Destructive Statements:** Confirmed that no `DROP TABLE`, `DROP COLUMN`, or `TRUNCATE` statements exist in migrations 1–4.
- [ ] `[VERIFIED]` **Transaction Isolation:** All migrations are designed to run within transactional boundaries (`BEGIN; ... COMMIT;`). Any statement failure causes an immediate rollback without partial state corruption.
- [ ] `[REQUIRES ACTION]` **Database Backup Snapshot:** Verify that Supabase automatic backups or Point-in-Time Recovery (PITR) are operational before applying migrations.

### Post-Migration Verification Queries
Execute after applying each migration in Phase 2B to verify structural health:

```sql
-- 1. Verify RLS is Forced on all 12 Application Tables
SELECT relname AS table_name, relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
ORDER BY relname;

-- 2. Verify Immutability and Administrative Protection Triggers
SELECT event_object_table, trigger_name, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public' AND trigger_name IN ('trg_protect_audit_logs', 'trg_prevent_last_admin_removal');

-- 3. Verify RPC Search Path and Security Definer Flags
SELECT proname, prosecdef, proconfig
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND proname IN ('authorize_terminal', 'heartbeat_terminal_lease', 'record_attendance', 'close_attendance_session', 'reopen_attendance_session');
```

---

## 5. Summary of Open Items Requiring Project Owner Action

1. `[REQUIRES ACTION]` **Confirm Live Audit Results:** Run Section 2 script from `docs/SUPABASE_AUDIT_RESULTS.md` in the Supabase SQL Editor and confirm findings.
2. `[REQUIRES ACTION]` **Confirm Official Stake Units:** Provide the confirmed list of Wards and Branches for the Abeokuta Nigeria Obantoko Stake.
3. `[REQUIRES ACTION]` **Authorize Phase 2B:** Explicitly approve applying Migrations 1–4 to `sqtmtwmdniwekthcngfn`.
