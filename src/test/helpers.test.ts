import { describe, it, expect, beforeEach } from 'vitest'
import { generateSessionCode } from '../services/activityService'
import { calculateAttendancePercentage, getMonthDateRange } from '../services/reportService'
import { validateAuthorizedProfile } from '../services/authService'
import { attendanceService } from '../services/attendanceService'
import { UserProfile } from '../types/database'

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

    it('rejects active accounts that have zero assigned leadership roles', () => {
      const noRoles = validateAuthorizedProfile({ ...baseProfile, roles: [] })
      expect(noRoles.authorized).toBe(false)
      expect(noRoles.error).toContain('No active leadership roles')
    })

    it('authorizes active accounts with at least one valid leadership role', () => {
      const ok = validateAuthorizedProfile(baseProfile)
      expect(ok.authorized).toBe(true)
      expect(ok.error).toBeUndefined()
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

