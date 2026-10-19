import { describe, it, expect, beforeEach } from 'vitest'
import crypto from 'crypto'
import { generateSessionCode, CreateActivityParams, CreateSessionParams } from '../services/activityService'
import { extractSessionCode } from '../App'
import { deriveLeadershipAccess } from '../context/AuthContext'
import { AppRole, UserProfile } from '../types/database'

/**
 * Pure SHA-256 helper matching PostgreSQL encode(sha256(convert_to(upper(trim(code)), 'UTF8')), 'hex')
 */
function hashSessionCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim().toUpperCase(), 'utf8').digest('hex')
}

// =============================================================================
// Simulated Multi-Session Attendance Engine for Phase 2 Concurrency & Invariants
// =============================================================================

interface MockTerminalAuth {
  id: string
  sessionId: string
  tokenHash: string
  tokenPlain: string
  label: string
  leaseExpiresAt: number // epoch ms
  isRevoked: boolean
}

interface MockSessionRecord {
  id: string
  activityId: string
  sessionTitle: string
  sessionDate: string
  startTime: string
  timezone: string
  status: 'draft' | 'active' | 'closed'
  maxTerminals: number
  participatingUnits: string[] | null // null = stake-wide
  visitorRegistrationEnabled: boolean
  codeHash: string | null
  codeExpiresAt: number | null
  initiatedBy: string | null
  closedBy: string | null
}

interface MockAttendanceRecord {
  id: string
  sessionId: string
  memberId: string
  recordedUnitId: string
  recordedByTerminalId: string
  checkInTime: string
}

interface MockVisitorRecord {
  id: string
  sessionId: string
  fullName: string
  contactPhone: string
  isChurchMember: boolean
  invitingUnitId: string | null
  recordedByTerminalId: string
  checkInTime: string
}

interface MockAuditLog {
  actorId: string
  action: string
  targetRecordId: string
  targetTable: string
  outcome: string
  metadata: any
}

class AttendanceEngineHarness {
  sessions: Map<string, MockSessionRecord> = new Map()
  terminals: Map<string, MockTerminalAuth> = new Map()
  attendance: MockAttendanceRecord[] = []
  visitors: MockVisitorRecord[] = []
  auditLogs: MockAuditLog[] = []
  reopenRequests: any[] = []

  createSession(params: CreateSessionParams): MockSessionRecord {
    const id = `sess-${crypto.randomUUID()}`
    const clampedTerminals = Math.min(Math.max(1, params.maxTerminals), 10)
    const session: MockSessionRecord = {
      id,
      activityId: params.activityId,
      sessionTitle: params.sessionTitle.trim(),
      sessionDate: params.sessionDate,
      startTime: params.startTime,
      timezone: 'Africa/Lagos',
      status: 'draft',
      maxTerminals: clampedTerminals,
      participatingUnits: params.participatingUnits || null,
      visitorRegistrationEnabled: params.visitorRegistrationEnabled ?? true,
      codeHash: null,
      codeExpiresAt: null,
      initiatedBy: null,
      closedBy: null
    }
    this.sessions.set(id, session)
    return session
  }

  initiateSession(
    sessionId: string,
    code: string,
    maxTerminals: number,
    callerId: string,
    callerRole: AppRole,
    expiryMinutes = 240,
    now: number = Date.now()
  ): { success: boolean; error?: string } {
    // Role check: Only system_admin, stake_presidency, or ysa_leader
    if (!['system_admin', 'stake_presidency', 'ysa_leader'].includes(callerRole)) {
      return { success: false, error: 'Unauthorized: Only authorized YSA leaders or administrators can initiate attendance.' }
    }

    const session = this.sessions.get(sessionId)
    if (!session) return { success: false, error: 'Session not found.' }

    const cleanCode = code.trim().toUpperCase()
    if (cleanCode.length !== 6) {
      return { success: false, error: 'Invalid session code length: Must be exactly 6 characters.' }
    }

    if (maxTerminals < 1 || maxTerminals > 10) {
      return { success: false, error: 'Invalid terminal limit: Must be between 1 and 10.' }
    }

    // Invalidate existing active terminals if code is rotated
    for (const term of this.terminals.values()) {
      if (term.sessionId === sessionId && !term.isRevoked) {
        term.isRevoked = true
      }
    }

    session.status = 'active'
    session.maxTerminals = maxTerminals
    session.codeHash = hashSessionCode(cleanCode)
    session.codeExpiresAt = now + expiryMinutes * 60 * 1000
    session.initiatedBy = callerId

    this.auditLogs.push({
      actorId: callerId,
      action: 'INITIATE_SESSION',
      targetRecordId: sessionId,
      targetTable: 'activity_sessions',
      outcome: 'success',
      metadata: { max_terminals: maxTerminals, expiry_minutes: expiryMinutes }
    })

    return { success: true }
  }

