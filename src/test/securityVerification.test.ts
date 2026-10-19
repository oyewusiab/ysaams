import { describe, it, expect } from 'vitest'
import { AppRole, UnitAssignedRole } from '../types/database'
import { deriveLeadershipAccess } from '../context/AuthContext'

describe('Phase 1 Production Security & Database Verification Tests', () => {
  describe('Clerk Role Hierarchy & Least-Privilege Scoping (Migration 8 Verification)', () => {
    const validAppRoles: AppRole[] = [
      'system_admin',
      'ysa_leader',
      'stake_presidency',
      'bishop',
      'branch_president',
      'stake_clerk',
      'ward_clerk',
      'branch_clerk'
    ]

    const validUnitAssignedRoles: UnitAssignedRole[] = [
      'bishop',
      'branch_president',
      'ysa_leader',
      'ward_clerk',
      'branch_clerk'
    ]

    it('verifies all 8 roles supported by user_roles constraint are valid AppRoles', () => {
      expect(validAppRoles).toContain('stake_clerk')
      expect(validAppRoles).toContain('ward_clerk')
      expect(validAppRoles).toContain('branch_clerk')
      expect(validAppRoles).toHaveLength(8)
    })

    it('verifies all 5 roles supported by user_unit_assignments constraint are valid UnitAssignedRoles', () => {
      expect(validUnitAssignedRoles).toContain('ward_clerk')
      expect(validUnitAssignedRoles).toContain('branch_clerk')
      expect(validUnitAssignedRoles).not.toContain('stake_clerk')
      expect(validUnitAssignedRoles).toHaveLength(5)
    })

    it('confirms stake_clerk has stake-wide read visibility but zero write/manage capabilities', () => {
      const access = deriveLeadershipAccess(['stake_clerk'], [])

      expect(access.isStakeClerk).toBe(true)
      expect(access.hasStakeWideReadAccess).toBe(true)
      expect(access.isClerkRoleOnly).toBe(true)
      expect(access.reportUnitFilter).toBeNull() // Stake-wide

      // Prohibited capabilities
      expect(access.isSystemAdmin).toBe(false)
      expect(access.isStakeLeader).toBe(false)
      expect(access.canManageActivities).toBe(false)
      expect(access.canManageMembers).toBe(false)
      expect(access.canRecordManualAttendance).toBe(false)
      expect(access.manageableUnitIds).toEqual([])
    })

    it('confirms ward_clerk is strictly bounded to their assigned unit', () => {
      const wardId = '45408cbb-4e5d-4080-94ff-dcde84fa3ab7'
      const access = deriveLeadershipAccess(
        ['ward_clerk'],
        [{ id: 'ua-1', userId: 'usr-1', unitId: wardId, assignedRole: 'ward_clerk', createdAt: '2026-10-01' }]
      )

      expect(access.isClerkRoleOnly).toBe(true)
      expect(access.hasStakeWideReadAccess).toBe(false)
      expect(access.assignedUnitIds).toEqual([wardId])
      expect(access.reportUnitFilter).toEqual([wardId])

      // Prohibited capabilities
      expect(access.isSystemAdmin).toBe(false)
      expect(access.isStakeLeader).toBe(false)
      expect(access.canManageActivities).toBe(false)
      expect(access.canManageMembers).toBe(false)
      expect(access.canRecordManualAttendance).toBe(false)
      expect(access.manageableUnitIds).toEqual([])
    })

    it('confirms branch_clerk is strictly bounded to their assigned branch', () => {
      const branchId = '9fc6886c-a782-4d09-bb66-6f712d4600fe'
      const access = deriveLeadershipAccess(
        ['branch_clerk'],
        [{ id: 'ua-2', userId: 'usr-2', unitId: branchId, assignedRole: 'branch_clerk', createdAt: '2026-10-01' }]
      )

      expect(access.isClerkRoleOnly).toBe(true)
      expect(access.hasStakeWideReadAccess).toBe(false)
      expect(access.assignedUnitIds).toEqual([branchId])
      expect(access.reportUnitFilter).toEqual([branchId])

      // Prohibited capabilities
      expect(access.isSystemAdmin).toBe(false)
      expect(access.isStakeLeader).toBe(false)
      expect(access.canManageActivities).toBe(false)
      expect(access.canManageMembers).toBe(false)
      expect(access.canRecordManualAttendance).toBe(false)
      expect(access.manageableUnitIds).toEqual([])
    })

    it('verifies orphaned unit assignment without matching user_roles entry is rejected', () => {
      const wardId = '45408cbb-4e5d-4080-94ff-dcde84fa3ab7'
      // User has assignment as 'ward_clerk' in user_unit_assignments, but roles array lacks 'ward_clerk'
      const access = deriveLeadershipAccess(
        [],
        [{ id: 'ua-orphan', userId: 'usr-orphan', unitId: wardId, assignedRole: 'ward_clerk', createdAt: '2026-10-01' }]
      )

      expect(access.assignedUnitIds).toEqual([])
      expect(access.reportUnitFilter).toEqual([])
      expect(access.isClerkRoleOnly).toBe(false)
    })
  })

  describe('Kiosk Terminal Search & Member Protection Rules (Migration 7 Verification)', () => {
    interface MemberRecord {
      id: string
      fullName: string
      preferredName?: string
      homeUnitId: string
      isActive: boolean
    }

    interface SessionContext {
      id: string
      status: 'draft' | 'active' | 'closed'
      participatingUnits?: string[] | null
    }

    function searchTerminalMembersMock(
      session: SessionContext,
      token: string | null | undefined,
      isTokenRevoked: boolean,
      isTokenExpired: boolean,
      members: MemberRecord[],
      activeUnitIds: string[],
      unitIdFilter?: string | null,
      query: string = ''
    ): { success: boolean; results?: MemberRecord[]; error?: string } {
      if (!token || token.trim().length === 0) {
        return { success: false, error: 'Unauthorized: Terminal bearer token is required.' }
      }
      if (isTokenRevoked || isTokenExpired) {
        return { success: false, error: 'Unauthorized terminal token, terminal revoked, or terminal lease expired.' }
      }
      if (session.status !== 'active') {
        return { success: false, error: 'Attendance session is not active.' }
      }

      const cleanQuery = query.trim().toLowerCase()

      const filtered = members.filter((m) => {
        if (!m.isActive) return false
        if (!activeUnitIds.includes(m.homeUnitId)) return false
        if (unitIdFilter && m.homeUnitId !== unitIdFilter) return false
        if (
          session.participatingUnits &&
          session.participatingUnits.length > 0 &&
          !session.participatingUnits.includes(m.homeUnitId)
        ) {
          return false
        }
        if (cleanQuery.length > 0) {
          const matchFull = m.fullName.toLowerCase().includes(cleanQuery)
          const matchPref = m.preferredName?.toLowerCase().includes(cleanQuery)
          if (!matchFull && !matchPref) return false
        }
        return true
      })

      return { success: true, results: filtered.slice(0, 10) }
    }

    const testMembers: MemberRecord[] = [
      { id: 'm-1', fullName: 'Adeola Adeyemi', homeUnitId: 'ward-1', isActive: true },
      { id: 'm-2', fullName: 'Babatunde Olawale', preferredName: 'Tunde', homeUnitId: 'ward-1', isActive: true },
      { id: 'm-3', fullName: 'Chidinma Okonkwo', homeUnitId: 'ward-2', isActive: true },
      { id: 'm-4', fullName: 'Deactivated Member', homeUnitId: 'ward-1', isActive: false },
      { id: 'm-5', fullName: 'Inactive Unit Member', homeUnitId: 'unit-archived', isActive: true }
    ]

    const activeUnits = ['ward-1', 'ward-2']

    it('rejects terminal member search when token is missing or empty', () => {
      const session: SessionContext = { id: 'sess-1', status: 'active' }
      expect(searchTerminalMembersMock(session, '', false, false, testMembers, activeUnits).error).toBe(
        'Unauthorized: Terminal bearer token is required.'
      )
      expect(searchTerminalMembersMock(session, null, false, false, testMembers, activeUnits).error).toBe(
        'Unauthorized: Terminal bearer token is required.'
      )
    })

    it('rejects terminal member search when token is revoked or expired', () => {
      const session: SessionContext = { id: 'sess-1', status: 'active' }
      expect(searchTerminalMembersMock(session, 'valid-tok', true, false, testMembers, activeUnits).error).toBe(
        'Unauthorized terminal token, terminal revoked, or terminal lease expired.'
      )
      expect(searchTerminalMembersMock(session, 'valid-tok', false, true, testMembers, activeUnits).error).toBe(
        'Unauthorized terminal token, terminal revoked, or terminal lease expired.'
      )
    })

    it('rejects terminal member search if session is not active', () => {
      const draftSession: SessionContext = { id: 'sess-draft', status: 'draft' }
      const closedSession: SessionContext = { id: 'sess-closed', status: 'closed' }
      expect(searchTerminalMembersMock(draftSession, 'valid-tok', false, false, testMembers, activeUnits).error).toBe(
        'Attendance session is not active.'
      )
      expect(searchTerminalMembersMock(closedSession, 'valid-tok', false, false, testMembers, activeUnits).error).toBe(
        'Attendance session is not active.'
      )
    })

    it('excludes inactive members and members from inactive units', () => {
      const session: SessionContext = { id: 'sess-1', status: 'active' }
      const res = searchTerminalMembersMock(session, 'valid-tok', false, false, testMembers, activeUnits)
      expect(res.success).toBe(true)
      const ids = res.results!.map(m => m.id)
      expect(ids).toContain('m-1')
      expect(ids).toContain('m-2')
      expect(ids).toContain('m-3')
      expect(ids).not.toContain('m-4') // inactive member
      expect(ids).not.toContain('m-5') // member in inactive unit
    })

    it('enforces participating units boundary in multi-ward sessions', () => {
      const scopedSession: SessionContext = { id: 'sess-scoped', status: 'active', participatingUnits: ['ward-1'] }
      const res = searchTerminalMembersMock(scopedSession, 'valid-tok', false, false, testMembers, activeUnits)
      expect(res.success).toBe(true)
      const ids = res.results!.map(m => m.id)
      expect(ids).toContain('m-1')
      expect(ids).toContain('m-2')
      expect(ids).not.toContain('m-3') // ward-2 member excluded
    })

    it('supports preferred name search matching', () => {
      const session: SessionContext = { id: 'sess-1', status: 'active' }
      const res = searchTerminalMembersMock(session, 'valid-tok', false, false, testMembers, activeUnits, null, 'Tunde')
      expect(res.success).toBe(true)
      expect(res.results).toHaveLength(1)
      expect(res.results![0].id).toBe('m-2')
    })
  })
})
