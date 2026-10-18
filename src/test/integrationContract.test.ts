import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('Migration Static Contract & Verification Tests', () => {
  const migrationsDir = path.resolve(__dirname, '../../supabase/migrations')

  it('contains all sequentially versioned migration files (Migrations 1 through 8)', () => {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'))
    expect(files).toContain('20261013000001_core_identity_and_units.sql')
    expect(files).toContain('20261013000002_core_rls_policies.sql')
    expect(files).toContain('20261013000003_activity_and_attendance_schema.sql')
    expect(files).toContain('20261013000004_attendance_engine_rpcs.sql')
    expect(files).toContain('20261013000005_security_and_privilege_remediation.sql')
    expect(files).toContain('20261018000006_targeted_manual_attendance_authorization.sql')
    expect(files).toContain('20261019000007_release_readiness_admin_and_kiosk_remediation.sql')
    expect(files).toContain('20261019000008_clerk_roles_and_least_privilege_rls.sql')
  })

  it('verifies Migration 1 defines all core identity tables and immutability triggers', () => {
    const content = fs.readFileSync(path.join(migrationsDir, '20261013000001_core_identity_and_units.sql'), 'utf-8')
    expect(content).toContain('CREATE TABLE IF NOT EXISTS public.stake_units')
    expect(content).toContain('CREATE TABLE IF NOT EXISTS public.user_profiles')
    expect(content).toContain('CREATE TABLE IF NOT EXISTS public.user_roles')
    expect(content).toContain('CREATE TABLE IF NOT EXISTS public.user_unit_assignments')
    expect(content).toContain('CREATE TABLE IF NOT EXISTS public.audit_logs')
    expect(content).toContain('trg_protect_audit_logs')
    expect(content).toContain('trg_prevent_last_admin_removal')
  })

  it('verifies Migration 2 forces Row Level Security on all core tables', () => {
    const content = fs.readFileSync(path.join(migrationsDir, '20261013000002_core_rls_policies.sql'), 'utf-8')
    expect(content).toContain('ALTER TABLE public.stake_units FORCE ROW LEVEL SECURITY')
    expect(content).toContain('ALTER TABLE public.user_profiles FORCE ROW LEVEL SECURITY')
    expect(content).toContain('ALTER TABLE public.user_roles FORCE ROW LEVEL SECURITY')
    expect(content).toContain('ALTER TABLE public.user_unit_assignments FORCE ROW LEVEL SECURITY')
    expect(content).toContain('ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY')
  })

  it('verifies Migration 3 defines all activity and attendance entities with duplicate constraints', () => {
    const content = fs.readFileSync(path.join(migrationsDir, '20261013000003_activity_and_attendance_schema.sql'), 'utf-8')
    expect(content).toContain('CREATE TABLE IF NOT EXISTS public.members')
    expect(content).toContain('CREATE TABLE IF NOT EXISTS public.activities')
    expect(content).toContain('CREATE TABLE IF NOT EXISTS public.activity_sessions')
    expect(content).toContain('CREATE TABLE IF NOT EXISTS public.terminal_authorizations')
    expect(content).toContain('CREATE TABLE IF NOT EXISTS public.attendance_records')
    expect(content).toContain('CREATE TABLE IF NOT EXISTS public.session_visitors')
    expect(content).toContain('uq_session_member_attendance UNIQUE (session_id, member_id)')
  })

  it('verifies Migration 4 defines hardened SECURITY DEFINER RPCs with fixed search_paths', () => {
    const content = fs.readFileSync(path.join(migrationsDir, '20261013000004_attendance_engine_rpcs.sql'), 'utf-8')
    expect(content).toContain('authorize_terminal')
    expect(content).toContain('heartbeat_terminal_lease')
    expect(content).toContain('release_terminal')
    expect(content).toContain('record_attendance')
    expect(content).toContain('close_attendance_session')
    expect(content).toContain('reopen_attendance_session')
    expect(content).toContain('SET search_path = public, extensions, pg_temp')
    expect(content).toContain('FOR UPDATE') // Row-level locking
  })

  it('verifies Migration 5 remediates all 12 tables privileges, audit logs, profile triggers, and manual check-in', () => {
    const content = fs.readFileSync(path.join(migrationsDir, '20261013000005_security_and_privilege_remediation.sql'), 'utf-8')
    // SEC-01: Drop fabricated audit inserts
    expect(content).toContain('DROP POLICY IF EXISTS policy_audit_insert ON public.audit_logs')
    // SEC-02: Comprehensive Revocation across all 12 tables
    expect(content).toContain('REVOKE ALL ON TABLE public.stake_units FROM anon, authenticated, public')
    expect(content).toContain('REVOKE ALL ON TABLE public.user_profiles FROM anon, authenticated, public')
    expect(content).toContain('REVOKE ALL ON TABLE public.user_roles FROM anon, authenticated, public')
    expect(content).toContain('REVOKE ALL ON TABLE public.user_unit_assignments FROM anon, authenticated, public')
    expect(content).toContain('REVOKE ALL ON TABLE public.audit_logs FROM anon, authenticated, public')
    expect(content).toContain('REVOKE ALL ON TABLE public.members FROM anon, authenticated, public')
    expect(content).toContain('REVOKE ALL ON TABLE public.activities FROM anon, authenticated, public')
    expect(content).toContain('REVOKE ALL ON TABLE public.activity_sessions FROM anon, authenticated, public')
    expect(content).toContain('REVOKE ALL ON TABLE public.terminal_authorizations FROM anon, authenticated, public')
    expect(content).toContain('REVOKE ALL ON TABLE public.attendance_records FROM anon, authenticated, public')
    expect(content).toContain('REVOKE ALL ON TABLE public.session_visitors FROM anon, authenticated, public')
    expect(content).toContain('REVOKE ALL ON TABLE public.session_reopening_requests FROM anon, authenticated, public')
    // SEC-03: Sensitive Profile Field Protection Trigger
    expect(content).toContain('trg_protect_profile_fields')
    expect(content).toContain('account_status IS DISTINCT FROM OLD.account_status')
    // SEC-04: Visitor visibility scoping
    expect(content).toContain('policy_visitors_view')
    expect(content).toContain('inviting_unit_id IS NOT NULL')
    // SEC-06: Manual attendance RPC
    expect(content).toContain('record_manual_attendance')
    expect(content).toContain('SET search_path = public, extensions, pg_temp')
  })

  it('verifies Migration 6 hardens manual attendance with strict unit assignments, participating units, and unique error trap', () => {
    const content = fs.readFileSync(path.join(migrationsDir, '20261018000006_targeted_manual_attendance_authorization.sql'), 'utf-8')
    // Function replace and security flags
    expect(content).toContain('CREATE OR REPLACE FUNCTION public.record_manual_attendance')
    expect(content).toContain('SECURITY DEFINER')
    expect(content).toContain('SET search_path = public, extensions, pg_temp')
    // Caller status validation
    expect(content).toContain('v_caller_status')
    expect(content).toContain("v_caller_status != 'active'")
    // Inactive member validation
    expect(content).toContain('v_member.is_active IS NOT TRUE')
    // Session participating units check
    expect(content).toContain('v_session.participating_units IS NOT NULL')
    expect(content).toContain('v_member.home_unit_id = ANY(v_session.participating_units)')
    // Stake-wide check
    expect(content).toContain('public.is_stake_wide_leader(v_caller_id)')
    // Strict join between user_roles and user_unit_assignments with matching role
    expect(content).toContain('JOIN public.user_unit_assignments uua')
    expect(content).toContain('uua.assigned_role = ur.role_name')
    expect(content).toContain('uua.unit_id = v_member.home_unit_id')
    // Concurrent race condition trap
    expect(content).toContain('EXCEPTION')
    expect(content).toContain('WHEN unique_violation THEN')
    // Anonymous revocation and explicit authenticated grant
    expect(content).toContain('REVOKE EXECUTE ON FUNCTION public.record_manual_attendance(UUID, UUID, TEXT) FROM PUBLIC')
    expect(content).toContain('REVOKE EXECUTE ON FUNCTION public.record_manual_attendance(UUID, UUID, TEXT) FROM anon')
    expect(content).toContain('GRANT EXECUTE ON FUNCTION public.record_manual_attendance(UUID, UUID, TEXT) TO authenticated')
  })

  it('verifies Migration 7 restores admin table write grants under forced RLS, syncs auth.users profiles, and hardens kiosk RPCs', () => {
    const content = fs.readFileSync(
      path.join(migrationsDir, '20261019000007_release_readiness_admin_and_kiosk_remediation.sql'),
      'utf-8'
    )
    expect(content).toContain('GRANT INSERT, UPDATE ON TABLE public.stake_units TO authenticated')
    expect(content).toContain('GRANT INSERT ON TABLE public.user_profiles TO authenticated')
    expect(content).toContain('GRANT INSERT, DELETE ON TABLE public.user_roles TO authenticated')
    expect(content).toContain('GRANT INSERT, DELETE ON TABLE public.user_unit_assignments TO authenticated')
    expect(content).toContain('fn_sync_auth_user_profile')
    expect(content).toContain('trg_on_auth_user_created')
    expect(content).toContain('REVOKE EXECUTE ON FUNCTION public.fn_sync_auth_user_profile() FROM PUBLIC, anon, authenticated')
    expect(content).toContain('CREATE OR REPLACE FUNCTION public.search_terminal_members')
    expect(content).toContain('REVOKE EXECUTE ON FUNCTION public.search_terminal_members(UUID, TEXT, UUID, TEXT) FROM PUBLIC')
    expect(content).toContain('REVOKE EXECUTE ON FUNCTION public.record_attendance(UUID, UUID, TEXT) FROM PUBLIC')
    expect(content).toContain('REVOKE EXECUTE ON FUNCTION public.record_visitor_attendance(UUID, TEXT, TEXT, BOOLEAN, UUID, TEXT) FROM PUBLIC')
    expect(content).toContain('v_session.visitor_registration_enabled IS NOT TRUE')
    expect(content).toContain('IF NOT (p_inviting_unit_id = ANY(v_session.participating_units)) THEN')
  })

  it('verifies Migration 8 defines least-privilege clerk roles and read-only RLS enforcement', () => {
    const content = fs.readFileSync(
      path.join(migrationsDir, '20261019000008_clerk_roles_and_least_privilege_rls.sql'),
      'utf-8'
    )
    expect(content).toContain("'stake_clerk'")
    expect(content).toContain("'ward_clerk'")
    expect(content).toContain("'branch_clerk'")
    expect(content).toContain('CREATE OR REPLACE FUNCTION public.is_stake_clerk')
    expect(content).toContain('REVOKE EXECUTE ON FUNCTION public.is_stake_clerk(UUID) FROM PUBLIC')
    expect(content).toContain('CREATE OR REPLACE FUNCTION public.get_user_assigned_units')
    expect(content).toContain('ON ur.user_id = uua.user_id')
    expect(content).toContain('AND ur.role_name = uua.assigned_role')
    expect(content).toContain('CREATE POLICY policy_members_view ON public.members')
    expect(content).toContain('CREATE POLICY policy_members_manage ON public.members')
    expect(content).toContain("AND uua.assigned_role IN ('bishop', 'branch_president', 'ysa_leader')")
    expect(content).toContain('CREATE POLICY policy_attendance_view ON public.attendance_records')
    expect(content).toContain('CREATE POLICY policy_visitors_view ON public.session_visitors')
  })
})

