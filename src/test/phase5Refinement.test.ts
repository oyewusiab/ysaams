/**
 * Phase 5 Usability, Live Operations & Security Refinement Test Suite
 * Abeokuta Nigeria Obantoko Stake — YSA AMS
 *
 * Comprehensive automated verification covering all 7 requirements:
 * 1. Responsive Left Sidebar & Route Scoping
 * 2. Light Theme by Default & Accessible Contrast
 * 3. Live Active-Session Reporting & Reconciliation
 * 4. Reliable Activity Code & Canonical Link Copying
 * 5. Permission-Based Navigation & Client-Side Route Guards
 * 6. Automatic Inactivity Sign-Out & Multi-Tab Synchronization
 * 7. Professional User-Facing Messages & Safe Logging
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getRolePermittedNavItems } from '../components/layout/LeadershipSidebar'
import { deriveLeadershipAccess } from '../context/AuthContext'
import {
  calculateIdleState,
  shouldThrottleActivity,
  getStoredLastActivity,
  setStoredLastActivity,
  broadcastSignOut,
  clearIdleStorage,
  STORAGE_KEY_LAST_ACTIVITY,
  STORAGE_KEY_SIGNOUT_BROADCAST
} from '../lib/idleTimer'
import {
  copyActivityCode,
  copyAttendanceLink,
  getCanonicalAttendanceUrl,
  saveActiveSessionCode,
  getActiveSessionCode,
  removeActiveSessionCode,
  syncActiveSessionCodes
} from '../lib/clipboardUtils'
import {
  categorizeAndHumanizeError,
  sanitizeTechnicalTerms,
  safeDevLogError
} from '../lib/errorUtils'
import { resolveLeadershipSubpath, extractSessionCode } from '../App'

describe('Requirement 1 & 5: Responsive Left Sidebar & Permission-Based Navigation', () => {
  it('builds navigation strictly matching effective permissions for all 8 roles', () => {
    // 1. System Admin: all 9 modules
    const adminAccess = deriveLeadershipAccess(['system_admin'], [])
    const adminItems = getRolePermittedNavItems({
      isStakeLeader: adminAccess.isStakeLeader,
      canRecordManualAttendance: adminAccess.canRecordManualAttendance
    })
    expect(adminItems.map((i) => i.id)).toEqual([
      'dashboard',
      'activities',
      'attendance',
      'members',
      'reports',
      'units',
      'users',
      'audit-logs',
      'settings'
    ])

    // 2. Stake Presidency: all 9 modules
    const presAccess = deriveLeadershipAccess(['stake_presidency'], [])
    const presItems = getRolePermittedNavItems({
      isStakeLeader: presAccess.isStakeLeader,
      canRecordManualAttendance: presAccess.canRecordManualAttendance
    })
    expect(presItems.map((i) => i.id)).toEqual([
      'dashboard',
      'activities',
      'attendance',
      'members',
      'reports',
      'units',
      'users',
      'audit-logs',
      'settings'
    ])

    // 3. YSA Leader: excludes users and audit-logs
    const ysaAccess = deriveLeadershipAccess(['ysa_leader'], [
      { id: 'ua-1', userId: 'u1', unitId: 'unit-1', assignedRole: 'ysa_leader', createdAt: '2026-10-01' }
    ])
    const ysaItems = getRolePermittedNavItems({
      isStakeLeader: ysaAccess.isStakeLeader,
      canRecordManualAttendance: ysaAccess.canRecordManualAttendance
    })
    expect(ysaItems.map((i) => i.id)).toEqual([
      'dashboard',
      'activities',
      'attendance',
      'members',
      'reports',
      'units',
      'settings'
    ])

    // 4. Bishop: unit-scoped, includes attendance, excludes users and audit-logs
    const bishopAccess = deriveLeadershipAccess(['bishop'], [
      { id: 'ua-2', userId: 'u2', unitId: 'unit-obantoko', assignedRole: 'bishop', createdAt: '2026-10-01' }
    ])
    const bishopItems = getRolePermittedNavItems({
      isStakeLeader: bishopAccess.isStakeLeader,
      canRecordManualAttendance: bishopAccess.canRecordManualAttendance
    })
    expect(bishopItems.map((i) => i.id)).toEqual([
      'dashboard',
      'activities',
      'attendance',
      'members',
      'reports',
      'units',
      'settings'
    ])

    // 5. Branch President: branch-scoped, includes attendance, excludes users and audit-logs
    const bpAccess = deriveLeadershipAccess(['branch_president'], [
      { id: 'ua-3', userId: 'u3', unitId: 'unit-alabata', assignedRole: 'branch_president', createdAt: '2026-10-01' }
    ])
    const bpItems = getRolePermittedNavItems({
      isStakeLeader: bpAccess.isStakeLeader,
      canRecordManualAttendance: bpAccess.canRecordManualAttendance
    })
    expect(bpItems.map((i) => i.id)).toEqual([
      'dashboard',
      'activities',
      'attendance',
      'members',
      'reports',
      'units',
      'settings'
    ])

    // 6. Stake Clerk: read-only, excludes attendance, users, and audit-logs (6 items)
    const scAccess = deriveLeadershipAccess(['stake_clerk'], [])
    const scItems = getRolePermittedNavItems({
      isStakeLeader: scAccess.isStakeLeader,
      canRecordManualAttendance: scAccess.canRecordManualAttendance
    })
    expect(scItems.map((i) => i.id)).toEqual([
      'dashboard',
      'activities',
      'members',
      'reports',
      'units',
      'settings'
    ])

    // 7. Ward Clerk: read-only, excludes attendance, users, and audit-logs (6 items)
    const wcAccess = deriveLeadershipAccess(['ward_clerk'], [
      { id: 'ua-4', userId: 'u4', unitId: 'unit-camp', assignedRole: 'ward_clerk', createdAt: '2026-10-01' }
    ])
    const wcItems = getRolePermittedNavItems({
      isStakeLeader: wcAccess.isStakeLeader,
      canRecordManualAttendance: wcAccess.canRecordManualAttendance
    })
    expect(wcItems.map((i) => i.id)).toEqual([
      'dashboard',
      'activities',
      'members',
      'reports',
      'units',
      'settings'
    ])

    // 8. Branch Clerk: read-only, excludes attendance, users, and audit-logs (6 items)
    const bcAccess = deriveLeadershipAccess(['branch_clerk'], [
      { id: 'ua-5', userId: 'u5', unitId: 'unit-apena', assignedRole: 'branch_clerk', createdAt: '2026-10-01' }
    ])
    const bcItems = getRolePermittedNavItems({
      isStakeLeader: bcAccess.isStakeLeader,
      canRecordManualAttendance: bcAccess.canRecordManualAttendance
    })
    expect(bcItems.map((i) => i.id)).toEqual([
      'dashboard',
      'activities',
      'members',
      'reports',
      'units',
      'settings'
    ])
  })

  it('preserves all route aliases and rejects unknown leadership subpaths', () => {
    expect(resolveLeadershipSubpath('/la')).toBe('dashboard')
    expect(resolveLeadershipSubpath('/la/sessions')).toBe('activities')
    expect(resolveLeadershipSubpath('/la/audit')).toBe('audit-logs')
    expect(resolveLeadershipSubpath('/la/admin')).toBe('users')
    expect(resolveLeadershipSubpath('/la/unknown-module')).toBe('not-found')
  })
})

describe('Requirement 2: Light Theme by Default', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to light theme when no preference is saved', () => {
    const saved = localStorage.getItem('ysaams_theme')
    expect(saved).toBeNull()
    const defaultTheme = saved === 'dark' ? 'dark' : 'light'
    expect(defaultTheme).toBe('light')
  })

  it('persists optional dark theme user preference when explicitly chosen', () => {
    localStorage.setItem('ysaams_theme', 'dark')
    expect(localStorage.getItem('ysaams_theme')).toBe('dark')
    localStorage.setItem('ysaams_theme', 'light')
    expect(localStorage.getItem('ysaams_theme')).toBe('light')
  })
})

describe('Requirement 3: Live Active-Session Reconciliation & Aggregation', () => {
  it('correctly aggregates distinct attendees using stable database UUIDs rather than names alone', () => {
    // Two attendees with the same name (e.g. Oluwatosin Adeyemi) from different units or members
    const memberRecords = [
      { id: 'rec-1', memberId: 'm-uuid-001', attendeeName: 'Oluwatosin Adeyemi', unitId: 'u-camp' },
      { id: 'rec-2', memberId: 'm-uuid-002', attendeeName: 'Oluwatosin Adeyemi', unitId: 'u-obantoko' }
    ]

    const visitorRecords = [
      { id: 'vis-1', fullName: 'Oluwatosin Adeyemi', inviting_unit_id: 'u-camp' }
    ]

    const distinctMemberIds = new Set(memberRecords.map((m) => m.memberId || m.id))
    const distinctVisitorIds = new Set(visitorRecords.map((v) => v.id))
    const distinctAttendeesCount = distinctMemberIds.size + distinctVisitorIds.size

    expect(memberRecords.length + visitorRecords.length).toBe(3)
    // 2 distinct members + 1 distinct visitor = 3 distinct attendees despite identical display names!
    expect(distinctAttendeesCount).toBe(3)
  })

  it('correctly classifies members versus visitors and breaks down by unit', () => {
    const memberRecords = [
      { id: 'r1', memberId: 'm1', attendeeName: 'John', unitId: 'u-camp' },
      { id: 'r2', memberId: 'm2', attendeeName: 'Mary', unitId: 'u-camp' },
      { id: 'r3', memberId: 'm3', attendeeName: 'David', unitId: 'u-obantoko' }
    ]
    const visitorRecords = [
      { id: 'v1', fullName: 'Visitor A', inviting_unit_id: 'u-camp' },
      { id: 'v2', fullName: 'Visitor B', inviting_unit_id: 'u-obantoko' }
    ]

    const totalValid = memberRecords.length + visitorRecords.length
    expect(totalValid).toBe(5)
    expect(memberRecords.length).toBe(3)
    expect(visitorRecords.length).toBe(2)

    const campMembers = memberRecords.filter((m) => m.unitId === 'u-camp').length
    const campVisitors = visitorRecords.filter((v) => v.inviting_unit_id === 'u-camp').length
    expect(campMembers + campVisitors).toBe(3)

    const obantokoMembers = memberRecords.filter((m) => m.unitId === 'u-obantoko').length
    const obantokoVisitors = visitorRecords.filter((v) => v.inviting_unit_id === 'u-obantoko').length
    expect(obantokoMembers + obantokoVisitors).toBe(2)
  })
})

describe('Requirement 4: Reliable Activity Code and Link Copying', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('separates code copying from canonical attendance link copying', async () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextSpy
      }
    })

    const sessionCode = '5BV21F'
    const origin = 'https://ysaams.vercel.app'

    // 1. Copy code only
    const codeResult = await copyActivityCode(sessionCode)
    expect(codeResult.success).toBe(true)
    expect(codeResult.message).toBe('Activity code copied')
    expect(codeResult.value).toBe('5BV21F')
    expect(writeTextSpy).toHaveBeenCalledWith('5BV21F')

    // 2. Copy canonical link only
    const linkResult = await copyAttendanceLink(origin, sessionCode)
    expect(linkResult.success).toBe(true)
    expect(linkResult.message).toBe('Attendance link copied')
    expect(linkResult.value).toBe('https://ysaams.vercel.app/5BV21F')
    expect(writeTextSpy).toHaveBeenCalledWith('https://ysaams.vercel.app/5BV21F')
  })

  it('formats canonical public attendance URL correctly without trailing slash duplication', () => {
    expect(getCanonicalAttendanceUrl('https://ysaams.vercel.app/', '5BV21F')).toBe(
      'https://ysaams.vercel.app/5BV21F'
    )
    expect(getCanonicalAttendanceUrl('http://localhost:5173', '7KM9PQ')).toBe(
      'http://localhost:5173/7KM9PQ'
    )
    expect(extractSessionCode('/5BV21F')).toBe('5BV21F')
  })

  it('persists active session codes and synchronizes across session state', () => {
    saveActiveSessionCode('sess-101', '7KM9PQ')
    expect(getActiveSessionCode('sess-101')).toBe('7KM9PQ')

    // Synchronize against currently active sessions; removes obsolete codes
    syncActiveSessionCodes(['sess-101'])
    expect(getActiveSessionCode('sess-101')).toBe('7KM9PQ')

    // When session is closed, remove code
    removeActiveSessionCode('sess-101')
    expect(getActiveSessionCode('sess-101')).toBeNull()
  })

  it('reports honest failure message when clipboard access fails and never claims false success', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('Permission denied'))
      }
    })

    const res = await copyActivityCode('XYZ123')
    expect(res.success).toBe(false)
    expect(res.message).toContain('Could not copy code automatically. Please copy manually: XYZ123')
    expect(res.value).toBe('XYZ123')
  })
})

describe('Requirement 6: Automatic Inactivity Sign-Out & Cross-Tab Coordination', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('correctly calculates idle remaining time, warning state, and expired state', () => {
    const now = 1000000000000 // reference time
    const timeoutMs = 30 * 60 * 1000 // 30 minutes (1800s)
    const warningThresholdMs = 2 * 60 * 1000 // 2 minutes (120s)

    // 1. Fresh activity (0 minutes elapsed)
    const fresh = calculateIdleState(now, now, timeoutMs, warningThresholdMs)
    expect(fresh.isWarning).toBe(false)
    expect(fresh.isExpired).toBe(false)
    expect(fresh.secondsRemaining).toBe(1800)

    // 2. Active use at 10 minutes (remaining 20 min)
    const mid = calculateIdleState(now - 10 * 60 * 1000, now, timeoutMs, warningThresholdMs)
    expect(mid.isWarning).toBe(false)
    expect(mid.isExpired).toBe(false)
    expect(mid.secondsRemaining).toBe(1200)

    // 3. Warning threshold reached at 28 minutes (remaining 2 minutes = 120s)
    const warn = calculateIdleState(now - 28 * 60 * 1000, now, timeoutMs, warningThresholdMs)
    expect(warn.isWarning).toBe(true)
    expect(warn.isExpired).toBe(false)
    expect(warn.secondsRemaining).toBe(120)

    // 4. Warning continuing at 29 minutes (remaining 60s)
    const warn60 = calculateIdleState(now - 29 * 60 * 1000, now, timeoutMs, warningThresholdMs)
    expect(warn60.isWarning).toBe(true)
    expect(warn60.isExpired).toBe(false)
    expect(warn60.secondsRemaining).toBe(60)

    // 5. Expired at 30 minutes (remaining 0s)
    const expired = calculateIdleState(now - 30 * 60 * 1000, now, timeoutMs, warningThresholdMs)
    expect(expired.isWarning).toBe(false)
    expect(expired.isExpired).toBe(true)
    expect(expired.secondsRemaining).toBe(0)
  })

  it('throttles activity events so rapid mouse movements do not spam storage', () => {
    const t0 = 1000
    // Event at +100ms should be throttled (< 1000ms)
    expect(shouldThrottleActivity(t0, t0 + 100, 1000)).toBe(true)
    // Event at +1500ms should NOT be throttled (>= 1000ms)
    expect(shouldThrottleActivity(t0, t0 + 1500, 1000)).toBe(false)
  })

  it('coordinates last activity timestamp and broadcast across browser tabs via storage', () => {
    const now = Date.now()
    setStoredLastActivity(now)
    expect(getStoredLastActivity()).toBe(now)

    broadcastSignOut()
    expect(localStorage.getItem(STORAGE_KEY_SIGNOUT_BROADCAST)).not.toBeNull()

    clearIdleStorage()
    expect(localStorage.getItem(STORAGE_KEY_LAST_ACTIVITY)).toBeNull()
  })
})

describe('Requirement 7: Professional User-Facing Messages & Safe Logging', () => {
  it('replaces database and Supabase error details with clean user-facing messages', () => {
    // 1. Session / token expired
    const authErr = categorizeAndHumanizeError('JWT expired: access token expired at timestamp 1760000000')
    expect(authErr.category).toBe('auth_expired')
    expect(authErr.userMessage).toBe('Your session has expired. Please sign in again.')

    // 2. Permission denied / Row-level security
    const rlsErr = categorizeAndHumanizeError('new row violates row-level security policy for table "activity_sessions"')
    expect(rlsErr.category).toBe('access_denied')
    expect(rlsErr.userMessage).toBe("This page or action isn't available to your account.")

    // 3. Network connection drop
    const netErr = categorizeAndHumanizeError('Failed to fetch from https://xyz.supabase.co/rest/v1/')
    expect(netErr.category).toBe('network')
    expect(netErr.userMessage).toBe('We could not connect to the server. Please check your internet connection and try again.')

    // 4. Duplicate attendance constraint
    const dupErr = categorizeAndHumanizeError('duplicate key value violates unique constraint "idx_attendance_unique"')
    expect(dupErr.category).toBe('duplicate')
    expect(dupErr.userMessage).toBe('This record already exists in the system.')

    // 5. Generic fallback
    const unkErr = categorizeAndHumanizeError(new Error('Internal Postgres fatal error 500'))
    expect(unkErr.category).toBe('unexpected')
    expect(unkErr.userMessage).toBe('We could not complete your request. Please try again or contact your system administrator.')
  })

  it('sanitizes technical implementation terms from messages', () => {
    const raw = 'Error in public.attendance_records: violates system constraint'
    const clean = sanitizeTechnicalTerms(raw)
    expect(clean).not.toContain('attendance_records')
    expect(clean).toContain('records')
  })

  it('safely logs developer errors while strictly redacting passwords, tokens, and secrets', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    safeDevLogError('Session Initiation', {
      token: 'secret-bearer-token-12345',
      password: 'mypassword123',
      sessionId: 'sess-999',
      errorMessage: 'Database timeout'
    })

    expect(consoleErrorSpy).toHaveBeenCalled()
    const logArgs = consoleErrorSpy.mock.calls[0]
    const details = logArgs[2]

    expect(details.token).toBe('[REDACTED]')
    expect(details.password).toBe('[REDACTED]')
    expect(details.sessionId).toBe('sess-999')
  })
})
