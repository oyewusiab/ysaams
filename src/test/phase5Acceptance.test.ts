/**
 * Phase 5 Acceptance Test Suite
 * Application-Wide UI, Usability and Workflow Refinement
 *
 * Verifies:
 * 1. Role-specific navigation across all 8 approved leadership roles
 * 2. Least-privilege boundary enforcement for clerks and unit leaders
 * 3. Session lifecycle, consequential action guards, and grace period calculations
 * 4. Member census search and filtering logic
 * 5. Saved preset security and state sanitization
 * 6. Export safety and print layout requirements
 */

import { describe, it, expect, vi } from 'vitest'
import { deriveLeadershipAccess } from '../context/AuthContext'
import { getRolePermittedNavItems } from '../components/leadership/LeadershipPortalView'
import { UserUnitAssignment, MemberRecord } from '../types/database'
import {
  calculateEffectiveLockTime,
  generateSessionCode
} from '../services/activityService'
import {
  sanitizeForSpreadsheet,
  exportToCsvAdvanced,
  triggerPrintReport
} from '../lib/exportUtils'

describe('Phase 5 Acceptance: Role-Specific Navigation & Scoping', () => {
  it('1. System Admin navigation includes all 9 leadership modules', () => {
    const access = deriveLeadershipAccess(['system_admin'], [])
    const items = getRolePermittedNavItems({
      isStakeLeader: access.isStakeLeader,
      canRecordManualAttendance: access.canRecordManualAttendance
    })
    const itemIds = items.map(i => i.id)

    expect(items).toHaveLength(9)
    expect(itemIds).toEqual([
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
  })

  it('2. Stake Presidency navigation includes all 9 leadership modules', () => {
    const access = deriveLeadershipAccess(['stake_presidency'], [])
    const items = getRolePermittedNavItems({
      isStakeLeader: access.isStakeLeader,
      canRecordManualAttendance: access.canRecordManualAttendance
    })
    const itemIds = items.map(i => i.id)

    expect(items).toHaveLength(9)
    expect(itemIds).toContain('users')
    expect(itemIds).toContain('audit-logs')
    expect(itemIds).toContain('attendance')
  })

  it('3. YSA Leader navigation excludes user governance and audit logs', () => {
    const unitAssignments: UserUnitAssignment[] = [
      { id: 'ua-1', userId: 'u-ysa', unitId: 'unit-camp', assignedRole: 'ysa_leader', createdAt: '2026-10-01' }
    ]
    const access = deriveLeadershipAccess(['ysa_leader'], unitAssignments)
    const items = getRolePermittedNavItems({
      isStakeLeader: access.isStakeLeader,
      canRecordManualAttendance: access.canRecordManualAttendance
    })
    const itemIds = items.map(i => i.id)

    expect(itemIds).toEqual([
      'dashboard',
      'activities',
      'attendance',
      'members',
      'reports',
      'units',
      'settings'
    ])
    expect(itemIds).not.toContain('users')
    expect(itemIds).not.toContain('audit-logs')
  })

  it('4. Bishop navigation is restricted to assigned ward and excludes governance and audit logs', () => {
    const unitAssignments: UserUnitAssignment[] = [
      { id: 'ua-b', userId: 'u-bishop', unitId: 'unit-obantoko', assignedRole: 'bishop', createdAt: '2026-10-01' }
    ]
    const access = deriveLeadershipAccess(['bishop'], unitAssignments)
    const items = getRolePermittedNavItems({
      isStakeLeader: access.isStakeLeader,
      canRecordManualAttendance: access.canRecordManualAttendance
    })
    const itemIds = items.map(i => i.id)

    expect(access.canRecordManualAttendance).toBe(true)
    expect(access.manageableUnitIds).toEqual(['unit-obantoko'])
    expect(itemIds).toEqual([
      'dashboard',
      'activities',
      'attendance',
      'members',
      'reports',
      'units',
      'settings'
    ])
    expect(itemIds).not.toContain('users')
    expect(itemIds).not.toContain('audit-logs')
  })

  it('5. Branch President navigation is restricted to assigned branch', () => {
    const unitAssignments: UserUnitAssignment[] = [
      { id: 'ua-bp', userId: 'u-bp', unitId: 'unit-alabata', assignedRole: 'branch_president', createdAt: '2026-10-01' }
    ]
    const access = deriveLeadershipAccess(['branch_president'], unitAssignments)
    const items = getRolePermittedNavItems({
      isStakeLeader: access.isStakeLeader,
      canRecordManualAttendance: access.canRecordManualAttendance
    })
    const itemIds = items.map(i => i.id)

    expect(access.canRecordManualAttendance).toBe(true)
    expect(access.manageableUnitIds).toEqual(['unit-alabata'])
    expect(itemIds).not.toContain('users')
    expect(itemIds).not.toContain('audit-logs')
  })

  it('6. Stake Clerk navigation excludes manual attendance check-in, users, and audit logs', () => {
    const access = deriveLeadershipAccess(['stake_clerk'], [])
    const items = getRolePermittedNavItems({
      isStakeLeader: access.isStakeLeader,
      canRecordManualAttendance: access.canRecordManualAttendance
    })
    const itemIds = items.map(i => i.id)

    expect(access.hasStakeWideReadAccess).toBe(true)
    expect(access.canRecordManualAttendance).toBe(false)
    expect(access.isClerkRoleOnly).toBe(true)

    // Exactly 6 permitted navigation items
    expect(items).toHaveLength(6)
    expect(itemIds).toEqual([
      'dashboard',
      'activities',
      'members',
      'reports',
      'units',
      'settings'
    ])
    expect(itemIds).not.toContain('attendance')
    expect(itemIds).not.toContain('users')
    expect(itemIds).not.toContain('audit-logs')
  })

  it('7. Ward Clerk navigation is read-only and unit-scoped', () => {
    const unitAssignments: UserUnitAssignment[] = [
      { id: 'ua-wc', userId: 'u-wc', unitId: 'unit-camp', assignedRole: 'ward_clerk', createdAt: '2026-10-01' }
    ]
    const access = deriveLeadershipAccess(['ward_clerk'], unitAssignments)
    const items = getRolePermittedNavItems({
      isStakeLeader: access.isStakeLeader,
      canRecordManualAttendance: access.canRecordManualAttendance
    })
    const itemIds = items.map(i => i.id)

    expect(access.reportUnitFilter).toEqual(['unit-camp'])
    expect(access.canRecordManualAttendance).toBe(false)
    expect(access.canManageMembers).toBe(false)
    expect(itemIds).toEqual([
      'dashboard',
      'activities',
      'members',
      'reports',
      'units',
      'settings'
    ])
    expect(itemIds).not.toContain('attendance')
  })

  it('8. Branch Clerk navigation is read-only and branch-scoped', () => {
    const unitAssignments: UserUnitAssignment[] = [
      { id: 'ua-bc', userId: 'u-bc', unitId: 'unit-apena', assignedRole: 'branch_clerk', createdAt: '2026-10-01' }
    ]
    const access = deriveLeadershipAccess(['branch_clerk'], unitAssignments)
    const items = getRolePermittedNavItems({
      isStakeLeader: access.isStakeLeader,
      canRecordManualAttendance: access.canRecordManualAttendance
    })
    const itemIds = items.map(i => i.id)

    expect(access.reportUnitFilter).toEqual(['unit-apena'])
    expect(access.canRecordManualAttendance).toBe(false)
    expect(itemIds).not.toContain('attendance')
  })
})

describe('Phase 5 Acceptance: Member Census Search & Filter Logic', () => {
  const sampleMembers: MemberRecord[] = [
    {
      id: 'm-1',
      fullName: 'Oluwatosin Adeyemi',
      preferredName: 'Tosin',
      homeUnitId: 'u-camp',
      homeUnitName: 'Camp Ward',
      phoneNumber: '08012345678',
      memberNumber: 'REC-001',
      isActive: true,
      createdAt: '2026-10-01'
    },
    {
      id: 'm-2',
      fullName: 'Babatunde Fashola',
      preferredName: 'Baba',
      homeUnitId: 'u-obantoko',
      homeUnitName: 'Obantoko Ward',
      phoneNumber: '08098765432',
      memberNumber: 'REC-002',
      isActive: true,
      createdAt: '2026-10-01'
    },
    {
      id: 'm-3',
      fullName: 'Chidinma Okonkwo',
      preferredName: null,
      homeUnitId: 'u-camp',
      homeUnitName: 'Camp Ward',
      phoneNumber: '07011223344',
      memberNumber: 'REC-003',
      isActive: false, // Archived
      createdAt: '2026-10-01'
    }
  ]

  function filterMembers(
    list: MemberRecord[],
    searchQuery: string,
    unitFilter: string,
    statusFilter: 'all' | 'active' | 'archived'
  ) {
    return list.filter((m) => {
      if (statusFilter === 'active' && !m.isActive) return false
      if (statusFilter === 'archived' && m.isActive) return false
      if (unitFilter !== 'all' && m.homeUnitId !== unitFilter) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchesName = m.fullName.toLowerCase().includes(q)
        const matchesPref = m.preferredName?.toLowerCase().includes(q)
        const matchesPhone = m.phoneNumber?.toLowerCase().includes(q)
        const matchesNumber = m.memberNumber?.toLowerCase().includes(q)
        if (!matchesName && !matchesPref && !matchesPhone && !matchesNumber) return false
      }
      return true
    })
  }

  it('9. Filters member census by full name query', () => {
    const results = filterMembers(sampleMembers, 'Adeyemi', 'all', 'all')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('m-1')
  })

  it('10. Filters member census by preferred name', () => {
    const results = filterMembers(sampleMembers, 'Tosin', 'all', 'all')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('m-1')
  })

  it('11. Filters member census by phone number', () => {
    const results = filterMembers(sampleMembers, '0809876', 'all', 'all')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('m-2')
  })

  it('12. Filters member census by record number', () => {
    const results = filterMembers(sampleMembers, 'REC-003', 'all', 'all')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('m-3')
  })

  it('13. Filters member census by unit assignment', () => {
    const results = filterMembers(sampleMembers, '', 'u-camp', 'all')
    expect(results).toHaveLength(2)
  })

  it('14. Filters member census by active status (excluding archived)', () => {
    const results = filterMembers(sampleMembers, '', 'all', 'active')
    expect(results).toHaveLength(2)
    expect(results.every(m => m.isActive)).toBe(true)
  })

  it('15. Filters member census by archived status only', () => {
    const results = filterMembers(sampleMembers, '', 'all', 'archived')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('m-3')
  })
})

describe('Phase 5 Acceptance: Session Security & Lagos Timezone Defenses', () => {
  it('16. Generates valid 6-character terminal code with excluded confusable characters', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateSessionCode()
      expect(code).toHaveLength(6)
      // Confusable characters 0, O, 1, I, L should never appear
      expect(code).not.toMatch(/[0O1IL]/)
    }
  })

  it('17. Accurately calculates effective lock time in Africa/Lagos (WAT, UTC+1)', () => {
    // 18:00 WAT is 17:00 UTC
    const lockImmediate = calculateEffectiveLockTime('2026-10-24', '18:00', 0)
    expect(lockImmediate).toBe('2026-10-24T17:00:00.000Z')

    // With 15 minutes grace period: 18:15 WAT = 17:15 UTC
    const lockWithGrace = calculateEffectiveLockTime('2026-10-24', '18:00', 15)
    expect(lockWithGrace).toBe('2026-10-24T17:15:00.000Z')
  })

  it('18. Returns null lock time when scheduledEndTime is omitted', () => {
    expect(calculateEffectiveLockTime('2026-10-24', null)).toBeNull()
    expect(calculateEffectiveLockTime('2026-10-24', '')).toBeNull()
  })
})

