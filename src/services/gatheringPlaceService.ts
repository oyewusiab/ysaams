/**
 * Service Layer: Gathering Place Needs Assessment & Analytics
 * Abeokuta Nigeria Obantoko Stake | 2027
 */

import { supabase } from '../lib/supabase'
import {
  GatheringPlaceAssessment,
  GatheringPlaceResponse,
  GatheringPlaceSubmissionPayload,
  GatheringPlaceAnalytics,
  ResponseFilters,
  AssessmentStatus,
  WARD_BRANCH_OPTIONS,
  DAYS_OPTIONS,
  TIME_PERIOD_OPTIONS,
  HARD_SKILLS_OPTIONS,
  SOFT_SKILLS_OPTIONS,
  SELF_RELIANCE_CLASS_OPTIONS,
  GOALS_OPTIONS,
  EXPERIENCE_LEVEL_OPTIONS,
  CURRENT_STATUS_OPTIONS,
  EDUCATION_LEVEL_OPTIONS,
  SELF_RELIANCE_PARTICIPATION_OPTIONS,
  SkillPreferenceItem,
  FrequencyItem,
  DayTimeMatrixCell,
  WardAnalyticsItem,
  RecommendedScheduleSlot
} from '../types/gatheringPlace'
import { sanitizeForSpreadsheet } from '../lib/exportUtils'
import writeXlsxFile, { SheetData, Row } from 'write-excel-file/browser'

export const DEFAULT_ASSESSMENT_ID = 'e7a00000-0000-0000-0000-000000000001'
export const DEFAULT_PUBLIC_SLUG = '2027-skills-assessment'

export function validateSurveySubmission(payload: GatheringPlaceSubmissionPayload): {
  valid: boolean
  error?: string
} {
  if (!payload.assessment_id) {
    return { valid: false, error: 'Assessment identifier is missing.' }
  }
  if (!payload.ward_branch || !payload.ward_branch.trim()) {
    return { valid: false, error: 'Please select your Ward or Branch.' }
  }
  if (!payload.current_status || !payload.current_status.trim()) {
    return { valid: false, error: 'Please select your current status.' }
  }
  if (!payload.education_level || !payload.education_level.trim()) {
    return { valid: false, error: 'Please select your highest level of education.' }
  }
  if (!payload.current_self_reliance_participation || !payload.current_self_reliance_participation.trim()) {
    return { valid: false, error: 'Please indicate your participation in skill or self-reliance programs.' }
  }

  // Question 5 — Ranked Hard Skills: Must be 3 distinct choices
  if (
    !payload.hard_skill_first_choice ||
    !payload.hard_skill_second_choice ||
    !payload.hard_skill_third_choice
  ) {
    return { valid: false, error: 'Please select your first, second, and third practical skills.' }
  }

  const h1 = payload.hard_skill_first_choice.trim()
  const h2 = payload.hard_skill_second_choice.trim()
  const h3 = payload.hard_skill_third_choice.trim()

  if (h1 === h2 || h1 === h3 || h2 === h3) {
    return {
      valid: false,
      error: 'Please select three different skills for your first, second, and third preferences.'
    }
  }

  // Question 6 — Soft Skills (1 to 3)
  if (!payload.soft_skills || payload.soft_skills.length === 0) {
    return { valid: false, error: 'Please select at least one soft skill to develop.' }
  }
  if (payload.soft_skills.length > 3) {
    return { valid: false, error: 'You can select a maximum of 3 soft skills.' }
  }

  // Question 7 — Self-Reliance Class
  if (!payload.self_reliance_class_interest || !payload.self_reliance_class_interest.trim()) {
    return { valid: false, error: 'Please select a Self-Reliance class you would like to attend.' }
  }

  // Question 8 — Goals (1 to 3)
  if (!payload.desired_outcomes || payload.desired_outcomes.length === 0) {
    return { valid: false, error: 'Please select at least one goal you hope to achieve.' }
  }
  if (payload.desired_outcomes.length > 3) {
    return { valid: false, error: 'You can select a maximum of 3 goals.' }
  }

  // Question 9 — Experience Level
  if (!payload.experience_level || !payload.experience_level.trim()) {
    return { valid: false, error: 'Please select your current experience level.' }
  }

  // Question 13 — Availability Days
  if (!payload.preferred_days || payload.preferred_days.length === 0) {
    return { valid: false, error: 'Please select at least one convenient day.' }
  }

  // Question 14 — Availability Times
  if (!payload.preferred_time_periods || payload.preferred_time_periods.length === 0) {
    return { valid: false, error: 'Please select at least one convenient time period.' }
  }

  return { valid: true }
}

