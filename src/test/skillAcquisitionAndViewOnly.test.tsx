import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import fs from 'fs'
import path from 'path'
import {
  DEFAULT_SKILL_ACQUISITION_CLASSES,
  normalizeClassOptions,
  parseActivitiesCsv,
  validateSkillAcquisitionCheckInClass,
  activityService
} from '../services/activityService'
import { attendanceService } from '../services/attendanceService'
import { adminService } from '../services/adminService'
import { memberService } from '../services/memberService'
import { computeClassBreakdown, UnifiedAttendanceRecord } from '../services/reportService'
import { deriveLeadershipAccess } from '../context/AuthContext'
import { getRolePermittedNavItems } from '../components/layout/LeadershipSidebar'
import { TerminalView } from '../components/public/TerminalView'
import { UnitAssignedRole, UserUnitAssignment } from '../types/database'

const mockRpc = vi.fn()
const mockFrom = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'leader-1' } }, error: null })
    },
    channel: () => ({
      on: function () {
        return this
      },
      subscribe: () => ({})
    }),
    removeChannel: vi.fn()
  }
}))

describe('YSA AMS — Skill Acquisition Multi-Class Attendance & View-Only Leadership Permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
  })

  // =========================================================================
  // PART 1: SKILL ACQUISITION MULTI-CLASS ATTENDANCE TESTS
  // =========================================================================
  describe('Skill Acquisition Multi-Class Configuration, CSV Import & Check-In Validation', () => {
    it('normalizes class options cleanly without hardcoding a permanent list', () => {
      const customClasses = normalizeClassOptions([
        '  Photography  ',
        'Web Development',
        'photography', // duplicate case-insensitive
        '',
        'Culinary Arts'
      ])
      expect(customClasses).toEqual(['Photography', 'Web Development', 'Culinary Arts'])
      expect(DEFAULT_SKILL_ACQUISITION_CLASSES).toEqual([
        'Barbing',
        'Tailoring',
        'Shoe Making',
        'Catering',
        'ICT'
      ])
    })

    it('parses CSV category "Skill Acquisition: Barbing, Tailoring, Shoe Making, Catering, ICT" into clean category + classOptions', () => {
      const csvText = [
        'title,description,category',
        'Skill Acquisition,Practical training at the Gathering Place,"Skill Acquisition: Barbing, Tailoring, Shoe Making, Catering, ICT"'
      ].join('\n')

      const parsed = parseActivitiesCsv(csvText)
      expect(parsed.errors).toHaveLength(0)
      expect(parsed.valid).toHaveLength(1)
      expect(parsed.valid[0]).toEqual({
        rowNumber: 2,
        title: 'Skill Acquisition',
        description: 'Practical training at the Gathering Place',
        category: 'Skill Acquisition',
        classOptions: ['Barbing', 'Tailoring', 'Shoe Making', 'Catering', 'ICT']
      })
    })

    it('supports dedicated classes / class_options CSV column for custom Skill Acquisition classes', () => {
      const csvText = [
        'title,description,category,classes',
        'Skill Acquisition,Gathering Place,Skill Acquisition,"Solar Installation, Graphic Design, Baking"'
      ].join('\n')

      const parsed = parseActivitiesCsv(csvText)
      expect(parsed.errors).toHaveLength(0)
      expect(parsed.valid).toHaveLength(1)
      expect(parsed.valid[0]).toEqual({
        rowNumber: 2,
        title: 'Skill Acquisition',
        description: 'Gathering Place',
        category: 'Skill Acquisition',
        classOptions: ['Solar Installation', 'Graphic Design', 'Baking']
      })
    })

    it('does NOT interpret commas in unrelated activity categories as class options and preserves arbitrary categories', () => {
      const csvText = [
        'title,description,category',
        '"Music, Dance & Drama Night",Stake Cultural Center,"Music, Dance, and Drama"',
        'Career Workshop,Gathering Place,Professional Development'
      ].join('\n')

      const parsed = parseActivitiesCsv(csvText)
      expect(parsed.errors).toHaveLength(0)
      expect(parsed.valid).toHaveLength(2)
      expect(parsed.valid[0].category).toBe('Music, Dance, and Drama')
      expect(parsed.valid[0].classOptions).toBeUndefined()
      expect(parsed.valid[1].category).toBe('Professional Development')
      expect(parsed.valid[1].classOptions).toBeUndefined()
    })

    it('creates one Skill Acquisition activity and starts one session with one shared activity code across all classes', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'activities') {
          return {
            insert: (payload: Record<string, unknown>) => ({
              select: () => ({
                single: async () => ({
                  data: {
                    id: 'act-skill-1',
                    title: payload.title,
                    description: payload.description,
                    category: payload.category,
                    class_options: payload.class_options,
                    default_participating_units: payload.default_participating_units ?? null,
                    created_by: payload.created_by,
                    created_at: '2026-11-01T10:00:00Z'
                  },
                  error: null
                })
              })
            })
          }
        }
        if (table === 'activity_sessions') {
          return {
            insert: (payload: Record<string, unknown>) => ({
              select: () => ({
                single: async () => ({
                  data: {
                    id: 'sess-skill-1',
                    activity_id: payload.activity_id,
                    session_title: payload.session_title,
                    session_date: payload.session_date,
                    start_time: payload.start_time,
                    status: 'draft',
                    timezone: 'Africa/Lagos',
                    max_terminals: payload.max_terminals,
                    visitor_registration_enabled: true,
                    class_options: payload.class_options,
                    created_at: '2026-11-01T10:05:00Z'
                  },
                  error: null
                })
              })
            })
          }
        }
        return {}
      })

      const createdActivity = await activityService.createActivity(
        {
          title: 'Skill Acquisition',
          description: 'Gathering Place',
          category: 'Skill Acquisition',
          classOptions: ['Barbing', 'Tailoring', 'Shoe Making', 'Catering', 'ICT']
        },
        'leader-1'
      )

      expect(createdActivity.title).toBe('Skill Acquisition')
      expect(createdActivity.description).toBe('Gathering Place')
      expect(createdActivity.category).toBe('Skill Acquisition')
      expect(createdActivity.classOptions).toEqual([
        'Barbing',
        'Tailoring',
        'Shoe Making',
        'Catering',
        'ICT'
      ])

      const createdSession = await activityService.createSession({
        activityId: createdActivity.id,
        sessionTitle: 'Skill Acquisition — Gathering Place',
        sessionDate: '2026-11-01',
        startTime: '10:00',
        maxTerminals: 5,
        classOptions: createdActivity.classOptions
      })

      const sharedSessionCode = activityService.generateCode()
      expect(sharedSessionCode).toHaveLength(6) // One shared 6-character activity code for all classes
      expect(createdSession.classOptions).toEqual([
        'Barbing',
        'Tailoring',
        'Shoe Making',
        'Catering',
        'ICT'
      ])
    })

    it('validates class selection: accepts configured classes, rejects missing or unconfigured classes for Skill Acquisition, and allows ordinary activities without class selection', () => {
      const configured = ['Barbing', 'Tailoring', 'Shoe Making', 'Catering', 'ICT']

      // 1. Valid configured classes
      const barbingCheck = validateSkillAcquisitionCheckInClass({
        isSkillAcquisition: true,
        classOptions: configured,
        selectedClass: 'Barbing'
      })
      expect(barbingCheck).toEqual({ valid: true, canonicalClass: 'Barbing' })

      const cateringCaseInsensitive = validateSkillAcquisitionCheckInClass({
        isSkillAcquisition: true,
        classOptions: configured,
        selectedClass: 'catering'
      })
      expect(cateringCaseInsensitive).toEqual({ valid: true, canonicalClass: 'Catering' })

      // 2. Reject missing class selection for Skill Acquisition
      const missingClass = validateSkillAcquisitionCheckInClass({
        isSkillAcquisition: true,
        classOptions: configured,
        selectedClass: ''
      })
      expect(missingClass.valid).toBe(false)
      expect(missingClass.error).toContain('Please select a Skill Acquisition class')

      // 3. Reject unconfigured class for Skill Acquisition
      const unconfiguredClass = validateSkillAcquisitionCheckInClass({
        isSkillAcquisition: true,
        classOptions: configured,
        selectedClass: 'Welding'
      })
      expect(unconfiguredClass.valid).toBe(false)
      expect(unconfiguredClass.error).toContain('is not configured or available')

      // 4. Ordinary activity check-in does NOT require class selection
      const ordinaryCheck = validateSkillAcquisitionCheckInClass({
        isSkillAcquisition: false,
        classOptions: null,
        selectedClass: null
      })
      expect(ordinaryCheck).toEqual({ valid: true, canonicalClass: null })
    })

    it('renders the public terminal class selector ONLY for Skill Acquisition sessions and checks in participants to different classes', async () => {
      vi.spyOn(adminService, 'listUnits').mockResolvedValue([
        {
          id: 'unit-1',
          unitName: 'Obantoko Ward',
          unitType: 'ward',
          isActive: true,
          createdAt: '2026-01-01'
        }
      ])
      vi.spyOn(memberService, 'listMembers').mockResolvedValue([
        {
          id: 'mem-1',
          fullName: 'Adebayo Ogunlesi',
          homeUnitId: 'unit-1',
          isActive: true,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01'
        }
      ])

      // 1. Render for ordinary activity first -> class selector must NOT appear
      const { unmount } = render(
        <TerminalView
          sessionTitle="Weekly Institute"
          sessionDate="2026-11-01"
          activityTitle="Weekly Institute"
          activityCategory="Spiritual"
          classOptions={null}
          onReleaseTerminal={vi.fn()}
        />
      )
      expect(screen.queryByLabelText(/Skill Acquisition Class/i)).toBeNull()
      unmount()

      // 2. Render for Skill Acquisition session -> class selector MUST appear with configured classes
      sessionStorage.setItem('ysaams_terminal_session_id', 'sess-skill-1')
      const recordSpy = vi.spyOn(attendanceService, 'recordAttendance').mockResolvedValue({
        success: true,
        record: {
          id: 'rec-1',
          sessionId: 'sess-skill-1',
          attendeeName: 'Adebayo Ogunlesi',
          isNonMember: false,
          unitId: 'unit-1',
          selectedClass: 'Tailoring',
          checkInTime: '2026-11-01T10:15:00Z'
        }
      })

      render(
        <TerminalView
          sessionTitle="Skill Acquisition"
          sessionDate="2026-11-01"
          activityTitle="Skill Acquisition"
          activityCategory="Skill Acquisition"
          classOptions={['Barbing', 'Tailoring', 'Shoe Making', 'Catering', 'ICT']}
          onReleaseTerminal={vi.fn()}
        />
      )

      // Class selector is visible and contains only configured classes
      const classSelect = (await screen.findByLabelText(/Skill Acquisition Class/i)) as HTMLSelectElement
      expect(classSelect).toBeTruthy()
      const optionValues = Array.from(classSelect.options)
        .map((o) => o.value)
        .filter(Boolean)
      expect(optionValues).toEqual(['Barbing', 'Tailoring', 'Shoe Making', 'Catering', 'ICT'])

      // Fill attendee name and ward/branch
      const nameInput = screen.getByLabelText(/Full Name/i)
      fireEvent.change(nameInput, { target: { value: 'Adebayo Ogunlesi' } })

      const unitSelect = screen.getByLabelText(/Ward or Branch/i)
      await waitFor(() => expect((unitSelect as HTMLSelectElement).options.length).toBeGreaterThan(1))
      fireEvent.change(unitSelect, { target: { value: 'unit-1' } })

      // Attempt submit without selecting a class -> validation error message shown
      fireEvent.click(screen.getByRole('button', { name: /Confirm Check In/i }))
      expect(await screen.findByText(/Please select a Skill Acquisition class/i)).toBeTruthy()
      expect(recordSpy).not.toHaveBeenCalled()

      // Select 'Tailoring' and submit
      fireEvent.change(classSelect, { target: { value: 'Tailoring' } })
      fireEvent.click(screen.getByRole('button', { name: /Confirm Check In/i }))

      await waitFor(() => {
        expect(recordSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionId: 'sess-skill-1',
            attendeeName: 'Adebayo Ogunlesi',
            unitId: 'unit-1',
            selectedClass: 'Tailoring'
          })
        )
      })

      // Confirmation card displays the selected class
      expect(await screen.findByText('Tailoring')).toBeTruthy()
    })

    it('prevents duplicate attendance on the terminal and displays friendly duplicate message', async () => {
      vi.spyOn(adminService, 'listUnits').mockResolvedValue([
        {
          id: 'unit-1',
          unitName: 'Obantoko Ward',
          unitType: 'ward',
          isActive: true,
          createdAt: '2026-01-01'
        }
      ])
      vi.spyOn(memberService, 'listMembers').mockResolvedValue([])
      sessionStorage.setItem('ysaams_terminal_session_id', 'sess-skill-1')

      vi.spyOn(attendanceService, 'recordAttendance').mockResolvedValue({
        success: false,
        error: 'Duplicate check-in: Adebayo Ogunlesi is already marked present for this session.'
      })

      render(
        <TerminalView
          sessionTitle="Skill Acquisition"
          sessionDate="2026-11-01"
          activityTitle="Skill Acquisition"
          activityCategory="Skill Acquisition"
          classOptions={['Barbing', 'Tailoring']}
          onReleaseTerminal={vi.fn()}
        />
      )

      fireEvent.change(screen.getByLabelText(/Full Name/i), {
        target: { value: 'Adebayo Ogunlesi' }
      })
      const unitSelect = screen.getByLabelText(/Ward or Branch/i)
      await waitFor(() => expect((unitSelect as HTMLSelectElement).options.length).toBeGreaterThan(1))
      fireEvent.change(unitSelect, { target: { value: 'unit-1' } })
      fireEvent.change(screen.getByLabelText(/Skill Acquisition Class/i), {
        target: { value: 'Barbing' }
      })

      fireEvent.click(screen.getByRole('button', { name: /Confirm Check In/i }))

      expect(
        await screen.findByText(/already been recorded for this activity today/i)
      ).toBeTruthy()
    })

    it('preserves historical class attribution and reconciles class totals with overall attendance without silently reassigning records', () => {
      const configuredClasses = ['Barbing', 'Tailoring', 'ICT']
      const sampleRecords: Pick<UnifiedAttendanceRecord, 'attendanceType' | 'selectedClass'>[] = [
        { attendanceType: 'member', selectedClass: 'Barbing' },
        { attendanceType: 'visitor', selectedClass: 'Barbing' },
        { attendanceType: 'member', selectedClass: 'Photography' }, // historical class removed from active config
        { attendanceType: 'member', selectedClass: null } // unassigned / legacy record
      ]

      const summary = computeClassBreakdown(sampleRecords, configuredClasses)

      // Total reconciliation check
      expect(summary.reconciled).toBe(true)
      expect(summary.totalRecords).toBe(4)
      expect(summary.totalWithClass).toBe(3)
      expect(summary.totalUnassigned).toBe(1)
      expect(summary.totalWithClass + summary.totalUnassigned).toBe(summary.totalRecords)

      // Configured classes appear (even 0-count ones like Tailoring & ICT)
      const barbingRow = summary.classes.find((r) => r.className === 'Barbing')
      expect(barbingRow).toMatchObject({
        recordsCount: 2,
        membersCount: 1,
        visitorsCount: 1,
        isConfigured: true
      })

      const tailoringRow = summary.classes.find((r) => r.className === 'Tailoring')
      expect(tailoringRow).toMatchObject({
        recordsCount: 0,
        membersCount: 0,
        visitorsCount: 0,
        isConfigured: true
      })

      // Historical class 'Photography' is preserved with isConfigured: false
      const historicalRow = summary.classes.find((r) => r.className === 'Photography')
      expect(historicalRow).toMatchObject({
        recordsCount: 1,
        membersCount: 1,
        visitorsCount: 0,
        isConfigured: false
      })
    })
  })

  // =========================================================================
  // PART 2: VIEW-ONLY PERMISSIONS FOR 4 ROLES & PRESERVATION OF OTHER 4 ROLES
  // =========================================================================
  describe('Strict View-Only Permissions for Four Specific Roles & Preservation of Other Four Roles', () => {
    const unitAssignmentFor = (role: UnitAssignedRole, unitId = 'unit-obantoko'): UserUnitAssignment[] => [
      {
        id: `ua-${role}`,
        userId: `user-${role}`,
        unitId,
        assignedRole: role,
        createdAt: '2026-11-01T00:00:00Z'
      }
    ]

    it.each([
      ['bishop', 'unit-obantoko-ward'],
      ['branch_president', 'unit-alabata-branch'],
      ['ward_clerk', 'unit-obantoko-ward'],
      ['branch_clerk', 'unit-alabata-branch']
    ] as const)(
      'enforces strict view-only permissions and preserves unit scope for %s',
      (role, assignedUnitId) => {
        const access = deriveLeadershipAccess([role], unitAssignmentFor(role, assignedUnitId))

        // Strictly view-only across every operational capability
        expect(access.isSystemAdmin).toBe(false)
        expect(access.isStakeLeader).toBe(false)
        expect(access.canManageActivities).toBe(false)
        expect(access.canRecordManualAttendance).toBe(false)
        expect(access.canManageMembers).toBe(false)
        expect(access.manageableUnitIds).toEqual([])
        expect(access.isViewOnlyRoleOnly).toBe(true)

        // Existing assigned-unit visibility scope is strictly preserved
        expect(access.assignedUnitIds).toEqual([assignedUnitId])
        expect(access.reportUnitFilter).toEqual([assignedUnitId])

        // Sidebar navigation excludes mutation-only / admin routes ('attendance', 'users', 'audit-logs')
        const navIds = getRolePermittedNavItems({
          isStakeLeader: access.isStakeLeader,
          canRecordManualAttendance: access.canRecordManualAttendance
        }).map((item) => item.id)

        expect(navIds).toEqual(['dashboard', 'activities', 'members', 'reports', 'units', 'settings'])
        expect(navIds).not.toContain('attendance')
        expect(navIds).not.toContain('users')
        expect(navIds).not.toContain('audit-logs')
      }
    )

    it('explicitly preserves existing permissions for stake_clerk unchanged', () => {
      const access = deriveLeadershipAccess(['stake_clerk'], [])

      expect(access.isSystemAdmin).toBe(false)
      expect(access.isStakeLeader).toBe(false)
      expect(access.isStakeClerk).toBe(true)
      expect(access.hasStakeWideReadAccess).toBe(true)
      expect(access.isViewOnlyRoleOnly).toBe(false) // stake_clerk is explicitly excluded from the 4-role restriction flag
      expect(access.canManageActivities).toBe(false)
      expect(access.canRecordManualAttendance).toBe(false)
      expect(access.canManageMembers).toBe(false)
      expect(access.reportUnitFilter).toBeNull() // stake-wide read visibility preserved
    })

    it('explicitly preserves existing permissions for ysa_leader unchanged', () => {
      const access = deriveLeadershipAccess(['ysa_leader'], unitAssignmentFor('ysa_leader', 'unit-obantoko'))

      expect(access.isSystemAdmin).toBe(false)
      expect(access.isStakeLeader).toBe(false)
      expect(access.isViewOnlyRoleOnly).toBe(false)
      expect(access.canManageActivities).toBe(true)
      expect(access.canRecordManualAttendance).toBe(true)
      expect(access.canManageMembers).toBe(true)
      expect(access.manageableUnitIds).toEqual(['unit-obantoko'])
      expect(access.reportUnitFilter).toEqual(['unit-obantoko'])

      const navIds = getRolePermittedNavItems({
        isStakeLeader: access.isStakeLeader,
        canRecordManualAttendance: access.canRecordManualAttendance
      }).map((item) => item.id)
      expect(navIds).toContain('attendance')
    })

    it('explicitly preserves existing permissions for stake_presidency unchanged', () => {
      const access = deriveLeadershipAccess(['stake_presidency'], [])

      expect(access.isSystemAdmin).toBe(false)
      expect(access.isStakeLeader).toBe(true)
      expect(access.hasStakeWideReadAccess).toBe(true)
      expect(access.isViewOnlyRoleOnly).toBe(false)
      expect(access.canManageActivities).toBe(true)
      expect(access.canRecordManualAttendance).toBe(true)
      expect(access.canManageMembers).toBe(true)
      expect(access.reportUnitFilter).toBeNull()
    })

    it('explicitly preserves existing permissions for system_admin unchanged', () => {
      const access = deriveLeadershipAccess(['system_admin'], [])

      expect(access.isSystemAdmin).toBe(true)
      expect(access.isStakeLeader).toBe(true)
      expect(access.hasStakeWideReadAccess).toBe(true)
      expect(access.isViewOnlyRoleOnly).toBe(false)
      expect(access.canManageActivities).toBe(true)
      expect(access.canRecordManualAttendance).toBe(true)
      expect(access.canManageMembers).toBe(true)
      expect(access.reportUnitFilter).toBeNull()
    })

    it('verifies the forward-only database migration enforces RPC and RLS restrictions for the 4 view-only roles and Skill Acquisition validation', () => {
      const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20261101000011_skill_acquisition_classes_and_view_only_roles.sql'
      )
      expect(fs.existsSync(migrationPath)).toBe(true)
      const sql = fs.readFileSync(migrationPath, 'utf-8')

      // 1. Structured columns added idempotently
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS class_options TEXT[] DEFAULT NULL')
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS selected_class TEXT DEFAULT NULL')

      // 2. Class validation helper & RPC
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.validate_and_resolve_session_class')
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.update_activity_classes')
      expect(sql).toContain("'UPDATE_ACTIVITY_CLASSES'")

      // 3. RLS on public.members removes bishop and branch_president write access while keeping ysa_leader and stake-wide leaders
      expect(sql).toContain('DROP POLICY IF EXISTS policy_members_manage ON public.members')
      expect(sql).toContain("ur.role_name = 'ysa_leader'")
      expect(sql).not.toMatch(/CREATE POLICY policy_members_manage[\s\S]*'bishop'/)

      // 4. Manual attendance RPC restricts unit-scoped check-in to ysa_leader or stake-wide leaders
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.record_manual_attendance')
      expect(sql).toContain(
        'Unauthorized: Your role has view-only access or is not authorized to record manual attendance for this unit.'
      )
    })
  })
})
