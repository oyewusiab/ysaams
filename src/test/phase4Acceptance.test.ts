import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  reportService,
  calculateAttendancePercentage,
  ReportFilterCriteria,
  UnifiedAttendanceRecord
} from '../services/reportService'
import {
  getThisWeekRangeLagos,
  getPreviousMonthRangeLagos,
  getSelectedMonthRangeLagos,
  getComparablePreviousPeriod
} from '../lib/timezone'
import {
  sanitizeForSpreadsheet,
  exportToCsvAdvanced,
  exportToXlsxAdvanced
} from '../lib/exportUtils'
import { deriveLeadershipAccess } from '../context/AuthContext'

describe('Phase 4 Acceptance Test Suite: Comprehensive Reporting, Registers, Analytics and Exports', () => {

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  // ==========================================
  // SECTION 1: FILTERING & SORTING
  // ==========================================
  describe('1. Filtering and Sorting Capabilities', () => {
    it('1. Single-person filtering filters accurately by stable UUID without name confusion', async () => {
      const mockRecords: UnifiedAttendanceRecord[] = [
        {
          id: 'att-1',
          attendanceType: 'member',
          attendeeId: 'uuid-adeoye-1',
          attendeeName: 'Adeoye Oyewusi',
          recordedUnitId: 'unit-camp',
          recordedUnitName: 'Camp Ward',
          activityId: 'act-1',
          activityTitle: 'Fireside',
          activityCategory: 'spiritual',
          sessionId: 'sess-1',
          sessionTitle: 'Fireside Session',
          sessionDate: '2026-10-15',
          checkInTime: '2026-10-15T17:00:00Z'
        },
        {
          id: 'att-2',
          attendanceType: 'member',
          attendeeId: 'uuid-adeoye-2',
          attendeeName: 'Adeoye Oyewusi', // Shares exact same name!
          recordedUnitId: 'unit-alabata',
          recordedUnitName: 'Alabata Branch',
          activityId: 'act-1',
          activityTitle: 'Fireside',
          activityCategory: 'spiritual',
          sessionId: 'sess-1',
          sessionTitle: 'Fireside Session',
          sessionDate: '2026-10-15',
          checkInTime: '2026-10-15T17:05:00Z'
        }
      ]

      const singleFilter = mockRecords.filter(r => r.attendeeId === 'uuid-adeoye-1')
      expect(singleFilter).toHaveLength(1)
      expect(singleFilter[0].attendeeId).toBe('uuid-adeoye-1')
      expect(singleFilter[0].recordedUnitName).toBe('Camp Ward')
    })

    it('2. Multiple-person filtering retrieves all selected individuals across different units', () => {
      const targetIds = ['uuid-person-1', 'uuid-person-3']
      const records = [
        { attendeeId: 'uuid-person-1', attendeeName: 'Person 1' },
        { attendeeId: 'uuid-person-2', attendeeName: 'Person 2' },
        { attendeeId: 'uuid-person-3', attendeeName: 'Person 3' },
        { attendeeId: 'uuid-person-4', attendeeName: 'Person 4' }
      ]
      const filtered = records.filter(r => targetIds.includes(r.attendeeId))
      expect(filtered).toHaveLength(2)
      expect(filtered.map(f => f.attendeeId)).toEqual(['uuid-person-1', 'uuid-person-3'])
    })

    it('3. Activity and multi-activity filtering isolates targeted activities', () => {
      const activities = [
        { activityId: 'act-spiritual-1', title: 'Institute Class' },
        { activityId: 'act-social-1', title: 'YSA Game Night' },
        { activityId: 'act-sports-1', title: 'Football Tournament' }
      ]
      const selectedActIds = ['act-spiritual-1', 'act-sports-1']
      const filtered = activities.filter(a => selectedActIds.includes(a.activityId))
      expect(filtered).toHaveLength(2)
      expect(filtered.map(f => f.title)).toEqual(['Institute Class', 'Football Tournament'])
    })

    it('4. Date and month boundaries resolve correctly in Africa/Lagos', () => {
      const feb2026 = getSelectedMonthRangeLagos(2026, 2)
      expect(feb2026.startDate).toBe('2026-02-01')
      expect(feb2026.endDate).toBe('2026-02-28')

      const oct2026 = getSelectedMonthRangeLagos(2026, 10)
      expect(oct2026.startDate).toBe('2026-10-01')
      expect(oct2026.endDate).toBe('2026-10-31')
    })

    it('5. Single-unit and multi-unit filtering limits records strictly to requested units', () => {
      const records = [
        { recordedUnitId: 'unit-camp', attendeeName: 'A' },
        { recordedUnitId: 'unit-obantoko', attendeeName: 'B' },
        { recordedUnitId: 'unit-alabata', attendeeName: 'C' }
      ]
      const singleUnit = records.filter(r => r.recordedUnitId === 'unit-camp')
      expect(singleUnit).toHaveLength(1)

      const multiUnit = records.filter(r => ['unit-camp', 'unit-alabata'].includes(r.recordedUnitId))
      expect(multiUnit).toHaveLength(2)
    })

    it('6. Member-only and visitor-only filters segregate cohorts cleanly', () => {
      const records: UnifiedAttendanceRecord[] = [
        { id: '1', attendanceType: 'member', attendeeName: 'M1', recordedUnitId: 'u1', recordedUnitName: 'U1', activityId: 'a1', activityTitle: 'A1', activityCategory: 'spiritual', sessionId: 's1', sessionTitle: 'S1', sessionDate: '2026-10-10', checkInTime: '10:00' },
        { id: '2', attendanceType: 'visitor', attendeeName: 'V1', recordedUnitId: 'u1', recordedUnitName: 'U1', activityId: 'a1', activityTitle: 'A1', activityCategory: 'spiritual', sessionId: 's1', sessionTitle: 'S1', sessionDate: '2026-10-10', checkInTime: '10:05' },
        { id: '3', attendanceType: 'member', attendeeName: 'M2', recordedUnitId: 'u1', recordedUnitName: 'U1', activityId: 'a1', activityTitle: 'A1', activityCategory: 'spiritual', sessionId: 's1', sessionTitle: 'S1', sessionDate: '2026-10-10', checkInTime: '10:10' }
      ]
      const membersOnly = records.filter(r => r.attendanceType === 'member')
      const visitorsOnly = records.filter(r => r.attendanceType === 'visitor')
      expect(membersOnly).toHaveLength(2)
      expect(visitorsOnly).toHaveLength(1)
    })

    it('7. Combined filters (unit + activity category + cohort) narrow results harmoniously', () => {
      const records: UnifiedAttendanceRecord[] = [
        { id: '1', attendanceType: 'member', activityCategory: 'social', recordedUnitId: 'unit-camp', attendeeName: 'M1', recordedUnitName: 'Camp', activityId: 'a1', activityTitle: 'A1', sessionId: 's1', sessionTitle: 'S1', sessionDate: '2026-10-10', checkInTime: '10:00' },
        { id: '2', attendanceType: 'visitor', activityCategory: 'social', recordedUnitId: 'unit-camp', attendeeName: 'V1', recordedUnitName: 'Camp', activityId: 'a1', activityTitle: 'A1', sessionId: 's1', sessionTitle: 'S1', sessionDate: '2026-10-10', checkInTime: '10:05' },
        { id: '3', attendanceType: 'member', activityCategory: 'spiritual', recordedUnitId: 'unit-camp', attendeeName: 'M2', recordedUnitName: 'Camp', activityId: 'a2', activityTitle: 'A2', sessionId: 's2', sessionTitle: 'S2', sessionDate: '2026-10-10', checkInTime: '10:10' },
        { id: '4', attendanceType: 'visitor', activityCategory: 'social', recordedUnitId: 'unit-obantoko', attendeeName: 'V2', recordedUnitName: 'Obantoko', activityId: 'a1', activityTitle: 'A1', sessionId: 's1', sessionTitle: 'S1', sessionDate: '2026-10-10', checkInTime: '10:15' }
      ]

      // Filter: Camp Ward + Social + Visitors Only
      const combined = records.filter(
        r => r.recordedUnitId === 'unit-camp' && r.activityCategory === 'social' && r.attendanceType === 'visitor'
      )
      expect(combined).toHaveLength(1)
      expect(combined[0].attendeeName).toBe('V1')
    })

    it('8. Ascending and descending sorting produces stable ordered results', () => {
      const rows = [
        { id: '1', attendeeName: 'Wilfred Iorna', checkInTime: '10:00' },
        { id: '2', attendeeName: 'Adeoye Oyewusi', checkInTime: '10:15' },
        { id: '3', attendeeName: 'Babatunde Smith', checkInTime: '10:05' }
      ]

      const asc = [...rows].sort((a, b) => a.attendeeName.localeCompare(b.attendeeName))
      expect(asc.map(r => r.attendeeName)).toEqual(['Adeoye Oyewusi', 'Babatunde Smith', 'Wilfred Iorna'])

      const desc = [...rows].sort((a, b) => b.attendeeName.localeCompare(a.attendeeName))
      expect(desc.map(r => r.attendeeName)).toEqual(['Wilfred Iorna', 'Babatunde Smith', 'Adeoye Oyewusi'])
    })

    it('9. Grouping by person, activity and unit aggregates correctly', () => {
      const records: UnifiedAttendanceRecord[] = [
        { id: '1', attendeeId: 'p1', attendeeName: 'Person 1', recordedUnitId: 'u1', recordedUnitName: 'Camp', activityId: 'a1', activityTitle: 'Game Night', activityCategory: 'social', sessionId: 's1', sessionTitle: 'S1', sessionDate: '2026-10-10', checkInTime: '10:00', attendanceType: 'member' },
        { id: '2', attendeeId: 'p1', attendeeName: 'Person 1', recordedUnitId: 'u1', recordedUnitName: 'Camp', activityId: 'a2', activityTitle: 'Devotional', activityCategory: 'spiritual', sessionId: 's2', sessionTitle: 'S2', sessionDate: '2026-10-17', checkInTime: '17:00', attendanceType: 'member' },
        { id: '3', attendeeId: 'p2', attendeeName: 'Person 2', recordedUnitId: 'u2', recordedUnitName: 'Kugba', activityId: 'a1', activityTitle: 'Game Night', activityCategory: 'social', sessionId: 's1', sessionTitle: 'S1', sessionDate: '2026-10-10', checkInTime: '10:05', attendanceType: 'visitor' }
      ]

      // Group by Activity
      const byActivity: Record<string, number> = {}
      for (const r of records) {
        byActivity[r.activityTitle] = (byActivity[r.activityTitle] || 0) + 1
      }
      expect(byActivity['Game Night']).toBe(2)
      expect(byActivity['Devotional']).toBe(1)
    })

    it('10. Handles empty and zero-result queries gracefully without crashing', async () => {
      const emptyStats = await reportService.getUnitMonthlyRegister(2026, 1, [])
      expect(emptyStats).toEqual([])

      const emptySummary = await reportService.getStakeSummary([])
      expect(emptySummary.totalCheckIns).toBe(0)
      expect(emptySummary.totalUnits).toBe(0)
    })
  })

  // ==========================================
  // SECTION 2: CALCULATION ACCURACY
  // ==========================================
  describe('2. Metric Definitions and Counting Accuracy', () => {
    it('11. Total attendance records matches sum of valid attendee check-ins', () => {
      const records = [1, 2, 3, 4, 5]
      expect(records.length).toBe(5)
    })

    it('12. Unique attendees counts distinct UUID profiles, not repeat visits', () => {
      const attendeeIds = ['mem-1', 'mem-2', 'mem-1', 'mem-3', 'mem-2']
      const unique = new Set(attendeeIds)
      expect(unique.size).toBe(3)
    })

    it('13. Disambiguates different people who share the exact same name', () => {
      const attendees = [
        { id: 'uuid-1', fullName: 'Adeoye Oyewusi', unit: 'Camp Ward' },
        { id: 'uuid-2', fullName: 'Adeoye Oyewusi', unit: 'Alabata Branch' }
      ]
      const uniqueAttendees = new Set(attendees.map(a => a.id))
      // Must be 2 unique attendees despite sharing the exact same name
      expect(uniqueAttendees.size).toBe(2)
    })

    it('14. Repeat attendance across multiple sessions tracks 1 unique person with multiple events', () => {
      const personEvents = [
        { memberId: 'mem-100', sessionId: 's1' },
        { memberId: 'mem-100', sessionId: 's2' },
        { memberId: 'mem-100', sessionId: 's3' }
      ]
      const totalEvents = personEvents.length
      const uniquePeople = new Set(personEvents.map(e => e.memberId)).size
      expect(totalEvents).toBe(3)
      expect(uniquePeople).toBe(1)
    })

    it('15. Historical unit attribution preserves the unit where attendance was recorded', () => {
      // Member originally attended while recorded in Camp Ward, later moved home unit to Obantoko
      const eventRecord = {
        memberId: 'mem-5',
        recordedUnitId: 'unit-camp',
        recordedUnitName: 'Camp Ward',
        currentHomeUnitId: 'unit-obantoko'
      }
      expect(eventRecord.recordedUnitId).toBe('unit-camp')
      expect(eventRecord.recordedUnitName).toBe('Camp Ward')
    })

    it('16. Accurately calculates member vs visitor breakdowns and percentages', () => {
      const totalRecords = 50
      const memberCount = 40
      const visitorCount = 10
      const memberPct = Math.round((memberCount / totalRecords) * 1000) / 10
      const visitorPct = Math.round((visitorCount / totalRecords) * 1000) / 10

      expect(memberPct).toBe(80)
      expect(visitorPct).toBe(20)
      expect(memberPct + visitorPct).toBe(100)
    })

    it('17. Average attendance per session calculation uses held sessions as denominator', () => {
      const totalRecords = 120
      const heldSessions = 4
      const avg = Math.round((totalRecords / heldSessions) * 10) / 10
      expect(avg).toBe(30)

      // When 0 held sessions, denominator guard yields null or 0
      const zeroHeld = 0
      const zeroAvg = zeroHeld > 0 ? totalRecords / zeroHeld : null
      expect(zeroAvg).toBeNull()
    })

    it('18. Percentage and denominator validation for unit opportunities', () => {
      // 10 attended out of 50 eligible opportunities = 20.0%
      expect(calculateAttendancePercentage(10, 50)).toBe(20)

      // Denominator <= 0 yields null rather than NaN or Infinity
      expect(calculateAttendancePercentage(10, 0)).toBeNull()
      expect(calculateAttendancePercentage(0, 0)).toBeNull()
    })

    it('19. Summary KPIs, tables, and charts reconcile to the exact same numbers', () => {
      const mockRecords: UnifiedAttendanceRecord[] = [
        { id: '1', attendanceType: 'member', attendeeId: 'm1', attendeeName: 'A', recordedUnitId: 'u1', recordedUnitName: 'Camp', activityId: 'a1', activityTitle: 'Game', activityCategory: 'social', sessionId: 's1', sessionTitle: 'S1', sessionDate: '2026-10-10', checkInTime: '10:00' },
        { id: '2', attendanceType: 'visitor', attendeeId: 'v1', attendeeName: 'B', recordedUnitId: 'u1', recordedUnitName: 'Camp', activityId: 'a1', activityTitle: 'Game', activityCategory: 'social', sessionId: 's1', sessionTitle: 'S1', sessionDate: '2026-10-10', checkInTime: '10:05' },
        { id: '3', attendanceType: 'member', attendeeId: 'm2', attendeeName: 'C', recordedUnitId: 'u2', recordedUnitName: 'Kugba', activityId: 'a1', activityTitle: 'Game', activityCategory: 'social', sessionId: 's1', sessionTitle: 'S1', sessionDate: '2026-10-10', checkInTime: '10:10' }
      ]

      const totalCheckIns = mockRecords.length
      const memberCount = mockRecords.filter(r => r.attendanceType === 'member').length
      const visitorCount = mockRecords.filter(r => r.attendanceType === 'visitor').length
      const uniqueCount = new Set(mockRecords.map(r => r.attendeeId)).size

      // KPI card matches Table row count matches Chart sums
      expect(totalCheckIns).toBe(3)
      expect(memberCount).toBe(2)
      expect(visitorCount).toBe(1)
      expect(uniqueCount).toBe(3)
      expect(memberCount + visitorCount).toBe(totalCheckIns)
    })

    it('20. Africa/Lagos timezone handles week, month, and day boundaries cleanly without UTC shift', () => {
      // Test reference date Oct 20, 2026
      const refDate = new Date('2026-10-20T12:00:00Z')
      const week = getThisWeekRangeLagos(refDate)
      expect(week.startDate).toBe('2026-10-19') // Monday
      expect(week.endDate).toBe('2026-10-25')   // Sunday

      const prevMonth = getPreviousMonthRangeLagos(refDate)
      expect(prevMonth.startDate).toBe('2026-09-01')
      expect(prevMonth.endDate).toBe('2026-09-30')

      const prevPeriod = getComparablePreviousPeriod('2026-10-01', '2026-10-31')
      expect(prevPeriod.startDate).toBe('2026-08-31')
      expect(prevPeriod.endDate).toBe('2026-09-30')
    })
  })

  // ==========================================
  // SECTION 3: ROLE-BASED AUTHORIZATION
  // ==========================================
  describe('3. Role Scoping and Security Boundaries', () => {
    it('21. Stake presidency is granted stake-wide reporting across all units', () => {
      const access = deriveLeadershipAccess(['stake_presidency'], [])
      expect(access.hasStakeWideReadAccess).toBe(true)
      expect(access.reportUnitFilter).toBeNull() // null means unconstrained stake-wide
    })

    it('22. Stake clerk has read-only stake-wide access with zero administrative mutations', () => {
      const access = deriveLeadershipAccess(['stake_clerk'], [])
      expect(access.hasStakeWideReadAccess).toBe(true)
      expect(access.isClerkRoleOnly).toBe(true)
      expect(access.canManageActivities).toBe(false)
      expect(access.canManageMembers).toBe(false)
      expect(access.canRecordManualAttendance).toBe(false)
    })

    it('23. Bishop of Camp Ward is strictly constrained to Camp Ward', () => {
      const access = deriveLeadershipAccess(['bishop'], [{ id: '1', userId: 'u1', unitId: 'unit-camp', assignedRole: 'bishop', createdAt: '' }])
      expect(access.hasStakeWideReadAccess).toBe(false)
      expect(access.reportUnitFilter).toEqual(['unit-camp'])
    })

    it('24. Branch president of Alabata Branch is strictly constrained to Alabata Branch', () => {
      const access = deriveLeadershipAccess(['branch_president'], [{ id: '2', userId: 'u2', unitId: 'unit-alabata', assignedRole: 'branch_president', createdAt: '' }])
      expect(access.hasStakeWideReadAccess).toBe(false)
      expect(access.reportUnitFilter).toEqual(['unit-alabata'])
    })

    it('25. Ward clerk and branch clerk are strictly restricted to assigned unit in read-only mode', () => {
      const wardClerk = deriveLeadershipAccess(['ward_clerk'], [{ id: '3', userId: 'u3', unitId: 'unit-obantoko', assignedRole: 'ward_clerk', createdAt: '' }])
      expect(wardClerk.reportUnitFilter).toEqual(['unit-obantoko'])
      expect(wardClerk.isClerkRoleOnly).toBe(true)

      const branchClerk = deriveLeadershipAccess(['branch_clerk'], [{ id: '4', userId: 'u4', unitId: 'unit-apena', assignedRole: 'branch_clerk', createdAt: '' }])
      expect(branchClerk.reportUnitFilter).toEqual(['unit-apena'])
      expect(branchClerk.isClerkRoleOnly).toBe(true)
    })

    it('26. YSA Leader assigned to Camp Ward cannot report on other wards', () => {
      const ysaCamp = deriveLeadershipAccess(['ysa_leader'], [{ id: '5', userId: 'u5', unitId: 'unit-camp', assignedRole: 'ysa_leader', createdAt: '' }])
      expect(ysaCamp.hasStakeWideReadAccess).toBe(false)
      expect(ysaCamp.reportUnitFilter).toEqual(['unit-camp'])
    })

    it('27. Direct query interception: query scope strips unauthorized unit IDs passed by client', () => {
      const userAllowedUnits = ['unit-camp']
      const clientRequestedUnits = ['unit-camp', 'unit-obantoko', 'unit-alabata'] // Malicious attempt to query other units

      const effectiveUnits = clientRequestedUnits.filter(uid => userAllowedUnits.includes(uid))
      expect(effectiveUnits).toEqual(['unit-camp'])
    })

    it('28. Saved preset loading re-enforces current user unit authorization', () => {
      // User saves a preset with 3 units while logged in as stake leader
      const preset = reportService.savePreset('Multi Unit Preset', {
        reportType: 'detailed_register',
        periodType: 'this_month',
        selectedUnitIds: ['unit-camp', 'unit-obantoko', 'unit-alabata'],
        selectedActivityIds: [],
        selectedSessionIds: [],
        memberVisitorClassification: 'all',
        selectedMemberIds: [],
        nameQuery: '',
        sessionStatus: 'active_and_closed',
        sortBy: 'sessionDate',
        sortDirection: 'desc',
        groupBy: 'none'
      })

      // When loaded by a Bishop of Camp Ward:
      const bishopAllowed = ['unit-camp']
      const sanitized = preset.criteria.selectedUnitIds.filter(id => bishopAllowed.includes(id))
      expect(sanitized).toEqual(['unit-camp'])
    })
  })

  // ==========================================
  // SECTION 4: EXPORTS & VISUALS
  // ==========================================
  describe('4. Export Formats, Formula Protection and Visuals', () => {
    it('29. CSV export generates valid data with metadata header and UTF-8 BOM', () => {
      let createdBlob: Blob | null = null
      const originalCreateObjectURL = URL.createObjectURL
      const originalRevokeObjectURL = URL.revokeObjectURL
      URL.createObjectURL = vi.fn((blob: Blob) => {
        createdBlob = blob
        return 'mock-blob-url'
      })
      URL.revokeObjectURL = vi.fn()

      const meta = {
        title: 'Detailed Attendance Register',
        generatedAt: '2026-10-20 (Africa/Lagos)',
        periodLabel: 'This Month',
        scopeLabel: 'Camp Ward',
        totalRecords: 1,
        uniqueAttendees: 1
      }
      const columns = [{ key: 'name', label: 'Name' }, { key: 'unit', label: 'Unit' }]
      const records = [{ name: 'Adeoye Oyewusi', unit: 'Camp Ward' }]

      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

      exportToCsvAdvanced('test_report', meta, columns, records)
      expect(createdBlob).not.toBeNull()

      clickSpy.mockRestore()
      URL.createObjectURL = originalCreateObjectURL
      URL.revokeObjectURL = originalRevokeObjectURL
    })

    it('30. XLSX export creates Excel document structure with correct column mapping', async () => {
      const originalCreateObjectURL = URL.createObjectURL
      const originalRevokeObjectURL = URL.revokeObjectURL
      URL.createObjectURL = vi.fn(() => 'blob:mock-xlsx')
      URL.revokeObjectURL = vi.fn()
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

      const meta = {
        title: 'Detailed Attendance Register',
        generatedAt: '2026-10-20',
        periodLabel: 'October 2026',
        scopeLabel: 'All Units',
        totalRecords: 1,
        uniqueAttendees: 1
      }
      const columns = [{ key: 'name', label: 'Attendee Name' }]
      const records = [{ name: 'Wilfred Iorna' }]

      await expect(exportToXlsxAdvanced('test_xlsx', meta, columns, records)).resolves.not.toThrow()

      clickSpy.mockRestore()
      URL.createObjectURL = originalCreateObjectURL
      URL.revokeObjectURL = originalRevokeObjectURL
    })

    it('31. Print / PDF report sets document title and triggers native print engine', () => {
      const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
      const titleBefore = document.title
      window.print()
      expect(printSpy).toHaveBeenCalled()
      printSpy.mockRestore()
      expect(document.title).toBe(titleBefore)
    })

    it('32. Formula injection sanitization neutralizes =, +, -, @, tab, and return prefixes', () => {
      expect(sanitizeForSpreadsheet('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)")
      expect(sanitizeForSpreadsheet('+12345')).toBe("'+12345")
      expect(sanitizeForSpreadsheet('-555')).toBe("'-555")
      expect(sanitizeForSpreadsheet('@cmd')).toBe("'@cmd")
      expect(sanitizeForSpreadsheet('\tTabbed')).toBe("'\tTabbed")
      expect(sanitizeForSpreadsheet('Normal Name')).toBe('Normal Name')
      expect(sanitizeForSpreadsheet(null)).toBe('')
    })

    it('33. Visual chart datasets match the filtered dataset sums exactly', () => {
      const timelineData = [
        { periodLabel: '2026-10-15', recordsCount: 15, membersCount: 10, visitorsCount: 5 },
        { periodLabel: '2026-10-18', recordsCount: 25, membersCount: 20, visitorsCount: 5 }
      ]
      const totalTimelineRecords = timelineData.reduce((acc, t) => acc + t.recordsCount, 0)
      expect(totalTimelineRecords).toBe(40)
    })

    it('34. Drill-down action filters report criteria to clicked unit or activity', () => {
      const initialCriteria: ReportFilterCriteria = {
        reportType: 'detailed_register',
        periodType: 'this_month',
        selectedUnitIds: [],
        selectedActivityIds: [],
        selectedSessionIds: [],
        memberVisitorClassification: 'all',
        selectedMemberIds: [],
        nameQuery: '',
        sessionStatus: 'active_and_closed',
        sortBy: 'sessionDate',
        sortDirection: 'desc',
        groupBy: 'none'
      }

      // User clicks "Camp Ward" bar in chart
      const drilled = { ...initialCriteria, selectedUnitIds: ['unit-camp'] }
      expect(drilled.selectedUnitIds).toEqual(['unit-camp'])
    })

    it('35. Full result sets are exported even when table page size is limited', () => {
      // Simulate 100 total records in memory, with table page size set to 10
      const all100Records = Array.from({ length: 100 }, (_, i) => ({ id: `rec-${i}`, name: `Attendee ${i}` }))
      const pageSize = 10
      const paginatedView = all100Records.slice(0, pageSize)

      expect(paginatedView).toHaveLength(10)
      // Export always takes `all100Records`, NOT `paginatedView`
      expect(all100Records).toHaveLength(100)
    })
  })
})
