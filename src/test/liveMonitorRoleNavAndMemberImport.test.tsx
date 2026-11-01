import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import {
  computeLiveSessionMetrics,
  LiveActiveSessionView
} from '../components/reporting/LiveActiveSessionView'
import { deriveLeadershipAccess } from '../context/AuthContext'
import {
  getRolePermittedNavItems,
  isLeadershipRoutePermitted,
  RESTRICTED_MANUAL_CHECKIN_ROLES
} from '../components/layout/LeadershipSidebar'
import {
  normalizeMemberGender,
  validateMembersCsv,
  memberService
} from '../services/memberService'
import { ActivitySession, AppRole, StakeUnit, UserUnitAssignment } from '../types/database'

const { mockFrom, mockChannel, mockRemoveChannel, mockAuthState } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockChannel: vi.fn(),
  mockRemoveChannel: vi.fn(),
  mockAuthState: {
    hasStakeWideReadAccess: true,
    reportUnitFilter: null as string[] | null,
    assignedUnitIds: [] as string[]
  }
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
    channel: (...args: any[]) => mockChannel(...args),
    removeChannel: (...args: any[]) => mockRemoveChannel(...args)
  }
}))

vi.mock('../context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../context/AuthContext')>()
  return {
    ...actual,
    useAuth: () => mockAuthState
  }
})

const UNIT_OBANTOKO_1 = '11111111-1111-4111-8111-111111111111'
const UNIT_OBANTOKO_2 = '22222222-2222-4222-8222-222222222222'
const UNIT_CAMP_BRANCH = '33333333-3333-4333-8333-333333333333'

const SAMPLE_UNITS: StakeUnit[] = [
  {
    id: UNIT_OBANTOKO_1,
    unitName: 'Obantoko 1st Ward',
    unitType: 'ward',
    isActive: true,
    createdAt: '2026-10-01T00:00:00Z'
  },
  {
    id: UNIT_OBANTOKO_2,
    unitName: 'Obantoko 2nd Ward',
    unitType: 'ward',
    isActive: true,
    createdAt: '2026-10-01T00:00:00Z'
  },
  {
    id: UNIT_CAMP_BRANCH,
    unitName: 'Camp Branch',
    unitType: 'branch',
    isActive: true,
    createdAt: '2026-10-01T00:00:00Z'
  }
]

const SAMPLE_SESSION: ActivitySession = {
  id: 'sess-active-001',
  activityId: 'act-001',
  activityTitle: 'Stake Skill Acquisition & Institute',
  activityCategory: 'Skill Acquisition',
  sessionTitle: 'Saturday Skill Acquisition Workshop',
  sessionDate: '2026-11-01',
  startTime: '10:00',
  scheduledEndTime: '14:00',
  gracePeriodMinutes: 15,
  timezone: 'Africa/Lagos',
  status: 'active',
  maxTerminals: 2,
  visitorRegistrationEnabled: true,
  participatingUnits: [UNIT_OBANTOKO_1, UNIT_OBANTOKO_2],
  classOptions: ['Caterers & Confectioneries', 'Graphics & Media', 'Coding & Software'],
  createdAt: '2026-11-01T08:00:00Z'
}