export const gatheringPlaceService = {
  /**
   * Retrieves the active assessment configuration.
   */
  async getActiveAssessment(): Promise<GatheringPlaceAssessment | null> {
    try {
      const { data, error } = await supabase
        .from('gathering_place_assessments')
        .select('*')
        .eq('status', 'active')
        .order('assessment_year', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        console.warn('getActiveAssessment database query error, fallback:', error.message)
      }

      if (data) {
        return {
          id: data.id,
          title: data.title,
          description: data.description,
          assessmentYear: data.assessment_year,
          status: data.status as AssessmentStatus,
          publicSlug: data.public_slug,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
          closedAt: data.closed_at
        }
      }

      // Default fallback for initial active 2027 assessment
      return {
        id: DEFAULT_ASSESSMENT_ID,
        title: 'YSA Gathering Place: Skills & Self-Reliance Needs Assessment',
        description: 'Abeokuta Nigeria Obantoko Stake | 2027 Gathering Place Planning',
        assessmentYear: 2027,
        status: 'active',
        publicSlug: DEFAULT_PUBLIC_SLUG,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    } catch {
      return {
        id: DEFAULT_ASSESSMENT_ID,
        title: 'YSA Gathering Place: Skills & Self-Reliance Needs Assessment',
        description: 'Abeokuta Nigeria Obantoko Stake | 2027 Gathering Place Planning',
        assessmentYear: 2027,
        status: 'active',
        publicSlug: DEFAULT_PUBLIC_SLUG,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    }
  },

  /**
   * Retrieves an assessment by ID or slug.
   */
  async getAssessmentById(idOrSlug: string): Promise<GatheringPlaceAssessment | null> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug)
    let query = supabase.from('gathering_place_assessments').select('*')
    if (isUuid) {
      query = query.eq('id', idOrSlug)
    } else {
      query = query.eq('public_slug', idOrSlug)
    }

    const { data, error } = await query.maybeSingle()
    if (error || !data) return null

    return {
      id: data.id,
      title: data.title,
      description: data.description,
      assessmentYear: data.assessment_year,
      status: data.status as AssessmentStatus,
      publicSlug: data.public_slug,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      closedAt: data.closed_at
    }
  },

  /**
   * Lists all assessments for authorized management.
   */
  async listAssessments(): Promise<GatheringPlaceAssessment[]> {
    const { data, error } = await supabase
      .from('gathering_place_assessments')
      .select('*, gathering_place_assessment_responses(count)')
      .order('assessment_year', { ascending: false })

    if (error) {
      throw new Error(`Failed to list assessments: ${error.message}`)
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      assessmentYear: row.assessment_year,
      status: row.status as AssessmentStatus,
      publicSlug: row.public_slug,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at,
      totalResponses: Array.isArray(row.gathering_place_assessment_responses)
        ? row.gathering_place_assessment_responses[0]?.count || 0
        : 0
    }))
  },

  /**
   * Updates assessment status (active, closed, draft, archived).
   */
  async updateAssessmentStatus(
    assessmentId: string,
    status: AssessmentStatus
  ): Promise<{ success: boolean; status: AssessmentStatus }> {
    // Try RPC first for defensive server validation
    const { data, error: rpcError } = await supabase.rpc(
      'update_gathering_place_assessment_status',
      {
        p_assessment_id: assessmentId,
        p_status: status
      }
    )

    if (!rpcError && data?.success) {
      return { success: true, status }
    }

    // Direct table update fallback if user is authorized under RLS
    const now = new Date().toISOString()
    const { error: directError } = await supabase
      .from('gathering_place_assessments')
      .update({
        status,
        updated_at: now,
        closed_at: status === 'closed' ? now : null
      })
      .eq('id', assessmentId)

    if (directError) {
      throw new Error(`Failed to update assessment status: ${directError.message}`)
    }

    return { success: true, status }
  },

  /**
   * Submits a public response to the assessment.
   */
  async submitResponse(
    payload: GatheringPlaceSubmissionPayload
  ): Promise<{ success: boolean; responseId?: string; message: string }> {
    const validation = validateSurveySubmission(payload)
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid submission.')
    }

    // Try RPC first (enforces atomic server-side validation)
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'submit_gathering_place_response',
      { p_response: payload }
    )

    if (!rpcError && rpcData?.success) {
      return {
        success: true,
        responseId: rpcData.response_id,
        message:
          rpcData.message ||
          'Your survey response has been successfully submitted. Thank you for helping shape the Gathering Place!'
      }
    }

    // Fallback: Direct table INSERT (handled under policy_gp_responses_insert)
    const insertRecord = {
      assessment_id: payload.assessment_id,
      ward_branch: payload.ward_branch.trim(),
      current_status: payload.current_status.trim(),
      education_level: payload.education_level.trim(),
      current_self_reliance_participation: payload.current_self_reliance_participation.trim(),
      hard_skill_first_choice: payload.hard_skill_first_choice.trim(),
      hard_skill_second_choice: payload.hard_skill_second_choice.trim(),
      hard_skill_third_choice: payload.hard_skill_third_choice.trim(),
      soft_skills: payload.soft_skills,
      self_reliance_class_interest: payload.self_reliance_class_interest.trim(),
      desired_outcomes: payload.desired_outcomes,
      experience_level: payload.experience_level.trim(),
      desired_5_6_month_outcome: payload.desired_5_6_month_outcome?.trim() || null,
      additional_skills_suggestions: payload.additional_skills_suggestions?.trim() || null,
      gathering_place_suggestions: payload.gathering_place_suggestions?.trim() || null,
      preferred_days: payload.preferred_days,
      preferred_time_periods: payload.preferred_time_periods
    }

    const { data: directData, error: directError } = await supabase
      .from('gathering_place_assessment_responses')
      .insert(insertRecord)
      .select('id')
      .single()

    if (directError) {
      if (directError.message.includes('check_distinct_hard_skills')) {
        throw new Error('Please select three different skills for your first, second, and third preferences.')
      }
      if (directError.message.includes('violates row-level security policy')) {
        throw new Error('This assessment is currently closed and cannot accept new responses.')
      }
      throw new Error(`Submission failed: ${directError.message}`)
    }

    return {
      success: true,
      responseId: directData.id,
      message: 'Your survey response has been successfully submitted. Thank you for helping shape the Gathering Place!'
    }
  },

  /**
   * Fetches all responses for an assessment. Strictly restricted to authorized Stake leadership.
   */
  async getResponses(
    assessmentId: string,
    filters?: ResponseFilters
  ): Promise<GatheringPlaceResponse[]> {
    let query = supabase
      .from('gathering_place_assessment_responses')
      .select('*')
      .eq('assessment_id', assessmentId)
      .order('submitted_at', { ascending: false })

    if (filters?.wardBranch && filters.wardBranch !== 'all') {
      query = query.eq('ward_branch', filters.wardBranch)
    }
    if (filters?.currentStatus && filters.currentStatus !== 'all') {
      if (filters.currentStatus === 'Other') {
        query = query.ilike('current_status', 'Other%')
      } else {
        query = query.eq('current_status', filters.currentStatus)
      }
    }
    if (filters?.educationLevel && filters.educationLevel !== 'all') {
      if (filters.educationLevel === 'Other') {
        query = query.ilike('education_level', 'Other%')
      } else {
        query = query.eq('education_level', filters.educationLevel)
      }
    }

    const { data, error } = await query

    if (error) {
      throw new Error(`Failed to load assessment responses: ${error.message}`)
    }

    let records: GatheringPlaceResponse[] = (data || []).map((row: any) => ({
      id: row.id,
      assessmentId: row.assessment_id,
      wardBranch: row.ward_branch,
      currentStatus: row.current_status,
      educationLevel: row.education_level,
      currentSelfRelianceParticipation: row.current_self_reliance_participation,
      hardSkillFirstChoice: row.hard_skill_first_choice,
      hardSkillSecondChoice: row.hard_skill_second_choice,
      hardSkillThirdChoice: row.hard_skill_third_choice,
      softSkills: row.soft_skills || [],
      selfRelianceClassInterest: row.self_reliance_class_interest,
      desiredOutcomes: row.desired_outcomes || [],
      experienceLevel: row.experience_level,
      desired56MonthOutcome: row.desired_5_6_month_outcome,
      additionalSkillsSuggestions: row.additional_skills_suggestions,
      gatheringPlaceSuggestions: row.gathering_place_suggestions,
      preferredDays: row.preferred_days || [],
      preferredTimePeriods: row.preferred_time_periods || [],
      submittedAt: row.submitted_at,
      updatedAt: row.updated_at
    }))

    // Text search query filter across open-ended feedback and text fields
    if (filters?.searchQuery && filters.searchQuery.trim()) {
      const q = filters.searchQuery.trim().toLowerCase()
      records = records.filter(
        (r) =>
          r.wardBranch.toLowerCase().includes(q) ||
          r.currentStatus.toLowerCase().includes(q) ||
          r.educationLevel.toLowerCase().includes(q) ||
          r.hardSkillFirstChoice.toLowerCase().includes(q) ||
          r.hardSkillSecondChoice.toLowerCase().includes(q) ||
          r.hardSkillThirdChoice.toLowerCase().includes(q) ||
          (r.softSkills || []).some((s) => s.toLowerCase().includes(q)) ||
          (r.desiredOutcomes || []).some((g) => g.toLowerCase().includes(q)) ||
          (r.desired56MonthOutcome && r.desired56MonthOutcome.toLowerCase().includes(q)) ||
          (r.additionalSkillsSuggestions && r.additionalSkillsSuggestions.toLowerCase().includes(q)) ||
          (r.gatheringPlaceSuggestions && r.gatheringPlaceSuggestions.toLowerCase().includes(q))
      )
    }

    return records
  },

  /**
   * Pure calculation: computes comprehensive analytics from responses.
   */
  computeAnalytics(responses: GatheringPlaceResponse[]): GatheringPlaceAnalytics {
    const total = responses.length

    const normalizeOther = (val?: string | null): string => {
      if (!val) return ''
      const trimmed = val.trim()
      if (trimmed === 'Other' || trimmed.startsWith('Other:') || trimmed.startsWith('Other (')) {
        return 'Other'
      }
      return trimmed
    }

    // Participating Wards/Branches
    const participatingUnits = new Set(responses.map((r) => r.wardBranch))
    const participatingUnitsCount = participatingUnits.size

    // 1. Hard Skills Analytics
    // Track 1st, 2nd, 3rd and overall unique respondent demand
    const firstChoiceCounts: Record<string, number> = {}
    const secondChoiceCounts: Record<string, number> = {}
    const thirdChoiceCounts: Record<string, number> = {}
    const overallCounts: Record<string, number> = {}

    for (const opt of HARD_SKILLS_OPTIONS) {
      firstChoiceCounts[opt] = 0
      secondChoiceCounts[opt] = 0
      thirdChoiceCounts[opt] = 0
      overallCounts[opt] = 0
    }

    for (const r of responses) {
      const h1 = normalizeOther(r.hardSkillFirstChoice)
      const h2 = normalizeOther(r.hardSkillSecondChoice)
      const h3 = normalizeOther(r.hardSkillThirdChoice)

      if (h1) {
        firstChoiceCounts[h1] = (firstChoiceCounts[h1] || 0) + 1
      }
      if (h2) {
        secondChoiceCounts[h2] = (secondChoiceCounts[h2] || 0) + 1
      }
      if (h3) {
        thirdChoiceCounts[h3] = (thirdChoiceCounts[h3] || 0) + 1
      }

      // Overall: Distinct set of skills for this respondent
      const respondentSkills = new Set([h1, h2, h3].filter(Boolean))

      for (const skill of respondentSkills) {
        overallCounts[skill] = (overallCounts[skill] || 0) + 1
      }
    }

    const hardSkillsRanked: SkillPreferenceItem[] = Object.keys(overallCounts)
      .map((skill) => {
        const count = overallCounts[skill] || 0
        return {
          skill,
          firstChoiceCount: firstChoiceCounts[skill] || 0,
          secondChoiceCount: secondChoiceCounts[skill] || 0,
          thirdChoiceCount: thirdChoiceCounts[skill] || 0,
          overallCount: count,
          overallPercentage: total > 0 ? Math.round((count / total) * 100) : 0
        }
      })
      .sort((a, b) => b.overallCount - a.overallCount || b.firstChoiceCount - a.firstChoiceCount)

    const mostPreferredHardSkill = hardSkillsRanked[0]?.overallCount > 0
      ? hardSkillsRanked[0].skill
      : 'None'

    // 2. Soft Skills Analytics
    const softCounts: Record<string, number> = {}
    for (const opt of SOFT_SKILLS_OPTIONS) softCounts[opt] = 0

    for (const r of responses) {
      for (const s of r.softSkills || []) {
        const key = normalizeOther(s)
        softCounts[key] = (softCounts[key] || 0) + 1
      }
    }

    const softSkillsRanked: FrequencyItem[] = Object.keys(softCounts)
      .map((s) => ({
        label: s,
        count: softCounts[s],
        percentage: total > 0 ? Math.round((softCounts[s] / total) * 100) : 0
      }))
      .sort((a, b) => b.count - a.count)

    const mostPreferredSoftSkill = softSkillsRanked[0]?.count > 0
      ? softSkillsRanked[0].label
      : 'None'

    // 3. Self-Reliance Class Analytics
    const srCounts: Record<string, number> = {}
    for (const opt of SELF_RELIANCE_CLASS_OPTIONS) srCounts[opt] = 0

    for (const r of responses) {
      if (r.selfRelianceClassInterest) {
        srCounts[r.selfRelianceClassInterest] = (srCounts[r.selfRelianceClassInterest] || 0) + 1
      }
    }

    const selfRelianceClassesRanked: FrequencyItem[] = Object.keys(srCounts)
      .map((label) => ({
        label,
        count: srCounts[label],
        percentage: total > 0 ? Math.round((srCounts[label] / total) * 100) : 0
      }))
      .sort((a, b) => b.count - a.count)

    const mostRequestedSelfRelianceClass = selfRelianceClassesRanked[0]?.count > 0
      ? selfRelianceClassesRanked[0].label
      : 'None'

    // 4. Goals and Desired Outcomes
    const goalCounts: Record<string, number> = {}
    for (const opt of GOALS_OPTIONS) goalCounts[opt] = 0

    for (const r of responses) {
      for (const g of r.desiredOutcomes || []) {
        const key = normalizeOther(g)
        goalCounts[key] = (goalCounts[key] || 0) + 1
      }
    }

    const desiredOutcomesRanked: FrequencyItem[] = Object.keys(goalCounts)
      .map((g) => ({
        label: g,
        count: goalCounts[g],
        percentage: total > 0 ? Math.round((goalCounts[g] / total) * 100) : 0
      }))
      .sort((a, b) => b.count - a.count)

    // 5. Experience Distribution
    const expCounts: Record<string, number> = {}
    for (const opt of EXPERIENCE_LEVEL_OPTIONS) expCounts[opt] = 0
    for (const r of responses) {
      if (r.experienceLevel) {
        expCounts[r.experienceLevel] = (expCounts[r.experienceLevel] || 0) + 1
      }
    }
    const experienceDistribution: FrequencyItem[] = Object.keys(expCounts).map((label) => ({
      label,
      count: expCounts[label],
      percentage: total > 0 ? Math.round((expCounts[label] / total) * 100) : 0
    }))

    // 6. Current Status & Education Distribution
    const statusCounts: Record<string, number> = {}
    for (const opt of CURRENT_STATUS_OPTIONS) statusCounts[opt] = 0
    for (const r of responses) {
      if (r.currentStatus) {
        const key = normalizeOther(r.currentStatus)
        statusCounts[key] = (statusCounts[key] || 0) + 1
      }
    }
    const statusDistribution: FrequencyItem[] = Object.keys(statusCounts).map((label) => ({
      label,
      count: statusCounts[label],
      percentage: total > 0 ? Math.round((statusCounts[label] / total) * 100) : 0
    }))

    const eduCounts: Record<string, number> = {}
    for (const opt of EDUCATION_LEVEL_OPTIONS) eduCounts[opt] = 0
    for (const r of responses) {
      if (r.educationLevel) {
        const key = normalizeOther(r.educationLevel)
        eduCounts[key] = (eduCounts[key] || 0) + 1
      }
    }
    const educationDistribution: FrequencyItem[] = Object.keys(eduCounts).map((label) => ({
      label,
      count: eduCounts[label],
      percentage: total > 0 ? Math.round((eduCounts[label] / total) * 100) : 0
    }))

    const srPartCounts: Record<string, number> = {}
    for (const opt of SELF_RELIANCE_PARTICIPATION_OPTIONS) srPartCounts[opt] = 0
    for (const r of responses) {
      if (r.currentSelfRelianceParticipation) {
        srPartCounts[r.currentSelfRelianceParticipation] =
          (srPartCounts[r.currentSelfRelianceParticipation] || 0) + 1
      }
    }
    const outsideParticipationDistribution: FrequencyItem[] = Object.keys(srPartCounts).map((label) => ({
      label,
      count: srPartCounts[label],
      percentage: total > 0 ? Math.round((srPartCounts[label] / total) * 100) : 0
    }))

    // 7. Availability Demand & Heatmap
    const daysCounts: Record<string, number> = {}
    for (const d of DAYS_OPTIONS) daysCounts[d] = 0

    const timeCounts: Record<string, number> = {}
    for (const t of TIME_PERIOD_OPTIONS) timeCounts[t] = 0

    const matrixCounts: Record<string, number> = {}
    for (const d of DAYS_OPTIONS) {
      for (const t of TIME_PERIOD_OPTIONS) {
        matrixCounts[`${d}|${t}`] = 0
      }
    }

    for (const r of responses) {
      for (const d of r.preferredDays || []) {
        daysCounts[d] = (daysCounts[d] || 0) + 1
      }
      for (const t of r.preferredTimePeriods || []) {
        timeCounts[t] = (timeCounts[t] || 0) + 1
      }
      // Pairings
      for (const d of r.preferredDays || []) {
        for (const t of r.preferredTimePeriods || []) {
          const key = `${d}|${t}`
          matrixCounts[key] = (matrixCounts[key] || 0) + 1
        }
      }
    }

    const daysDemand: FrequencyItem[] = DAYS_OPTIONS.map((d) => ({
      label: d,
      count: daysCounts[d] || 0,
      percentage: total > 0 ? Math.round(((daysCounts[d] || 0) / total) * 100) : 0
    }))

    const timePeriodsDemand: FrequencyItem[] = TIME_PERIOD_OPTIONS.map((t) => ({
      label: t,
      count: timeCounts[t] || 0,
      percentage: total > 0 ? Math.round(((timeCounts[t] || 0) / total) * 100) : 0
    }))

    const sortedDays = [...daysDemand].sort((a, b) => b.count - a.count)
    const sortedTimes = [...timePeriodsDemand].sort((a, b) => b.count - a.count)
    const mostPreferredDay = sortedDays[0]?.count > 0 ? sortedDays[0].label : 'None'
    const mostPreferredTimePeriod = sortedTimes[0]?.count > 0 ? sortedTimes[0].label : 'None'

    const dayTimeMatrix: DayTimeMatrixCell[] = []
    for (const d of DAYS_OPTIONS) {
      for (const t of TIME_PERIOD_OPTIONS) {
        dayTimeMatrix.push({
          day: d,
          timePeriod: t,
          count: matrixCounts[`${d}|${t}`] || 0
        })
      }
    }

    // Recommended Data-Driven Schedule (top slots)
    const recommendedSchedule: RecommendedScheduleSlot[] = dayTimeMatrix
      .filter((slot) => slot.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((slot) => {
        const pct = total > 0 ? Math.round((slot.count / total) * 100) : 0
        return {
          day: slot.day,
          timePeriod: slot.timePeriod,
          score: slot.count,
          rationale: `${slot.count} respondents (${pct}%) selected availability for ${slot.day} in the ${slot.timePeriod}.`
        }
      })

    // 8. Ward / Branch Analysis (all 8 stake units)
    const wardBreakdown: WardAnalyticsItem[] = WARD_BRANCH_OPTIONS.map((unitName) => {
      const unitResponses = responses.filter((r) => r.wardBranch === unitName)
      const uCount = unitResponses.length
      const uPct = total > 0 ? Math.round((uCount / total) * 100) : 0

      // Top hard skill in this unit
      const uSkills: Record<string, number> = {}
      for (const ur of unitResponses) {
        const h1 = normalizeOther(ur.hardSkillFirstChoice)
        const h2 = normalizeOther(ur.hardSkillSecondChoice)
        const h3 = normalizeOther(ur.hardSkillThirdChoice)
        if (h1) uSkills[h1] = (uSkills[h1] || 0) + 2
        if (h2) uSkills[h2] = (uSkills[h2] || 0) + 1
        if (h3) uSkills[h3] = (uSkills[h3] || 0) + 1
      }
      const topSkillEntry = Object.entries(uSkills).sort((a, b) => b[1] - a[1])[0]

      // Top soft skill in this unit
      const uSoft: Record<string, number> = {}
      for (const ur of unitResponses) {
        for (const s of ur.softSkills || []) {
          const key = normalizeOther(s)
          uSoft[key] = (uSoft[key] || 0) + 1
        }
      }
      const topSoftEntry = Object.entries(uSoft).sort((a, b) => b[1] - a[1])[0]

      // Top SR class in this unit
      const uSr: Record<string, number> = {}
      for (const ur of unitResponses) {
        if (ur.selfRelianceClassInterest) {
          uSr[ur.selfRelianceClassInterest] = (uSr[ur.selfRelianceClassInterest] || 0) + 1
        }
      }
      const topSrEntry = Object.entries(uSr).sort((a, b) => b[1] - a[1])[0]

      // Top Day & Time in this unit
      const uDays: Record<string, number> = {}
      for (const ur of unitResponses) {
        for (const d of ur.preferredDays || []) {
          uDays[d] = (uDays[d] || 0) + 1
        }
      }
      const topDayEntry = Object.entries(uDays).sort((a, b) => b[1] - a[1])[0]

      const uTimes: Record<string, number> = {}
      for (const ur of unitResponses) {
        for (const t of ur.preferredTimePeriods || []) {
          uTimes[t] = (uTimes[t] || 0) + 1
        }
      }
      const topTimeEntry = Object.entries(uTimes).sort((a, b) => b[1] - a[1])[0]

      return {
        unitName,
        responseCount: uCount,
        percentage: uPct,
        topHardSkill: topSkillEntry ? topSkillEntry[0] : 'N/A',
        topSoftSkill: topSoftEntry ? topSoftEntry[0] : 'N/A',
        topSelfRelianceClass: topSrEntry ? topSrEntry[0] : 'N/A',
        topDay: topDayEntry ? topDayEntry[0] : 'N/A',
        topTimePeriod: topTimeEntry ? topTimeEntry[0] : 'N/A'
      }
    }).sort((a, b) => b.responseCount - a.responseCount)

    // 9. Open-Ended Feedback Collections
    const openEndedFeedback = {
      outcomes: responses
        .filter((r) => r.desired56MonthOutcome && r.desired56MonthOutcome.trim())
        .map((r) => ({
          id: r.id,
          ward: r.wardBranch,
          text: r.desired56MonthOutcome!.trim(),
          date: r.submittedAt
        })),
      additionalSkills: responses
        .filter((r) => r.additionalSkillsSuggestions && r.additionalSkillsSuggestions.trim())
        .map((r) => ({
          id: r.id,
          ward: r.wardBranch,
          text: r.additionalSkillsSuggestions!.trim(),
          date: r.submittedAt
        })),
      suggestions: responses
        .filter((r) => r.gatheringPlaceSuggestions && r.gatheringPlaceSuggestions.trim())
        .map((r) => ({
          id: r.id,
          ward: r.wardBranch,
          text: r.gatheringPlaceSuggestions!.trim(),
          date: r.submittedAt
        }))
    }

    return {
      totalResponses: total,
      participatingUnitsCount,
      mostPreferredHardSkill,
      mostPreferredSoftSkill,
      mostRequestedSelfRelianceClass,
      mostPreferredDay,
      mostPreferredTimePeriod,
      hardSkillsRanked,
      softSkillsRanked,
      selfRelianceClassesRanked,
      desiredOutcomesRanked,
      experienceDistribution,
      statusDistribution,
      educationDistribution,
      outsideParticipationDistribution,
      daysDemand,
      timePeriodsDemand,
      dayTimeMatrix,
      recommendedSchedule,
      wardBreakdown,
      openEndedFeedback
    }
  },

  /**
   * Exports survey responses to CSV with formula injection sanitization.
   */
  exportToCsv(responses: GatheringPlaceResponse[], filename = 'gathering_place_assessment_responses'): void {
    const metaRows: string[] = [
      `"Abeokuta Nigeria Obantoko Stake — YSA Gathering Place Needs Assessment"`,
      `"Generated:","${new Date().toISOString()}"`,
      `"Total Submitted Responses:",${responses.length}`,
      `""`
    ]

    const columns = [
      'Submission ID',
      'Submission Date',
      'Ward / Branch',
      'Current Status',
      'Education Level',
      'Participating in Outside Programs',
      'First Choice Hard Skill',
      'Second Choice Hard Skill',
      'Third Choice Hard Skill',
      'Soft Skills Selected',
      'Self-Reliance Class Interest',
      'Goals and Desired Outcomes',
      'Experience Level',
      '5-6 Month Outcome',
      'Additional Skills Suggested',
      'Gathering Place Suggestions',
      'Convenient Days',
      'Convenient Times'
    ]

    const headerRow = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')

    const dataRows = responses.map((r) => {
      const values = [
        sanitizeForSpreadsheet(r.id),
        sanitizeForSpreadsheet(r.submittedAt),
        sanitizeForSpreadsheet(r.wardBranch),
        sanitizeForSpreadsheet(r.currentStatus),
        sanitizeForSpreadsheet(r.educationLevel),
        sanitizeForSpreadsheet(r.currentSelfRelianceParticipation),
        sanitizeForSpreadsheet(r.hardSkillFirstChoice),
        sanitizeForSpreadsheet(r.hardSkillSecondChoice),
        sanitizeForSpreadsheet(r.hardSkillThirdChoice),
        sanitizeForSpreadsheet((r.softSkills || []).join('; ')),
        sanitizeForSpreadsheet(r.selfRelianceClassInterest),
        sanitizeForSpreadsheet((r.desiredOutcomes || []).join('; ')),
        sanitizeForSpreadsheet(r.experienceLevel),
        sanitizeForSpreadsheet(r.desired56MonthOutcome || ''),
        sanitizeForSpreadsheet(r.additionalSkillsSuggestions || ''),
        sanitizeForSpreadsheet(r.gatheringPlaceSuggestions || ''),
        sanitizeForSpreadsheet((r.preferredDays || []).join('; ')),
        sanitizeForSpreadsheet((r.preferredTimePeriods || []).join('; '))
      ]
      return values.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')
    })

    const csvContent = '\uFEFF' + [...metaRows, headerRow, ...dataRows].join('\r\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `${filename.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url)
    }
  },

  /**
   * Exports survey responses to an Excel workbook (.xlsx).
   */
  async exportToXlsx(
    responses: GatheringPlaceResponse[],
    filename = 'gathering_place_assessment_responses'
  ): Promise<void> {
    const rows: SheetData = []

    // Title Row
    rows.push([
      {
        value: 'Abeokuta Nigeria Obantoko Stake — YSA Gathering Place Needs Assessment',
        fontWeight: 'bold',
        fontSize: 14
      }
    ])
    rows.push([
      {
        value: `Generated: ${new Date().toLocaleDateString()} | Total Responses: ${responses.length}`,
        fontSize: 10,
        textColor: '#64748b'
      }
    ])
    rows.push([]) // Spacer

    // Header Row
    const headers = [
      'Submission Date',
      'Ward / Branch',
      'Current Status',
      'Education Level',
      'Outside Program Participation',
      'Hard Skill (1st Choice)',
      'Hard Skill (2nd Choice)',
      'Hard Skill (3rd Choice)',
      'Soft Skills',
      'Self-Reliance Class',
      'Desired Outcomes',
      'Experience Level',
      '5-6 Month Target',
      'Additional Skills Ideas',
      'Gathering Place Suggestions',
      'Convenient Days',
      'Convenient Times'
    ]

    const headerCells: Row = headers.map((h) => ({
      value: h,
      fontWeight: 'bold',
      backgroundColor: '#0f766e',
      textColor: '#ffffff'
    }))
    rows.push(headerCells)

    for (const r of responses) {
      rows.push([
        { value: sanitizeForSpreadsheet(new Date(r.submittedAt).toLocaleDateString()) },
        { value: sanitizeForSpreadsheet(r.wardBranch) },
        { value: sanitizeForSpreadsheet(r.currentStatus) },
        { value: sanitizeForSpreadsheet(r.educationLevel) },
        { value: sanitizeForSpreadsheet(r.currentSelfRelianceParticipation) },
        { value: sanitizeForSpreadsheet(r.hardSkillFirstChoice), fontWeight: 'bold' },
        { value: sanitizeForSpreadsheet(r.hardSkillSecondChoice) },
        { value: sanitizeForSpreadsheet(r.hardSkillThirdChoice) },
        { value: sanitizeForSpreadsheet((r.softSkills || []).join(', ')) },
        { value: sanitizeForSpreadsheet(r.selfRelianceClassInterest) },
        { value: sanitizeForSpreadsheet((r.desiredOutcomes || []).join(', ')) },
        { value: sanitizeForSpreadsheet(r.experienceLevel) },
        { value: sanitizeForSpreadsheet(r.desired56MonthOutcome || '') },
        { value: sanitizeForSpreadsheet(r.additionalSkillsSuggestions || '') },
        { value: sanitizeForSpreadsheet(r.gatheringPlaceSuggestions || '') },
        { value: sanitizeForSpreadsheet((r.preferredDays || []).join(', ')) },
        { value: sanitizeForSpreadsheet((r.preferredTimePeriods || []).join(', ')) }
      ])
    }

    const result = writeXlsxFile(rows)
    await result.toFile(`${filename.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`)
  }
}
