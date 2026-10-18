import { describe, it, expect, beforeEach } from 'vitest'
import { AppRole, UnitAssignedRole, UserUnitAssignment as DbUserUnitAssignment } from '../types/database'
import { deriveLeadershipAccess } from '../context/AuthContext'

// --- Mock In-Memory Domain Engine for Pure Unit Testing ---

interface UserUnitAssignment {
  unitId: string
  assignedRole: UnitAssignedRole
}

interface UserContext {
  id: string
  accountStatus: 'active' | 'deactivated' | 'pending'
  roles: AppRole[]
  unitAssignments: UserUnitAssignment[]
}

interface MockSession {
  id: string
  codeHash: string
  status: 'draft' | 'active' | 'closed'
  codeExpiresAt: number // epoch ms
  maxTerminals: number
  participatingUnits?: string[] | null
  terminals: { id: string; token: string; leaseExpiresAt: number; isRevoked: boolean }[]
}

interface AttendanceEntry {
  sessionId: string
  memberId: string
  recordedUnitId: string
}

function hasStakeWideAccess(user: UserContext): boolean {
  return user.roles.includes('system_admin') || user.roles.includes('stake_presidency')
}

function canAccessUnitData(user: UserContext, unitId: string): boolean {
  if (hasStakeWideAccess(user)) return true
  return user.unitAssignments.some(ua => ua.unitId === unitId)
}

function authorizeTerminalDevice(
  session: MockSession,
  code: string,
  now: number = Date.now()
): { success: boolean; token?: string; error?: string } {
  if (session.status !== 'active') {
    return { success: false, error: 'Session is not active' }
  }
  if (now > session.codeExpiresAt) {
    return { success: false, error: 'Session code has expired' }
  }
  if (code !== '5BV21F') {
    return { success: false, error: 'Invalid session code' }
  }

  // Count active non-expired non-revoked leases
  const activeCount = session.terminals.filter(t => !t.isRevoked && t.leaseExpiresAt >= now).length
  if (activeCount >= session.maxTerminals) {
    return { success: false, error: `Terminal capacity limit reached (${activeCount} of ${session.maxTerminals})` }
  }

  const token = `tok-${Math.random().toString(36).substring(2)}`
  session.terminals.push({
    id: `term-${session.terminals.length + 1}`,
    token,
    leaseExpiresAt: now + 10 * 60 * 1000,
    isRevoked: false
  })
  return { success: true, token }
}