describe('ISSUE 1 — Live Monitor Accuracy & Reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthState.hasStakeWideReadAccess = true
    mockAuthState.reportUnitFilter = null
    mockAuthState.assignedUnitIds = []

    const channelObj: any = {
      on: vi.fn().mockImplementation(() => channelObj),
      subscribe: vi.fn().mockImplementation((cb?: (status: string) => void) => {
        if (cb) cb('SUBSCRIBED')
        return channelObj
      })
    }
    mockChannel.mockReturnValue(channelObj)
  })

  it('accurately counts single member check-in, single visitor check-in, and reconciles unit & class totals', () => {
    const metrics = computeLiveSessionMetrics({
      sessionId: SAMPLE_SESSION.id,
      sessionStatus: SAMPLE_SESSION.status,
      units: SAMPLE_UNITS,
      participatingUnits: SAMPLE_SESSION.participatingUnits,
      authorizedUnitIds: null,
      configuredClasses: SAMPLE_SESSION.classOptions,
      isSkillAcquisition: true,
      rawMemberRows: [
        {
          id: 'att-1',
          session_id: SAMPLE_SESSION.id,
          member_id: 'mem-1',
          recorded_unit_id: UNIT_OBANTOKO_1,
          recorded_by_terminal_id: 'term-1',
          selected_class: 'Coding & Software',
          check_in_time: '2026-11-01T10:05:00Z',
          members: {
            id: 'mem-1',
            full_name: 'Oluwatosin Adeyemi',
            home_unit_id: UNIT_OBANTOKO_1
          }
        }
      ],
      rawVisitorRows: [
        {
          id: 'vis-1',
          session_id: SAMPLE_SESSION.id,
          full_name: 'Chinedu Okafor',
          is_church_member: false,
          inviting_unit_id: UNIT_OBANTOKO_2,
          recorded_by_terminal_id: 'term-1',
          selected_class: 'Graphics & Media',
          created_at: '2026-11-01T10:07:00Z'
        }
      ]
    })

    expect(metrics.totalValidCheckIns).toBe(2)
    expect(metrics.distinctAttendeesCount).toBe(2)
    expect(metrics.memberCount).toBe(1)
    expect(metrics.visitorCount).toBe(1)
    expect(metrics.reconciled.memberVisitorReconciled).toBe(true)
    expect(metrics.reconciled.unitBreakdownReconciled).toBe(true)
    expect(metrics.reconciled.classBreakdownReconciled).toBe(true)
  })

  it('deduplicates duplicate realtime/member records and counts two distinct members sharing the same full_name separately', () => {
    const metrics = computeLiveSessionMetrics({
      sessionId: SAMPLE_SESSION.id,
      sessionStatus: SAMPLE_SESSION.status,
      units: SAMPLE_UNITS,
      participatingUnits: SAMPLE_SESSION.participatingUnits,
      authorizedUnitIds: null,
      configuredClasses: SAMPLE_SESSION.classOptions,
      isSkillAcquisition: true,
      rawMemberRows: [
        // First person named Samuel Ajayi
        {
          id: 'att-1',
          session_id: SAMPLE_SESSION.id,
          member_id: 'mem-samuel-1',
          recorded_unit_id: UNIT_OBANTOKO_1,
          recorded_by_terminal_id: 'term-1',
          selected_class: 'Coding & Software',
          check_in_time: '2026-11-01T10:05:00Z',
          members: { id: 'mem-samuel-1', full_name: 'Samuel Ajayi', home_unit_id: UNIT_OBANTOKO_1 }
        },
        // Duplicate delivery of the same member_id in the same session
        {
          id: 'att-1-dup',
          session_id: SAMPLE_SESSION.id,
          member_id: 'mem-samuel-1',
          recorded_unit_id: UNIT_OBANTOKO_1,
          recorded_by_terminal_id: 'term-1',
          selected_class: 'Coding & Software',
          check_in_time: '2026-11-01T10:06:00Z',
          members: { id: 'mem-samuel-1', full_name: 'Samuel Ajayi', home_unit_id: UNIT_OBANTOKO_1 }
        },
        // Second distinct person with the exact same name "Samuel Ajayi"
        {
          id: 'att-2',
          session_id: SAMPLE_SESSION.id,
          member_id: 'mem-samuel-2',
          recorded_unit_id: UNIT_OBANTOKO_2,
          recorded_by_terminal_id: null, // Manual leader check-in
          selected_class: 'Coding & Software',
          check_in_time: '2026-11-01T10:08:00Z',
          members: { id: 'mem-samuel-2', full_name: 'Samuel Ajayi', home_unit_id: UNIT_OBANTOKO_2 }
        },
        // Record from a different session_id (must be ignored)
        {
          id: 'att-other-session',
          session_id: 'sess-other-999',
          member_id: 'mem-other',
          recorded_unit_id: UNIT_OBANTOKO_1,
          recorded_by_terminal_id: 'term-1',
          selected_class: 'Coding & Software',
          check_in_time: '2026-11-01T10:09:00Z',
          members: { id: 'mem-other', full_name: 'Wrong Session Person', home_unit_id: UNIT_OBANTOKO_1 }
        }
      ],
      rawVisitorRows: []
    })

    // Only 2 valid check-ins for SAMPLE_SESSION (duplicate mem-samuel-1 & wrong session excluded)
    expect(metrics.totalValidCheckIns).toBe(2)
    // Both "Samuel Ajayi" records have distinct member_ids, so distinctAttendeesCount is 2 (not 1!)
    expect(metrics.distinctAttendeesCount).toBe(2)
    expect(metrics.memberCount).toBe(2)
    expect(metrics.visitorCount).toBe(0)
    // Manual check-in (recorded_by_terminal_id === null) is properly flagged
    const manualEntry = metrics.recentItems.find((r) => r.id === 'att-2')
    expect(manualEntry?.isManual).toBe(true)
  })

  it('transparently reconciles visitors with no inviting_unit_id and records missing selected_class', () => {
    const metrics = computeLiveSessionMetrics({
      sessionId: SAMPLE_SESSION.id,
      sessionStatus: SAMPLE_SESSION.status,
      units: SAMPLE_UNITS,
      participatingUnits: SAMPLE_SESSION.participatingUnits,
      authorizedUnitIds: null,
      configuredClasses: SAMPLE_SESSION.classOptions,
      isSkillAcquisition: true,
      rawMemberRows: [
        {
          id: 'att-legacy',
          session_id: SAMPLE_SESSION.id,
          member_id: 'mem-10',
          recorded_unit_id: UNIT_OBANTOKO_1,
          recorded_by_terminal_id: 'term-1',
          selected_class: null,
          check_in_time: '2026-11-01T10:10:00Z',
          members: { id: 'mem-10', full_name: 'Kehinde Balogun', home_unit_id: UNIT_OBANTOKO_1 }
        }
      ],
      rawVisitorRows: [
        {
          id: 'vis-unassigned',
          session_id: SAMPLE_SESSION.id,
          full_name: 'Walk-in Guest',
          is_church_member: false,
          inviting_unit_id: null,
          recorded_by_terminal_id: 'term-1',
          selected_class: 'Caterers & Confectioneries',
          created_at: '2026-11-01T10:12:00Z'
        }
      ]
    })

    expect(metrics.totalValidCheckIns).toBe(2)
    expect(metrics.reconciled.unitBreakdownReconciled).toBe(true)
    expect(metrics.reconciled.classBreakdownReconciled).toBe(true)

    const unassignedUnitRow = metrics.unitBreakdown.find((u) => u.isUnassigned)
    expect(unassignedUnitRow).toBeDefined()
    expect(unassignedUnitRow?.visitors).toBe(1)

    const unclassifiedClassRow = metrics.classBreakdown.find(
      (c) => c.className === 'Unassigned / Not Specified'
    )
    expect(unclassifiedClassRow).toBeDefined()
    expect(unclassifiedClassRow?.total).toBe(1)
  })

  it('clearly distinguishes database fetch failure from zero attendance in LiveActiveSessionView', async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: null,
            error: { message: 'Database connection timeout while querying attendance_records' }
          })
      })
    }))

    render(
      <LiveActiveSessionView
        session={SAMPLE_SESSION}
        units={SAMPLE_UNITS}
        onClose={() => {}}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /Attendance figures cannot be displayed until connection is restored/i
      )
    })

    // Must show '—' instead of '0' when fetch fails and no data has ever been loaded
    expect(screen.getByTestId('live-metric-total-checkins')).toHaveTextContent('—')
    expect(screen.getByTestId('live-metric-distinct-attendees')).toHaveTextContent('—')
    expect(screen.getByTestId('live-monitor-connection-status')).toHaveTextContent(
      'Awaiting initial sync'
    )
  })

  it('queries only valid columns on public.attendance_records and displays accurate totals for Stake Clerk', async () => {
    // Simulate Stake Clerk (hasStakeWideReadAccess = true, assignedUnitIds = [])
    mockAuthState.hasStakeWideReadAccess = true
    mockAuthState.reportUnitFilter = null
    mockAuthState.assignedUnitIds = []

    const selectSpies: Record<string, string> = {}

    mockFrom.mockImplementation((table: string) => ({
      select: (columns: string) => {
        selectSpies[table] = columns
        return {
          eq: () => {
            if (table === 'attendance_records') {
              return Promise.resolve({
                data: [
                  {
                    id: 'att-live-1',
                    session_id: SAMPLE_SESSION.id,
                    member_id: 'mem-live-1',
                    recorded_unit_id: UNIT_OBANTOKO_1,
                    recorded_by_terminal_id: 'term-1',
                    selected_class: 'Coding & Software',
                    check_in_time: '2026-11-01T11:00:00Z',
                    created_at: '2026-11-01T11:00:00Z',
                    members: {
                      id: 'mem-live-1',
                      full_name: 'Adebayo Ogunlesi',
                      home_unit_id: UNIT_OBANTOKO_1
                    }
                  }
                ],
                error: null
              })
            }
            return Promise.resolve({
              data: [
                {
                  id: 'vis-live-1',
                  session_id: SAMPLE_SESSION.id,
                  full_name: 'Tunde Visitor',
                  is_church_member: false,
                  inviting_unit_id: UNIT_OBANTOKO_2,
                  recorded_by_terminal_id: 'term-1',
                  selected_class: 'Graphics & Media',
                  created_at: '2026-11-01T11:02:00Z'
                }
              ],
              error: null
            })
          }
        }
      }
    }))

    render(
      <LiveActiveSessionView
        session={SAMPLE_SESSION}
        units={SAMPLE_UNITS}
        onClose={() => {}}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('live-metric-total-checkins')).toHaveTextContent('2')
    })

    // Ensure non-existent columns are NEVER requested from public.attendance_records
    expect(selectSpies['attendance_records']).not.toContain('attendee_name')
    expect(selectSpies['attendance_records']).not.toContain('is_non_member')
    expect(selectSpies['attendance_records']).not.toContain('is_manual')

    expect(screen.getByTestId('live-metric-distinct-attendees')).toHaveTextContent('2')
    expect(screen.getByTestId('live-metric-members')).toHaveTextContent('1')
    expect(screen.getByTestId('live-metric-visitors')).toHaveTextContent('1')
    // Stake Clerk sees both participating units
    expect(screen.getAllByText('Obantoko 1st Ward').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Obantoko 2nd Ward').length).toBeGreaterThan(0)
  })
})

