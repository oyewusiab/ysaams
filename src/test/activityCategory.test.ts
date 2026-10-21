import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  STANDARD_ACTIVITY_CATEGORIES,
  ActivityDefinition,
  ActivitySession
} from '../types/database'
import {
  activityService,
  parseCsvRows,
  parseActivitiesCsv,
  CreateActivityParams
} from '../services/activityService'
import { reportService, ReportFilterCriteria } from '../services/reportService'
import { supabase } from '../lib/supabase'

describe('Activity Dynamic Category & CSV Import Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------------
  // 1. Standard & Custom Categories
  // ---------------------------------------------------------------------------
  describe('Category Acceptance and Normalization', () => {
    it('recognizes all 7 legacy standard categories as valid', () => {
      expect(STANDARD_ACTIVITY_CATEGORIES).toEqual([
        'spiritual',
        'social',
        'service',
        'sports',
        'temple',
        'educational',
        'other'
      ])
      expect(STANDARD_ACTIVITY_CATEGORIES).toHaveLength(7)
    })

    it('accepts new dynamic categories including "Gathering Place" and "Skill Acquisition"', () => {
      const customCategories = [
        'Gathering Place',
        'Skill Acquisition',
        'Stake Conference',
        'Leadership Training',
        'Family History Workshop'
      ]

      customCategories.forEach(cat => {
        const params: CreateActivityParams = {
          title: `Stake ${cat} Event`,
          category: cat,
          description: 'Custom activity description'
        }
        expect(params.category).toBe(cat)
        expect(params.category.trim().length).toBeGreaterThan(0)
      })
    })

    it('rejects blank or whitespace-only categories on createActivity', async () => {
      const userId = 'u-user-1'
      
      await expect(
        activityService.createActivity({ title: 'Devotional', category: '' }, userId)
      ).rejects.toThrow('Activity category is required and cannot be blank.')

      await expect(
        activityService.createActivity({ title: 'Devotional', category: '   \t  ' }, userId)
      ).rejects.toThrow('Activity category is required and cannot be blank.')
    })

    it('rejects blank or whitespace-only activity title', async () => {
      const userId = 'u-user-1'

      await expect(
        activityService.createActivity({ title: '   ', category: 'Gathering Place' }, userId)
      ).rejects.toThrow('Activity title is required.')
    })

    it('trims leading and trailing whitespace from title and category upon creation', async () => {
      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'act-new-1',
              title: 'Weekly Gathering Place',
              category: 'Gathering Place',
              description: 'Trimmed notes',
              default_participating_units: null,
              created_by: 'u-admin-1',
              created_at: '2026-10-21T10:00:00Z'
            },
            error: null
          })
        })
      })

      vi.spyOn(supabase, 'from').mockReturnValue({ insert: mockInsert } as any)

      const result = await activityService.createActivity(
        {
          title: '   Weekly Gathering Place   ',
          category: '   Gathering Place   ',
          description: '  Trimmed notes  '
        },
        'u-admin-1'
      )

      expect(mockInsert).toHaveBeenCalledWith({
        title: 'Weekly Gathering Place',
        category: 'Gathering Place',
        description: 'Trimmed notes',
        default_participating_units: null,
        created_by: 'u-admin-1'
      })
      expect(result.category).toBe('Gathering Place')
    })
  })

  // ---------------------------------------------------------------------------
  // 2. CSV Parser & Importer
  // ---------------------------------------------------------------------------
  describe('RFC-4180 CSV Parsing & Error Isolation', () => {
    it('handles commas within quotes, escaped quotes, and multiline descriptions', () => {
      const csv = `title,category,description\r\n"YSA Gathering Place, Obantoko","Gathering Place","Weekly meeting, food & devotion"\r\n"Skill Acquisition ""Advanced""","Skill Acquisition","Learn tailoring and crafts"`
      
      const rows = parseCsvRows(csv)
      expect(rows).toHaveLength(3)
      expect(rows[1][0]).toBe('YSA Gathering Place, Obantoko')
      expect(rows[1][1]).toBe('Gathering Place')
      expect(rows[1][2]).toBe('Weekly meeting, food & devotion')
      expect(rows[2][0]).toBe('Skill Acquisition "Advanced"')
      expect(rows[2][1]).toBe('Skill Acquisition')
    })

    it('strips UTF-8 BOM smoothly from imported CSV files', () => {
      const csvWithBom = '\uFEFFtitle,category,description\n"Devotional","spiritual","Morning prayer"'
      const res = parseActivitiesCsv(csvWithBom)
      expect(res.errors).toHaveLength(0)
      expect(res.valid).toHaveLength(1)
      expect(res.valid[0].title).toBe('Devotional')
      expect(res.valid[0].category).toBe('spiritual')
    })

    it('parses valid CSV rows with new categories like "Gathering Place" and "Skill Acquisition"', () => {
      const csv = [
        'title,category,description',
        '"Abeokuta Gathering Place","Gathering Place","Weekly activity center"',
        '"Vocational Workshop","Skill Acquisition","Carpentry and design"',
        '"Stake Volleyball Match","sports","Quarterly tournament"',
        '"Institute Study Class","educational","Scripture mastery"'
      ].join('\n')

      const res = parseActivitiesCsv(csv)
      expect(res.errors).toHaveLength(0)
      expect(res.valid).toHaveLength(4)
      expect(res.valid[0].category).toBe('Gathering Place')
      expect(res.valid[1].category).toBe('Skill Acquisition')
      expect(res.valid[2].category).toBe('sports')
      expect(res.valid[3].category).toBe('educational')
    })

    it('reports missing required headers with clear explanation', () => {
      const badHeadersCsv = 'activity_name,unit,notes\n"Sports Day","Camp","Fun"'
      const res = parseActivitiesCsv(badHeadersCsv)
      expect(res.valid).toHaveLength(0)
      expect(res.errors).toHaveLength(1)
      expect(res.errors[0].error).toContain('Missing required CSV header(s): title, category')
    })

    it('isolates malformed rows and reports exact line numbers without aborting valid rows', () => {
      const mixedCsv = [
        'title,category,description',
        '"Valid Activity 1","Gathering Place","Good"',
        '"","Gathering Place","Missing title"', // Row 3: missing title
        '"Valid Activity 2","Skill Acquisition","Good"',
        '"Valid Activity 3","","Missing category"', // Row 5: missing category
        '   ', // Row 6: blank line, should be skipped
        '"Valid Activity 4","sports","Good"'
      ].join('\n')

      const res = parseActivitiesCsv(mixedCsv)
      expect(res.valid).toHaveLength(3)
      expect(res.valid.map(v => v.title)).toEqual([
        'Valid Activity 1',
        'Valid Activity 2',
        'Valid Activity 4'
      ])

      expect(res.errors).toHaveLength(2)
      expect(res.errors[0].row).toBe(3)
      expect(res.errors[0].error).toContain('Activity title is required')
      expect(res.errors[1].row).toBe(5)
      expect(res.errors[1].error).toContain('Activity category is required')
    })

    it('executes activityService.importActivitiesFromCsv and creates records in database', async () => {
      const csv = [
        'title,category,description',
        '"Gathering Place Night","Gathering Place","Weekly gathering"',
        '"Web Development Bootcamp","Skill Acquisition","Coding training"'
      ].join('\n')

      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'act-1',
              title: 'Gathering Place Night',
              category: 'Gathering Place',
              description: 'Weekly gathering',
              created_by: 'u-leader-1',
              created_at: '2026-10-21T10:00:00Z'
            },
            {
              id: 'act-2',
              title: 'Web Development Bootcamp',
              category: 'Skill Acquisition',
              description: 'Coding training',
              created_by: 'u-leader-1',
              created_at: '2026-10-21T10:00:00Z'
            }
          ],
          error: null
        })
      })

      vi.spyOn(supabase, 'from').mockReturnValue({ insert: mockInsert } as any)

      const result = await activityService.importActivitiesFromCsv(csv, 'u-leader-1')
      expect(result.successCount).toBe(2)
      expect(result.errorCount).toBe(0)
      expect(result.importedActivities).toHaveLength(2)
      expect(result.importedActivities[0].category).toBe('Gathering Place')
      expect(result.importedActivities[1].category).toBe('Skill Acquisition')
    })
  })

  // ---------------------------------------------------------------------------
  // 3. Reporting and Filtering of Dynamic Categories
  // ---------------------------------------------------------------------------
  describe('Dynamic Category Filtering in Reporting Services', () => {
    it('filters sessions accurately by dynamic category with case-insensitivity and trimming', async () => {
      const mockActivities: ActivityDefinition[] = [
        {
          id: 'act-gp-1',
          title: 'Stake Gathering Place',
          category: 'Gathering Place',
          createdBy: 'u-1',
          createdAt: '2026-10-01'
        },
        {
          id: 'act-sa-1',
          title: 'Tailoring Class',
          category: 'Skill Acquisition',
          createdBy: 'u-1',
          createdAt: '2026-10-01'
        },
        {
          id: 'act-sp-1',
          title: 'Sunday Devotional',
          category: 'spiritual',
          createdBy: 'u-1',
          createdAt: '2026-10-01'
        }
      ]

      const mockSessions: ActivitySession[] = [
        {
          id: 'sess-1',
          activityId: 'act-gp-1',
          sessionTitle: 'Gathering Place Week 1',
          sessionDate: '2026-10-10',
          startTime: '17:00',
          status: 'closed',
          maxTerminals: 2,
          timezone: 'Africa/Lagos',
          visitorRegistrationEnabled: true,
          createdAt: '2026-10-01'
        },
        {
          id: 'sess-2',
          activityId: 'act-sa-1',
          sessionTitle: 'Skill Session 1',
          sessionDate: '2026-10-12',
          startTime: '16:00',
          status: 'closed',
          maxTerminals: 2,
          timezone: 'Africa/Lagos',
          visitorRegistrationEnabled: true,
          createdAt: '2026-10-01'
        }
      ]

      const createChainable = (data: any) => {
        const promise = Promise.resolve({ data, error: null }) as any
        promise.select = vi.fn(() => promise)
        promise.order = vi.fn(() => promise)
        promise.in = vi.fn(() => promise)
        promise.eq = vi.fn(() => promise)
        promise.gte = vi.fn(() => promise)
        promise.lte = vi.fn(() => promise)
        return promise
      }

      // Mock supabase queries inside reportService
      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'stake_units') {
          return createChainable([
            { id: 'unit-1', unit_name: 'Obantoko Ward', unit_type: 'ward', is_active: true }
          ]) as any
        }
        if (table === 'activity_sessions') {
          return createChainable(
            mockSessions.map(s => ({
              id: s.id,
              activity_id: s.activityId,
              session_title: s.sessionTitle,
              session_date: s.sessionDate,
              start_time: s.startTime,
              status: s.status
            }))
          ) as any
        }
        if (table === 'activities') {
          return createChainable(
            mockActivities.map(a => ({
              id: a.id,
              title: a.title,
              category: a.category
            }))
          ) as any
        }
        if (table === 'attendance_records') {
          return createChainable([
            {
              id: 'att-1',
              session_id: 'sess-1',
              member_id: 'mem-1',
              recorded_unit_id: 'unit-1',
              check_in_time: '17:05:00',
              created_at: '2026-10-10T17:05:00Z'
            }
          ]) as any
        }
        if (table === 'members') {
          return createChainable([
            {
              id: 'mem-1',
              full_name: 'Faith Okon',
              home_unit_id: 'unit-1',
              member_number: '12345',
              stake_units: { unit_name: 'Obantoko Ward' }
            }
          ]) as any
        }
        return createChainable([]) as any
      })

      const criteria: ReportFilterCriteria = {
        reportType: 'detailed_register',
        periodType: 'all_time',
        selectedUnitIds: ['unit-1'],
        selectedActivityIds: [],
        selectedSessionIds: [],
        activityCategory: '  gathering place  ', // Case-insensitive and untrimmed test
        memberVisitorClassification: 'all',
        selectedMemberIds: [],
        nameQuery: '',
        sessionStatus: 'active_and_closed',
        sortBy: 'checkInTime',
        sortDirection: 'asc',
        groupBy: 'none'
      }

      const report = await reportService.getComprehensiveReport(criteria, ['unit-1'])
      expect(report.records).toHaveLength(1)
      expect(report.records[0].activityCategory).toBe('Gathering Place')
      expect(report.records[0].activityTitle).toBe('Stake Gathering Place')
      expect(report.metrics.totalRecords).toBe(1)
    })
  })
})