describe('Domain Rules & Invariant Validation (Pure Unit Tests)', () => {
  describe('Role Permission Boundaries & Unit Scoping', () => {
    const bishopWard1: UserContext = {
      id: 'usr-bishop-1',
      accountStatus: 'active',
      roles: ['bishop'],
      unitAssignments: [{ unitId: 'ward-1', assignedRole: 'bishop' }]
    }

    const stakePresident: UserContext = {
      id: 'usr-stake-pres',
      accountStatus: 'active',
      roles: ['stake_presidency'],
      unitAssignments: []
    }

    it('allows a Bishop to access their own ward data', () => {
      expect(canAccessUnitData(bishopWard1, 'ward-1')).toBe(true)
    })

    it('denies a Bishop access to other wards or branches (Cross-Unit Access Denial)', () => {
      expect(canAccessUnitData(bishopWard1, 'ward-2')).toBe(false)
      expect(canAccessUnitData(bishopWard1, 'branch-1')).toBe(false)
    })

    it('allows Stake Presidency stake-wide access across all units', () => {
      expect(canAccessUnitData(stakePresident, 'ward-1')).toBe(true)
      expect(canAccessUnitData(stakePresident, 'ward-2')).toBe(true)
      expect(canAccessUnitData(stakePresident, 'branch-1')).toBe(true)
    })
  })

  describe('Session Code Validation & Expiration', () => {
    let session: MockSession

    beforeEach(() => {
      session = {
        id: 'sess-100',
        codeHash: 'hash-5bv21f',
        status: 'active',
        codeExpiresAt: Date.now() + 60 * 60 * 1000, // 1 hr future
        maxTerminals: 2,
        terminals: []
      }
    })

    it('rejects invalid session codes', () => {
      const res = authorizeTerminalDevice(session, 'WRONG1')
      expect(res.success).toBe(false)
      expect(res.error).toContain('Invalid session code')
    })

    it('rejects expired session codes', () => {
      const pastTime = Date.now() + 2 * 60 * 60 * 1000 // 2 hrs future, past 1 hr expiry
      const res = authorizeTerminalDevice(session, '5BV21F', pastTime)
      expect(res.success).toBe(false)
      expect(res.error).toContain('Session code has expired')
    })

    it('rejects authorization when session is closed', () => {
      session.status = 'closed'
      const res = authorizeTerminalDevice(session, '5BV21F')
      expect(res.success).toBe(false)
      expect(res.error).toContain('Session is not active')
    })
  })

  describe('Terminal Capacity & Concurrency Limits', () => {
    let session: MockSession

    beforeEach(() => {
      session = {
        id: 'sess-200',
        codeHash: 'hash-5bv21f',
        status: 'active',
        codeExpiresAt: Date.now() + 60 * 60 * 1000,
        maxTerminals: 2,
        terminals: []
      }
    })

    it('enforces maximum terminal limits and rejects excess connections', () => {
      const t1 = authorizeTerminalDevice(session, '5BV21F')
      const t2 = authorizeTerminalDevice(session, '5BV21F')
      expect(t1.success).toBe(true)
      expect(t2.success).toBe(true)

      const t3 = authorizeTerminalDevice(session, '5BV21F')
      expect(t3.success).toBe(false)
      expect(t3.error).toContain('Terminal capacity limit reached (2 of 2)')
    })

    it('re-allows connection when an abandoned terminal lease expires after 10 minutes', () => {
      const now = 1000000000000
      authorizeTerminalDevice(session, '5BV21F', now)
      authorizeTerminalDevice(session, '5BV21F', now)

      // Capacity reached at time `now`
      expect(authorizeTerminalDevice(session, '5BV21F', now).success).toBe(false)

      // Advance by 11 minutes -> both leases expired
      const later = now + 11 * 60 * 1000
      const newDevice = authorizeTerminalDevice(session, '5BV21F', later)
      expect(newDevice.success).toBe(true)
    })
  })

  describe('Duplicate Attendance Prevention & Session Closure', () => {
    const records: AttendanceEntry[] = []

    function recordAttendance(
      session: MockSession,
      memberId: string,
      unitId: string
    ): { success: boolean; error?: string } {
      if (session.status !== 'active') {
        return { success: false, error: 'Session is closed. Attendance rejected.' }
      }
      if (records.some(r => r.sessionId === session.id && r.memberId === memberId)) {
        return { success: false, error: 'Duplicate attendance: Member already checked in.' }
      }
      records.push({ sessionId: session.id, memberId, recordedUnitId: unitId })
      return { success: true }
    }

    it('prevents duplicate attendance for the same member in a session', () => {
      const session: MockSession = {
        id: 'sess-300',
        codeHash: 'h',
        status: 'active',
        codeExpiresAt: Date.now() + 10000,
        maxTerminals: 1,
        terminals: []
      }

      const first = recordAttendance(session, 'mem-1', 'ward-1')
      expect(first.success).toBe(true)

      const duplicate = recordAttendance(session, 'mem-1', 'ward-1')
      expect(duplicate.success).toBe(false)
      expect(duplicate.error).toContain('Duplicate attendance')
    })

    it('rejects attendance submissions when session is closed', () => {
      const closedSession: MockSession = {
        id: 'sess-400',
        codeHash: 'h',
        status: 'closed',
        codeExpiresAt: Date.now() + 10000,
        maxTerminals: 1,
        terminals: []
      }

      const res = recordAttendance(closedSession, 'mem-2', 'ward-1')
      expect(res.success).toBe(false)
      expect(res.error).toContain('Session is closed')
    })
  })

  describe('Session Reopening Authorization', () => {
    function canReopenSession(user: UserContext): boolean {
      return user.roles.includes('system_admin') || user.roles.includes('stake_presidency')
    }

    it('allows System Admin and Stake Presidency to reopen a session', () => {
      expect(canReopenSession({ id: 'u1', accountStatus: 'active', roles: ['system_admin'], unitAssignments: [] })).toBe(true)
      expect(canReopenSession({ id: 'u2', accountStatus: 'active', roles: ['stake_presidency'], unitAssignments: [] })).toBe(true)
    })

    it('denies YSA Leaders, Bishops, and Branch Presidents from reopening closed sessions', () => {
      expect(canReopenSession({ id: 'u3', accountStatus: 'active', roles: ['ysa_leader'], unitAssignments: [] })).toBe(false)
      expect(canReopenSession({ id: 'u4', accountStatus: 'active', roles: ['bishop'], unitAssignments: [{ unitId: 'ward-1', assignedRole: 'bishop' }] })).toBe(false)
      expect(canReopenSession({ id: 'u5', accountStatus: 'active', roles: ['branch_president'], unitAssignments: [{ unitId: 'branch-1', assignedRole: 'branch_president' }] })).toBe(false)
    })
  })

  describe('Phase 2B Security Remediation: Profile Column Immutability & Visitor Scoping', () => {
    // Model fn_protect_profile_fields trigger logic
    function simulateProfileUpdate(
      user: UserContext,
      currentRecord: { id: string; fullName: string; email: string; accountStatus: string },
      updatedRecord: { id: string; fullName: string; email: string; accountStatus: string }
    ): { success: boolean; error?: string } {
      const isAdmin = user.roles.includes('system_admin')

      if (!isAdmin) {
        if (updatedRecord.accountStatus !== currentRecord.accountStatus) {
          return { success: false, error: 'Unauthorized: Only system administrators can alter account status.' }
        }
        if (updatedRecord.email !== currentRecord.email) {
          return { success: false, error: 'Unauthorized: Profile email address cannot be changed directly.' }
        }
      }

      return { success: true }
    }

    it('prevents non-admin user from escalating their own account_status', () => {
      const regularUser: UserContext = { id: 'u-reg', accountStatus: 'pending', roles: ['ysa_leader'], unitAssignments: [{ unitId: 'ward-1', assignedRole: 'ysa_leader' }] }
      const current = { id: 'u-reg', fullName: 'John Doe', email: 'john@example.com', accountStatus: 'pending' }
      const malicious = { ...current, accountStatus: 'active' }

      const res = simulateProfileUpdate(regularUser, current, malicious)
      expect(res.success).toBe(false)
      expect(res.error).toContain('Only system administrators can alter account status')
    })

    it('prevents non-admin user from changing profile email address', () => {
      const regularUser: UserContext = { id: 'u-reg', accountStatus: 'active', roles: ['ysa_leader'], unitAssignments: [{ unitId: 'ward-1', assignedRole: 'ysa_leader' }] }
      const current = { id: 'u-reg', fullName: 'John Doe', email: 'john@example.com', accountStatus: 'active' }
      const malicious = { ...current, email: 'hijacked@attacker.com' }

      const res = simulateProfileUpdate(regularUser, current, malicious)
      expect(res.success).toBe(false)
      expect(res.error).toContain('Profile email address cannot be changed directly')
    })

    it('allows system_admin to update account_status and email', () => {
      const admin: UserContext = { id: 'u-admin', accountStatus: 'active', roles: ['system_admin'], unitAssignments: [] }
      const current = { id: 'u-reg', fullName: 'John Doe', email: 'john@example.com', accountStatus: 'pending' }
      const updated = { ...current, accountStatus: 'active', email: 'verified@example.com' }

      const res = simulateProfileUpdate(admin, current, updated)
      expect(res.success).toBe(true)
    })

    // Model SEC-04 visitor visibility scoping logic
    function canViewVisitor(
      user: UserContext,
      visitor: { invitingUnitId: string | null }
    ): boolean {
      if (hasStakeWideAccess(user)) return true
      if (visitor.invitingUnitId === null) return false // Unassigned visitors are stake-wide only
      return user.unitAssignments.some(ua => ua.unitId === visitor.invitingUnitId)
    }

    it('hides unassigned visitors from local ward bishops', () => {
      const bishop: UserContext = { id: 'b1', accountStatus: 'active', roles: ['bishop'], unitAssignments: [{ unitId: 'ward-1', assignedRole: 'bishop' }] }
      const unassignedVisitor = { invitingUnitId: null }

      expect(canViewVisitor(bishop, unassignedVisitor)).toBe(false)
    })

    it('allows ward bishops to view visitors invited specifically by their unit', () => {
      const bishop: UserContext = { id: 'b1', accountStatus: 'active', roles: ['bishop'], unitAssignments: [{ unitId: 'ward-1', assignedRole: 'bishop' }] }
      const ward1Visitor = { invitingUnitId: 'ward-1' }
      const ward2Visitor = { invitingUnitId: 'ward-2' }

      expect(canViewVisitor(bishop, ward1Visitor)).toBe(true)
      expect(canViewVisitor(bishop, ward2Visitor)).toBe(false)
    })

    it('allows stake presidency to view all visitors including unassigned', () => {
      const stakeLeader: UserContext = { id: 'sp1', accountStatus: 'active', roles: ['stake_presidency'], unitAssignments: [] }
      const unassignedVisitor = { invitingUnitId: null }
      const ward1Visitor = { invitingUnitId: 'ward-1' }

      expect(canViewVisitor(stakeLeader, unassignedVisitor)).toBe(true)
      expect(canViewVisitor(stakeLeader, ward1Visitor)).toBe(true)
    })
  })

  describe('Targeted Manual Attendance Authorization (Migration 6 Verification)', () => {
    interface MemberRecord {
      id: string
      fullName: string
      homeUnitId: string
      isActive: boolean
    }

    function simulateRecordManualAttendance(
      caller: UserContext | null,
      session: MockSession,
      member: MemberRecord,
      existingRecords: AttendanceEntry[],
      isConcurrentRace: boolean = false
    ): { success: boolean; error?: string } {
      // 1. Authentication check
      if (!caller || !caller.id) {
        return { success: false, error: 'Authentication required: Anonymous callers cannot record manual attendance.' }
      }

      // 2. Caller account status
      if (caller.accountStatus !== 'active') {
        return { success: false, error: 'Unauthorized: Caller account is deactivated, pending, or does not exist.' }
      }

      // 3. Session status
      if (session.status !== 'active') {
        return { success: false, error: `Attendance session is ${session.status} and cannot accept check-ins.` }
      }

      // 4. Member active check
      if (!member.isActive) {
        return { success: false, error: 'Member is inactive and cannot be checked in.' }
      }

      // 5. Participating units restriction
      if (session.participatingUnits && session.participatingUnits.length > 0) {
        if (!session.participatingUnits.includes(member.homeUnitId)) {
          return { success: false, error: 'Member home unit is not authorized for this session (participating units restriction).' }
        }
      }

      // 6. Role & Unit Authorization Check
      const isStake = hasStakeWideAccess(caller)
      let isAuthorizedUnitLeader = false

      if (!isStake) {
        // Must have matching role in user_roles AND matching unit assignment with same role
        isAuthorizedUnitLeader = caller.roles.some(r =>
          ['bishop', 'branch_president', 'ysa_leader'].includes(r) &&
          caller.unitAssignments.some(ua => ua.unitId === member.homeUnitId && ua.assignedRole === r)
        )
      }

      if (!isStake && !isAuthorizedUnitLeader) {
        return { success: false, error: 'Unauthorized: Caller does not have an authorized leadership role assigned to the member unit.' }
      }

      // 7. Duplicate check-in pre-check
      if (existingRecords.some(r => r.sessionId === session.id && r.memberId === member.id)) {
        return { success: false, error: `Duplicate check-in: ${member.fullName} is already marked present for this session.` }
      }

      // 8. Concurrent race condition check (simulate unique violation trap)
      if (isConcurrentRace) {
        return { success: false, error: `Duplicate check-in: ${member.fullName} was concurrently marked present for this session.` }
      }

      existingRecords.push({ sessionId: session.id, memberId: member.id, recordedUnitId: member.homeUnitId })
      return { success: true }
    }

    const activeSession: MockSession = {
      id: 'sess-active',
      codeHash: 'h',
      status: 'active',
      codeExpiresAt: Date.now() + 100000,
      maxTerminals: 5,
      participatingUnits: null,
      terminals: []
    }

    const activeMemberWard1: MemberRecord = {
      id: 'mem-1',
      fullName: 'Br. John Obantoko',
      homeUnitId: 'ward-1',
      isActive: true
    }

    it('rejects unauthenticated (anonymous) callers', () => {
      const records: AttendanceEntry[] = []
      const res = simulateRecordManualAttendance(null, activeSession, activeMemberWard1, records)
      expect(res.success).toBe(false)
      expect(res.error).toContain('Authentication required')
    })

    it('rejects deactivated or pending caller accounts', () => {
      const records: AttendanceEntry[] = []
      const deactivatedAdmin: UserContext = {
        id: 'u-deact',
        accountStatus: 'deactivated',
        roles: ['system_admin'],
        unitAssignments: []
      }
      const res = simulateRecordManualAttendance(deactivatedAdmin, activeSession, activeMemberWard1, records)
      expect(res.success).toBe(false)
      expect(res.error).toContain('Caller account is deactivated, pending, or does not exist')
    })

    it('allows stake-wide leaders (stake_presidency & system_admin) stake-wide check-in authority', () => {
      const records: AttendanceEntry[] = []
      const stakePres: UserContext = {
        id: 'u-sp',
        accountStatus: 'active',
        roles: ['stake_presidency'],
        unitAssignments: []
      }
      const sysAdmin: UserContext = {
        id: 'u-admin',
        accountStatus: 'active',
        roles: ['system_admin'],
        unitAssignments: []
      }

      const res1 = simulateRecordManualAttendance(stakePres, activeSession, activeMemberWard1, records)
      expect(res1.success).toBe(true)

      const activeMemberWard2: MemberRecord = {
        id: 'mem-2',
        fullName: 'Sr. Mary Obantoko',
        homeUnitId: 'ward-2',
        isActive: true
      }
      const res2 = simulateRecordManualAttendance(sysAdmin, activeSession, activeMemberWard2, records)
      expect(res2.success).toBe(true)
    })

    it('allows assigned unit leaders with matching role and matching unit assignment', () => {
      const records: AttendanceEntry[] = []
      const bishopWard1: UserContext = {
        id: 'u-bishop-w1',
        accountStatus: 'active',
        roles: ['bishop'],
        unitAssignments: [{ unitId: 'ward-1', assignedRole: 'bishop' }]
      }
      const ysaLeaderWard1: UserContext = {
        id: 'u-ysa-w1',
        accountStatus: 'active',
        roles: ['ysa_leader'],
        unitAssignments: [{ unitId: 'ward-1', assignedRole: 'ysa_leader' }]
      }

      const res1 = simulateRecordManualAttendance(bishopWard1, activeSession, activeMemberWard1, records)
      expect(res1.success).toBe(true)

      const activeMemberWard1B: MemberRecord = {
        id: 'mem-1b',
        fullName: 'Br. David Ward1',
        homeUnitId: 'ward-1',
        isActive: true
      }
      const res2 = simulateRecordManualAttendance(ysaLeaderWard1, activeSession, activeMemberWard1B, records)
      expect(res2.success).toBe(true)
    })

    it('denies unit YSA leader without matching unit assignment from gaining stake-wide access', () => {
      const records: AttendanceEntry[] = []
      // User has ysa_leader role globally, but NO unit assignments
      const unassignedYsaLeader: UserContext = {
        id: 'u-ysa-unassigned',
        accountStatus: 'active',
        roles: ['ysa_leader'],
        unitAssignments: []
      }

      const res = simulateRecordManualAttendance(unassignedYsaLeader, activeSession, activeMemberWard1, records)
      expect(res.success).toBe(false)
      expect(res.error).toContain('Unauthorized: Caller does not have an authorized leadership role assigned to the member unit')
    })

    it('denies cross-unit check-ins by ward leaders for members of other units', () => {
      const records: AttendanceEntry[] = []
      const bishopWard2: UserContext = {
        id: 'u-bishop-w2',
        accountStatus: 'active',
        roles: ['bishop'],
        unitAssignments: [{ unitId: 'ward-2', assignedRole: 'bishop' }]
      }

      const res = simulateRecordManualAttendance(bishopWard2, activeSession, activeMemberWard1, records)
      expect(res.success).toBe(false)
      expect(res.error).toContain('Unauthorized: Caller does not have an authorized leadership role assigned to the member unit')
    })

    it('denies check-in if leader role in user_roles does not match assigned_role in unit_assignments', () => {
      const records: AttendanceEntry[] = []
      // User has 'bishop' in unit assignments, but only 'branch_president' in user_roles (role mismatch)
      const mismatchedLeader: UserContext = {
        id: 'u-mismatch',
        accountStatus: 'active',
        roles: ['branch_president'],
        unitAssignments: [{ unitId: 'ward-1', assignedRole: 'bishop' }]
      }

      const res = simulateRecordManualAttendance(mismatchedLeader, activeSession, activeMemberWard1, records)
      expect(res.success).toBe(false)
      expect(res.error).toContain('Unauthorized: Caller does not have an authorized leadership role assigned to the member unit')
    })

    it('rejects check-in for inactive members', () => {
      const records: AttendanceEntry[] = []
      const stakePres: UserContext = {
        id: 'u-sp',
        accountStatus: 'active',
        roles: ['stake_presidency'],
        unitAssignments: []
      }
      const inactiveMember: MemberRecord = {
        id: 'mem-inact',
        fullName: 'Inactive Member',
        homeUnitId: 'ward-1',
        isActive: false
      }

      const res = simulateRecordManualAttendance(stakePres, activeSession, inactiveMember, records)
      expect(res.success).toBe(false)
      expect(res.error).toContain('Member is inactive and cannot be checked in')
    })

    it('rejects check-ins when session status is closed or draft', () => {
      const records: AttendanceEntry[] = []
      const stakePres: UserContext = {
        id: 'u-sp',
        accountStatus: 'active',
        roles: ['stake_presidency'],
        unitAssignments: []
      }
      const closedSession: MockSession = { ...activeSession, status: 'closed' }
      const draftSession: MockSession = { ...activeSession, status: 'draft' }

      const resClosed = simulateRecordManualAttendance(stakePres, closedSession, activeMemberWard1, records)
      expect(resClosed.success).toBe(false)
      expect(resClosed.error).toContain('Attendance session is closed and cannot accept check-ins')

      const resDraft = simulateRecordManualAttendance(stakePres, draftSession, activeMemberWard1, records)
      expect(resDraft.success).toBe(false)
      expect(resDraft.error).toContain('Attendance session is draft and cannot accept check-ins')
    })

    it('enforces session participating_units restriction', () => {
      const records: AttendanceEntry[] = []
      const stakePres: UserContext = {
        id: 'u-sp',
        accountStatus: 'active',
        roles: ['stake_presidency'],
        unitAssignments: []
      }
      // Restricted session: only allows ward-2 and ward-3
      const restrictedSession: MockSession = {
        ...activeSession,
        participatingUnits: ['ward-2', 'ward-3']
      }

      // Member belongs to ward-1 (not in participating_units)
      const res = simulateRecordManualAttendance(stakePres, restrictedSession, activeMemberWard1, records)
      expect(res.success).toBe(false)
      expect(res.error).toContain('Member home unit is not authorized for this session (participating units restriction)')

      // Member belongs to ward-2 (in participating_units)
      const allowedMember: MemberRecord = {
        id: 'mem-w2',
        fullName: 'Br. Peter Ward2',
        homeUnitId: 'ward-2',
        isActive: true
      }
      const resAllowed = simulateRecordManualAttendance(stakePres, restrictedSession, allowedMember, records)
      expect(resAllowed.success).toBe(true)
    })

    it('rejects duplicate submissions and traps concurrent unique_violation races', () => {
      const records: AttendanceEntry[] = []
      const stakePres: UserContext = {
        id: 'u-sp',
        accountStatus: 'active',
        roles: ['stake_presidency'],
        unitAssignments: []
      }

      // First check-in succeeds
      const first = simulateRecordManualAttendance(stakePres, activeSession, activeMemberWard1, records)
      expect(first.success).toBe(true)

      // Sequential duplicate submission
      const duplicate = simulateRecordManualAttendance(stakePres, activeSession, activeMemberWard1, records)
      expect(duplicate.success).toBe(false)
      expect(duplicate.error).toContain('Duplicate check-in: Br. John Obantoko is already marked present')

      // Concurrent race condition trap
      const freshMember: MemberRecord = { id: 'mem-race', fullName: 'Race Member', homeUnitId: 'ward-1', isActive: true }
      const concurrentRace = simulateRecordManualAttendance(stakePres, activeSession, freshMember, records, true)
      expect(concurrentRace.success).toBe(false)
      expect(concurrentRace.error).toContain('was concurrently marked present for this session')
    })

    it('strictly denies stake_clerk, ward_clerk, and branch_clerk from manual attendance check-ins', () => {
      const records: AttendanceEntry[] = []
      const stakeClerk: UserContext = {
        id: 'u-sc',
        accountStatus: 'active',
        roles: ['stake_clerk'],
        unitAssignments: []
      }
      const wardClerk: UserContext = {
        id: 'u-wc',
        accountStatus: 'active',
        roles: ['ward_clerk'],
        unitAssignments: [{ unitId: 'ward-1', assignedRole: 'ward_clerk' }]
      }
      const branchClerk: UserContext = {
        id: 'u-bc',
        accountStatus: 'active',
        roles: ['branch_clerk'],
        unitAssignments: [{ unitId: 'ward-1', assignedRole: 'branch_clerk' }]
      }

      expect(simulateRecordManualAttendance(stakeClerk, activeSession, activeMemberWard1, records).success).toBe(false)
      expect(simulateRecordManualAttendance(wardClerk, activeSession, activeMemberWard1, records).success).toBe(false)
      expect(simulateRecordManualAttendance(branchClerk, activeSession, activeMemberWard1, records).success).toBe(false)
    })
  })

  describe('Clerk Roles Least-Privilege & Scoped Reporting (Migration 8 Verification)', () => {
    const eightUnitIds = [
      'unit-abiola-way',
      'unit-alabata',
      'unit-apena',
      'unit-apete',
      'unit-camp',
      'unit-kugba',
      'unit-obantoko',
      'unit-odeda'
    ]

    function makeAssignment(unitId: string, assignedRole: UnitAssignedRole): DbUserUnitAssignment {
      return {
        id: `ua-${unitId}-${assignedRole}`,
        userId: 'usr-test',
        unitId,
        assignedRole,
        createdAt: '2026-10-18T00:00:00Z'
      }
    }

    // Mirrors PostgreSQL RLS + deriveLeadershipAccess for report visibility and mutations
    function canReadUnitReport(access: ReturnType<typeof deriveLeadershipAccess>, targetUnitId: string): boolean {
      if (access.reportUnitFilter === null) return true
      return access.reportUnitFilter.includes(targetUnitId)
    }

    function filterExportableUnitStats<T extends { unitId: string }>(
      allStats: T[],
      access: ReturnType<typeof deriveLeadershipAccess>
    ): T[] {
      if (access.reportUnitFilter === null) return allStats
      return allStats.filter(s => access.reportUnitFilter!.includes(s.unitId))
    }

    it('grants stake_clerk stake-wide read and export access across all 8 units while denying all write and privileged actions', () => {
      const stakeClerkAccess = deriveLeadershipAccess(['stake_clerk'], [])

      expect(stakeClerkAccess.isStakeClerk).toBe(true)
      expect(stakeClerkAccess.hasStakeWideReadAccess).toBe(true)
      expect(stakeClerkAccess.isClerkRoleOnly).toBe(true)
      expect(stakeClerkAccess.reportUnitFilter).toBeNull()

      // Can read and export across all 8 units
      for (const unitId of eightUnitIds) {
        expect(canReadUnitReport(stakeClerkAccess, unitId)).toBe(true)
      }
      const allUnitRows = eightUnitIds.map(unitId => ({ unitId, totalAttended: 10 }))
      expect(filterExportableUnitStats(allUnitRows, stakeClerkAccess)).toHaveLength(8)

      // Strictly denied all writes, manual check-ins, session management, user governance, and audit logs
      expect(stakeClerkAccess.isSystemAdmin).toBe(false)
      expect(stakeClerkAccess.isStakeLeader).toBe(false) // Blocks session reopen, audit logs, and user directory
      expect(stakeClerkAccess.canManageActivities).toBe(false)
      expect(stakeClerkAccess.canManageMembers).toBe(false)
      expect(stakeClerkAccess.canRecordManualAttendance).toBe(false)
      expect(stakeClerkAccess.manageableUnitIds).toEqual([])
    })

    it('grants ward_clerk read and export access ONLY to their assigned ward and blocks cross-unit data and all writes', () => {
      const wardClerkAccess = deriveLeadershipAccess(
        ['ward_clerk'],
        [makeAssignment('unit-abiola-way', 'ward_clerk')]
      )

      expect(wardClerkAccess.isClerkRoleOnly).toBe(true)
      expect(wardClerkAccess.hasStakeWideReadAccess).toBe(false)
      expect(wardClerkAccess.assignedUnitIds).toEqual(['unit-abiola-way'])
      expect(wardClerkAccess.reportUnitFilter).toEqual(['unit-abiola-way'])

      // Permitted for assigned ward only
      expect(canReadUnitReport(wardClerkAccess, 'unit-abiola-way')).toBe(true)
      for (const otherUnit of eightUnitIds.filter(u => u !== 'unit-abiola-way')) {
        expect(canReadUnitReport(wardClerkAccess, otherUnit)).toBe(false)
      }

      // Report export strictly filtered to assigned ward (cannot export stake-wide data)
      const allUnitRows = eightUnitIds.map(unitId => ({ unitId, totalAttended: 5 }))
      const exported = filterExportableUnitStats(allUnitRows, wardClerkAccess)
      expect(exported).toEqual([{ unitId: 'unit-abiola-way', totalAttended: 5 }])

      // Strictly denied all write or privileged actions
      expect(wardClerkAccess.isSystemAdmin).toBe(false)
      expect(wardClerkAccess.isStakeLeader).toBe(false)
      expect(wardClerkAccess.canManageActivities).toBe(false)
      expect(wardClerkAccess.canManageMembers).toBe(false)
      expect(wardClerkAccess.canRecordManualAttendance).toBe(false)
      expect(wardClerkAccess.manageableUnitIds).toEqual([])
    })

    it('grants branch_clerk read and export access ONLY to their assigned branch and blocks cross-unit data and all writes', () => {
      const branchClerkAccess = deriveLeadershipAccess(
        ['branch_clerk'],
        [makeAssignment('unit-alabata', 'branch_clerk')]
      )

      expect(branchClerkAccess.isClerkRoleOnly).toBe(true)
      expect(branchClerkAccess.hasStakeWideReadAccess).toBe(false)
      expect(branchClerkAccess.assignedUnitIds).toEqual(['unit-alabata'])
      expect(branchClerkAccess.reportUnitFilter).toEqual(['unit-alabata'])

      // Permitted for assigned branch only
      expect(canReadUnitReport(branchClerkAccess, 'unit-alabata')).toBe(true)
      for (const otherUnit of eightUnitIds.filter(u => u !== 'unit-alabata')) {
        expect(canReadUnitReport(branchClerkAccess, otherUnit)).toBe(false)
      }

      // Report export strictly filtered to assigned branch
      const allUnitRows = eightUnitIds.map(unitId => ({ unitId, totalAttended: 7 }))
      const exported = filterExportableUnitStats(allUnitRows, branchClerkAccess)
      expect(exported).toEqual([{ unitId: 'unit-alabata', totalAttended: 7 }])

      // Strictly denied all write or privileged actions
      expect(branchClerkAccess.isSystemAdmin).toBe(false)
      expect(branchClerkAccess.isStakeLeader).toBe(false)
      expect(branchClerkAccess.canManageActivities).toBe(false)
      expect(branchClerkAccess.canManageMembers).toBe(false)
      expect(branchClerkAccess.canRecordManualAttendance).toBe(false)
      expect(branchClerkAccess.manageableUnitIds).toEqual([])
    })

    it('verifies Stake YSA Representatives (Option A: ysa_leader + all 8 units) have full operational access across all 8 units without stake_presidency privileges', () => {
      const allEightAssignments = eightUnitIds.map(unitId => makeAssignment(unitId, 'ysa_leader'))
      const stakeYsaRepAccess = deriveLeadershipAccess(['ysa_leader'], allEightAssignments)

      // Operational access across all 8 units
      expect(stakeYsaRepAccess.canManageActivities).toBe(true)
      expect(stakeYsaRepAccess.canManageMembers).toBe(true)
      expect(stakeYsaRepAccess.canRecordManualAttendance).toBe(true)
      expect(stakeYsaRepAccess.assignedUnitIds).toHaveLength(8)
      expect(stakeYsaRepAccess.manageableUnitIds).toHaveLength(8)
      expect(stakeYsaRepAccess.reportUnitFilter).toEqual(eightUnitIds)

      for (const unitId of eightUnitIds) {
        expect(canReadUnitReport(stakeYsaRepAccess, unitId)).toBe(true)
      }

      // Strictly denied stake_presidency and system_admin privileges (cannot reopen closed sessions, view audit logs, or manage users/units)
      expect(stakeYsaRepAccess.isSystemAdmin).toBe(false)
      expect(stakeYsaRepAccess.isStakeLeader).toBe(false)
    })
  })
})