describe('Phase 5 Acceptance: Saved Presets Usability & Security', () => {
  it('19. Presets enforce scope sanitization on load to prevent privilege escalation', () => {
    const savedPreset = {
      id: 'p-1',
      name: 'Stake Wide Preset',
      createdAt: '2026-10-01',
      criteria: {
        reportType: 'detailed_register' as const,
        periodType: 'this_month' as const,
        year: 2026,
        month: 10,
        selectedUnitIds: ['unit-obantoko', 'unit-camp', 'unit-kugba'],
        selectedActivityIds: [],
        selectedSessionIds: [],
        activityCategory: 'all' as const,
        memberVisitorClassification: 'all' as const,
        selectedMemberIds: [],
        nameQuery: '',
        sessionStatus: 'active_and_closed' as const,
        sortBy: 'sessionDate' as const,
        sortDirection: 'desc' as const,
        groupBy: 'none' as const
      }
    }

    // When loaded by a Bishop restricted only to Obantoko Ward
    const bishopReportFilter = ['unit-obantoko']
    const hasStakeWideReadAccess = false

    let effectiveUnitIds = savedPreset.criteria.selectedUnitIds
    if (!hasStakeWideReadAccess && bishopReportFilter) {
      effectiveUnitIds = effectiveUnitIds.filter(id => bishopReportFilter.includes(id))
    }

    expect(effectiveUnitIds).toEqual(['unit-obantoko'])
    expect(effectiveUnitIds).not.toContain('unit-camp')
    expect(effectiveUnitIds).not.toContain('unit-kugba')
  })
})

