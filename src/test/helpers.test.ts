import { describe, it, expect, beforeEach } from 'vitest'
import { generateSessionCode } from '../services/activityService'
import { calculateAttendancePercentage, getMonthDateRange } from '../services/reportService'
import {
  validateAuthorizedProfile,
  resolveAuthRedirectUrl,
  parseAuthCallbackUrl,
  validateNewPassword
} from '../services/authService'
import { deriveLeadershipAccess } from '../context/AuthContext'
import { attendanceService } from '../services/attendanceService'
import { UserProfile, AppRole, UnitAssignedRole } from '../types/database'

describe('Domain Helper Engines', () => {
  describe('Session Code Generator', () => {
    it('generates a 6-character code using an unambiguous alphabet', () => {
      const code = generateSessionCode()
      expect(code).toHaveLength(6)
      // Must match uppercase alphanumeric excluding ambiguous chars 0, O, 1, I, L
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/)
      expect(code).not.toMatch(/[01OIL]/)
    })

    it('generates distinct codes with high entropy across multiple runs', () => {
      const set = new Set<string>()
      for (let i = 0; i < 50; i++) {
        set.add(generateSessionCode())
      }
      expect(set.size).toBe(50)
    })
  })

  describe('Attendance Percentage Reconciliation', () => {
    it('returns null (N/A) when eligible opportunities are 0', () => {
      expect(calculateAttendancePercentage(0, 0)).toBeNull()
      expect(calculateAttendancePercentage(5, 0)).toBeNull()
    })

    it('calculates correct attendance percentage rounded to one decimal place', () => {
      expect(calculateAttendancePercentage(15, 20)).toBe(75.0)
      expect(calculateAttendancePercentage(1, 3)).toBe(33.3)
      expect(calculateAttendancePercentage(10, 10)).toBe(100.0)
    })
  })

  describe('Calendar Month Date Range Validation', () => {
    it('computes valid PostgreSQL DATE boundaries for 28-day, 29-day, 30-day, and 31-day months', () => {
      expect(getMonthDateRange(2026, 2)).toEqual({
        startDate: '2026-02-01',
        endDate: '2026-02-28'
      })
      expect(getMonthDateRange(2024, 2)).toEqual({
        startDate: '2024-02-01',
        endDate: '2024-02-29'
      })
      expect(getMonthDateRange(2026, 4)).toEqual({
        startDate: '2026-04-01',
        endDate: '2026-04-30'
      })
      expect(getMonthDateRange(2026, 10)).toEqual({
        startDate: '2026-10-01',
        endDate: '2026-10-31'
      })
      expect(getMonthDateRange(2026, 11)).toEqual({
        startDate: '2026-11-01',
        endDate: '2026-11-30'
      })
    })
  })

  describe('Account Status & Leadership Role Enforcement (validateAuthorizedProfile)', () => {
    const baseProfile: UserProfile = {
      id: 'usr-1',
      fullName: 'Adebayo Oyewusi',
      email: 'oyewusi.adebayo1@gmail.com',
      roles: ['system_admin'],
      accountStatus: 'active',
      createdAt: '2026-10-18T00:00:00Z'
    }

    it('rejects null / missing user profiles', () => {
      const res = validateAuthorizedProfile(null)
      expect(res.authorized).toBe(false)
      expect(res.error).toContain('No leadership profile found')
    })

    it('rejects deactivated and pending user accounts even if roles exist', () => {
      const deactivated = validateAuthorizedProfile({ ...baseProfile, accountStatus: 'deactivated' })
      expect(deactivated.authorized).toBe(false)
      expect(deactivated.error).toContain('deactivated')

      const pending = validateAuthorizedProfile({ ...baseProfile, accountStatus: 'pending' })
      expect(pending.authorized).toBe(false)
      expect(pending.error).toContain('pending')
    })

    it('rejects active accounts that have zero assigned leadership roles (symptom when user_roles is empty)', () => {
      const unprovisionedProfile: UserProfile = {
        id: 'usr-1',
        fullName: 'oyewusi.adebayo1',
        email: 'oyewusi.adebayo1@gmail.com',
        roles: [],
        unitAssignments: [],
        unitId: null,
        accountStatus: 'active',
        createdAt: '2026-10-18T00:00:00Z'
      }
      const noRoles = validateAuthorizedProfile(unprovisionedProfile)
      expect(noRoles.authorized).toBe(false)
      expect(noRoles.error).toContain('No active leadership roles')
    })

    it('authorizes active accounts with at least one valid leadership role', () => {
      const ok = validateAuthorizedProfile(baseProfile)
      expect(ok.authorized).toBe(true)
      expect(ok.error).toBeUndefined()
    })

    it('resolves system_admin with full stake-wide authority and zero local-unit assignment required', () => {
      const adminProfile: UserProfile = {
        id: 'usr-admin',
        fullName: 'Adebayo Oyewusi',
        email: 'oyewusi.adebayo1@gmail.com',
        roles: ['system_admin'],
        unitAssignments: [],
        unitId: null,
        accountStatus: 'active',
        createdAt: '2026-10-18T00:00:00Z'
      }

      const validation = validateAuthorizedProfile(adminProfile)
      expect(validation.authorized).toBe(true)

      const access = deriveLeadershipAccess(adminProfile.roles, adminProfile.unitAssignments)
      expect(access.isSystemAdmin).toBe(true)
      expect(access.isStakeLeader).toBe(true)
      expect(access.hasStakeWideReadAccess).toBe(true)
      expect(access.isClerkRoleOnly).toBe(false)
      expect(access.canManageActivities).toBe(true)
      expect(access.canManageMembers).toBe(true)
      expect(access.canRecordManualAttendance).toBe(true)
      expect(access.assignedUnitIds).toEqual([])
      expect(access.reportUnitFilter).toBeNull()
    })

    it('simulates idempotent bootstrap and role provisioning without duplicating units, roles, or unit assignments', () => {
      const OFFICIAL_UNITS: { name: string; type: 'ward' | 'branch' }[] = [
        { name: 'Abiola-Way Ward', type: 'ward' },
        { name: 'Alabata Branch', type: 'branch' },
        { name: 'Apena Branch', type: 'branch' },
        { name: 'Apete Branch', type: 'branch' },
        { name: 'Camp Ward', type: 'ward' },
        { name: 'Kugba Ward', type: 'ward' },
        { name: 'Obantoko Ward', type: 'ward' },
        { name: 'Odeda Ward', type: 'ward' }
      ]

      const stakeUnits = new Map<string, { id: string; unitName: string; unitType: 'ward' | 'branch'; isActive: boolean }>()
      const userProfiles = new Map<string, { id: string; fullName: string; email: string; accountStatus: 'active' }>()
      const userRoles = new Set<string>() // key: `${userId}:${roleName}`
      const unitAssignments = new Set<string>() // key: `${userId}:${unitId}:${assignedRole}`

      // Initial state matching confirmed production symptoms:
      // 1 profile with full_name = 'oyewusi.adebayo1', 0 roles, 0 assignments, 0 units
      const adminAuthId = 'auth-uuid-admin'
      userProfiles.set(adminAuthId, {
        id: adminAuthId,
        fullName: 'oyewusi.adebayo1',
        email: 'oyewusi.adebayo1@gmail.com',
        accountStatus: 'active'
      })

      const runIdempotentBootstrap = () => {
        // 1. Upsert 8 official units by unit_name
        for (const u of OFFICIAL_UNITS) {
          const existing = stakeUnits.get(u.name)
          stakeUnits.set(u.name, {
            id: existing?.id || `unit-${u.name.toLowerCase().replace(/\s+/g, '-')}`,
            unitName: u.name,
            unitType: u.type,
            isActive: true
          })
        }

        // 2. Correct administrator profile full_name without changing Auth UUID
        const existingAdmin = userProfiles.get(adminAuthId)
        if (existingAdmin) {
          userProfiles.set(adminAuthId, {
            ...existingAdmin,
            fullName: 'Adebayo Oyewusi',
            accountStatus: 'active'
          })
        }

        // 3. Assign system_admin role idempotently (no unit assignment)
        userRoles.add(`${adminAuthId}:system_admin`)

        // 4. Provision sample Stake YSA Rep (Option A: ysa_leader + all 8 units) if Auth user exists
        const ysaRepId = 'auth-uuid-mubarak'
        if (userProfiles.has(ysaRepId)) {
          const repRole: AppRole = 'ysa_leader'
          const repUnitRole: UnitAssignedRole = 'ysa_leader'
          userRoles.add(`${ysaRepId}:${repRole}`)
          for (const unit of stakeUnits.values()) {
            unitAssignments.add(`${ysaRepId}:${unit.id}:${repUnitRole}`)
          }
        }
      }

      // First run: only admin exists in userProfiles
      runIdempotentBootstrap()
      expect(stakeUnits.size).toBe(8)
      expect(userProfiles.get(adminAuthId)?.id).toBe(adminAuthId)
      expect(userProfiles.get(adminAuthId)?.fullName).toBe('Adebayo Oyewusi')
      expect(userRoles.size).toBe(1)
      expect(userRoles.has(`${adminAuthId}:system_admin`)).toBe(true)
      expect(unitAssignments.size).toBe(0)

      // Second run after Stake YSA Rep Auth user is invited/created
      userProfiles.set('auth-uuid-mubarak', {
        id: 'auth-uuid-mubarak',
        fullName: 'Sosanya, Mubarak Akolade',
        email: 'Mubarakakolade09@gmail.com',
        accountStatus: 'active'
      })
      runIdempotentBootstrap()
      // Third run to verify strict idempotency
      runIdempotentBootstrap()

      expect(stakeUnits.size).toBe(8)
      expect(userProfiles.get(adminAuthId)?.id).toBe(adminAuthId)
      expect(userProfiles.get(adminAuthId)?.fullName).toBe('Adebayo Oyewusi')
      expect(userRoles.size).toBe(2) // system_admin + ysa_leader
      expect(unitAssignments.size).toBe(8) // 8 local unit assignments for Mubarak, 0 for admin
    })
  })

  describe('Production & Local Auth Redirect Resolution (resolveAuthRedirectUrl)', () => {
    it('explicitly redirects to https://ysaams.vercel.app/la in production', () => {
      expect(resolveAuthRedirectUrl('https://ysaams.vercel.app')).toBe(
        'https://ysaams.vercel.app/la'
      )
      expect(resolveAuthRedirectUrl('https://ysaams-git-main-oyewusiab.vercel.app')).toBe(
        'https://ysaams.vercel.app/la'
      )
      expect(resolveAuthRedirectUrl('')).toBe('https://ysaams.vercel.app/la')
    })

    it('uses the current origin /la when running locally on localhost or 127.0.0.1', () => {
      expect(resolveAuthRedirectUrl('http://localhost:5173')).toBe(
        'http://localhost:5173/la'
      )
      expect(resolveAuthRedirectUrl('http://127.0.0.1:4173/')).toBe(
        'http://127.0.0.1:4173/la'
      )
    })
  })

  describe('Supabase Auth Callback & Recovery Link Parsing (parseAuthCallbackUrl)', () => {
    it('detects valid password recovery and invite callbacks', () => {
      const recovery = parseAuthCallbackUrl(
        '#access_token=tok&refresh_token=ref&type=recovery',
        ''
      )
      expect(recovery.hasAuthCallback).toBe(true)
      expect(recovery.isPasswordRecovery).toBe(true)
      expect(recovery.errorMessage).toBeNull()

      const invite = parseAuthCallbackUrl(
        '#access_token=tok&refresh_token=ref&type=invite',
        ''
      )
      expect(invite.hasAuthCallback).toBe(true)
      expect(invite.isInvite).toBe(true)
      expect(invite.isPasswordRecovery).toBe(true)
      expect(invite.errorMessage).toBeNull()
    })

    it('detects expired or invalid recovery links and returns a clear user-facing error message', () => {
      const expired = parseAuthCallbackUrl(
        '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
        ''
      )
      expect(expired.hasAuthCallback).toBe(true)
      expect(expired.isPasswordRecovery).toBe(false)
      expect(expired.errorCode).toBe('otp_expired')
      expect(expired.errorMessage).toContain('invalid or has expired')
      expect(expired.errorMessage).toContain('request a fresh recovery link')
    })

    it('validates new leadership password length and confirmation match', () => {
      expect(validateNewPassword('short', 'short').valid).toBe(false)
      expect(validateNewPassword('ValidPass123!', 'Mismatch123!').valid).toBe(false)
      expect(validateNewPassword('ValidPass123!', 'ValidPass123!').valid).toBe(true)
    })
  })

  describe('Terminal Session Metadata Lifecycle', () => {
    beforeEach(() => {
      attendanceService.clearStoredSession()
    })

    it('stores and clears volatile terminal session metadata cleanly', () => {
      sessionStorage.setItem('ysaams_terminal_token', 'tok-abc')
      sessionStorage.setItem('ysaams_terminal_session_id', 'sess-123')
      sessionStorage.setItem('ysaams_terminal_id', 'term-456')
      sessionStorage.setItem('ysaams_terminal_session_title', 'Obantoko Stake Gathering')
      sessionStorage.setItem('ysaams_terminal_session_date', '2026-10-18')

      const meta = attendanceService.getStoredSessionMetadata()
      expect(meta.token).toBe('tok-abc')
      expect(meta.sessionId).toBe('sess-123')
      expect(meta.terminalId).toBe('term-456')
      expect(meta.sessionTitle).toBe('Obantoko Stake Gathering')
      expect(meta.sessionDate).toBe('2026-10-18')

      attendanceService.clearStoredSession()
      const cleared = attendanceService.getStoredSessionMetadata()
      expect(cleared.token).toBeNull()
      expect(cleared.sessionId).toBeNull()
      expect(cleared.terminalId).toBeNull()
      expect(cleared.sessionTitle).toBeNull()
      expect(cleared.sessionDate).toBeNull()
    })
  })
})