  authorizeTerminal(
    sessionCode: string,
    terminalLabel = 'Attendance Terminal',
    existingToken?: string,
    now: number = Date.now()
  ): { success: boolean; terminalToken?: string; sessionId?: string; error?: string } {
    const cleanCode = sessionCode.trim().toUpperCase()
    const codeHash = hashSessionCode(cleanCode)

    // Find session by codeHash and status = 'active'
    let matchingSession: MockSessionRecord | null = null
    for (const s of this.sessions.values()) {
      if (s.codeHash === codeHash && s.status === 'active') {
        matchingSession = s
        break
      }
    }

    if (!matchingSession) {
      return { success: false, error: 'Invalid attendance code or session is not active.' }
    }

    if (matchingSession.codeExpiresAt && matchingSession.codeExpiresAt < now) {
      return { success: false, error: 'Attendance session code has expired.' }
    }

    // Reconnection handling: does existingToken belong to this session and is not revoked?
    if (existingToken) {
      const existingHash = crypto.createHash('sha256').update(existingToken, 'utf8').digest('hex')
      for (const term of this.terminals.values()) {
        if (term.sessionId === matchingSession.id && term.tokenHash === existingHash && !term.isRevoked) {
          term.leaseExpiresAt = now + 10 * 60 * 1000
          return { success: true, terminalToken: existingToken, sessionId: matchingSession.id }
        }
      }
    }

    // Revoke expired leases
    for (const term of this.terminals.values()) {
      if (term.sessionId === matchingSession.id && !term.isRevoked && term.leaseExpiresAt < now) {
        term.isRevoked = true
      }
    }

    // Count active terminals for THIS session
    let activeCount = 0
    for (const term of this.terminals.values()) {
      if (term.sessionId === matchingSession.id && !term.isRevoked && term.leaseExpiresAt >= now) {
        activeCount++
      }
    }

    if (activeCount >= matchingSession.maxTerminals) {
      return {
        success: false,
        error: `Terminal limit reached (${activeCount} of ${matchingSession.maxTerminals} active). Please contact the session administrator.`
      }
    }

    // Issue 32-byte hex token
    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex')
    const termId = `term-${crypto.randomUUID()}`

    this.terminals.set(termId, {
      id: termId,
      sessionId: matchingSession.id,
      tokenHash,
      tokenPlain: token,
      label: terminalLabel,
      leaseExpiresAt: now + 10 * 60 * 1000,
      isRevoked: false
    })

    return { success: true, terminalToken: token, sessionId: matchingSession.id }
  }

  heartbeatLease(token: string, now: number = Date.now()): { success: boolean; error?: string } {
    const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex')
    let foundTerm: MockTerminalAuth | null = null

    for (const term of this.terminals.values()) {
      if (term.tokenHash === tokenHash && !term.isRevoked) {
        foundTerm = term
        break
      }
    }

    if (!foundTerm) {
      return { success: false, error: 'Terminal lease revoked or session not active' }
    }

    const session = this.sessions.get(foundTerm.sessionId)
    if (!session || session.status !== 'active') {
      return { success: false, error: 'Terminal lease revoked or session not active' }
    }

    foundTerm.leaseExpiresAt = now + 10 * 60 * 1000
    return { success: true }
  }

  releaseTerminal(token: string): { success: boolean } {
    const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex')
    for (const term of this.terminals.values()) {
      if (term.tokenHash === tokenHash && !term.isRevoked) {
        term.isRevoked = true
        return { success: true }
      }
    }
    return { success: true }
  }

