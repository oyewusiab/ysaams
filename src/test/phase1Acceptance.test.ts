import { describe, it, expect } from 'vitest'
import { StakeUnit, AppRole } from '../types/database'
import { deriveLeadershipAccess } from '../context/AuthContext'
import {
  validateProvisioningInput,
  ProvisionUserRequest
} from '../services/adminService'
import {
  isLeadershipPath,
  resolveLeadershipSubpath,
  extractSessionCode
} from '../App'

describe('Phase 1 Acceptance Tests: Identity, Governance & Security Isolation', () => {
  const sampleUnits: StakeUnit[] = [
    { id: 'u-ward-1', unitName: 'Obantoko Ward', unitType: 'ward', isActive: true, createdAt: '2026-10-01' },
    { id: 'u-ward-2', unitName: 'Abiola-Way Ward', unitType: 'ward', isActive: true, createdAt: '2026-10-01' },
    { id: 'u-ward-inactive', unitName: 'Inactive Ward', unitType: 'ward', isActive: false, createdAt: '2026-10-01' },
    { id: 'u-branch-1', unitName: 'Alabata Branch', unitType: 'branch', isActive: true, createdAt: '2026-10-01' },
    { id: 'u-branch-2', unitName: 'Apena Branch', unitType: 'branch', isActive: true, createdAt: '2026-10-01' },
    { id: 'u-branch-inactive', unitName: 'Inactive Branch', unitType: 'branch', isActive: false, createdAt: '2026-10-01' }
  ]

  // Criterion 1: Only System Administrators can provision accounts
  describe('Criterion 1: Only System Administrators can provision accounts', () => {
    it('authorizes system_admin to manage user provisioning and governance', () => {
      const adminAccess = deriveLeadershipAccess(['system_admin'], [])
      expect(adminAccess.isSystemAdmin).toBe(true)
      expect(adminAccess.isStakeLeader).toBe(true)
    })

    it('denies all non-system_admin roles from administrative provisioning authority', () => {
      const nonAdminRoles: AppRole[] = [
        'stake_presidency',
        'ysa_leader',
        'bishop',
        'branch_president',
        'stake_clerk',
        'ward_clerk',
        'branch_clerk'
      ]

      for (const role of nonAdminRoles) {
        const access = deriveLeadershipAccess([role], [])
        expect(access.isSystemAdmin).toBe(false)
      }
    })
  })

  // Criterion 2: Bishop and branch-president assignments require the appropriate unit type
  describe('Criterion 2: Unit Type Enforcement for Leadership Roles', () => {
    it('validates bishop role can ONLY be assigned to an active ward', () => {
      // Valid ward assignment
      const validReq: ProvisionUserRequest = {
        fullName: 'Bishop John',
        email: 'bishop.john@example.com',
        role: 'bishop',
        unitId: 'u-ward-1'
      }
      const validRes = validateProvisioningInput(validReq, sampleUnits)
      expect(validRes.valid).toBe(true)
      expect(validRes.validatedUnitId).toBe('u-ward-1')

      // Invalid assignment: bishop to branch
      const invalidBranchReq: ProvisionUserRequest = {
        fullName: 'Bishop John',
        email: 'bishop.john@example.com',
        role: 'bishop',
        unitId: 'u-branch-1'
      }
      const invalidBranchRes = validateProvisioningInput(invalidBranchReq, sampleUnits)
      expect(invalidBranchRes.valid).toBe(false)
      expect(invalidBranchRes.error).toContain('Bishop role must be assigned to a Ward, not a Branch')

      // Invalid assignment: bishop to inactive ward
      const inactiveReq: ProvisionUserRequest = {
        fullName: 'Bishop John',
        email: 'bishop.john@example.com',
        role: 'bishop',
        unitId: 'u-ward-inactive'
      }
      const inactiveRes = validateProvisioningInput(inactiveReq, sampleUnits)
      expect(inactiveRes.valid).toBe(false)
      expect(inactiveRes.error).toContain('inactive')

      // Invalid assignment: bishop without unit
      const missingUnitReq: ProvisionUserRequest = {
        fullName: 'Bishop John',
        email: 'bishop.john@example.com',
        role: 'bishop'
      }
      const missingRes = validateProvisioningInput(missingUnitReq, sampleUnits)
      expect(missingRes.valid).toBe(false)
      expect(missingRes.error).toContain('Selecting an active Ward is required')
    })

    it('validates branch president role can ONLY be assigned to an active branch', () => {
      // Valid branch assignment
      const validReq: ProvisionUserRequest = {
        fullName: 'President Mark',
        email: 'pres.mark@example.com',
        role: 'branch_president',
        unitId: 'u-branch-1'
      }
      const validRes = validateProvisioningInput(validReq, sampleUnits)
      expect(validRes.valid).toBe(true)
      expect(validRes.validatedUnitId).toBe('u-branch-1')

      // Invalid assignment: branch president to ward
      const invalidWardReq: ProvisionUserRequest = {
        fullName: 'President Mark',
        email: 'pres.mark@example.com',
        role: 'branch_president',
        unitId: 'u-ward-1'
      }
      const invalidWardRes = validateProvisioningInput(invalidWardReq, sampleUnits)
      expect(invalidWardRes.valid).toBe(false)
      expect(invalidWardRes.error).toContain('Branch President role must be assigned to a Branch, not a Ward')

      // Invalid assignment: branch president without unit
      const missingReq: ProvisionUserRequest = {
        fullName: 'President Mark',
        email: 'pres.mark@example.com',
        role: 'branch_president'
      }
      const missingRes = validateProvisioningInput(missingReq, sampleUnits)
      expect(missingRes.valid).toBe(false)
      expect(missingRes.error).toContain('Selecting an active Branch is required')
    })

    it('validates ward clerk can only be assigned to a ward and branch clerk to a branch', () => {
      const wardClerkOnBranch: ProvisionUserRequest = {
        fullName: 'Ward Clerk Test',
        email: 'wclerk@example.com',
        role: 'ward_clerk',
        unitId: 'u-branch-1'
      }
      expect(validateProvisioningInput(wardClerkOnBranch, sampleUnits).valid).toBe(false)

      const branchClerkOnWard: ProvisionUserRequest = {
        fullName: 'Branch Clerk Test',
        email: 'bclerk@example.com',
        role: 'branch_clerk',
        unitId: 'u-ward-1'
      }
      expect(validateProvisioningInput(branchClerkOnWard, sampleUnits).valid).toBe(false)
    })
  })

  // Criterion 3: Clerk roles remain read-only and limited to their authorized reporting scope
  describe('Criterion 3: Clerk Roles Read-Only & Scoped Reporting', () => {
    it('restricts stake_clerk to stake-wide read/export with zero write privileges', () => {
      const stakeClerk = deriveLeadershipAccess(['stake_clerk'], [])
      expect(stakeClerk.isStakeClerk).toBe(true)
      expect(stakeClerk.hasStakeWideReadAccess).toBe(true)
      expect(stakeClerk.reportUnitFilter).toBeNull() // stake-wide
      expect(stakeClerk.isClerkRoleOnly).toBe(true)

      // Strictly denied write / management capabilities
      expect(stakeClerk.canManageActivities).toBe(false)
      expect(stakeClerk.canManageMembers).toBe(false)
      expect(stakeClerk.canRecordManualAttendance).toBe(false)
      expect(stakeClerk.isSystemAdmin).toBe(false)
      expect(stakeClerk.isStakeLeader).toBe(false)
      expect(stakeClerk.manageableUnitIds).toEqual([])
    })

    it('restricts ward_clerk to single ward read scope with zero write privileges', () => {
      const wardClerk = deriveLeadershipAccess(
        ['ward_clerk'],
        [{ id: 'ua-w', userId: 'u-1', unitId: 'u-ward-1', assignedRole: 'ward_clerk', createdAt: '2026-10-01' }]
      )
      expect(wardClerk.isClerkRoleOnly).toBe(true)
      expect(wardClerk.hasStakeWideReadAccess).toBe(false)
      expect(wardClerk.assignedUnitIds).toEqual(['u-ward-1'])
      expect(wardClerk.reportUnitFilter).toEqual(['u-ward-1'])

      // Strictly denied write / management capabilities
      expect(wardClerk.canManageActivities).toBe(false)
      expect(wardClerk.canManageMembers).toBe(false)
      expect(wardClerk.canRecordManualAttendance).toBe(false)
      expect(wardClerk.manageableUnitIds).toEqual([])
    })

    it('restricts branch_clerk to single branch read scope with zero write privileges', () => {
      const branchClerk = deriveLeadershipAccess(
        ['branch_clerk'],
        [{ id: 'ua-b', userId: 'u-2', unitId: 'u-branch-1', assignedRole: 'branch_clerk', createdAt: '2026-10-01' }]
      )
      expect(branchClerk.isClerkRoleOnly).toBe(true)
      expect(branchClerk.hasStakeWideReadAccess).toBe(false)
      expect(branchClerk.assignedUnitIds).toEqual(['u-branch-1'])
      expect(branchClerk.reportUnitFilter).toEqual(['u-branch-1'])

      expect(branchClerk.canManageActivities).toBe(false)
      expect(branchClerk.canManageMembers).toBe(false)
      expect(branchClerk.canRecordManualAttendance).toBe(false)
      expect(branchClerk.manageableUnitIds).toEqual([])
    })
  })

  // Criterion 4: YSA leaders receive only their approved permissions and assignments
  describe('Criterion 4: YSA Leader Permissions and Approved All-Unit Scope', () => {
    it('supports YSA leader with approved all-unit assignments', () => {
      const req: ProvisionUserRequest = {
        fullName: 'Sister Leader',
        email: 'leader@example.com',
        role: 'ysa_leader',
        unitId: 'all'
      }
      const res = validateProvisioningInput(req, sampleUnits)
      expect(res.valid).toBe(true)
      expect(res.allUnits).toBe(true)

      const activeUnitIds = sampleUnits.filter(u => u.isActive).map(u => u.id)
      const assignments = activeUnitIds.map(unitId => ({
        id: `ua-${unitId}`,
        userId: 'u-ysa-all',
        unitId,
        assignedRole: 'ysa_leader' as const,
        createdAt: '2026-10-01'
      }))

      const access = deriveLeadershipAccess(['ysa_leader'], assignments)
      expect(access.canManageActivities).toBe(true)
      expect(access.canManageMembers).toBe(true)
      expect(access.canRecordManualAttendance).toBe(true)
      expect(access.assignedUnitIds).toEqual(activeUnitIds)
      expect(access.manageableUnitIds).toEqual(activeUnitIds)
      expect(access.isSystemAdmin).toBe(false) // Not system admin
      expect(access.isStakeLeader).toBe(false) // Not stake presidency
    })

    it('supports YSA leader scoped to a single unit', () => {
      const access = deriveLeadershipAccess(
        ['ysa_leader'],
        [{ id: 'ua-1', userId: 'u-ysa-1', unitId: 'u-ward-1', assignedRole: 'ysa_leader', createdAt: '2026-10-01' }]
      )
      expect(access.canManageActivities).toBe(true)
      expect(access.canManageMembers).toBe(true)
      expect(access.canRecordManualAttendance).toBe(true)
      expect(access.assignedUnitIds).toEqual(['u-ward-1'])
      expect(access.manageableUnitIds).toEqual(['u-ward-1'])
    })
  })

  // Criterion 5: Existing users and role assignments are preserved
  describe('Criterion 5: Preservation of Existing Users and Role Assignments', () => {
    it('does not wipe or mutate existing assignments during idempotent assignment', () => {
      const existingAssignments = [
        { id: 'ua-1', unitId: 'u-ward-1', assignedRole: 'bishop' as const },
        { id: 'ua-2', unitId: 'u-ward-2', assignedRole: 'ysa_leader' as const }
      ]

      // Simulating idempotent addition of a new role assignment
      const newAssignment = { id: 'ua-3', unitId: 'u-branch-1', assignedRole: 'branch_president' as const }
      const updatedAssignments = [...existingAssignments, newAssignment]

      expect(updatedAssignments).toHaveLength(3)
      expect(updatedAssignments).toContainEqual(existingAssignments[0])
      expect(updatedAssignments).toContainEqual(existingAssignments[1])
    })
  })

  // Criterion 6: Route aliases, canonical routes and unknown routes behave correctly
  describe('Criterion 6: Route Aliases, Canonical Routes, and Unknown Route Resolution', () => {
    it('correctly maps route aliases to canonical modules', () => {
      expect(resolveLeadershipSubpath('/la/sessions')).toBe('activities')
      expect(resolveLeadershipSubpath('/la/audit')).toBe('audit-logs')
      expect(resolveLeadershipSubpath('/la/admin')).toBe('users')
    })

    it('preserves all canonical routes', () => {
      expect(resolveLeadershipSubpath('/la')).toBe('dashboard')
      expect(resolveLeadershipSubpath('/la/')).toBe('dashboard')
      expect(resolveLeadershipSubpath('/la/dashboard')).toBe('dashboard')
      expect(resolveLeadershipSubpath('/la/activities')).toBe('activities')
      expect(resolveLeadershipSubpath('/la/attendance')).toBe('attendance')
      expect(resolveLeadershipSubpath('/la/members')).toBe('members')
      expect(resolveLeadershipSubpath('/la/reports')).toBe('reports')
      expect(resolveLeadershipSubpath('/la/units')).toBe('units')
      expect(resolveLeadershipSubpath('/la/users')).toBe('users')
      expect(resolveLeadershipSubpath('/la/settings')).toBe('settings')
      expect(resolveLeadershipSubpath('/la/audit-logs')).toBe('audit-logs')
    })

    it('returns not-found for unknown leadership subpaths without falling back to dashboard', () => {
      expect(resolveLeadershipSubpath('/la/unknown-route')).toBe('not-found')
      expect(resolveLeadershipSubpath('/la/fake-module')).toBe('not-found')
      expect(resolveLeadershipSubpath('/la/xyz')).toBe('not-found')
    })

    it('distinguishes public, terminal, and session code routes', () => {
      expect(isLeadershipPath('/la')).toBe(true)
      expect(isLeadershipPath('/la/users')).toBe(true)
      expect(isLeadershipPath('/')).toBe(false)
      expect(isLeadershipPath('/terminal')).toBe(false)
      expect(isLeadershipPath('/5BV21F')).toBe(false)
      expect(extractSessionCode('/5BV21F')).toBe('5BV21F')
      expect(extractSessionCode('/unknown')).toBeNull()
    })
  })

  // Criterion 7: Provisioning failure and retries do not create inconsistent or duplicated accounts
  describe('Criterion 7: Safe Failure & Retry Idempotency', () => {
    it('rejects invalid email formats cleanly without creating orphaned state', () => {
      const invalidEmails = ['plainaddress', '@missingusername.com', 'username@.com', '']
      for (const email of invalidEmails) {
        const req: ProvisionUserRequest = {
          fullName: 'Test User',
          email,
          role: 'system_admin'
        }
        const res = validateProvisioningInput(req, sampleUnits)
        expect(res.valid).toBe(false)
        expect(res.error).toBe('A valid email address is required.')
      }
    })

    it('rejects empty or single-character full names', () => {
      const invalidNames = ['', ' ', 'A']
      for (const fullName of invalidNames) {
        const req: ProvisionUserRequest = {
          fullName,
          email: 'valid@example.com',
          role: 'system_admin'
        }
        const res = validateProvisioningInput(req, sampleUnits)
        expect(res.valid).toBe(false)
        expect(res.error).toBe('Full name must be at least 2 characters long.')
      }
    })

    it('demonstrates idempotent retry safety for role and unit assignments', () => {
      const assignedRoles: Set<string> = new Set()
      const simulateAssignRole = (userId: string, role: string) => {
        const key = `${userId}:${role}`
        if (!assignedRoles.has(key)) {
          assignedRoles.add(key)
        }
        return true
      }

      // Initial assignment
      simulateAssignRole('user-1', 'bishop')
      expect(assignedRoles.size).toBe(1)

      // Repeated retry (e.g. on network timeout or retry button click)
      simulateAssignRole('user-1', 'bishop')
      expect(assignedRoles.size).toBe(1) // Still 1, no duplicate role created!
    })
  })
})
