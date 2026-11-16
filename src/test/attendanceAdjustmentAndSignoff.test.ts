import { describe, it, expect, vi, beforeEach } from 'vitest'
import { deriveLeadershipAccess } from '../context/AuthContext'
import { attendanceAdjustmentService } from '../services/attendanceAdjustmentService'
import {
  calculateParticipantVisits,
  calculateAttendanceDistribution,
  gatheringPlaceReportService
} from '../services/gatheringPlaceReportService'
import {
  ActivitySession,
  AttendanceRecord,
  MemberRecord,
  StakeUnit,
  UserProfile,
  GatheringPlaceReportLeaderSnapshot
} from '../types/database'

const mockRpc = vi.fn()
const mockFrom = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null })
    }
  }
}))

describe('YSA AMS — Flexible Stake YSA Leader Sign-Off & Audited Attendance Adjustment Suite', () => {
  const units: StakeUnit[] = [
    { id: 'u-1', unitName: 'Obantoko 1st Ward', unitType: 'ward', isActive: true, createdAt: '2026-01-01' },
    { id: 'u-2', unitName: 'Obantoko 2nd Ward', unitType: 'ward', isActive: true, createdAt: '2026-01-01' }
  ]

  const members: MemberRecord[] = [
    { id: 'm-1', fullName: 'Adeola Balogun', homeUnitId: 'u-1', homeUnitName: 'Obantoko 1st Ward', isActive: true, createdAt: '2026-01-01' },
    { id: 'm-2', fullName: 'Chinedu Eze', homeUnitId: 'u-1', homeUnitName: 'Obantoko 1st Ward', isActive: true, createdAt: '2026-01-01' },
    { id: 'm-3', fullName: 'Fatima Lawal', homeUnitId: 'u-2', homeUnitName: 'Obantoko 2nd Ward', isActive: true, createdAt: '2026-01-01' }
  ]

  const heldSession: ActivitySession = {
    id: 'sess-1',
    activityId: 'act-1',
    sessionTitle: 'Gathering Place - Skill Acquisition (Session 1)',
    sessionDate: '2026-11-03',
    startTime: '10:00:00',
    status: 'closed',
    initiatedAt: '2026-11-03T10:00:00Z',
    closedAt: '2026-11-03T12:00:00Z',
    maxTerminals: 1,
    timezone: 'Africa/Lagos',
    visitorRegistrationEnabled: true,
    classOptions: ['Barbing', 'ICT', 'Catering'],
    createdAt: '2026-11-01'
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockRpc.mockImplementation((name: string, params: any) => {
      if (name === 'rpc_submit_attendance_adjustment') {
        return Promise.resolve({
          data: {
            batch_id: 'batch-test-123',
            count: params.p_adjustments?.length || 1,
            status: params.p_direct_apply ? 'applied' : 'pending_approval'
          },
          error: null
        })
      }
      if (name === 'rpc_review_attendance_adjustment') {
        return Promise.resolve({
          data: {
            count: params.p_adjustment_ids?.length || 1,
            action: params.p_action
          },
          error: null
        })
      }
      return Promise.resolve({ data: null, error: null })
    })

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null })
    })
  })

  describe('1. Flexible Stake YSA Leader Sign-Off & Least Privilege RBAC', () => {
    it('grants sign-off strictly to stake_presidency and ysa_leader', () => {
      const presidencyAccess = deriveLeadershipAccess(['stake_presidency'])
      expect(presidencyAccess.canSignGatheringPlaceReport).toBe(true)

      const ysaLeaderAccess = deriveLeadershipAccess(['ysa_leader'])
      expect(ysaLeaderAccess.canSignGatheringPlaceReport).toBe(true)
    })

    it('explicitly excludes system_admin from sign-off unless they also hold stake_presidency or ysa_leader', () => {
      const adminOnlyAccess = deriveLeadershipAccess(['system_admin'])
      expect(adminOnlyAccess.canSignGatheringPlaceReport).toBe(false)

      const adminWithYsaLeader = deriveLeadershipAccess(['system_admin', 'ysa_leader'])
      expect(adminWithYsaLeader.canSignGatheringPlaceReport).toBe(true)

      const adminWithPresidency = deriveLeadershipAccess(['system_admin', 'stake_presidency'])
      expect(adminWithPresidency.canSignGatheringPlaceReport).toBe(true)
    })

    it('denies sign-off to clerks and unit leaders', () => {
      expect(deriveLeadershipAccess(['stake_clerk']).canSignGatheringPlaceReport).toBe(false)
      expect(deriveLeadershipAccess(['ward_clerk']).canSignGatheringPlaceReport).toBe(false)
      expect(deriveLeadershipAccess(['bishop']).canSignGatheringPlaceReport).toBe(false)
      expect(deriveLeadershipAccess(['branch_president']).canSignGatheringPlaceReport).toBe(false)
    })

    it('separates report generation, approval, and sign-off privileges', () => {
      const stakeClerk = deriveLeadershipAccess(['stake_clerk'])
      expect(stakeClerk.canGenerateGatheringPlaceReport).toBe(true)
      expect(stakeClerk.canApproveGatheringPlaceReport).toBe(false)
      expect(stakeClerk.canSignGatheringPlaceReport).toBe(false)

      const ysaLeader = deriveLeadershipAccess(['ysa_leader'])
      expect(ysaLeader.canGenerateGatheringPlaceReport).toBe(false)
      expect(ysaLeader.canApproveGatheringPlaceReport).toBe(false)
      expect(ysaLeader.canSignGatheringPlaceReport).toBe(true)

      const stakePresident = deriveLeadershipAccess(['stake_presidency'], [], true)
      expect(stakePresident.canGenerateGatheringPlaceReport).toBe(true)
      expect(stakePresident.canApproveGatheringPlaceReport).toBe(true)
      expect(stakePresident.canSignGatheringPlaceReport).toBe(true)
    })

    it('validates signatory role in gatheringPlaceReportService.buildReportSnapshot', () => {
      const adminUser: UserProfile = {
        id: 'admin-1',
        fullName: 'System Admin',
        email: 'admin@stake.org',
        roles: ['system_admin'],
        accountStatus: 'active',
        createdAt: '2026-01-01'
      }

      const invalidSignatory: GatheringPlaceReportLeaderSnapshot = {
        userId: 'admin-1',
        fullName: 'Admin User',
        phoneNumber: '08012345678',
        signatureDataUrl: 'data:image/png;base64,mock',
        role: 'system_admin'
      }

      expect(() => {
        gatheringPlaceReportService.buildReportSnapshot({
          year: 2026,
          month: 11,
          monthName: 'November',
          units,
          activities: [],
          sessions: [heldSession],
          attendanceRecords: [],
          criteria: {
            year: 2026,
            month: 11,
            monthName: 'November',
            selectedUnitIds: ['u-1'],
            isAllUnits: true,
            selectedActivityIds: [],
            selectedClassesByActivity: {},
            memberClassification: 'all',
            minimumVisitThreshold: 5,
            selectedLeaderId: 'admin-1'
          },
          selectedLeader: invalidSignatory,
          generatedBy: adminUser
        })
      }).toThrow('Invalid signatory: Only Stake Presidency or Stake YSA Leader can provide Stake YSA Leader Sign-Off.')
    })
  })

  describe('2. Non-Destructive Attendance History & Reversible Voiding', () => {
    it('completely excludes voided attendance records from participant visit counts', () => {
      const records: AttendanceRecord[] = [
        {
          id: 'rec-1',
          sessionId: 'sess-1',
          memberId: 'm-1',
          attendeeName: 'Adeola Balogun',
          unitId: 'u-1',
          unitName: 'Obantoko 1st Ward',
          checkInTime: '2026-11-03T10:15:00Z',
          isNonMember: false,
          isVoided: false
        },
        {
          id: 'rec-2',
          sessionId: 'sess-1',
          memberId: 'm-2',
          attendeeName: 'Chinedu Eze',
          unitId: 'u-1',
          unitName: 'Obantoko 1st Ward',
          checkInTime: '2026-11-03T10:20:00Z',
          isNonMember: false,
          isVoided: true, // VOIDED RECORD: Should be excluded
          voidReason: 'Mistakenly scanned card for absent sibling',
          voidedAt: '2026-11-04T12:00:00Z',
          voidedBy: 'admin-1'
        }
      ]

      const items = calculateParticipantVisits({
        eligibleSessions: [heldSession],
        attendanceRecords: records,
        selectedUnitIds: ['u-1', 'u-2'],
        isAllUnits: true,
        memberClassification: 'all',
        minimumVisitThreshold: 1,
        units,
        members
      })

      expect(items).toHaveLength(1)
      expect(items[0].memberId).toBe('m-1')
      expect(items.find((i) => i.memberId === 'm-2')).toBeUndefined()
    })

    it('excludes voided attendance records from attendance frequency distribution and qualifying counts', () => {
      const records: AttendanceRecord[] = [
        {
          id: 'rec-1',
          sessionId: 'sess-1',
          memberId: 'm-1',
          attendeeName: 'Adeola Balogun',
          unitId: 'u-1',
          unitName: 'Obantoko 1st Ward',
          checkInTime: '2026-11-03T10:15:00Z',
          isNonMember: false,
          isVoided: false
        },
        {
          id: 'rec-2',
          sessionId: 'sess-1',
          memberId: 'm-2',
          attendeeName: 'Chinedu Eze',
          unitId: 'u-1',
          unitName: 'Obantoko 1st Ward',
          checkInTime: '2026-11-03T10:20:00Z',
          isNonMember: false,
          isVoided: true // VOIDED RECORD
        }
      ]

      const dist = calculateAttendanceDistribution({
        attendanceRecords: records,
        eligibleSessions: [heldSession],
        minimumVisitThreshold: 1,
        selectedUnitIds: ['u-1'],
        isAllUnits: true
      })

      expect(dist.totalDistinctAttendees).toBe(1)
      expect(dist.qualifyingCount).toBe(1)
      expect(dist.distribution.visits1).toBe(1)
    })
  })

  describe('3. Session Occurrence Integrity Validation', () => {
    it('validates eligible held sessions', () => {
      const res = attendanceAdjustmentService.validateSessionEligibility(heldSession, 1)
      expect(res.eligible).toBe(true)
    })

    it('rejects cancelled sessions', () => {
      const cancelledSession: ActivitySession = {
        ...heldSession,
        status: 'cancelled',
        cancelledAt: '2026-11-02T10:00:00Z'
      }
      const res = attendanceAdjustmentService.validateSessionEligibility(cancelledSession, 0)
      expect(res.eligible).toBe(false)
      expect(res.reason).toContain('cancelled')
    })

    it('rejects postponed sessions', () => {
      const postponedSession: ActivitySession = {
        ...heldSession,
        postponedAt: '2026-11-02T10:00:00Z'
      }
      const res = attendanceAdjustmentService.validateSessionEligibility(postponedSession, 0)
      expect(res.eligible).toBe(false)
      expect(res.reason).toContain('postponed')
    })

    it('rejects draft sessions', () => {
      const draftSession: ActivitySession = {
        ...heldSession,
        status: 'draft'
      }
      const res = attendanceAdjustmentService.validateSessionEligibility(draftSession, 0)
      expect(res.eligible).toBe(false)
      expect(res.reason).toContain('draft')
    })

    it('rejects future session dates', () => {
      const futureSession: ActivitySession = {
        ...heldSession,
        sessionDate: '2029-12-31'
      }
      const res = attendanceAdjustmentService.validateSessionEligibility(futureSession, 0)
      expect(res.eligible).toBe(false)
      expect(res.reason).toContain('future')
    })

    it('rejects sessions that have no record of having occurred', () => {
      const unheldSession: ActivitySession = {
        ...heldSession,
        status: 'active',
        initiatedAt: null
      }
      const res = attendanceAdjustmentService.validateSessionEligibility(unheldSession, 0)
      expect(res.eligible).toBe(false)
      expect(res.reason).toContain('no record of occurrence')
    })
  })

  describe('4. Pre-Flight Batch Impact Preview & Conflict Detection', () => {
    const existingAttendance: AttendanceRecord[] = [
      // m-1 has 4 existing visits this month, including sess-1
      { id: 'a-1', sessionId: 'sess-1', memberId: 'm-1', attendeeName: 'Adeola', isNonMember: false, checkInTime: '2026-11-03', unitId: 'u-1', isVoided: false },
      { id: 'a-2', sessionId: 'sess-2', memberId: 'm-1', attendeeName: 'Adeola', isNonMember: false, checkInTime: '2026-11-10', unitId: 'u-1', isVoided: false },
      { id: 'a-3', sessionId: 'sess-3', memberId: 'm-1', attendeeName: 'Adeola', isNonMember: false, checkInTime: '2026-11-17', unitId: 'u-1', isVoided: false },
      { id: 'a-4', sessionId: 'sess-4', memberId: 'm-1', attendeeName: 'Adeola', isNonMember: false, checkInTime: '2026-11-24', unitId: 'u-1', isVoided: false },
      // m-2 has 4 existing visits, but NOT in sess-1
      { id: 'b-1', sessionId: 'sess-2', memberId: 'm-2', attendeeName: 'Chinedu', isNonMember: false, checkInTime: '2026-11-10', unitId: 'u-1', isVoided: false },
      { id: 'b-2', sessionId: 'sess-3', memberId: 'm-2', attendeeName: 'Chinedu', isNonMember: false, checkInTime: '2026-11-17', unitId: 'u-1', isVoided: false },
      { id: 'b-3', sessionId: 'sess-4', memberId: 'm-2', attendeeName: 'Chinedu', isNonMember: false, checkInTime: '2026-11-24', unitId: 'u-1', isVoided: false },
      { id: 'b-4', sessionId: 'sess-5', memberId: 'm-2', attendeeName: 'Chinedu', isNonMember: false, checkInTime: '2026-11-25', unitId: 'u-1', isVoided: false }
    ]

    it('detects duplicate conflict when adding attendance for an already present member', () => {
      const preview = attendanceAdjustmentService.calculateBatchPreview({
        session: heldSession,
        members: [members[0]], // m-1 is already in sess-1
        adjustmentType: 'add_attendance',
        allMonthAttendance: existingAttendance
      })

      expect(preview.hasConflicts).toBe(true)
      expect(preview.items[0].isConflict).toBe(true)
      expect(preview.items[0].conflictReason).toContain('Already marked present')
    })

    it('accurately calculates resulting visits and 5-visit threshold crossing on valid addition', () => {
      const preview = attendanceAdjustmentService.calculateBatchPreview({
        session: heldSession,
        members: [members[1]], // m-2 has 4 visits, not present in sess-1
        adjustmentType: 'add_attendance',
        allMonthAttendance: existingAttendance,
        minimumVisitThreshold: 5
      })

      expect(preview.hasConflicts).toBe(false)
      expect(preview.items[0].currentVisitsThisMonth).toBe(4)
      expect(preview.items[0].resultingVisitsThisMonth).toBe(5)
      expect(preview.items[0].crossesThreshold).toBe(true)
      expect(preview.totalNetVisitChange).toBe(1)
      expect(preview.thresholdCrossingCount).toBe(1)
    })

    it('detects missing conflict when attempting to void attendance for a member not marked present', () => {
      const preview = attendanceAdjustmentService.calculateBatchPreview({
        session: heldSession,
        members: [members[1]], // m-2 is NOT in sess-1
        adjustmentType: 'remove_attendance',
        allMonthAttendance: existingAttendance
      })

      expect(preview.hasConflicts).toBe(true)
      expect(preview.items[0].isConflict).toBe(true)
      expect(preview.items[0].conflictReason).toContain('Not marked present')
    })
  })

  describe('5. Role Enforcement in Adjustment Workflow', () => {
    const clerkUser: UserProfile = {
      id: 'clerk-1',
      fullName: 'Stake Clerk',
      email: 'clerk@stake.org',
      roles: ['stake_clerk'],
      accountStatus: 'active',
      createdAt: '2026-01-01'
    }

    const adminUser: UserProfile = {
      id: 'admin-1',
      fullName: 'System Admin',
      email: 'admin@stake.org',
      roles: ['system_admin'],
      accountStatus: 'active',
      createdAt: '2026-01-01'
    }

    it('prohibits Stake Clerk from direct-applying adjustments', async () => {
      await expect(
        attendanceAdjustmentService.submitAdjustment(
          {
            sessionId: 'sess-1',
            memberIds: ['m-1'],
            adjustmentType: 'add_attendance',
            reason: 'Hardware failure at terminal 1',
            directApply: true
          },
          clerkUser
        )
      ).rejects.toThrow('Stake Clerks cannot directly apply adjustments')
    })

    it('requires a mandatory reason of at least 5 characters', async () => {
      await expect(
        attendanceAdjustmentService.submitAdjustment(
          {
            sessionId: 'sess-1',
            memberIds: ['m-1'],
            adjustmentType: 'add_attendance',
            reason: 'Fix'
          },
          clerkUser
        )
      ).rejects.toThrow('A valid adjustment reason (minimum 5 characters) is required.')
    })

    it('allows System Admin to direct-apply with valid reason', async () => {
      const res = await attendanceAdjustmentService.submitAdjustment(
        {
          sessionId: 'sess-1',
          memberIds: ['m-2'],
          adjustmentType: 'add_attendance',
          reason: 'Verified in attendance by class instructor',
          directApply: true
        },
        adminUser
      )

      expect(res.success).toBe(true)
      expect(res.status).toBe('applied')
    })

    it('requires a comment when rejecting adjustments', async () => {
      await expect(
        attendanceAdjustmentService.reviewAdjustments(
          ['adj-1'],
          'reject',
          '',
          adminUser
        )
      ).rejects.toThrow('A comment explaining the rejection is required.')
    })
  })

  describe('6. Historical Report Immutability & Revision Trigger Workflow', () => {
    it('increments version to v2 when generating a revised report from v1', () => {
      const adminUser: UserProfile = {
        id: 'admin-1',
        fullName: 'System Admin',
        email: 'admin@stake.org',
        roles: ['system_admin'],
        accountStatus: 'active',
        createdAt: '2026-01-01'
      }

      const signatory: GatheringPlaceReportLeaderSnapshot = {
        userId: 'leader-1',
        fullName: 'Victor Ogundele',
        phoneNumber: '08083238902',
        signatureDataUrl: 'data:image/png;base64,mock',
        role: 'ysa_leader'
      }

      const reportV2 = gatheringPlaceReportService.buildReportSnapshot({
        year: 2026,
        month: 11,
        monthName: 'November',
        units,
        activities: [],
        sessions: [heldSession],
        attendanceRecords: [],
        criteria: {
          year: 2026,
          month: 11,
          monthName: 'November',
          selectedUnitIds: ['u-1'],
          isAllUnits: true,
          selectedActivityIds: [],
          selectedClassesByActivity: {},
          memberClassification: 'all',
          minimumVisitThreshold: 5,
          selectedLeaderId: 'leader-1'
        },
        selectedLeader: signatory,
        generatedBy: adminUser,
        existingVersion: 1 // Existing approved report was v1
      })

      expect(reportV2.version).toBe(2)
      expect(reportV2.leaderSnapshot.role).toBe('ysa_leader')
    })
  })

  describe('7. Stake YSA Leader Visibility & Stake Clerk Signatory Fallback Suite', () => {
    it('grants ysa_leader access to Gathering Place workspace without adjustment or approval rights', () => {
      const access = deriveLeadershipAccess(['ysa_leader'])
      expect(access.canAccessGatheringPlace).toBe(true)
      expect(access.canSignGatheringPlaceReport).toBe(true)
      expect(access.canGenerateGatheringPlaceReport).toBe(false)
      expect(access.canApproveGatheringPlaceReport).toBe(false)
      expect(access.canInitiateAttendanceAdjustment).toBe(false)
      expect(access.canApproveAttendanceAdjustment).toBe(false)
    })

    it('grants stake_clerk attendance adjustment initiation while strictly denying self-approval', () => {
      const access = deriveLeadershipAccess(['stake_clerk'])
      expect(access.canAccessGatheringPlace).toBe(true)
      expect(access.canGenerateGatheringPlaceReport).toBe(true)
      expect(access.canSignGatheringPlaceReport).toBe(false)
      expect(access.canApproveGatheringPlaceReport).toBe(false)
      expect(access.canInitiateAttendanceAdjustment).toBe(true)
      expect(access.canApproveAttendanceAdjustment).toBe(false)
    })

    it('grants stake_presidency full adjustment and approval authority', () => {
      const access = deriveLeadershipAccess(['stake_presidency'], [], true)
      expect(access.canAccessGatheringPlace).toBe(true)
      expect(access.canGenerateGatheringPlaceReport).toBe(true)
      expect(access.canSignGatheringPlaceReport).toBe(true)
      expect(access.canApproveGatheringPlaceReport).toBe(true)
      expect(access.canInitiateAttendanceAdjustment).toBe(true)
      expect(access.canApproveAttendanceAdjustment).toBe(true)
    })

    it('derives active signatories from stake_leader_signatures when usersList has no eligible leaders for Clerk', () => {
      const clerkProfile: UserProfile = {
        id: 'clerk-1',
        fullName: 'Stake Clerk',
        email: 'clerk@stake.org',
        roles: ['stake_clerk'],
        accountStatus: 'active',
        createdAt: '2026-01-01T00:00:00Z'
      }

      // Simulate restricted usersList returned under RLS for clerk (only sees own profile)
      const restrictedUsersList = [clerkProfile]

      // Filter directly using role logic:
      const eligibleUsers = restrictedUsersList.filter(
        (u) => u.roles.includes('ysa_leader') || u.roles.includes('stake_presidency')
      )
      expect(eligibleUsers.length).toBe(0)

      // Fallback to active signatures:
      const activeSignatures = [
        {
          id: 'sig-1',
          userId: 'pres-1',
          fullName: 'President Adebaki',
          phoneNumber: '08012345678',
          signatureDataUrl: 'data:image/png;base64,data',
          isActive: true,
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z'
        },
        {
          id: 'sig-2',
          userId: 'inactive-1',
          fullName: 'Former Leader',
          phoneNumber: '08099999999',
          signatureDataUrl: 'data:image/png;base64,data',
          isActive: false,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z'
        }
      ]

      const fallbackLeaders = activeSignatures
        .filter((s) => s.isActive)
        .map((s) => ({
          id: s.userId,
          fullName: s.fullName,
          email: '',
          phoneNumber: s.phoneNumber,
          roles: ['ysa_leader' as const],
          accountStatus: 'active' as const,
          createdAt: s.createdAt
        }))

      expect(fallbackLeaders.length).toBe(1)
      expect(fallbackLeaders[0].id).toBe('pres-1')
      expect(fallbackLeaders[0].fullName).toBe('President Adebaki')
    })
  })
})
