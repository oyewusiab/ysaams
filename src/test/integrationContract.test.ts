import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('Migration Static Contract & Verification Tests', () => {
  const migrationsDir = path.resolve(__dirname, '../../supabase/migrations')

  it('contains all 4 sequentially versioned migration files for Phase 2', () => {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'))
    expect(files).toContain('20261013000001_core_identity_and_units.sql')
    expect(files).toContain('20261013000002_core_rls_policies.sql')
    expect(files).toContain('20261013000003_activity_and_attendance_schema.sql')
    expect(files).toContain('20261013000004_attendance_engine_rpcs.sql')
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
})
