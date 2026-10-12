# YSA Attendance Management System (YSA AMS) — Core Requirements Specification
**Abeokuta Nigeria Obantoko Stake | The Church of Jesus Christ of Latter-day Saints**
**Document Version:** 1.0.0 (Phase 1 Baseline)

---

## 1. System Administration & User Provisioning
- **No Self-Registration:** Public signup is permanently disabled. Privileged users (Stake Presidency, Bishops, Branch Presidents, YSA Leaders) must be provisioned directly by an authorized `system_admin`.
- **Provisioning Workflow:** `system_admin` provisions users by specifying full name, email, role, and (for unit leaders) the assigned ward or branch.
- **Last Admin Invariant:** A database trigger prevents revoking or deleting the final remaining `system_admin`.
- **Authentication:** Backed by Supabase Auth (JWT), with application user metadata and role mappings stored in dedicated relational tables.

---

## 2. Role-Based Access Control (RBAC) & Scoping

| Role | Operational Scope | Authorized Actions |
| :--- | :--- | :--- |
| `system_admin` | Stake-wide | Full configuration, user provisioning, unit setup, session management, reopening closed sessions, audit log inspection. |
| `stake_presidency` | Stake-wide | Full read access to all ward/branch attendance records, stake-wide reports, audit inspection, authorized session reopening. |
| `ysa_leader` | Assigned Units / Stake | Create activities, initiate attendance sessions, generate session codes, view live attendance and unit reports. |
| `bishop` | Assigned Ward | Read-only access to member attendance registers and reports for their assigned Ward only. Cross-unit queries return 0 rows. |
| `branch_president` | Assigned Branch | Read-only access to member attendance registers and reports for their assigned Branch only. |

*Note: All access restrictions must be enforced at the PostgreSQL database level using Row-Level Security (RLS) and Security Definer RPCs. Frontend menu hiding is not authorization.*

---

## 3. Activity Management & Attendance Lifecycle
- **Activity Creation:** YSA Leaders define activities specifying title, description, category (spiritual, social, service, sports, temple, educational, other), date, and participating units.
- **Unique Alphanumeric Codes:** The system generates a cryptographically random, unambiguous 6-character code (alphabet: `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, excluding `0, O, 1, I, L`). Codes are stored on the database server as SHA-256 hashes (`code_hash`).
- **Configurable Terminal Limits:** Leaders configure the maximum number of simultaneous terminal devices allowed (1–10).
- **Atomic Terminal Redemption:** 
  - Kiosks and attendee devices redeem the code via RPC.
  - Concurrency is serialized using row-level locking (`SELECT ... FOR UPDATE`) to eliminate race conditions and over-allocation.
  - Upon successful redemption, a 32-byte unpredictable bearer token is issued with a 10-minute lease (`lease_expires_at`).
  - Active terminals send periodic heartbeats (every 5 minutes) to extend the lease. Abandoned browser tabs expire after 10 minutes, automatically freeing capacity.
  - Terminals feature an explicit "Release Terminal" button to immediately free capacity.
  - The browser URL is instantly scrubbed from `/:sessionCode` to `/terminal` via `window.history.replaceState`.

---

## 4. Attendance Recording & Member Integrity
- **Attendance Form Fields:**
  - Full Name (with autocomplete suggestions based on historical records).
  - Non-Member Checkbox (distinguishes Church members from visiting friends).
  - Unit Dropdown: **Mandatory** for Church members; **optional** for non-members (designates inviting ward or branch).
- **Duplicate Prevention:** Atomic database constraints (`UNIQUE(session_id, member_id)` / normalized name constraint) prevent duplicate check-ins even during concurrent network retries.
- **Historical Attribution:** When a member checks in, the `recorded_unit_id` captures their home unit at the exact time of attendance. Subsequent member transfers to another ward do not alter historical reports.

---

## 5. Session Closure & Controlled Reopening
- **Session Closure:** When closed by a leader, `status` updates to `'closed'`. All subsequent check-in RPCs immediately reject writes.
- **Authorized Reopening:** Reopening a closed session requires `system_admin` or `stake_presidency` authorization, a mandatory written justification, and creates an immutable audit event.

---

## 6. Monthly Member Registers & Stake Reporting
- **Monthly Registers:** Tabular grid showing all registered members in a unit against every activity held during the calendar month.
- **Attendance Percentage Formula:**
  $$\text{Attendance Rate} = \frac{\text{Total Attended Sessions}}{\text{Total Eligible Activity Opportunities}} \times 100$$
  *Reconciliation Rule:* If a unit held 0 activities in a period, the rate reports as `N/A` (null), preventing division by zero or false 0% metrics.
- **Export Capabilities:** CSV, XLSX multi-sheet workbooks, and print-optimized PDF attendance registers.

---

## 7. Audit Logging & Timezone Handling
- **Timezone Invariant:** All activity dates, start times, timestamps, and reporting cutoffs are calculated strictly in `Africa/Lagos` (`UTC+1`).
- **Immutable Audit Trail:** Append-only audit table with database trigger prohibiting `UPDATE` or `DELETE` operations. Records actor ID, action, target entity, timestamp, and metadata for every security-relevant action.