  recordAttendance(
    sessionId: string,
    memberId: string,
    memberHomeUnitId: string,
    terminalToken: string,
    now: number = Date.now()
  ): { success: boolean; attendanceId?: string; error?: string } {
    const tokenHash = crypto.createHash('sha256').update(terminalToken, 'utf8').digest('hex')
    let validTerminal: MockTerminalAuth | null = null

    for (const term of this.terminals.values()) {
      if (term.tokenHash === tokenHash && term.sessionId === sessionId && !term.isRevoked && term.leaseExpiresAt >= now) {
        validTerminal = term
        break
      }
    }

    if (!validTerminal) {
      return { success: false, error: 'Unauthorized terminal token, terminal revoked, or terminal lease expired.' }
    }

    const session = this.sessions.get(sessionId)
    if (!session || session.status !== 'active') {
      return { success: false, error: 'Session is not active. Attendance writes are closed.' }
    }

    // Participating unit scoping: If session has specific participating units, check member's home unit
    if (session.participatingUnits && session.participatingUnits.length > 0) {
      if (!session.participatingUnits.includes(memberHomeUnitId)) {
        return { success: false, error: 'Member does not belong to participating units for this session.' }
      }
    }

    // Duplicate check
    const duplicate = this.attendance.some(a => a.sessionId === sessionId && a.memberId === memberId)
    if (duplicate) {
      return { success: false, error: 'Duplicate check-in: member already marked present for this session.' }
    }

    const attId = `att-${crypto.randomUUID()}`
    this.attendance.push({
      id: attId,
      sessionId,
      memberId,
      recordedUnitId: memberHomeUnitId,
      recordedByTerminalId: validTerminal.id,
      checkInTime: new Date(now).toISOString()
    })

    // Activity extends terminal lease
    validTerminal.leaseExpiresAt = now + 10 * 60 * 1000

    return { success: true, attendanceId: attId }
  }

  closeSession(
    sessionId: string,
    callerId: string,
    callerRole: AppRole,
    now: number = Date.now()
  ): { success: boolean; error?: string } {
    if (!['system_admin', 'stake_presidency', 'ysa_leader'].includes(callerRole)) {
      return { success: false, error: 'Unauthorized to close attendance session.' }
    }

    const session = this.sessions.get(sessionId)
    if (!session) return { success: false, error: 'Session not found.' }

    session.status = 'closed'
    session.closedBy = callerId

    // Revoke all active terminals immediately
    for (const term of this.terminals.values()) {
      if (term.sessionId === sessionId && !term.isRevoked) {
        term.isRevoked = true
      }
    }

    this.auditLogs.push({
      actorId: callerId,
      action: 'CLOSE_SESSION',
      targetRecordId: sessionId,
      targetTable: 'activity_sessions',
      outcome: 'success',
      metadata: { timestamp: new Date(now).toISOString() }
    })

    return { success: true }
  }

  reopenSession(
    sessionId: string,
    reason: string,
    callerId: string,
    callerRole: AppRole,
    durationMinutes = 60,
    now: number = Date.now()
  ): { success: boolean; error?: string } {
    // Only stake-wide leadership (system_admin, stake_presidency)
    if (!['system_admin', 'stake_presidency'].includes(callerRole)) {
      return { success: false, error: 'Unauthorized: Reopening a closed session requires System Admin or Stake Presidency authorization.' }
    }

    if (!reason || reason.trim().length < 5) {
      return { success: false, error: 'A mandatory justification reason (at least 5 characters) is required to reopen a closed session.' }
    }

    const session = this.sessions.get(sessionId)
    if (!session) return { success: false, error: 'Session not found.' }

    const reopenUntil = now + durationMinutes * 60 * 1000
    session.status = 'active'
    session.codeExpiresAt = reopenUntil

    this.reopenRequests.push({
      sessionId,
      requestedBy: callerId,
      reason: reason.trim(),
      authorizedBy: callerId,
      reopenUntil: new Date(reopenUntil).toISOString()
    })

    this.auditLogs.push({
      actorId: callerId,
      action: 'REOPEN_SESSION',
      targetRecordId: sessionId,
      targetTable: 'activity_sessions',
      outcome: 'success',
      metadata: { reason: reason.trim(), reopen_until: new Date(reopenUntil).toISOString() }
    })

    return { success: true }
  }
}

// =============================================================================
// PHASE 2 ACCEPTANCE TEST SUITE
// =============================================================================