describe('ISSUE 2 — Role-Based Navigation & Authorized Leader Check-In Removal', () => {
  const makeAssignments = (role: AppRole, withUnit = true): UserUnitAssignment[] =>
    withUnit
      ? [
          {
            id: 'ua-1',
            userId: `user-${role}`,
            unitId: UNIT_OBANTOKO_1,
            unitName: 'Obantoko 1st Ward',
            assignedRole:
              role === 'system_admin' || role === 'stake_presidency' || role === 'stake_clerk'
                ? 'ysa_leader'
                : role,
            createdAt: '2026-10-01T00:00:00Z'
          }
        ]
      : []

  it('lists the exact 5 restricted roles for Authorized Leader Check-In removal', () => {
    expect(RESTRICTED_MANUAL_CHECKIN_ROLES).toEqual([
      'bishop',
      'branch_president',
      'ward_clerk',
      'branch_clerk',
      'stake_clerk'
    ])
  })

  it.each(['bishop', 'branch_president', 'ward_clerk', 'branch_clerk'] as const)(
    'enforces strict view-only permissions and removes Authorized Leader Check-In for %s',
    (role) => {
      const access = deriveLeadershipAccess([role], makeAssignments(role, true))
      expect(access.canRecordManualAttendance).toBe(false)
      expect(access.isViewOnlyRoleOnly).toBe(true)
      expect(access.canManageActivities).toBe(false)
      expect(access.canManageMembers).toBe(false)
      expect(access.isStakeLeader).toBe(false)
      expect(access.reportUnitFilter).toEqual([UNIT_OBANTOKO_1])

      const navItems = getRolePermittedNavItems({
        isStakeLeader: access.isStakeLeader,
        canRecordManualAttendance: access.canRecordManualAttendance
      })
      expect(navItems.some((item) => item.id === 'attendance')).toBe(false)
      expect(
        isLeadershipRoutePermitted('attendance', {
          isStakeLeader: access.isStakeLeader,
          canRecordManualAttendance: access.canRecordManualAttendance
        })
      ).toBe(false)
    }
  )

  it('removes Authorized Leader Check-In for stake_clerk while preserving stake-wide read access and non-view-only status', () => {
    const access = deriveLeadershipAccess(['stake_clerk'], makeAssignments('stake_clerk', false))

    // Removed from manual check-in
    expect(access.canRecordManualAttendance).toBe(false)
    const navItems = getRolePermittedNavItems({
      isStakeLeader: access.isStakeLeader,
      canRecordManualAttendance: access.canRecordManualAttendance
    })
    expect(navItems.some((item) => item.id === 'attendance')).toBe(false)
    expect(
      isLeadershipRoutePermitted('attendance', {
        isStakeLeader: access.isStakeLeader,
        canRecordManualAttendance: access.canRecordManualAttendance
      })
    ).toBe(false)

    // Preserves all other existing Stake Clerk capabilities
    expect(access.isStakeClerk).toBe(true)
    expect(access.hasStakeWideReadAccess).toBe(true)
    expect(access.isViewOnlyRoleOnly).toBe(false)
    expect(access.reportUnitFilter).toBeNull()
  })

  it.each(['system_admin', 'stake_presidency', 'ysa_leader'] as const)(
    'preserves Authorized Leader Check-In and operational mutation permissions for %s',
    (role) => {
      const access = deriveLeadershipAccess([role], makeAssignments(role, true))
      expect(access.canRecordManualAttendance).toBe(true)
      expect(access.canManageActivities).toBe(true)
      expect(access.canManageMembers).toBe(true)
      expect(access.isViewOnlyRoleOnly).toBe(false)

      const navItems = getRolePermittedNavItems({
        isStakeLeader: access.isStakeLeader,
        canRecordManualAttendance: access.canRecordManualAttendance
      })
      expect(navItems.some((item) => item.id === 'attendance')).toBe(true)
      expect(
        isLeadershipRoutePermitted('attendance', {
          isStakeLeader: access.isStakeLeader,
          canRecordManualAttendance: access.canRecordManualAttendance
        })
      ).toBe(true)
    }
  )
})

