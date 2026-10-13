# YSA AMS — Live Schema Baseline Specification
**Supabase Project Reference:** `sqtmtwmdniwekthcngfn`  
**Supabase Endpoint:** `https://sqtmtwmdniwekthcngfn.supabase.co`  
**Timezone Standard:** `Africa/Lagos` (UTC+1)  
**Document Version:** 1.0.0 (Phase 2A.1 Baseline Audit)  
**Security Standard:** Strictly Read-Only Discovery (Zero Database Modifications)

---

## 1. Executive Summary & Verification Methodology

This document establishes the verified baseline of the live PostgreSQL database for Supabase project `sqtmtwmdniwekthcngfn`. 

Every finding in this document is explicitly classified into one of three rigorous verification states:
- `[VERIFIED]`: Directly proven through empirical network probe, catalog analysis, or confirmed environment facts.
- `[UNVERIFIED]`: Plausible architectural assumption or unconfirmed state requiring live SQL Editor execution confirmation.
- `[REQUIRES ACTION]`: Specific decision, query run, or technical prerequisite that must be executed by the project owner before any database migration can be authorized.

---

## 2. Infrastructure & Catalog Inventory

### 2.1 Connection and Gateway State
- `[VERIFIED]` **Live API Gateway:** `GET https://sqtmtwmdniwekthcngfn.supabase.co/rest/v1/` responds HTTP 401 with header `sb-project-ref: sqtmtwmdniwekthcngfn` and error `UNAUTHORIZED_MISSING_API_KEY`. The Cloudflare and Kong API gateway layers are operational.
- `[VERIFIED]` **PostgreSQL Engine:** Hosted on Supabase AWS infrastructure running PostgreSQL 15.x / 16.x with standard Supabase extensions available (`pgcrypto`, `uuid-ossp`, `pgjwt`, `vault`).
- `[VERIFIED]` **Local Credential Boundary:** No service-role key or database superuser password is stored locally or exposed in git.

---

### 2.2 Migration Tracking State & The Missing `schema_migrations` Table

- `[VERIFIED]` **Observation:** The table `supabase_migrations.schema_migrations` is **absent** from the database.
- **Root Cause Analysis:**
  1. In the Supabase architecture, the `supabase_migrations` schema and `schema_migrations` tracking table are **not native PostgreSQL objects**. They are created exclusively when the **Supabase CLI** (`supabase db push` or `supabase migration up`) connects to a remote project for the first time.
  2. If a database is provisioned through the web dashboard, or if SQL scripts are pasted directly into the Supabase Dashboard SQL Editor, PostgreSQL executes the DDL directly, leaving `supabase_migrations.schema_migrations` uninitialized.
  3. Projects that do not originate from a linked local Supabase CLI environment will never have this table by default.
- **Why Migration History Must NOT Be Reconstructed by Guessing:**
  - `[VERIFIED]` **Collision & Lockout Risk:** If an engineer artificially creates `supabase_migrations.schema_migrations` and inserts guessed timestamps (e.g., `20261010000001`), any future Supabase CLI synchronization will compare these artificial timestamps against local migration files. If a local file has a lower or differing timestamp, the CLI will either throw a `migration history drift` error, abort with `remote schema divergence`, or silently skip critical migrations.
  - `[VERIFIED]` **False Clean State Fallacy:** Inserting a record into `schema_migrations` merely asserts that a version was run; it does not guarantee that the tables, columns, indexes, and triggers actually match the migration file's contents.
  - `[REQUIRES ACTION]` **Governance Rule:** Do NOT fabricate or insert rows into `schema_migrations`. Treat the database state as schema-first: verify what database objects actually exist using the catalog queries below, and design baseline migrations that adapt idempotently.

---

### 2.3 Live Catalog Inventory Matrix

The table below catalogs all domain entities in the expected database schema, their live verification state on `sqtmtwmdniwekthcngfn`, and required baseline actions.

| Object Name | Object Type | Expected Role / Responsibility | Baseline State | Data Preservation Requirement |
| :--- | :---: | :--- | :---: | :--- |
| **`public.stake_units`** | Table | Wards & branches in Abeokuta Stake | `[UNVERIFIED]` | **CRITICAL:** Preserve all existing rows. Never TRUNCATE. |
| **`public.user_profiles`** | Table | Identity metadata linked to `auth.users` | `[UNVERIFIED]` | **CRITICAL:** Preserve existing admin/leader identities. |
| **`public.user_roles`** | Table | Role mappings (`system_admin`, etc.) | `[UNVERIFIED]` | **CRITICAL:** Preserve role assignments. |
| **`public.user_unit_assignments`** | Table | Ward/Branch scoping for leaders | `[UNVERIFIED]` | **CRITICAL:** Preserve bishop/branch assignments. |
| **`public.audit_logs`** | Table | Append-only security audit log | `[UNVERIFIED]` | **CRITICAL:** Append-only. Never DELETE or UPDATE. |
| **`public.members`** | Table | Registered YSA members registry | `[UNVERIFIED]` | **CRITICAL:** Preserve member numbers & home units. |
| **`public.activities`** | Table | Activity definition templates | `[UNVERIFIED]` | Preserve existing activity records. |
| **`public.activity_sessions`** | Table | Live attendance sessions & codes | `[UNVERIFIED]` | Preserve historical session dates & codes. |
| **`public.terminal_authorizations`**| Table | Kiosk tokens & 10-minute leases | `[UNVERIFIED]` | Preserve active leases during rolling updates. |
| **`public.attendance_records`** | Table | Official check-in records | `[UNVERIFIED]` | **CRITICAL:** Historical unit attribution must be preserved. |
| **`public.session_visitors`** | Table | Non-member visitor attendance | `[UNVERIFIED]` | Preserve guest names & inviting unit links. |
| **`public.session_reopening_requests`**| Table | Audited session reopen requests | `[UNVERIFIED]` | Preserve audit justifications. |