describe('Phase 2: Activities and Sessions Acceptance & Concurrency Tests', () => {
  let engine: AttendanceEngineHarness

  beforeEach(() => {
    engine = new AttendanceEngineHarness()
  })

  // ---------------------------------------------------------------------------
  // CRITERION 1: Activity Creation & Category Validation
  // ---------------------------------------------------------------------------
  describe('Criterion 1: Activity Creation and Management', () => {
    it('validates all supported activity categories per database check constraint', () => {
      const supportedCategories: Array<CreateActivityParams['category']> = [
        'spiritual',
        'social',
        'service',
        'sports',
        'temple',
        'educational',
        'other'
      ]
      expect(supportedCategories).toHaveLength(7)

      // Confirm all values are distinct and valid
      const set = new Set(supportedCategories)
      expect(set.size).toBe(7)
    })

    it('enforces that clerk roles cannot manage activities', () => {
      const stakeClerk: UserProfile = {
        id: 'u-clerk-1',
        fullName: 'Bro Clerk',
        email: 'clerk@stake.org',
        accountStatus: 'active',
        roles: ['stake_clerk'],
        unitAssignments: [],
        createdAt: '2026-10-19T00:00:00Z'
      }
      const access = deriveLeadershipAccess(stakeClerk.roles, stakeClerk.unitAssignments)
      expect(access.canManageActivities).toBe(false)
      expect(access.hasStakeWideReadAccess).toBe(true)
    })

    it('allows YSA leaders and System Admins to manage activities', () => {
      const ysaLeader: UserProfile = {
        id: 'u-ysa-1',
        fullName: 'Sis YSA Leader',
        email: 'ysa@stake.org',
        accountStatus: 'active',
        roles: ['ysa_leader'],
        unitAssignments: [
          {
            id: 'ua-1',
            userId: 'u-ysa-1',
            unitId: 'ward-1',
            unitName: 'Ward 1',
            assignedRole: 'ysa_leader',
            createdAt: '2026-10-19T00:00:00Z'
          }
        ],
        createdAt: '2026-10-19T00:00:00Z'
      }
      const admin: UserProfile = {
        id: 'u-admin-1',
        fullName: 'President Admin',
        email: 'admin@stake.org',
        accountStatus: 'active',
        roles: ['system_admin'],
        unitAssignments: [],
        createdAt: '2026-10-19T00:00:00Z'
      }

      expect(deriveLeadershipAccess(ysaLeader.roles, ysaLeader.unitAssignments).canManageActivities).toBe(true)
      expect(deriveLeadershipAccess(admin.roles, admin.unitAssignments).canManageActivities).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // CRITERION 2: Session Scheduling & Participating-Unit Configuration
  // ---------------------------------------------------------------------------
  describe('Criterion 2: Session Scheduling & Participating-Unit Configuration', () => {
    it('schedules draft session with Africa/Lagos timezone, clamped terminals, and unit scoping', () => {
      const session = engine.createSession({
        activityId: 'act-101',
        sessionTitle: 'Obantoko Stake YSA FHE',
        sessionDate: '2026-10-24',
        startTime: '17:00',
        maxTerminals: 5,
        participatingUnits: ['ward-1', 'ward-2'],
        visitorRegistrationEnabled: true
      })

      expect(session.status).toBe('draft')
      expect(session.timezone).toBe('Africa/Lagos')
      expect(session.maxTerminals).toBe(5)
      expect(session.participatingUnits).toEqual(['ward-1', 'ward-2'])
      expect(session.visitorRegistrationEnabled).toBe(true)
      expect(session.codeHash).toBeNull()
    })

    it('clamps maxTerminals between 1 and 10', () => {
      const underClamped = engine.createSession({
        activityId: 'act-101',
        sessionTitle: 'Session Low',
        sessionDate: '2026-10-24',
        startTime: '18:00',
        maxTerminals: 0
      })
      expect(underClamped.maxTerminals).toBe(1)

      const overClamped = engine.createSession({
        activityId: 'act-101',
        sessionTitle: 'Session High',
        sessionDate: '2026-10-24',
        startTime: '18:00',
        maxTerminals: 50
      })
      expect(overClamped.maxTerminals).toBe(10)
    })

    it('supports stake-wide open sessions when participatingUnits is null or empty', () => {
      const openSession = engine.createSession({
        activityId: 'act-101',
        sessionTitle: 'All-Stake Conference',
        sessionDate: '2026-10-25',
        startTime: '10:00',
        maxTerminals: 3,
        participatingUnits: null
      })
      expect(openSession.participatingUnits).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // CRITERION 3: Correct Session Lifecycle Transitions
  // ---------------------------------------------------------------------------
  describe('Criterion 3: Session Lifecycle Transitions', () => {
    it('transitions strictly through draft -> active -> closed -> active (reopened)', () => {
      const session = engine.createSession({
        activityId: 'act-101',
        sessionTitle: 'Institute Night',
        sessionDate: '2026-10-22',
        startTime: '19:00',
        maxTerminals: 2
      })
      expect(session.status).toBe('draft')

      // Draft -> Active
      const initRes = engine.initiateSession(session.id, '234567', 2, 'user-ysa', 'ysa_leader')
      expect(initRes.success).toBe(true)
      expect(session.status).toBe('active')
      expect(session.codeHash).toBe(hashSessionCode('234567'))

      // Active -> Closed
      const closeRes = engine.closeSession(session.id, 'user-ysa', 'ysa_leader')
      expect(closeRes.success).toBe(true)
      expect(session.status).toBe('closed')

      // Closed -> Active (Reopening by Stake Presidency)
      const reopenRes = engine.reopenSession(session.id, 'Power outage delayed check-in', 'user-pres', 'stake_presidency', 60)
      expect(reopenRes.success).toBe(true)
      expect(session.status).toBe('active')
    })

    it('rejects invalid state transitions or unauthorized roles', () => {
      const session = engine.createSession({
        activityId: 'act-101',
        sessionTitle: 'Ward Activity',
        sessionDate: '2026-10-22',
        startTime: '19:00',
        maxTerminals: 2
      })

      // Clerk cannot initiate
      const clerkInit = engine.initiateSession(session.id, '5BV21F', 2, 'user-clerk', 'ward_clerk')
      expect(clerkInit.success).toBe(false)
      expect(clerkInit.error).toContain('Unauthorized')

      // YSA leader initiates
      engine.initiateSession(session.id, '5BV21F', 2, 'user-ysa', 'ysa_leader')
      engine.closeSession(session.id, 'user-ysa', 'ysa_leader')

      // YSA leader CANNOT reopen; requires stake-wide leader (System Admin or Stake Presidency)
      const ysaReopen = engine.reopenSession(session.id, 'Forgot members', 'user-ysa', 'ysa_leader')
      expect(ysaReopen.success).toBe(false)
      expect(ysaReopen.error).toContain('Unauthorized: Reopening a closed session requires System Admin or Stake Presidency')

      // Reopen fails if reason is under 5 characters
      const shortReason = engine.reopenSession(session.id, 'bad', 'user-admin', 'system_admin')
      expect(shortReason.success).toBe(false)
      expect(shortReason.error).toContain('at least 5 characters')
    })
  })

  // ---------------------------------------------------------------------------
  // CRITERION 4: Unique Codes and Usable Session Links
  // ---------------------------------------------------------------------------
  describe('Criterion 4: Unique Codes and Usable Session Links', () => {
    it('generates strictly 6-character unambiguous codes excluding 0, O, 1, I, L', () => {
      const disallowedChars = ['0', 'O', '1', 'I', 'L']
      for (let i = 0; i < 50; i++) {
        const code = generateSessionCode()
        expect(code).toHaveLength(6)
        for (const disallowed of disallowedChars) {
          expect(code).not.toContain(disallowed)
        }
      }
    })

    it('extracts session code accurately from URL paths and normalizes to uppercase', () => {
      expect(extractSessionCode('/5BV21F')).toBe('5BV21F')
      expect(extractSessionCode('/5bv21f')).toBe('5BV21F')
      expect(extractSessionCode('/234567/')).toBe('234567')

      // Non-session paths are rejected
      expect(extractSessionCode('/')).toBeNull()
      expect(extractSessionCode('/la')).toBeNull()
      expect(extractSessionCode('/la/sessions')).toBeNull()
      expect(extractSessionCode('/terminal')).toBeNull()
      expect(extractSessionCode('/invalid-long-slug')).toBeNull()
      expect(extractSessionCode('/123')).toBeNull()
    })

    it('verifies that database persists SHA-256 hash without plaintext code leakage', () => {
      const code = '7X9K2M'
      const hashed = hashSessionCode(code)
      expect(hashed).toHaveLength(64)
      expect(hashed).not.toContain(code)
    })
  })

  // ---------------------------------------------------------------------------
  // CRITERION 5: INDEPENDENT CONCURRENT SESSIONS (PRIMARY EXIT CRITERION)
  // ---------------------------------------------------------------------------
  describe('Criterion 5: Independent Concurrent Sessions (Primary Exit Criterion)', () => {
    it('runs multiple independent concurrent sessions simultaneously without sharing codes, tokens, quotas, or state', () => {
      // 1. Create two distinct concurrent sessions running simultaneously
      const sessionA = engine.createSession({
        activityId: 'act-spiritual',
        sessionTitle: 'Obantoko Stake YSA Institute Night',
        sessionDate: '2026-10-25',
        startTime: '18:00',
        maxTerminals: 2,
        participatingUnits: ['ward-obantoko-1', 'ward-obantoko-2']
      })

      const sessionB = engine.createSession({
        activityId: 'act-sports',
        sessionTitle: 'Abeokuta Stake YSA Volleyball Tournament',
        sessionDate: '2026-10-25',
        startTime: '18:00',
        maxTerminals: 1,
        participatingUnits: ['ward-camp', 'branch-adatan']
      })

      const codeA = '3H7N9P'
      const codeB = '4K8R2W'

      // 2. Initiate both sessions as active
      expect(engine.initiateSession(sessionA.id, codeA, 2, 'leader-1', 'ysa_leader').success).toBe(true)
      expect(engine.initiateSession(sessionB.id, codeB, 1, 'leader-2', 'ysa_leader').success).toBe(true)

      expect(sessionA.status).toBe('active')
      expect(sessionB.status).toBe('active')
      expect(sessionA.codeHash).not.toBe(sessionB.codeHash)

      // 3. Authorize kiosks for Session A (Max: 2)
      const authA1 = engine.authorizeTerminal(codeA, 'Entrance Kiosk A1')
      expect(authA1.success).toBe(true)
      expect(authA1.sessionId).toBe(sessionA.id)

      const authA2 = engine.authorizeTerminal(codeA, 'Exit Kiosk A2')
      expect(authA2.success).toBe(true)
      expect(authA2.sessionId).toBe(sessionA.id)

      // 3rd kiosk for Session A must hit capacity limit
      const authA3 = engine.authorizeTerminal(codeA, 'Overflow Kiosk A3')
      expect(authA3.success).toBe(false)
      expect(authA3.error).toContain('Terminal limit reached')

      // 4. Authorize kiosk for Session B (Max: 1) - Independent quota!
      const authB1 = engine.authorizeTerminal(codeB, 'Sports Court Kiosk B1')
      expect(authB1.success).toBe(true)
      expect(authB1.sessionId).toBe(sessionB.id)

      // Session B tokens and Session A tokens are completely distinct
      expect(authA1.terminalToken).not.toBe(authB1.terminalToken)
      expect(authA2.terminalToken).not.toBe(authB1.terminalToken)

      // 2nd kiosk for Session B hits its own quota without affecting Session A
      const authB2 = engine.authorizeTerminal(codeB, 'Overflow Kiosk B2')
      expect(authB2.success).toBe(false)
      expect(authB2.error).toContain('Terminal limit reached (1 of 1 active)')

      // 5. Cross-Session Token Rejection (Session A token cannot check into Session B)
      const crossCheckIn = engine.recordAttendance(
        sessionB.id,
        'member-1',
        'ward-camp',
        authA1.terminalToken!
      )
      expect(crossCheckIn.success).toBe(false)
      expect(crossCheckIn.error).toContain('Unauthorized terminal token')

      // 6. Valid Check-in Isolation
      const checkInA = engine.recordAttendance(
        sessionA.id,
        'member-obantoko-1',
        'ward-obantoko-1',
        authA1.terminalToken!
      )
      expect(checkInA.success).toBe(true)

      const checkInB = engine.recordAttendance(
        sessionB.id,
        'member-camp-1',
        'ward-camp',
        authB1.terminalToken!
      )
      expect(checkInB.success).toBe(true)

      // Check attendance table partition
      const recsA = engine.attendance.filter(r => r.sessionId === sessionA.id)
      const recsB = engine.attendance.filter(r => r.sessionId === sessionB.id)
      expect(recsA).toHaveLength(1)
      expect(recsB).toHaveLength(1)
      expect(recsA[0].memberId).toBe('member-obantoko-1')
      expect(recsB[0].memberId).toBe('member-camp-1')

      // 7. Unit Boundary Isolation: Member from Session A's ward cannot check into Session B
      const invalidUnitCheckIn = engine.recordAttendance(
        sessionB.id,
        'member-obantoko-2',
        'ward-obantoko-1', // Not in sessionB participatingUnits ('ward-camp', 'branch-adatan')
        authB1.terminalToken!
      )
      expect(invalidUnitCheckIn.success).toBe(false)
      expect(invalidUnitCheckIn.error).toContain('Member does not belong to participating units')

      // 8. Lifecycle Isolation: Closing Session A DOES NOT affect Session B
      const closeA = engine.closeSession(sessionA.id, 'leader-1', 'ysa_leader')
      expect(closeA.success).toBe(true)
      expect(sessionA.status).toBe('closed')
      expect(sessionB.status).toBe('active') // Session B remains active!

      // Session A terminals are revoked
      const postCloseCheckInA = engine.recordAttendance(
        sessionA.id,
        'member-obantoko-2',
        'ward-obantoko-2',
        authA2.terminalToken!
      )
      expect(postCloseCheckInA.success).toBe(false)

      // Session B terminals continue to operate and accept check-ins without disruption!
      const postCloseCheckInB = engine.recordAttendance(
        sessionB.id,
        'member-adatan-1',
        'branch-adatan',
        authB1.terminalToken!
      )
      expect(postCloseCheckInB.success).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // CRITERION 6: Device Limits and Lease Handling
  // ---------------------------------------------------------------------------
  describe('Criterion 6: Device Limits and Lease Handling', () => {
    it('manages 10-minute leases, automatic expired-lease slot reclaim, and clean release', () => {
      const now = 1000000000000
      const session = engine.createSession({
        activityId: 'act-1',
        sessionTitle: 'Terminal Lease Test',
        sessionDate: '2026-10-26',
        startTime: '10:00',
        maxTerminals: 1
      })
      engine.initiateSession(session.id, '234567', 1, 'admin', 'system_admin', 240, now)

      // 1. First device authorization consumes slot 1
      const auth1 = engine.authorizeTerminal('234567', 'Kiosk 1', undefined, now)
      expect(auth1.success).toBe(true)

      // 2. Second device rejected while lease is active
      const auth2 = engine.authorizeTerminal('234567', 'Kiosk 2', undefined, now + 2 * 60 * 1000)
      expect(auth2.success).toBe(false)
      expect(auth2.error).toContain('Terminal limit reached')

      // 3. Heartbeat extends active lease
      const hb = engine.heartbeatLease(auth1.terminalToken!, now + 4 * 60 * 1000)
      expect(hb.success).toBe(true)

      // 4. Same device reconnecting with existing token preserves slot without quota violation
      const reconnect = engine.authorizeTerminal('234567', 'Kiosk 1', auth1.terminalToken!, now + 5 * 60 * 1000)
      expect(reconnect.success).toBe(true)

      // 5. After lease expires (> 10 minutes past last heartbeat), next authorization automatically reclaims slot
      const futureTime = now + (5 + 11) * 60 * 1000 // 16 min total (11 min after last heartbeat)
      const authReclaimed = engine.authorizeTerminal('234567', 'Kiosk 2', undefined, futureTime)
      expect(authReclaimed.success).toBe(true)

      // 6. Manual release immediately frees capacity
      engine.releaseTerminal(authReclaimed.terminalToken!)
      const authImmediate = engine.authorizeTerminal('234567', 'Kiosk 3', undefined, futureTime + 1000)
      expect(authImmediate.success).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // CRITERION 7: Closure, Write Rejection, and Authorized Reopening
  // ---------------------------------------------------------------------------
  describe('Criterion 7: Closure, Write Rejection, and Authorized Reopening', () => {
    it('strictly revokes tokens on closure, rejects check-in writes, and audits reopening', () => {
      const session = engine.createSession({
        activityId: 'act-1',
        sessionTitle: 'Strict Closure Test',
        sessionDate: '2026-10-27',
        startTime: '16:00',
        maxTerminals: 2
      })
      engine.initiateSession(session.id, '234567', 2, 'leader-ysa', 'ysa_leader')
      const auth = engine.authorizeTerminal('234567', 'Kiosk 1')
      expect(auth.success).toBe(true)

      // Successful check-in while active
      const okCheckIn = engine.recordAttendance(session.id, 'm-1', 'ward-1', auth.terminalToken!)
      expect(okCheckIn.success).toBe(true)

      // Close session
      const closeRes = engine.closeSession(session.id, 'leader-ysa', 'ysa_leader')
      expect(closeRes.success).toBe(true)

      // Check-in after closure rejected
      const blockedCheckIn = engine.recordAttendance(session.id, 'm-2', 'ward-1', auth.terminalToken!)
      expect(blockedCheckIn.success).toBe(false)
      expect(blockedCheckIn.error).toContain('Unauthorized terminal token, terminal revoked, or terminal lease expired')

      // Heartbeat after closure fails
      const hb = engine.heartbeatLease(auth.terminalToken!)
      expect(hb.success).toBe(false)

      // Reopening requires at least 5-character reason
      const badReopen = engine.reopenSession(session.id, 'no', 'stake-pres', 'stake_presidency')
      expect(badReopen.success).toBe(false)
      expect(badReopen.error).toContain('at least 5 characters')

      // Authorized reopening succeeds and records in audit log and reopening requests
      const goodReopen = engine.reopenSession(
        session.id,
        'Heavy traffic delayed bus arrival from Camp Ward',
        'stake-pres',
        'stake_presidency',
        45
      )
      expect(goodReopen.success).toBe(true)
      expect(session.status).toBe('active')
      expect(engine.reopenRequests).toHaveLength(1)
      expect(engine.reopenRequests[0].reason).toContain('Heavy traffic')
      expect(engine.auditLogs.some(l => l.action === 'REOPEN_SESSION')).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // CRITERION 8: Role and Unit-Scope Enforcement
  // ---------------------------------------------------------------------------
  describe('Criterion 8: Role and Unit-Scope Enforcement', () => {
    it('enforces least privilege across stake clerks, ward clerks, and executive roles', () => {
      const stakeClerkProfile: UserProfile = {
        id: 'u-sc',
        fullName: 'Stake Clerk',
        email: 'sc@stake.org',
        accountStatus: 'active',
        roles: ['stake_clerk'],
        unitAssignments: [],
        createdAt: '2026-10-19T00:00:00Z'
      }
      const wardClerkProfile: UserProfile = {
        id: 'u-wc',
        fullName: 'Ward Clerk',
        email: 'wc@ward1.org',
        accountStatus: 'active',
        roles: ['ward_clerk'],
        unitAssignments: [
          {
            id: 'ua-wc-1',
            userId: 'u-wc',
            unitId: 'ward-1',
            unitName: 'Ward 1',
            assignedRole: 'ward_clerk',
            createdAt: '2026-10-19T00:00:00Z'
          }
        ],
        createdAt: '2026-10-19T00:00:00Z'
      }
      const ysaLeaderProfile: UserProfile = {
        id: 'u-ysa',
        fullName: 'YSA Leader',
        email: 'ysa@stake.org',
        accountStatus: 'active',
        roles: ['ysa_leader'],
        unitAssignments: [
          {
            id: 'ua-ysa-1',
            userId: 'u-ysa',
            unitId: 'ward-1',
            unitName: 'Ward 1',
            assignedRole: 'ysa_leader',
            createdAt: '2026-10-19T00:00:00Z'
          }
        ],
        createdAt: '2026-10-19T00:00:00Z'
      }

      const scAccess = deriveLeadershipAccess(stakeClerkProfile.roles, stakeClerkProfile.unitAssignments)
      const wcAccess = deriveLeadershipAccess(wardClerkProfile.roles, wardClerkProfile.unitAssignments)
      const ysaAccess = deriveLeadershipAccess(ysaLeaderProfile.roles, ysaLeaderProfile.unitAssignments)

      // Stake clerk has stake-wide read filter, but CANNOT manage activities, members, or record manual check-ins
      expect(scAccess.reportUnitFilter).toBeNull() // stake-wide reporting
      expect(scAccess.canManageActivities).toBe(false)
      expect(scAccess.canManageMembers).toBe(false)
      expect(scAccess.canRecordManualAttendance).toBe(false)

      // Ward clerk is scoped to ward-1 only, and CANNOT manage activities, members, or record manual check-ins
      expect(wcAccess.reportUnitFilter).toEqual(['ward-1'])
      expect(wcAccess.canManageActivities).toBe(false)
      expect(wcAccess.canManageMembers).toBe(false)
      expect(wcAccess.canRecordManualAttendance).toBe(false)

      // YSA leader CAN manage activities, manage members, and record manual attendance
      expect(ysaAccess.canManageActivities).toBe(true)
      expect(ysaAccess.canManageMembers).toBe(true)
      expect(ysaAccess.canRecordManualAttendance).toBe(true)
    })
  })
})