describe('ISSUE 3 — Member CSV Import & Canonical Gender Mapping', () => {
  it('normalizes M, Male, m, male, F, Female, f, female, and empty values to canonical database representation', () => {
    expect(normalizeMemberGender('M')).toEqual({
      valid: true,
      value: 'male',
      wasNormalized: true,
      raw: 'M'
    })
    expect(normalizeMemberGender('Male')).toEqual({
      valid: true,
      value: 'male',
      wasNormalized: true,
      raw: 'Male'
    })
    expect(normalizeMemberGender('m')).toEqual({
      valid: true,
      value: 'male',
      wasNormalized: true,
      raw: 'm'
    })
    expect(normalizeMemberGender('male')).toEqual({
      valid: true,
      value: 'male',
      wasNormalized: false,
      raw: 'male'
    })
    expect(normalizeMemberGender('F')).toEqual({
      valid: true,
      value: 'female',
      wasNormalized: true,
      raw: 'F'
    })
    expect(normalizeMemberGender('Female')).toEqual({
      valid: true,
      value: 'female',
      wasNormalized: true,
      raw: 'Female'
    })
    expect(normalizeMemberGender('f')).toEqual({
      valid: true,
      value: 'female',
      wasNormalized: true,
      raw: 'f'
    })
    expect(normalizeMemberGender('female')).toEqual({
      valid: true,
      value: 'female',
      wasNormalized: false,
      raw: 'female'
    })
    expect(normalizeMemberGender('')).toEqual({
      valid: true,
      value: null,
      wasNormalized: false,
      raw: ''
    })
    expect(normalizeMemberGender('   ')).toEqual({
      valid: true,
      value: null,
      wasNormalized: false,
      raw: '   '
    })

    const unknown = normalizeMemberGender('UnknownGender')
    expect(unknown.valid).toBe(false)
    expect(unknown.value).toBeNull()
    expect(unknown.error).toContain('Invalid gender value "UnknownGender"')
  })

  it('validates a full 886-row Member CSV with gender=M/F and calculates accurate pre-import summary', () => {
    const header = 'id,full_name,preferred_name,gender,phone_number,email,home_unit_id,is_active'
    const rows: string[] = [header]

    for (let i = 1; i <= 886; i++) {
      const hex = i.toString(16).padStart(12, '0')
      const uuid = `00000000-0000-4000-8000-${hex}`
      const gender = i % 2 === 0 ? 'F' : 'M'
      const unitId = i % 2 === 0 ? UNIT_OBANTOKO_2 : UNIT_OBANTOKO_1
      rows.push(
        `${uuid},Member Name ${i},Pref ${i},${gender},0803000${String(i).padStart(4, '0')},member${i}@example.com,${unitId},true`
      )
    }

    const result = validateMembersCsv(rows.join('\n'), {
      units: SAMPLE_UNITS,
      existingMembers: []
    })

    expect(result.isValid).toBe(true)
    expect(result.summary.totalRows).toBe(886)
    expect(result.summary.validRows).toBe(886)
    expect(result.summary.invalidRows).toBe(0)
    expect(result.summary.genderMappingIssues).toBe(0)
    expect(result.summary.genderNormalizedCount).toBe(886)
    expect(result.summary.missingRequiredFields).toBe(0)
    expect(result.summary.duplicateOrConflictingRecords).toBe(0)
    expect(result.validRecords[0].gender).toBe('male')
    expect(result.validRecords[1].gender).toBe('female')
  })

  it('detects invalid gender values, missing required fields, invalid unit references, and duplicate records with row/column detail', () => {
    const csv = [
      'id,full_name,gender,home_unit_id,member_number',
      `10000000-0000-4000-8000-000000000001,Valid Member,M,${UNIT_OBANTOKO_1},MRN-01`,
      `10000000-0000-4000-8000-000000000002,,F,${UNIT_OBANTOKO_1},MRN-02`, // Missing full_name
      `10000000-0000-4000-8000-000000000003,Bad Gender Person,X,${UNIT_OBANTOKO_1},MRN-03`, // Invalid gender
      `10000000-0000-4000-8000-000000000004,Unknown Unit Person,Female,99999999-9999-4999-8999-999999999999,MRN-04`, // Non-existent unit
      `10000000-0000-4000-8000-000000000005,Valid Member,Male,${UNIT_OBANTOKO_1},MRN-01` // Duplicate name+unit and duplicate MRN-01
    ].join('\n')

    const result = validateMembersCsv(csv, {
      units: SAMPLE_UNITS,
      existingMembers: []
    })

    expect(result.isValid).toBe(false)
    expect(result.summary.totalRows).toBe(5)
    expect(result.summary.validRows).toBe(1)
    expect(result.summary.invalidRows).toBe(4)
    expect(result.summary.missingRequiredFields).toBe(1)
    expect(result.summary.genderMappingIssues).toBe(1)
    expect(result.summary.invalidUnitOrUuidReferences).toBe(1)
    expect(result.summary.duplicateOrConflictingRecords).toBe(1)

    expect(result.rowErrorsByRow[2][0].column).toBe('full_name')
    expect(result.rowErrorsByRow[3][0].column).toBe('gender')
    expect(result.rowErrorsByRow[4][0].column).toBe('home_unit_id')
    expect(result.rowErrorsByRow[5].some((e) => e.category === 'duplicate_or_conflict')).toBe(true)
  })

  it('prevents partial imports when any row is invalid and executes atomic insert when all rows are valid', async () => {
    const insertSpy = vi.fn()
    mockFrom.mockImplementation(() => ({
      insert: (rows: any[]) => {
        insertSpy(rows)
        return {
          select: () =>
            Promise.resolve({ data: rows.map((_, idx) => ({ id: `id-${idx}` })), error: null })
        }
      }
    }))

    // 1. Mixed valid + invalid CSV must abort without inserting any rows
    const mixedCsv = [
      'full_name,gender,home_unit_id',
      `Valid Person,M,${UNIT_OBANTOKO_1}`,
      `Invalid Person,INVALID_GENDER,${UNIT_OBANTOKO_1}`
    ].join('\n')

    const failedImport = await memberService.importMembersFromCsv(mixedCsv, {
      units: SAMPLE_UNITS,
      existingMembers: []
    })

    expect(failedImport.success).toBe(false)
    expect(failedImport.insertedCount).toBe(0)
    expect(insertSpy).not.toHaveBeenCalled()

    // 2. All-valid CSV with shorthand genders 'M' and 'F' inserts atomically with canonical 'male' and 'female'
    const validCsv = [
      'id,full_name,gender,home_unit_id',
      `10000000-0000-4000-8000-000000000011,Brother One,M,${UNIT_OBANTOKO_1}`,
      `10000000-0000-4000-8000-000000000012,Sister Two,F,${UNIT_OBANTOKO_2}`
    ].join('\n')

    const successImport = await memberService.importMembersFromCsv(validCsv, {
      units: SAMPLE_UNITS,
      existingMembers: []
    })

    expect(successImport.success).toBe(true)
    expect(successImport.insertedCount).toBe(2)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(insertSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        id: '10000000-0000-4000-8000-000000000011',
        full_name: 'Brother One',
        gender: 'male',
        home_unit_id: UNIT_OBANTOKO_1
      }),
      expect.objectContaining({
        id: '10000000-0000-4000-8000-000000000012',
        full_name: 'Sister Two',
        gender: 'female',
        home_unit_id: UNIT_OBANTOKO_2
      })
    ])
  })
})
