/**
 * YSA AMS — Gathering Place Needs Assessment & Analytics Module Test Suite
 * Stake: Abeokuta Nigeria Obantoko Stake | 2027
 *
 * Comprehensive Test Coverage:
 * 1. Functional Tests (Survey questions, options, validation, distinct hard skills, max selections)
 * 2. Analytics Computation Engine (KPIs, distinct ranking, heatmap, schedule recommendations, ward breakdown)
 * 3. Role-Based Access Control (RBAC) (Strict authorization & denial for all 9 roles)
 * 4. Route Resolution & Navigation Integration
 * 5. Export Functionality & Formula Injection Defense
 */

import { describe, it, expect } from 'vitest'
import {
  gatheringPlaceService,
  validateSurveySubmission
} from '../services/gatheringPlaceService'
import {
  GatheringPlaceSubmissionPayload,
  GatheringPlaceResponse,
  WARD_BRANCH_OPTIONS,
  CURRENT_STATUS_OPTIONS,
  EDUCATION_LEVEL_OPTIONS,
  SELF_RELIANCE_PARTICIPATION_OPTIONS,
  HARD_SKILLS_OPTIONS,
  SOFT_SKILLS_OPTIONS,
  SELF_RELIANCE_CLASS_OPTIONS,
  GOALS_OPTIONS,
  EXPERIENCE_LEVEL_OPTIONS,
  DAYS_OPTIONS,
  TIME_PERIOD_OPTIONS
} from '../types/gatheringPlace'
import { deriveLeadershipAccess } from '../context/AuthContext'
import {
  getRolePermittedNavItems,
  isLeadershipRoutePermitted
} from '../components/layout/LeadershipSidebar'
import {
  isLeadershipPath,
  isGatheringPlaceSurveyPath,
  resolveLeadershipSubpath,
  extractSessionCode
} from '../App'
import { UserUnitAssignment } from '../types/database'
import { sanitizeForSpreadsheet } from '../lib/exportUtils'