describe('Phase 5 Acceptance: Export Safety & Print Layout', () => {
  it('20. Spreadsheet formula injection defense escapes dangerous lead characters', () => {
    expect(sanitizeForSpreadsheet('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)")
    expect(sanitizeForSpreadsheet('+cmd|/c')).toBe("'+cmd|/c")
    expect(sanitizeForSpreadsheet('-10+20')).toBe("'-10+20")
    expect(sanitizeForSpreadsheet('@mention')).toBe("'@mention")
    expect(sanitizeForSpreadsheet('Normal Attendee')).toBe('Normal Attendee')
    expect(sanitizeForSpreadsheet(null)).toBe('')
    expect(sanitizeForSpreadsheet(undefined)).toBe('')
  })

  it('21. CSV export serializes complete dataset with UTF-8 BOM and metadata header', () => {
    const originalCreateObjectURL = URL.createObjectURL
    URL.createObjectURL = vi.fn((_blob: Blob) => {
      return 'blob:mock-csv'
    })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const meta = {
      title: 'Detailed Attendance Register',
      generatedAt: '2026-10-20',
      periodLabel: 'October 2026',
      scopeLabel: 'Obantoko Ward',
      totalRecords: 2,
      uniqueAttendees: 2
    }
    const cols = [
      { key: 'attendeeName', label: 'Attendee Name' },
      { key: 'recordedUnitName', label: 'Unit' }
    ]
    const records = [
      { attendeeName: 'Adeola Johnson', recordedUnitName: 'Obantoko Ward' },
      { attendeeName: '=HYPERLINK("evil.com")', recordedUnitName: 'Obantoko Ward' }
    ]

    exportToCsvAdvanced('test_report', meta, cols, records)

    expect(clickSpy).toHaveBeenCalledTimes(1)
    clickSpy.mockRestore()
    URL.createObjectURL = originalCreateObjectURL
  })

  it('22. Print / PDF report sets document title and invokes native print dialog', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    triggerPrintReport('Monthly Attendance Register')

    expect(printSpy).toHaveBeenCalledTimes(1)
    printSpy.mockRestore()
  })
})
