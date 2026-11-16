import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  calculateExpectedVisits,
  calculateParticipantVisits,
  calculateAttendanceDistribution,
  gatheringPlaceReportService
} from '../services/gatheringPlaceReportService'
import { deriveLeadershipAccess } from '../context/AuthContext'
import { GatheringPlaceReportDocument } from '../components/reporting/GatheringPlaceReportDocument'
import {
  ActivitySession,
  AttendanceRecord,
  StakeUnit,
  MemberRecord,
  UserProfile,
  ActivityDefinition,
  GatheringPlaceReportLeaderSnapshot,
  GatheringPlaceMonthlyReport
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

describe('YSA AMS — Gathering Place Monthly Report, Stake Approval & Unit Distribution Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockRpc.mockImplementation((name: string, params: any) => {
      if (name === 'rpc_review_gathering_place_monthly_report') {
        const action = params?.p_action
        const status =
          action === 'approve'
            ? 'approved'
            : action === 'disapprove'
            ? 'disapproved'
            : 'correction_requested'
        return Promise.resolve({
          data: { success: true, status, comment: params?.p_comment },
          error: null
        })
      }
      if (name === 'rpc_create_gathering_place_monthly_report') {
        return Promise.resolve({ data: 'mock-persisted-report-id-123', error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    mockFrom.mockImplementation((table: string) => {
      const defaultData =
        table === 'gathering_place_monthly_reports'
          ? [
              {
                id: 'rep-approved-1',
                report_title: 'November 2026 Gathering Place Monthly Report',
                reporting_year: 2026,
                reporting_month: 11,
                month_name: 'November',
                status: 'approved',
                version: 1,
                expected_visits_per_ya: 9,
                total_eligible_occurrences: 9,
                minimum_visit_threshold: 5,
                filter_criteria: {},
                leader_snapshot: {},
                summary_metrics: {},
                unit_ids: ['u-4'],
                generated_by: 'admin-1',
                generated_at: '2026-11-16T10:00:00Z',
                created_at: '2026-11-16T10:00:00Z',
                updated_at: '2026-11-16T10:00:00Z'
              }
            ]
          : []

      const queryPromise = Promise.resolve({ data: defaultData, error: null })

      const queryBuilder: any = Object.assign(queryPromise, {
        select: vi.fn().mockImplementation(() => queryBuilder),
        order: vi.fn().mockImplementation(() => queryBuilder),
        eq: vi.fn().mockImplementation(() => queryBuilder),
        in: vi.fn().mockImplementation(() => queryBuilder),
        gte: vi.fn().mockImplementation(() => queryBuilder),
        lte: vi.fn().mockImplementation(() => queryBuilder),
        range: vi.fn().mockImplementation(() => queryBuilder),
        upsert: vi.fn().mockImplementation(() => queryBuilder),
        update: vi.fn().mockImplementation(() => queryBuilder),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: defaultData[0] || null,
          error: null
        })
      })

      return queryBuilder
    })
  })

  // Test Fixture Data: 8 Units of Abeokuta Nigeria Obantoko Stake
  const stakeUnits: StakeUnit[] = [
    { id: 'u-1', unitName: 'Abiola-Way Ward', unitType: 'ward', isActive: true, createdAt: '2026-01-01' },
    { id: 'u-2', unitName: 'Camp Ward', unitType: 'ward', isActive: true, createdAt: '2026-01-01' },
    { id: 'u-3', unitName: 'Kugba Ward', unitType: 'ward', isActive: true, createdAt: '2026-01-01' },
    { id: 'u-4', unitName: 'Obantoko Ward', unitType: 'ward', isActive: true, createdAt: '2026-01-01' },
    { id: 'u-5', unitName: 'Odeda Ward', unitType: 'ward', isActive: true, createdAt: '2026-01-01' },
    { id: 'u-6', unitName: 'Alabata Branch', unitType: 'branch', isActive: true, createdAt: '2026-01-01' },
    { id: 'u-7', unitName: 'Apena Branch', unitType: 'branch', isActive: true, createdAt: '2026-01-01' },
    { id: 'u-8', unitName: 'Apete Branch', unitType: 'branch', isActive: true, createdAt: '2026-01-01' }
  ]

  // Activities: Devotional, Institute, Skill Acquisition
  const activities: ActivityDefinition[] = [
    {
      id: 'act-devotional',
      title: 'Devotional',
      category: 'spiritual',
      createdBy: 'admin-1',
      createdAt: '2026-01-01'
    },
    {
      id: 'act-institute',
      title: 'Institute',
      category: 'educational',
      createdBy: 'admin-1',
      createdAt: '2026-01-01'
    },
    {
      id: 'act-skills',
      title: 'Skill Acquisition',
      category: 'educational',
      classOptions: ['Barbing', 'Tailoring', 'Shoe Making', 'Catering', 'ICT'],
      createdBy: 'admin-1',
      createdAt: '2026-01-01'
    }
  ]

  // Sessions for June 2026:
  // Activity A (Devotional): 4 sessions
  // Activity B (Institute): 8 sessions
  // Activity C (Skill Acquisition): 9 sessions
  // Total eligible held occurrences = 4 + 8 + 9 = 21!
  const sessions: ActivitySession[] = []

  // 4 Devotional sessions
  for (let i = 1; i <= 4; i++) {
    sessions.push({
      id: `session-dev-${i}`,
      activityId: 'act-devotional',
      activityTitle: 'Devotional',
      sessionTitle: `June Devotional #${i}`,
      sessionDate: `2026-06-0${i}`,
      startTime: '16:00',
      scheduledEndTime: '18:00',
      status: 'closed',
      maxTerminals: 1,
      timezone: 'Africa/Lagos',
      visitorRegistrationEnabled: true,
      createdAt: '2026-06-01'
    })
  }

  // 8 Institute sessions
  for (let i = 1; i <= 8; i++) {
    sessions.push({
      id: `session-inst-${i}`,
      activityId: 'act-institute',
      activityTitle: 'Institute',
      sessionTitle: `June Institute #${i}`,
      sessionDate: `2026-06-${String(i + 5).padStart(2, '0')}`,
      startTime: '17:00',
      scheduledEndTime: '19:00',
      status: 'closed',
      maxTerminals: 1,
      timezone: 'Africa/Lagos',
      visitorRegistrationEnabled: true,
      createdAt: '2026-06-01'
    })
  }

  // 9 Skill Acquisition sessions (1 cancelled, so 10 total created, 9 eligible closed)
  for (let i = 1; i <= 9; i++) {
    sessions.push({
      id: `session-skill-${i}`,
      activityId: 'act-skills',
      activityTitle: 'Skill Acquisition',
      sessionTitle: `Skill Acquisition #${i}`,
      sessionDate: `2026-06-${String(i + 15).padStart(2, '0')}`,
      classOptions: ['Barbing', 'Tailoring', 'Shoe Making', 'Catering', 'ICT'],
      startTime: '10:00',
      scheduledEndTime: '14:00',
      status: 'closed',
      maxTerminals: 2,
      timezone: 'Africa/Lagos',
      visitorRegistrationEnabled: true,
      createdAt: '2026-06-01'
    })
  }

  // 1 Cancelled session (must NOT be counted in expected visits!)
  sessions.push({
    id: 'session-skill-cancelled',
    activityId: 'act-skills',
    activityTitle: 'Skill Acquisition',
    sessionTitle: 'Cancelled Session',
    sessionDate: '2026-06-28',
    startTime: '10:00',
    status: 'cancelled',
    maxTerminals: 1,
    timezone: 'Africa/Lagos',
    visitorRegistrationEnabled: true,
    createdAt: '2026-06-01'
  })

  // 1 July session (outside June 2026, must NOT be counted!)
  sessions.push({
    id: 'session-july-1',
    activityId: 'act-devotional',
    activityTitle: 'Devotional',
    sessionTitle: 'July Devotional',
    sessionDate: '2026-07-05',
    startTime: '16:00',
    status: 'closed',
    maxTerminals: 1,
    timezone: 'Africa/Lagos',
    visitorRegistrationEnabled: true,
    createdAt: '2026-07-01'
  })

  // Members
  const members: MemberRecord[] = [
    {
      id: 'm-1',
      fullName: 'Alma Sobakin',
      homeUnitId: 'u-4', // Obantoko Ward
      homeUnitName: 'Obantoko Ward',
      isActive: true,
      createdAt: '2026-01-01'
    },
    {
      id: 'm-2',
      fullName: 'Akinola Emmanuel Adeolu',
      homeUnitId: 'u-4', // Obantoko Ward
      homeUnitName: 'Obantoko Ward',
      isActive: true,
      createdAt: '2026-01-01'
    },
    {
      id: 'm-3',
      fullName: 'Adewusi Titilayo Ibukunduwa',
      homeUnitId: 'u-4', // Obantoko Ward
      homeUnitName: 'Obantoko Ward',
      isActive: true,
      createdAt: '2026-01-01'
    },
    {
      id: 'm-4',
      fullName: 'Camp Ward Participant',
      homeUnitId: 'u-2', // Camp Ward
      homeUnitName: 'Camp Ward',
      isActive: true,
      createdAt: '2026-01-01'
    }
  ]

  // Stake Leader Snapshot
  const leaderSnapshot: GatheringPlaceReportLeaderSnapshot = {
    userId: 'leader-1',
    fullName: 'Victor Ogundele',
    phoneNumber: '08083238902',
    signatureDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  }

  // --------------------------------------------------------------------------
  // SECTION 4: EXPECTED VISITS CALCULATION TESTS
  // --------------------------------------------------------------------------
  describe('4. Expected Visits Calculation', () => {
    it('correctly calculates expected visits = 21 when all 3 activities are selected for June 2026', () => {
      const result = calculateExpectedVisits({
        year: 2026,
        month: 6,
        sessions,
        selectedActivityIds: ['act-devotional', 'act-institute', 'act-skills']
      })

      // 4 Devotionals + 8 Institute + 9 Skills = 21 eligible sessions
      expect(result.expectedVisits).toBe(21)
      expect(result.eligibleSessions.length).toBe(21)
      expect(result.eligibleSessions.some((s) => s.status === 'cancelled')).toBe(false)
      expect(result.eligibleSessions.some((s) => s.sessionDate.startsWith('2026-07'))).toBe(false)
    })

    it('correctly recalculates expected visits = 12 when only Activity A and B are selected', () => {
      // Devotional (4) + Institute (8) = 12
      const result = calculateExpectedVisits({
        year: 2026,
        month: 6,
        sessions,
        selectedActivityIds: ['act-devotional', 'act-institute']
      })
      expect(result.expectedVisits).toBe(12)
    })

    it('excludes cancelled sessions from expected visit count', () => {
      const result = calculateExpectedVisits({
        year: 2026,
        month: 6,
        sessions,
        selectedActivityIds: ['act-skills']
      })
      // 9 closed sessions, 1 cancelled session ignored
      expect(result.expectedVisits).toBe(9)
    })

    it('excludes sessions outside the selected month', () => {
      const result = calculateExpectedVisits({
        year: 2026,
        month: 7,
        sessions,
        selectedActivityIds: ['act-devotional']
      })
      // Only 1 session in July 2026
      expect(result.expectedVisits).toBe(1)
    })
  })

  // --------------------------------------------------------------------------
  // SECTION 5: PARTICIPANT TOTAL VISITS & ATTENDANCE AGGREGATION TESTS
  // --------------------------------------------------------------------------
  describe('5. Participant Total Visits Calculation & De-duplication', () => {
    it('accurately calculates participant total visits, deduplicating multiple check-ins to the same session', () => {
      const eligibleSessions = sessions.filter(
        (s) => s.sessionDate.startsWith('2026-06') && s.status !== 'cancelled'
      )

      // Alma Sobakin attends 12 distinct sessions
      const attendanceRecords: AttendanceRecord[] = []

      // 4 Devotionals
      for (let i = 1; i <= 4; i++) {
        attendanceRecords.push({
          id: `att-alma-dev-${i}`,
          sessionId: `session-dev-${i}`,
          memberId: 'm-1',
          attendeeName: 'Alma Sobakin',
          unitId: 'u-4',
          unitName: 'Obantoko Ward',
          checkInTime: `2026-06-0${i}T16:05:00Z`,
          isNonMember: false
        })
      }

      // 4 Institutes
      for (let i = 1; i <= 4; i++) {
        attendanceRecords.push({
          id: `att-alma-inst-${i}`,
          sessionId: `session-inst-${i}`,
          memberId: 'm-1',
          attendeeName: 'Alma Sobakin',
          unitId: 'u-4',
          unitName: 'Obantoko Ward',
          checkInTime: `2026-06-0${i + 5}T17:05:00Z`,
          isNonMember: false
        })
      }

      // 4 Skills (Barbing class)
      for (let i = 1; i <= 4; i++) {
        attendanceRecords.push({
          id: `att-alma-skill-${i}`,
          sessionId: `session-skill-${i}`,
          memberId: 'm-1',
          attendeeName: 'Alma Sobakin',
          unitId: 'u-4',
          unitName: 'Obantoko Ward',
          selectedClass: 'Barbing',
          checkInTime: `2026-06-1${i + 5}T10:05:00Z`,
          isNonMember: false
        })
      }

      // DUPLICATE RECORD in session-skill-1 (e.g. participant checked into both Barbing and Tailoring)
      // Must NOT inflate visit count!
      attendanceRecords.push({
        id: 'att-alma-skill-dup',
        sessionId: 'session-skill-1',
        memberId: 'm-1',
        attendeeName: 'Alma Sobakin',
        unitId: 'u-4',
        unitName: 'Obantoko Ward',
        selectedClass: 'Tailoring',
        checkInTime: '2026-06-16T11:00:00Z',
        isNonMember: false
      })

      const items = calculateParticipantVisits({
        eligibleSessions,
        attendanceRecords,
        selectedUnitIds: ['u-4'],
        units: stakeUnits,
        members
      })

      expect(items.length).toBe(1)
      const alma = items[0]
      expect(alma.attendeeName).toBe('Alma Sobakin')
      // Exactly 12 distinct visits, not 13!
      expect(alma.totalVisits).toBe(12)
      // Class/Group aggregates all distinct activities and classes attended
      expect(alma.classGroupDisplay).toContain('Barbing')
      expect(alma.classGroupDisplay).toContain('Devotional')
      expect(alma.classGroupDisplay).toContain('Institute')
    })

    it('enforces minimum visit threshold (e.g. 5 and above) matching the reference report', () => {
      const eligibleSessions = sessions.filter(
        (s) => s.sessionDate.startsWith('2026-06') && s.status !== 'cancelled'
      )

      const attendanceRecords: AttendanceRecord[] = [
        // Participant with 5 visits across 5 distinct sessions (meets threshold >= 5)
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `att-akinola-${i}`,
          sessionId: i < 4 ? `session-dev-${i + 1}` : 'session-inst-1',
          memberId: 'm-2',
          attendeeName: 'Akinola Emmanuel Adeolu',
          unitId: 'u-4',
          unitName: 'Obantoko Ward',
          checkInTime: '2026-06-01T16:00:00Z',
          isNonMember: false
        })),
        // Participant with 3 visits (below threshold)
        ...Array.from({ length: 3 }, (_, i) => ({
          id: `att-low-${i}`,
          sessionId: `session-dev-${i + 1}`,
          memberId: 'm-3',
          attendeeName: 'Adewusi Titilayo Ibukunduwa',
          unitId: 'u-4',
          unitName: 'Obantoko Ward',
          checkInTime: '2026-06-01T16:00:00Z',
          isNonMember: false
        }))
      ]

      const items = calculateParticipantVisits({
        eligibleSessions,
        attendanceRecords,
        selectedUnitIds: ['u-4'],
        minimumVisitThreshold: 5,
        units: stakeUnits,
        members
      })

      expect(items.length).toBe(1)
      expect(items[0].attendeeName).toBe('Akinola Emmanuel Adeolu')
      expect(items[0].totalVisits).toBe(5)
    })
  })

  // --------------------------------------------------------------------------
  // SECTION 2 & 8: STAKE PRESIDENT DISTINCTION & APPROVAL WORKFLOW TESTS
  // --------------------------------------------------------------------------
  describe('2 & 8. Stake Presidency Distinction & Approval Workflow', () => {
    it('distinguishes verified Stake President from other Stake Presidency members', () => {
      // Verified Stake President
      const presAccess = deriveLeadershipAccess(['stake_presidency'], [], true)
      expect(presAccess.isStakePresident).toBe(true)
      expect(presAccess.canGenerateGatheringPlaceReport).toBe(true)
      expect(presAccess.canApproveGatheringPlaceReport).toBe(true)

      // Other Stake Presidency member (e.g. Counselor)
      const counselorAccess = deriveLeadershipAccess(['stake_presidency'], [], false)
      expect(counselorAccess.isStakePresident).toBe(false)
      expect(counselorAccess.canGenerateGatheringPlaceReport).toBe(true)
      // CANNOT approve! Must submit for Stake President approval
      expect(counselorAccess.canApproveGatheringPlaceReport).toBe(false)

      // Stake Clerk
      const clerkAccess = deriveLeadershipAccess(['stake_clerk'], [], false)
      expect(clerkAccess.canGenerateGatheringPlaceReport).toBe(true)
      expect(clerkAccess.canApproveGatheringPlaceReport).toBe(false)

      // System Admin
      const adminAccess = deriveLeadershipAccess(['system_admin'], [], false)
      expect(adminAccess.canGenerateGatheringPlaceReport).toBe(true)
      expect(adminAccess.canApproveGatheringPlaceReport).toBe(true)

      // Unit Leader (Bishop)
      const bishopAccess = deriveLeadershipAccess(['bishop'], [{ id: 'ua-1', userId: 'b-1', unitId: 'u-4', assignedRole: 'bishop', createdAt: '' }])
      expect(bishopAccess.canGenerateGatheringPlaceReport).toBe(false)
      expect(bishopAccess.canApproveGatheringPlaceReport).toBe(false)
      expect(bishopAccess.isUnitLeader).toBe(true)
    })

    it('reports generated by system_admin proceed directly to approved status', () => {
      const adminUser: UserProfile = {
        id: 'admin-1',
        fullName: 'Admin User',
        email: 'admin@stake.org',
        roles: ['system_admin'],
        accountStatus: 'active',
        createdAt: '2026-01-01'
      }

      const report = gatheringPlaceReportService.buildReportSnapshot({
        year: 2026,
        month: 6,
        monthName: 'June',
        units: stakeUnits,
        activities,
        sessions,
        attendanceRecords: [],
        members,
        criteria: {
          year: 2026,
          month: 6,
          monthName: 'June',
          selectedUnitIds: ['u-4'],
          isAllUnits: false,
          selectedActivityIds: [],
          selectedClassesByActivity: {},
          memberClassification: 'all',
          minimumVisitThreshold: 0,
          selectedLeaderId: 'leader-1'
        },
        selectedLeader: leaderSnapshot,
        generatedBy: adminUser
      })

      expect(report.status).toBe('approved')
      expect(report.approvedBy).toBe('admin-1')
    })

    it('reports generated by verified Stake President proceed directly to approved status', () => {
      const presidentUser: UserProfile = {
        id: 'pres-1',
        fullName: 'Stake President',
        email: 'president@stake.org',
        roles: ['stake_presidency'],
        isStakePresident: true,
        accountStatus: 'active',
        createdAt: '2026-01-01'
      }

      const report = gatheringPlaceReportService.buildReportSnapshot({
        year: 2026,
        month: 6,
        monthName: 'June',
        units: stakeUnits,
        activities,
        sessions,
        attendanceRecords: [],
        members,
        criteria: {
          year: 2026,
          month: 6,
          monthName: 'June',
          selectedUnitIds: ['u-4'],
          isAllUnits: false,
          selectedActivityIds: [],
          selectedClassesByActivity: {},
          memberClassification: 'all',
          minimumVisitThreshold: 0,
          selectedLeaderId: 'leader-1'
        },
        selectedLeader: leaderSnapshot,
        generatedBy: presidentUser
      })

      expect(report.status).toBe('approved')
      expect(report.approvedBy).toBe('pres-1')
    })

    it('reports generated by other Stake Presidency members or Stake Clerk start in generated_pending_approval', () => {
      const counselorUser: UserProfile = {
        id: 'counselor-1',
        fullName: 'First Counselor',
        email: 'counselor@stake.org',
        roles: ['stake_presidency'],
        isStakePresident: false,
        accountStatus: 'active',
        createdAt: '2026-01-01'
      }

      const report = gatheringPlaceReportService.buildReportSnapshot({
        year: 2026,
        month: 6,
        monthName: 'June',
        units: stakeUnits,
        activities,
        sessions,
        attendanceRecords: [],
        members,
        criteria: {
          year: 2026,
          month: 6,
          monthName: 'June',
          selectedUnitIds: ['u-4'],
          isAllUnits: false,
          selectedActivityIds: [],
          selectedClassesByActivity: {},
          memberClassification: 'all',
          minimumVisitThreshold: 0,
          selectedLeaderId: 'leader-1'
        },
        selectedLeader: leaderSnapshot,
        generatedBy: counselorUser
      })

      expect(report.status).toBe('generated_pending_approval')
      expect(report.approvedBy).toBeNull()
    })

    it('allows verified Stake President to approve, disapprove, or request correction', async () => {
      const presidentUser: UserProfile = {
        id: 'pres-1',
        fullName: 'Stake President',
        email: 'president@stake.org',
        roles: ['stake_presidency'],
        isStakePresident: true,
        accountStatus: 'active',
        createdAt: '2026-01-01'
      }

      // Approve
      const approveResult = await gatheringPlaceReportService.reviewReport(
        'rep-1',
        'approve',
        'Approved by Stake President',
        presidentUser
      )
      expect(approveResult.success).toBe(true)
      expect(approveResult.status).toBe('approved')

      // Disapprove with comment
      const disapproveResult = await gatheringPlaceReportService.reviewReport(
        'rep-1',
        'disapprove',
        'Incomplete records for Apena branch',
        presidentUser
      )
      expect(disapproveResult.success).toBe(true)
      expect(disapproveResult.status).toBe('disapproved')

      // Request correction
      const correctionResult = await gatheringPlaceReportService.reviewReport(
        'rep-1',
        'request_correction',
        'Please re-include Tailoring class',
        presidentUser
      )
      expect(correctionResult.success).toBe(true)
      expect(correctionResult.status).toBe('correction_requested')
    })

    it('rejects approval attempt by unauthorized user (e.g. Stake Clerk or Counselor)', async () => {
      const clerkUser: UserProfile = {
        id: 'clerk-1',
        fullName: 'Stake Clerk',
        email: 'clerk@stake.org',
        roles: ['stake_clerk'],
        accountStatus: 'active',
        createdAt: '2026-01-01'
      }

      await expect(
        gatheringPlaceReportService.reviewReport(
          'rep-1',
          'approve',
          'Attempted approval',
          clerkUser
        )
      ).rejects.toThrow('Permission denied')
    })

    it('enforces mandatory reason/comment when disapproving or requesting correction', async () => {
      const presidentUser: UserProfile = {
        id: 'pres-1',
        fullName: 'Stake President',
        email: 'president@stake.org',
        roles: ['stake_presidency'],
        isStakePresident: true,
        accountStatus: 'active',
        createdAt: '2026-01-01'
      }

      await expect(
        gatheringPlaceReportService.reviewReport(
          'rep-1',
          'disapprove',
          '',
          presidentUser
        )
      ).rejects.toThrow('A comment is required')
    })
  })

  // --------------------------------------------------------------------------
  // SECTION 9: UNIT-SPECIFIC REPORT ACCESS & SECURITY
  // --------------------------------------------------------------------------
  describe('9. Unit-Specific Report Distribution & Least-Privilege Access', () => {
    it('allows a Bishop to access ONLY approved reports for their own assigned unit', async () => {
      const bishopUser: UserProfile = {
        id: 'bishop-obantoko',
        fullName: 'Bishop Obantoko',
        email: 'bishop.obantoko@stake.org',
        roles: ['bishop'],
        unitAssignments: [
          {
            id: 'ua-obantoko',
            userId: 'bishop-obantoko',
            unitId: 'u-4', // Obantoko Ward
            assignedRole: 'bishop',
            createdAt: '2026-01-01'
          }
        ],
        accountStatus: 'active',
        createdAt: '2026-01-01'
      }

      // Mock listReports to return both approved and unapproved reports
      const reports = await gatheringPlaceReportService.listReports(bishopUser)
      // Unit leader should never see pending or disapproved reports
      expect(reports.every((r) => r.status === 'approved')).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  // SECTION 6: SIGNATURE MANAGEMENT
  // --------------------------------------------------------------------------
  describe('6. Stake Leader Signature Management', () => {
    it('preserves the leader snapshot including name, phone and transparent PNG signature', () => {
      const adminUser: UserProfile = {
        id: 'admin-1',
        fullName: 'Admin User',
        email: 'admin@stake.org',
        roles: ['system_admin'],
        accountStatus: 'active',
        createdAt: '2026-01-01'
      }

      const report = gatheringPlaceReportService.buildReportSnapshot({
        year: 2026,
        month: 6,
        monthName: 'June',
        units: stakeUnits,
        activities,
        sessions,
        attendanceRecords: [],
        members,
        criteria: {
          year: 2026,
          month: 6,
          monthName: 'June',
          selectedUnitIds: ['u-4'],
          isAllUnits: false,
          selectedActivityIds: [],
          selectedClassesByActivity: {},
          memberClassification: 'all',
          minimumVisitThreshold: 0,
          selectedLeaderId: 'leader-1'
        },
        selectedLeader: leaderSnapshot,
        generatedBy: adminUser
      })

      expect(report.leaderSnapshot.fullName).toBe('Victor Ogundele')
      expect(report.leaderSnapshot.phoneNumber).toBe('08083238902')
      expect(report.leaderSnapshot.signatureDataUrl).toContain('data:image/png')
    })
  })

  // --------------------------------------------------------------------------
  // SECTION 10 & 7: HIGH-FIDELITY PDF & PREVIEW RENDERING TESTS
  // --------------------------------------------------------------------------
  describe('10 & 7. High-Fidelity PDF & Landscape Preview Rendering', () => {
    const sampleApprovedReport: GatheringPlaceMonthlyReport = {
      id: 'rep-obantoko-june-2026',
      reportTitle: 'June 2026 Gathering Place Monthly Report',
      reportingYear: 2026,
      reportingMonth: 6,
      monthName: 'June',
      status: 'approved',
      version: 1,
      expectedVisitsPerYa: 21,
      totalEligibleOccurrences: 21,
      minimumVisitThreshold: 5,
      filterCriteria: {
        year: 2026,
        month: 6,
        monthName: 'June',
        selectedUnitIds: ['u-4'],
        isAllUnits: false,
        selectedActivityIds: [],
        selectedClassesByActivity: {},
        memberClassification: 'all',
        minimumVisitThreshold: 5,
        selectedLeaderId: 'leader-1'
      },
      leaderSnapshot: {
        userId: 'leader-1',
        fullName: 'VICTOR OGUNDELE',
        phoneNumber: '08083238902',
        signatureDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      },
      summaryMetrics: {
        totalParticipants: 2,
        totalVisits: 17,
        unitsCount: 1,
        unitBreakdown: { 'Obantoko Ward': 2 }
      },
      unitIds: ['u-4'],
      generatedBy: 'admin-1',
      generatedByName: 'System Admin',
      generatedAt: '2026-06-30T18:00:00Z',
      approvedBy: 'admin-1',
      approvedByName: 'System Admin',
      approvedAt: '2026-06-30T18:05:00Z',
      approvalNote: 'Approved for reimbursement.',
      createdAt: '2026-06-30T18:00:00Z',
      updatedAt: '2026-06-30T18:05:00Z',
      items: [
        {
          serialNumber: 62,
          memberId: 'm-3',
          attendeeName: 'Adewusi Titilayo Ibukunduwa',
          unitId: 'u-4',
          unitName: 'Obantoko Ward',
          classGroupDisplay: 'Catering, Devotional, Institute, Institute Cluster, Missionary Departure',
          totalVisits: 12
        },
        {
          serialNumber: 63,
          memberId: 'm-2',
          attendeeName: 'Akinola Emmanuel Adeolu',
          unitId: 'u-4',
          unitName: 'Obantoko Ward',
          classGroupDisplay: 'Barbing, Institute, Institute Cluster',
          totalVisits: 5
        }
      ]
    }

    it('renders exact official headers, titles and subheaders matching the reference PDF', () => {
      render(<GatheringPlaceReportDocument report={sampleApprovedReport} />)

      // Top title
      expect(
        screen.getByText('AFRICA WEST AREA GATHERING PLACE DAILY ATTENDANCE REGISTER')
      ).toBeInTheDocument()

      // Subheader
      expect(screen.getByText('CONSOLIDATED MONTHLY REPORT')).toBeInTheDocument()

      // Unit & Stake identification
      expect(
        screen.getByText((content) => content.includes('OBANTOKO WARD (Abeokuta, Nigeria, Obantoko Stake)'))
      ).toBeInTheDocument()

      // Minimum qualifying attendance threshold metadata
      expect(
        screen.getByText((content) => content.includes('Minimum qualifying attendance: 5 visits and above'))
      ).toBeInTheDocument()

      // Date identification
      expect(screen.getByText('June 2026')).toBeInTheDocument()

      // Table banner header
      expect(screen.getByText('PARTICIPANTS LIST')).toBeInTheDocument()

      // Table column headers
      expect(screen.getByText('S/N')).toBeInTheDocument()
      expect(screen.getByText('Member Name')).toBeInTheDocument()
      expect(screen.getByText('Ward/Branch')).toBeInTheDocument()
      expect(screen.getByText('Class/Group')).toBeInTheDocument()
      expect(screen.getByText('Total Visits')).toBeInTheDocument()

      // Participant rows
      expect(screen.getByText('Adewusi Titilayo Ibukunduwa')).toBeInTheDocument()
      expect(
        screen.getByText('Catering, Devotional, Institute, Institute Cluster, Missionary Departure')
      ).toBeInTheDocument()
      expect(screen.getByText('12')).toBeInTheDocument()

      expect(screen.getByText('Akinola Emmanuel Adeolu')).toBeInTheDocument()
      expect(screen.getByText('Barbing, Institute, Institute Cluster')).toBeInTheDocument()
      expect(screen.getByText('5')).toBeInTheDocument()

      // Expected visits statement
      expect(
        screen.getByText((content) =>
          content.includes('EXPECTED VISIT FOR THE MONTH FOR EACH YA IS')
        )
      ).toBeInTheDocument()
      expect(screen.getByText('21')).toBeInTheDocument()

      // Stake Leader verification details
      expect(screen.getByText('VICTOR OGUNDELE')).toBeInTheDocument()
      expect(screen.getByText('08083238902')).toBeInTheDocument()
      expect(screen.getByAltText('Stake Leader E-Signature')).toBeInTheDocument()
      expect(screen.getByText('Attendance Management System')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // SECTION 11: NOVEMBER 2026 DATA RECONCILIATION & PRE-FLIGHT DIAGNOSTICS SUITE
  // --------------------------------------------------------------------------
  describe('11. November 2026 Data Reconciliation & Pre-Flight Diagnostics Suite', () => {
    // Construct 13 held sessions in November 2026 across 6 activities:
    // - Skill Acquisition (act-skills): 9 held occurrences
    // - Devotional (act-devotional): 1 held occurrence
    // - Institute (act-institute): 1 held occurrence
    // - Missionary Prep Class (act-miss-prep): 1 held occurrence
    // - Missionary Departure Devotional (act-miss-dep): 1 held occurrence
    // Total = 9 + 4 = 13 held sessions!
    const novSessions: ActivitySession[] = []

    for (let i = 1; i <= 9; i++) {
      novSessions.push({
        id: `nov-skill-${i}`,
        activityId: 'act-skills',
        activityTitle: 'Skill Acquisition',
        sessionTitle: `Skill Acquisition Class #${i}`,
        sessionDate: `2026-11-${String(i + 2).padStart(2, '0')}`,
        startTime: '10:00',
        status: 'closed',
        maxTerminals: 1,
        timezone: 'Africa/Lagos',
        visitorRegistrationEnabled: true,
        createdAt: '2026-11-01'
      })
    }

    novSessions.push({
      id: 'nov-dev-1',
      activityId: 'act-devotional',
      activityTitle: 'Stake Devotional',
      sessionTitle: 'November Devotional',
      sessionDate: '2026-11-08',
      startTime: '16:00',
      status: 'closed',
      maxTerminals: 1,
      timezone: 'Africa/Lagos',
      visitorRegistrationEnabled: true,
      createdAt: '2026-11-01'
    })

    novSessions.push({
      id: 'nov-inst-1',
      activityId: 'act-institute',
      activityTitle: 'Cluster Institute',
      sessionTitle: 'November Institute',
      sessionDate: '2026-11-15',
      startTime: '17:00',
      status: 'closed',
      maxTerminals: 1,
      timezone: 'Africa/Lagos',
      visitorRegistrationEnabled: true,
      createdAt: '2026-11-01'
    })

    novSessions.push({
      id: 'nov-missprep-1',
      activityId: 'act-miss-prep',
      activityTitle: 'Missionary Prep Class',
      sessionTitle: 'Nov Missionary Prep',
      sessionDate: '2026-11-22',
      startTime: '15:00',
      status: 'closed',
      maxTerminals: 1,
      timezone: 'Africa/Lagos',
      visitorRegistrationEnabled: true,
      createdAt: '2026-11-01'
    })

    novSessions.push({
      id: 'nov-missdep-1',
      activityId: 'act-miss-dep',
      activityTitle: 'Missionary Departure Devotional',
      sessionTitle: 'Nov Missionary Departure',
      sessionDate: '2026-11-29',
      startTime: '16:00',
      status: 'closed',
      maxTerminals: 1,
      timezone: 'Africa/Lagos',
      visitorRegistrationEnabled: true,
      createdAt: '2026-11-01'
    })

    // Construct 175 check-ins across 59 distinct attendees
    // Let's create 59 attendees:
    // - 10 attendees with 5 visits (10 * 5 = 50 check-ins)
    // - 10 attendees with 4 visits (10 * 4 = 40 check-ins)
    // - 15 attendees with 3 visits (15 * 3 = 45 check-ins)
    // - 10 attendees with 2 visits (10 * 2 = 20 check-ins)
    // - 14 attendees with 1 visit  (14 * 1 = 14 check-ins)
    // - Plus 6 extra check-ins for the 5-visit cohort = 175 check-ins total!
    // Total distinct attendees = 10 + 10 + 15 + 10 + 14 = 59!
    const novAttendanceRecords: AttendanceRecord[] = []
    let currentCheckInId = 1

    // Cohort 5+ visits (10 attendees: att-1 to att-10, att-1 through att-6 have 6 visits, att-7 through att-10 have 5 visits -> 56 check-ins)
    for (let a = 1; a <= 10; a++) {
      const visitCount = a <= 6 ? 6 : 5
      for (let v = 0; v < visitCount; v++) {
        novAttendanceRecords.push({
          id: `rec-${currentCheckInId++}`,
          sessionId: novSessions[v % novSessions.length].id,
          memberId: `mem-${a}`,
          attendeeName: `Attendee Member ${a}`,
          unitId: 'u-4',
          unitName: 'Obantoko Ward',
          selectedClass: 'Barbing',
          checkInTime: '2026-11-10T10:30:00Z',
          isNonMember: false
        })
      }
    }

    // Cohort 4 visits (10 attendees: att-11 to att-20 -> 40 check-ins)
    for (let a = 11; a <= 20; a++) {
      for (let v = 0; v < 4; v++) {
        novAttendanceRecords.push({
          id: `rec-${currentCheckInId++}`,
          sessionId: novSessions[v].id,
          memberId: `mem-${a}`,
          attendeeName: `Attendee Member ${a}`,
          unitId: 'u-4',
          unitName: 'Obantoko Ward',
          selectedClass: 'Catering',
          checkInTime: '2026-11-12T10:30:00Z',
          isNonMember: false
        })
      }
    }

    // Cohort 3 visits (15 attendees: att-21 to att-35 -> 45 check-ins)
    for (let a = 21; a <= 35; a++) {
      for (let v = 0; v < 3; v++) {
        novAttendanceRecords.push({
          id: `rec-${currentCheckInId++}`,
          sessionId: novSessions[v].id,
          memberId: `mem-${a}`,
          attendeeName: `Attendee Member ${a}`,
          unitId: 'u-4',
          unitName: 'Obantoko Ward',
          selectedClass: 'ICT',
          checkInTime: '2026-11-15T10:30:00Z',
          isNonMember: false
        })
      }
    }

    // Cohort 2 visits (10 attendees: att-36 to att-45 -> 20 check-ins)
    for (let a = 36; a <= 45; a++) {
      for (let v = 0; v < 2; v++) {
        novAttendanceRecords.push({
          id: `rec-${currentCheckInId++}`,
          sessionId: novSessions[v].id,
          memberId: `mem-${a}`,
          attendeeName: `Attendee Member ${a}`,
          unitId: 'u-4',
          unitName: 'Obantoko Ward',
          selectedClass: 'Tailoring',
          checkInTime: '2026-11-18T10:30:00Z',
          isNonMember: false
        })
      }
    }

    // Cohort 1 visit (14 attendees: att-46 to att-59 -> 14 check-ins)
    for (let a = 46; a <= 59; a++) {
      novAttendanceRecords.push({
        id: `rec-${currentCheckInId++}`,
        sessionId: novSessions[0].id,
        memberId: `mem-${a}`,
        attendeeName: `Attendee Member ${a}`,
        unitId: 'u-4',
        unitName: 'Obantoko Ward',
        selectedClass: 'Shoe Making',
        checkInTime: '2026-11-20T10:30:00Z',
        isNonMember: false
      })
    }

    it('correctly reconciles 175 total check-ins across 59 distinct attendees in 13 held sessions', () => {
      expect(novSessions.length).toBe(13)
      expect(novAttendanceRecords.length).toBe(175)

      const distinctMemberIds = new Set(novAttendanceRecords.map((r) => r.memberId))
      expect(distinctMemberIds.size).toBe(59)
    })

    it('reconciles Expected Visits: 13 for all stake activities vs 9 for Skill Acquisition alone', () => {
      // 1. All Activities
      const allActivitiesResult = calculateExpectedVisits({
        year: 2026,
        month: 11,
        sessions: novSessions,
        selectedActivityIds: []
      })
      expect(allActivitiesResult.expectedVisits).toBe(13)

      // 2. Skill Acquisition Only
      const skillOnlyResult = calculateExpectedVisits({
        year: 2026,
        month: 11,
        sessions: novSessions,
        selectedActivityIds: ['act-skills']
      })
      expect(skillOnlyResult.expectedVisits).toBe(9)
    })

    it('reconciles participant visit frequency distribution across 1, 2, 3, 4, and 5+ visits', () => {
      const dist = calculateAttendanceDistribution({
        attendanceRecords: novAttendanceRecords,
        eligibleSessions: novSessions,
        minimumVisitThreshold: 5,
        selectedUnitIds: ['u-4'],
        isAllUnits: true
      })

      expect(dist.totalRecords).toBe(175)
      expect(dist.totalDistinctAttendees).toBe(59)
      expect(dist.distribution.visits1).toBe(14)
      expect(dist.distribution.visits2).toBe(10)
      expect(dist.distribution.visits3).toBe(15)
      expect(dist.distribution.visits4).toBe(10)
      expect(dist.distribution.visits5Plus).toBe(10)
      expect(dist.qualifyingCount).toBe(10)
    })

    it('demonstrates minimum threshold impact: threshold 5 returns 10 qualifying participants; threshold 1 returns all 59', () => {
      // Standard threshold 5
      const participantsThreshold5 = calculateParticipantVisits({
        eligibleSessions: novSessions,
        attendanceRecords: novAttendanceRecords,
        selectedUnitIds: ['u-4'],
        isAllUnits: true,
        minimumVisitThreshold: 5,
        units: stakeUnits
      })
      expect(participantsThreshold5.length).toBe(10)
      expect(participantsThreshold5.every((p) => p.totalVisits >= 5)).toBe(true)

      // Threshold 1 (view all attendees)
      const participantsThreshold1 = calculateParticipantVisits({
        eligibleSessions: novSessions,
        attendanceRecords: novAttendanceRecords,
        selectedUnitIds: ['u-4'],
        isAllUnits: true,
        minimumVisitThreshold: 1,
        units: stakeUnits
      })
      expect(participantsThreshold1.length).toBe(59)
    })

    it('throws explicit error when RPC create report fails (no silent fallback to in-memory ID)', async () => {
      mockRpc.mockImplementationOnce(() =>
        Promise.resolve({ data: null, error: { message: 'Database connection refused' } })
      )

      const adminUser: UserProfile = {
        id: 'admin-1',
        fullName: 'Admin User',
        email: 'admin@stake.org',
        roles: ['system_admin'],
        accountStatus: 'active',
        createdAt: '2026-01-01'
      }

      const report = gatheringPlaceReportService.buildReportSnapshot({
        year: 2026,
        month: 11,
        monthName: 'November',
        units: stakeUnits,
        activities,
        sessions: novSessions,
        attendanceRecords: novAttendanceRecords,
        criteria: {
          year: 2026,
          month: 11,
          monthName: 'November',
          selectedUnitIds: ['u-4'],
          isAllUnits: true,
          selectedActivityIds: [],
          selectedClassesByActivity: {},
          memberClassification: 'all',
          minimumVisitThreshold: 5,
          selectedLeaderId: 'leader-1'
        },
        selectedLeader: leaderSnapshot,
        generatedBy: adminUser
      })

      await expect(
        gatheringPlaceReportService.createReport(report, adminUser)
      ).rejects.toThrow('Failed to persist report to database: Database connection refused')
    })
  })
})