describe('YSA Gathering Place — Needs Assessment & Analytics Module', () => {
  // Sample valid submission fixture
  const validPayload: GatheringPlaceSubmissionPayload = {
    assessment_id: 'e7a00000-0000-0000-0000-000000000001',
    ward_branch: 'Obantoko Ward',
    current_status: 'Student',
    education_level: "HND / Bachelor's degree",
    current_self_reliance_participation: 'No',
    hard_skill_first_choice: 'Graphic Design (Canva, Photoshop, etc.)',
    hard_skill_second_choice: 'Web Design & Development',
    hard_skill_third_choice: 'Data Analytics (Excel, Power BI, etc.)',
    soft_skills: ['Communication Skills', 'Leadership & Teamwork', 'Public Speaking'],
    self_reliance_class_interest: 'Starting and Growing My Business',
    desired_outcomes: ['Acquire a new skill', 'Start or grow my own business'],
    experience_level: 'Beginner — I have little or no experience',
    desired_5_6_month_outcome: 'Launch a graphic design freelance business',
    additional_skills_suggestions: 'Mobile App Development',
    gathering_place_suggestions: 'Provide good internet and power backup',
    preferred_days: ['Saturday', 'Friday'],
    preferred_time_periods: ['Morning (8 AM – 12 PM)', 'Evening (4 PM – 7 PM)']
  }

  // ==========================================================================
  // 1. SURVEY QUESTIONS, DATA VALIDATION & DISTINCT HARD SKILLS
  // ==========================================================================
  describe('1. Survey Form Validation & Option Integrity', () => {
    it('verifies all 8 Obantoko Stake units are present in Ward/Branch options', () => {
      expect(WARD_BRANCH_OPTIONS).toHaveLength(8)
      expect(WARD_BRANCH_OPTIONS).toEqual([
        'Abiola-Way Ward',
        'Alabata Branch',
        'Apena Branch',
        'Apete Branch',
        'Camp Ward',
        'Kugba Ward',
        'Obantoko Ward',
        'Odeda Ward'
      ])
    })

    it('verifies complete option sets for status, education, hard skills, soft skills, and classes', () => {
      expect(CURRENT_STATUS_OPTIONS).toHaveLength(6)
      expect(EDUCATION_LEVEL_OPTIONS).toHaveLength(6)
      expect(SELF_RELIANCE_PARTICIPATION_OPTIONS).toHaveLength(3)
      expect(HARD_SKILLS_OPTIONS).toHaveLength(17)
      expect(SOFT_SKILLS_OPTIONS).toHaveLength(11)
      expect(SELF_RELIANCE_CLASS_OPTIONS).toHaveLength(6)
      expect(GOALS_OPTIONS).toHaveLength(10)
      expect(EXPERIENCE_LEVEL_OPTIONS).toHaveLength(3)
      expect(DAYS_OPTIONS).toHaveLength(7)
      expect(TIME_PERIOD_OPTIONS).toHaveLength(3)
    })

    it('accepts a fully compliant survey submission', () => {
      const res = validateSurveySubmission(validPayload)
      expect(res.valid).toBe(true)
      expect(res.error).toBeUndefined()
    })

    it('enforces CRITICAL VALIDATION: First, second, and third hard skills must be DISTINCT', () => {
      // 1st == 2nd
      const duplicate1And2 = {
        ...validPayload,
        hard_skill_first_choice: 'Web Design & Development',
        hard_skill_second_choice: 'Web Design & Development'
      }
      const res1 = validateSurveySubmission(duplicate1And2)
      expect(res1.valid).toBe(false)
      expect(res1.error).toBe(
        'Please select three different skills for your first, second, and third preferences.'
      )

      // 1st == 3rd
      const duplicate1And3 = {
        ...validPayload,
        hard_skill_first_choice: 'Graphic Design (Canva, Photoshop, etc.)',
        hard_skill_third_choice: 'Graphic Design (Canva, Photoshop, etc.)'
      }
      const res2 = validateSurveySubmission(duplicate1And3)
      expect(res2.valid).toBe(false)
      expect(res2.error).toBe(
        'Please select three different skills for your first, second, and third preferences.'
      )

      // 2nd == 3rd
      const duplicate2And3 = {
        ...validPayload,
        hard_skill_second_choice: 'Driving',
        hard_skill_third_choice: 'Driving'
      }
      const res3 = validateSurveySubmission(duplicate2And3)
      expect(res3.valid).toBe(false)
      expect(res3.error).toBe(
        'Please select three different skills for your first, second, and third preferences.'
      )
    })

    it('enforces maximum 3 soft skills selection constraint', () => {
      // 0 soft skills
      const zeroSoft = { ...validPayload, soft_skills: [] }
      const res0 = validateSurveySubmission(zeroSoft)
      expect(res0.valid).toBe(false)
      expect(res0.error).toContain('Please select at least one soft skill')

      // Exactly 3 soft skills: Allowed
      const threeSoft = {
        ...validPayload,
        soft_skills: ['Public Speaking', 'Time Management & Productivity', 'Emotional Resilience']
      }
      expect(validateSurveySubmission(threeSoft).valid).toBe(true)

      // 4 soft skills: Rejected
      const fourSoft = {
        ...validPayload,
        soft_skills: [
          'Communication Skills',
          'Leadership & Teamwork',
          'Public Speaking',
          'Time Management & Productivity'
        ]
      }
      const res4 = validateSurveySubmission(fourSoft)
      expect(res4.valid).toBe(false)
      expect(res4.error).toBe('You can select a maximum of 3 soft skills.')
    })

    it('enforces maximum 3 desired outcomes (goals) constraint', () => {
      // 0 goals
      const zeroGoals = { ...validPayload, desired_outcomes: [] }
      expect(validateSurveySubmission(zeroGoals).valid).toBe(false)

      // 4 goals: Rejected
      const fourGoals = {
        ...validPayload,
        desired_outcomes: [
          'Acquire a new skill',
          'Start or grow my own business',
          'Become more self-reliant',
          'Build meaningful friendships and networks'
        ]
      }
      const res = validateSurveySubmission(fourGoals)
      expect(res.valid).toBe(false)
      expect(res.error).toBe('You can select a maximum of 3 goals.')
    })

    it('enforces required demographic and availability questions', () => {
      expect(validateSurveySubmission({ ...validPayload, ward_branch: '' }).valid).toBe(false)
      expect(validateSurveySubmission({ ...validPayload, current_status: '' }).valid).toBe(false)
      expect(validateSurveySubmission({ ...validPayload, education_level: '' }).valid).toBe(false)
      expect(
        validateSurveySubmission({ ...validPayload, current_self_reliance_participation: '' }).valid
      ).toBe(false)
      expect(validateSurveySubmission({ ...validPayload, preferred_days: [] }).valid).toBe(false)
      expect(validateSurveySubmission({ ...validPayload, preferred_time_periods: [] }).valid).toBe(false)
    })

    it('allows optional text responses (5-6 month outcome, additional skills, suggestions) to remain blank', () => {
      const payloadWithBlanks = {
        ...validPayload,
        desired_5_6_month_outcome: '',
        additional_skills_suggestions: '',
        gathering_place_suggestions: ''
      }
      expect(validateSurveySubmission(payloadWithBlanks).valid).toBe(true)
    })
  })

  // ==========================================================================
  // 2. ANALYTICS ENGINE COMPUTATION & SCHEDULE RECOMMENDATION
  // ==========================================================================
  describe('2. Comprehensive Analytics Computation Engine', () => {
    const mockResponses: GatheringPlaceResponse[] = [
      {
        id: 'resp-1',
        assessmentId: 'a1',
        wardBranch: 'Obantoko Ward',
        currentStatus: 'Student',
        educationLevel: "HND / Bachelor's degree",
        currentSelfRelianceParticipation: 'No',
        hardSkillFirstChoice: 'Graphic Design (Canva, Photoshop, etc.)',
        hardSkillSecondChoice: 'Web Design & Development',
        hardSkillThirdChoice: 'Data Analytics (Excel, Power BI, etc.)',
        softSkills: ['Communication Skills', 'Leadership & Teamwork'],
        selfRelianceClassInterest: 'Starting and Growing My Business',
        desiredOutcomes: ['Acquire a new skill', 'Start or grow my own business'],
        experienceLevel: 'Beginner — I have little or no experience',
        desired56MonthOutcome: 'Freelance design client work',
        additionalSkillsSuggestions: 'UI/UX Design',
        gatheringPlaceSuggestions: 'High-speed internet',
        preferredDays: ['Saturday', 'Friday'],
        preferredTimePeriods: ['Morning (8 AM – 12 PM)'],
        submittedAt: '2026-11-10T10:00:00Z'
      },
      {
        id: 'resp-2',
        assessmentId: 'a1',
        wardBranch: 'Camp Ward',
        currentStatus: 'Employed',
        educationLevel: "HND / Bachelor's degree",
        currentSelfRelianceParticipation: 'Yes',
        hardSkillFirstChoice: 'Web Design & Development',
        hardSkillSecondChoice: 'Artificial Intelligence (AI) & Digital Tools',
        hardSkillThirdChoice: 'Graphic Design (Canva, Photoshop, etc.)',
        softSkills: ['Public Speaking'],
        selfRelianceClassInterest: 'Find a Better Job',
        desiredOutcomes: ['Get a job or improve my employment opportunities'],
        experienceLevel: 'Intermediate — I have some experience',
        desired56MonthOutcome: 'Remote software engineering role',
        additionalSkillsSuggestions: '',
        gatheringPlaceSuggestions: 'Evening mentoring sessions',
        preferredDays: ['Saturday', 'Sunday'],
        preferredTimePeriods: ['Morning (8 AM – 12 PM)', 'Afternoon (12 PM – 4 PM)'],
        submittedAt: '2026-11-10T11:00:00Z'
      },
      {
        id: 'resp-3',
        assessmentId: 'a1',
        wardBranch: 'Obantoko Ward',
        currentStatus: 'Currently seeking employment',
        educationLevel: 'Secondary school',
        currentSelfRelianceParticipation: 'No',
        hardSkillFirstChoice: 'Catering, Baking & Food Processing',
        hardSkillSecondChoice: 'Graphic Design (Canva, Photoshop, etc.)',
        hardSkillThirdChoice: 'Fashion Design & Tailoring',
        softSkills: ['Time Management & Productivity', 'Communication Skills'],
        selfRelianceClassInterest: 'Starting and Growing My Business',
        desiredOutcomes: ['Start or grow my own business', 'Improve my income and financial independence'],
        experienceLevel: 'Beginner — I have little or no experience',
        desired56MonthOutcome: 'Open catering shop',
        additionalSkillsSuggestions: 'Pastry art',
        gatheringPlaceSuggestions: '',
        preferredDays: ['Saturday'],
        preferredTimePeriods: ['Morning (8 AM – 12 PM)'],
        submittedAt: '2026-11-10T12:00:00Z'
      }
    ]

    it('computes accurate KPI cards from submitted survey responses', () => {
      const analytics = gatheringPlaceService.computeAnalytics(mockResponses)

      expect(analytics.totalResponses).toBe(3)
      expect(analytics.participatingUnitsCount).toBe(2) // Obantoko Ward, Camp Ward
      // Graphic Design was chosen by all 3 respondents (1st choice for resp-1, 3rd choice for resp-2, 2nd choice for resp-3)
      expect(analytics.mostPreferredHardSkill).toBe('Graphic Design (Canva, Photoshop, etc.)')
      // Communication Skills chosen by 2 respondents
      expect(analytics.mostPreferredSoftSkill).toBe('Communication Skills')
      expect(analytics.mostRequestedSelfRelianceClass).toBe('Starting and Growing My Business')
      expect(analytics.mostPreferredDay).toBe('Saturday')
      expect(analytics.mostPreferredTimePeriod).toBe('Morning (8 AM – 12 PM)')
    })

    it('computes ranked hard skills without triple-counting respondents', () => {
      const analytics = gatheringPlaceService.computeAnalytics(mockResponses)
      const graphicDesign = analytics.hardSkillsRanked.find(
        (s) => s.skill === 'Graphic Design (Canva, Photoshop, etc.)'
      )
      expect(graphicDesign).toBeDefined()
      expect(graphicDesign!.overallCount).toBe(3) // 3 distinct respondents
      expect(graphicDesign!.firstChoiceCount).toBe(1)
      expect(graphicDesign!.secondChoiceCount).toBe(1)
      expect(graphicDesign!.thirdChoiceCount).toBe(1)
      expect(graphicDesign!.overallPercentage).toBe(100) // 3/3 = 100%

      const webDesign = analytics.hardSkillsRanked.find(
        (s) => s.skill === 'Web Design & Development'
      )
      expect(webDesign).toBeDefined()
      expect(webDesign!.overallCount).toBe(2)
      expect(webDesign!.firstChoiceCount).toBe(1)
      expect(webDesign!.secondChoiceCount).toBe(1)
      expect(webDesign!.thirdChoiceCount).toBe(0)
      expect(webDesign!.overallPercentage).toBe(67) // 2/3 = 67%
    })

    it('generates day x time availability heatmap and top schedule recommendations', () => {
      const analytics = gatheringPlaceService.computeAnalytics(mockResponses)

      // Heatmap matrix should contain 7 days * 3 time periods = 21 cells
      expect(analytics.dayTimeMatrix).toHaveLength(21)

      const satMorning = analytics.dayTimeMatrix.find(
        (c) => c.day === 'Saturday' && c.timePeriod === 'Morning (8 AM – 12 PM)'
      )
      expect(satMorning).toBeDefined()
      expect(satMorning!.count).toBe(3) // All 3 respondents selected Saturday Morning

      // Top recommendation
      expect(analytics.recommendedSchedule.length).toBeGreaterThan(0)
      const topSlot = analytics.recommendedSchedule[0]
      expect(topSlot.day).toBe('Saturday')
      expect(topSlot.timePeriod).toBe('Morning (8 AM – 12 PM)')
      expect(topSlot.score).toBe(3)
      expect(topSlot.rationale).toContain('3 respondents (100%) selected availability')
    })

    it('generates unit breakdown across all 8 Stake units', () => {
      const analytics = gatheringPlaceService.computeAnalytics(mockResponses)
      expect(analytics.wardBreakdown).toHaveLength(8)

      const obantoko = analytics.wardBreakdown.find((w) => w.unitName === 'Obantoko Ward')
      expect(obantoko).toBeDefined()
      expect(obantoko!.responseCount).toBe(2)
      expect(obantoko!.percentage).toBe(67)

      const camp = analytics.wardBreakdown.find((w) => w.unitName === 'Camp Ward')
      expect(camp).toBeDefined()
      expect(camp!.responseCount).toBe(1)
      expect(camp!.percentage).toBe(33)

      const odeda = analytics.wardBreakdown.find((w) => w.unitName === 'Odeda Ward')
      expect(odeda).toBeDefined()
      expect(odeda!.responseCount).toBe(0)
      expect(odeda!.percentage).toBe(0)
    })

    it('preserves open-ended feedback verbatim with unit source and date', () => {
      const analytics = gatheringPlaceService.computeAnalytics(mockResponses)
      expect(analytics.openEndedFeedback.outcomes).toHaveLength(3)
      expect(analytics.openEndedFeedback.outcomes[0].text).toBe('Freelance design client work')
      expect(analytics.openEndedFeedback.additionalSkills).toHaveLength(2)
      expect(analytics.openEndedFeedback.suggestions).toHaveLength(2)
    })
  })

  // ==========================================================================
  // 3. ROLE-BASED ACCESS CONTROL (RBAC) & LEAST-PRIVILEGE AUDIT
  // ==========================================================================
  describe('3. Role-Based Access Control (RBAC) Enforcement', () => {
    const eightUnitIds = [
      'unit-abiola',
      'unit-alabata',
      'unit-apena',
      'unit-apete',
      'unit-camp',
      'unit-kugba',
      'unit-obantoko',
      'unit-odeda'
    ]

    function makeAssignment(unitId: string, role: any): UserUnitAssignment {
      return {
        id: `ua-${unitId}`,
        userId: 'u-test',
        unitId,
        assignedRole: role,
        createdAt: '2026-10-01'
      }
    }

    it('allows System Admin to access Gathering Place module', () => {
      const access = deriveLeadershipAccess(['system_admin'], [])
      expect(access.canAccessGatheringPlace).toBe(true)

      const navItems = getRolePermittedNavItems({
        isStakeLeader: access.isStakeLeader,
        canRecordManualAttendance: access.canRecordManualAttendance,
        canAccessGatheringPlace: access.canAccessGatheringPlace
      })
      expect(navItems.some((item) => item.id === 'gathering-place')).toBe(true)
      expect(isLeadershipRoutePermitted('gathering-place', { ...access, canAccessGatheringPlace: true })).toBe(true)
    })

    it('allows Stake Presidency to access Gathering Place module', () => {
      const access = deriveLeadershipAccess(['stake_presidency'], [])
      expect(access.canAccessGatheringPlace).toBe(true)

      const navItems = getRolePermittedNavItems({
        isStakeLeader: access.isStakeLeader,
        canRecordManualAttendance: access.canRecordManualAttendance,
        canAccessGatheringPlace: access.canAccessGatheringPlace
      })
      expect(navItems.some((item) => item.id === 'gathering-place')).toBe(true)
    })

    it('allows Stake Clerk to access Gathering Place module', () => {
      const access = deriveLeadershipAccess(['stake_clerk'], [])
      expect(access.canAccessGatheringPlace).toBe(true)

      const navItems = getRolePermittedNavItems({
        isStakeLeader: access.isStakeLeader,
        canRecordManualAttendance: access.canRecordManualAttendance,
        canAccessGatheringPlace: access.canAccessGatheringPlace
      })
      expect(navItems.some((item) => item.id === 'gathering-place')).toBe(true)
    })

    it('allows Stake YSA Leader (assigned across all 8 stake units) to access Gathering Place module', () => {
      const allEightAssignments = eightUnitIds.map((u) => makeAssignment(u, 'ysa_leader'))
      const access = deriveLeadershipAccess(['ysa_leader'], allEightAssignments)
      expect(access.canAccessGatheringPlace).toBe(true)

      const navItems = getRolePermittedNavItems({
        isStakeLeader: access.isStakeLeader,
        canRecordManualAttendance: access.canRecordManualAttendance,
        canAccessGatheringPlace: access.canAccessGatheringPlace
      })
      expect(navItems.some((item) => item.id === 'gathering-place')).toBe(true)
    })

    it('allows Stake YSA Leader with unconstrained stake-wide role (no unit restrictions) to access Gathering Place', () => {
      const access = deriveLeadershipAccess(['ysa_leader'], [])
      expect(access.canAccessGatheringPlace).toBe(true)
    })

    it('STRICTLY DENIES Bishop from accessing Gathering Place module', () => {
      const access = deriveLeadershipAccess(
        ['bishop'],
        [makeAssignment('unit-obantoko', 'bishop')]
      )
      expect(access.canAccessGatheringPlace).toBe(false)

      const navItems = getRolePermittedNavItems({
        isStakeLeader: access.isStakeLeader,
        canRecordManualAttendance: access.canRecordManualAttendance,
        canAccessGatheringPlace: access.canAccessGatheringPlace
      })
      expect(navItems.some((item) => item.id === 'gathering-place')).toBe(false)
      expect(isLeadershipRoutePermitted('gathering-place', { ...access, canAccessGatheringPlace: false })).toBe(false)
    })

    it('STRICTLY DENIES Branch President from accessing Gathering Place module', () => {
      const access = deriveLeadershipAccess(
        ['branch_president'],
        [makeAssignment('unit-alabata', 'branch_president')]
      )
      expect(access.canAccessGatheringPlace).toBe(false)

      const navItems = getRolePermittedNavItems({
        isStakeLeader: access.isStakeLeader,
        canRecordManualAttendance: access.canRecordManualAttendance,
        canAccessGatheringPlace: access.canAccessGatheringPlace
      })
      expect(navItems.some((item) => item.id === 'gathering-place')).toBe(false)
    })

    it('allows YSA Leader (including unit-assigned YSA leaders) to access Gathering Place module', () => {
      const access = deriveLeadershipAccess(
        ['ysa_leader'],
        [makeAssignment('unit-camp', 'ysa_leader')]
      )
      expect(access.canAccessGatheringPlace).toBe(true)

      const navItems = getRolePermittedNavItems({
        isStakeLeader: access.isStakeLeader,
        canRecordManualAttendance: access.canRecordManualAttendance,
        canAccessGatheringPlace: access.canAccessGatheringPlace
      })
      expect(navItems.some((item) => item.id === 'gathering-place')).toBe(true)
    })

    it('STRICTLY DENIES Ward Clerk and Branch Clerk from accessing Gathering Place module', () => {
      const wardClerkAccess = deriveLeadershipAccess(
        ['ward_clerk'],
        [makeAssignment('unit-obantoko', 'ward_clerk')]
      )
      expect(wardClerkAccess.canAccessGatheringPlace).toBe(false)

      const branchClerkAccess = deriveLeadershipAccess(
        ['branch_clerk'],
        [makeAssignment('unit-apena', 'branch_clerk')]
      )
      expect(branchClerkAccess.canAccessGatheringPlace).toBe(false)
    })

    it('STRICTLY DENIES general attendees and anonymous users from accessing protected Gathering Place routes', () => {
      const attendeeAccess = deriveLeadershipAccess([], [])
      expect(attendeeAccess.canAccessGatheringPlace).toBe(false)
    })
  })

  // ==========================================================================
  // 4. ROUTE ARCHITECTURE & NAVIGATION INTEGRATION
  // ==========================================================================
  describe('4. Route Architecture & Public/Leadership Separation', () => {
    it('correctly resolves public survey paths without requiring authentication', () => {
      expect(isGatheringPlaceSurveyPath('/gathering-place/survey')).toBe(true)
      expect(isGatheringPlaceSurveyPath('/gathering-place')).toBe(true)
      expect(isGatheringPlaceSurveyPath('/gathering-place/')).toBe(true)
      expect(isGatheringPlaceSurveyPath('/gathering-place/survey/2027')).toBe(true)
      expect(isGatheringPlaceSurveyPath('/la/dashboard')).toBe(false)
      expect(isGatheringPlaceSurveyPath('/terminal')).toBe(false)
      expect(isGatheringPlaceSurveyPath('/')).toBe(false)
    })

    it('correctly resolves protected gathering place leadership routes and aliases', () => {
      expect(isLeadershipPath('/la/gathering-place')).toBe(true)
      expect(isLeadershipPath('/admin/gathering-place/assessment')).toBe(true)
      expect(isLeadershipPath('/admin/gathering-place/responses')).toBe(true)

      expect(resolveLeadershipSubpath('/la/gathering-place')).toBe('gathering-place')
      expect(resolveLeadershipSubpath('/la/gathering-place/assessment')).toBe('gathering-place')
      expect(resolveLeadershipSubpath('/admin/gathering-place/assessment')).toBe('gathering-place')
      expect(resolveLeadershipSubpath('/admin/gathering-place/responses')).toBe('gathering-place')
    })

    it('ensures gathering place survey paths are never mistaken for 6-character session codes', () => {
      expect(extractSessionCode('/gathering-place/survey')).toBeNull()
      expect(extractSessionCode('/gathering-place')).toBeNull()
      expect(extractSessionCode('/admin/gathering-place/assessment')).toBeNull()
      expect(extractSessionCode('/5BV21F')).toBe('5BV21F')
    })
  })

  // ==========================================================================
  // 5. EXPORT UTILITY & SECURITY SANITIZATION
  // ==========================================================================
  describe('5. Export Sanitization & Spreadsheet Formula Injection Defense', () => {
    it('sanitizes dangerous spreadsheet formula prefixes (=, +, -, @, tab, newline)', () => {
      expect(sanitizeForSpreadsheet('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)")
      expect(sanitizeForSpreadsheet('+12345')).toBe("'+12345")
      expect(sanitizeForSpreadsheet('-50')).toBe("'-50")
      expect(sanitizeForSpreadsheet('@cmd|/c calc')).toBe("'@cmd|/c calc")
      expect(sanitizeForSpreadsheet('\tTabbed')).toBe("'\tTabbed")
      expect(sanitizeForSpreadsheet('Normal Text')).toBe('Normal Text')
      expect(sanitizeForSpreadsheet(null)).toBe('')
      expect(sanitizeForSpreadsheet(undefined)).toBe('')
    })
  })
})