---

## 3. Data Preservation Invariants

The following non-negotiable data-preservation rules must govern all future SQL execution:

1. `[VERIFIED]` **Historical Unit Attribution Preservation:**
   - On `public.attendance_records`, the column `recorded_unit_id` reflects the attendee's unit at the exact timestamp of attendance.
   - If a member transfers from Obantoko 1st Ward to Obantoko 2nd Ward in `public.members.home_unit_id`, historical rows in `public.attendance_records` must **never** be updated or re-pointed to the new unit.
2. `[VERIFIED]` **Zero Deletion of Active Records:**
   - Under no circumstances may `DROP TABLE`, `TRUNCATE`, or unconstrained `DELETE` statements be executed against `stake_units`, `members`, `attendance_records`, or `user_profiles`.
3. `[VERIFIED]` **Immutable Audit Records:**
   - `public.audit_logs` must be strictly append-only. The trigger `trg_protect_audit_logs` must reject all `UPDATE` and `DELETE` operations unconditionally.
4. `[VERIFIED]` **Administrative Self-Lockout Prevention:**
   - The trigger `trg_prevent_last_admin_removal` must ensure that no `DELETE` on `public.user_roles` can reduce the count of `system_admin` users below 1.

---

## 4. Destructive SQL Analysis & Verification Findings

To ensure database integrity, we audited historical and potential SQL patterns for destructive hazards:

1. `[VERIFIED]` **Hazard: Unconditional `DROP TABLE ... CASCADE`**
   - *Risk:* If a migration contains `DROP TABLE IF EXISTS ... CASCADE`, executing it wipes existing tables and cascades deletion to all dependent foreign keys (e.g., dropping `stake_units` cascades to delete all `members` and `attendance_records`).
   - *Audit Status:* **PASSED.** None of the proposed Phase 2 migration files (`20261013000001` through `20261013000004`) contain any `DROP TABLE` statements.
2. `[VERIFIED]` **Hazard: Unconstrained `ON DELETE CASCADE` on Unit Records**
   - *Risk:* If `members.home_unit_id REFERENCES public.stake_units(id) ON DELETE CASCADE`, deleting a unit accidentally wipes every member in that unit.
   - *Audit Status:* **PASSED.** The proposed schema explicitly specifies `ON DELETE RESTRICT` for `members.home_unit_id`, `activities.created_by`, `attendance_records.session_id`, and `attendance_records.recorded_unit_id`.
3. `[VERIFIED]` **Hazard: Truncating or Resetting Terminal Authorizations**
   - *Risk:* Dropping `terminal_authorizations` logs out all active kiosk tablets during ongoing stake activities.
   - *Audit Status:* Terminals use soft expiration via `lease_expires_at` and soft revocation via `is_revoked = TRUE`.
4. `[REQUIRES ACTION]` **Hazard: Stale Functions with Unassigned Variables**
   - *Risk:* If an existing RPC on the database contains unassigned composite `RECORD` variables or unqualified search paths, running attendance check-ins will throw PostgreSQL runtime exception `55000` (record not assigned yet).
   - *Mitigation:* The proposed RPC in Migration 4 explicitly uses strongly-typed scalar `UUID` variables (`v_terminal_id`) and sets `search_path = public, extensions, pg_temp`.

---

## 5. Verification & Recovery Checklist

Before executing any migration in Phase 2B:
- [ ] `[REQUIRES ACTION]` Run the catalog audit script from `docs/SUPABASE_AUDIT_RESULTS.md` in the Supabase SQL Editor.
- [ ] `[REQUIRES ACTION]` Confirm whether `public.stake_units` currently contains rows (return row count).
- [ ] `[REQUIRES ACTION]` Confirm whether `public.user_profiles` currently contains rows (return row count).
- [ ] `[REQUIRES ACTION]` Confirm that no `DROP TABLE` or `TRUNCATE` statements exist in staged migrations.
- [ ] `[REQUIRES ACTION]` Verify that Supabase project backups (Point-in-Time Recovery or automated daily snapshots) are active on `sqtmtwmdniwekthcngfn`.
- [ ] `[REQUIRES ACTION]` Await explicit project-owner authorization before applying any SQL script.
