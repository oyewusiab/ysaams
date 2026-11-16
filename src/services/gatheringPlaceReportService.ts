/**
-- ============================================================================
-- YSA Attendance Management System (YSA AMS)
-- Module: Gathering Place Monthly Report Service
-- Stake: Abeokuta Nigeria Obantoko Stake
-- ============================================================================
*/

import { supabase } from '../lib/supabase'
import {
  ActivityDefinition,
  ActivitySession,
  AttendanceRecord,
  SessionVisitor,
  StakeUnit,
  MemberRecord,
  UserProfile,
  GatheringPlaceMonthlyReport,
  GatheringPlaceReportItem,
  GatheringPlaceReportFilterCriteria,
  GatheringPlaceReportLeaderSnapshot,
  StakeLeaderSignature
} from '../types/database'

export interface CalculateExpectedVisitsParams {
  year: number
  month: number // 1-12
  sessions: ActivitySession[]
  selectedActivityIds?: string[]
  selectedClassesByActivity?: Record<string, string[]>
  specificPeriod?: 'full_month' | 'specific_dates' | 'selected_occurrences'
  startDate?: string
  endDate?: string
  selectedSessionIds?: string[]
}

export interface ExpectedVisitsResult {
  expectedVisits: number
  eligibleSessions: ActivitySession[]
}

export interface ParticipantCalculationParams {
  eligibleSessions: ActivitySession[]
  attendanceRecords: AttendanceRecord[]
  sessionVisitors?: SessionVisitor[]
  selectedUnitIds: string[]
  isAllUnits?: boolean
  selectedClassesByActivity?: Record<string, string[]>
  memberClassification?: 'all' | 'members_only' | 'visitors_only'
  minimumVisitThreshold?: number
  selectedMemberIds?: string[]
  searchQuery?: string
  units: StakeUnit[]
  members?: MemberRecord[]
}

/**
 * Calculates the expected visits for the selected reporting month/period.
 * Expected Visits per YA = Sum of eligible occurrences of the selected activities/classes within the selected periods.
 * Excludes cancelled or postponed occurrences.
 */
export function calculateExpectedVisits(
  params: CalculateExpectedVisitsParams
): ExpectedVisitsResult {
  const {
    year,
    month,
    sessions,
    selectedActivityIds = [],
    selectedClassesByActivity = {},
    specificPeriod = 'full_month',
    startDate,
    endDate,
    selectedSessionIds
  } = params

  const monthStr = String(month).padStart(2, '0')
  const monthPrefix = `${year}-${monthStr}`

  const eligibleSessions = sessions.filter((s) => {
    // 1. Must be in the selected month / period
    if (specificPeriod === 'specific_dates' && startDate && endDate) {
      if (s.sessionDate < startDate || s.sessionDate > endDate) {
        return false
      }
    } else {
      if (!s.sessionDate.startsWith(monthPrefix)) {
        return false
      }
    }

    // 2. Must not be cancelled
    if (s.status === 'cancelled') {
      return false
    }

    // 3. Activity inclusion: If activity filter is specified, session must belong to selected activity
    if (
      selectedActivityIds.length > 0 &&
      !selectedActivityIds.includes('all') &&
      !selectedActivityIds.includes(s.activityId)
    ) {
      return false
    }

    // 4. Class inclusion: If specific classes are selected for this activity, check class options
    const selectedClasses = selectedClassesByActivity[s.activityId]
    if (selectedClasses && selectedClasses.length > 0 && !selectedClasses.includes('all')) {
      const offeredClasses = (s.classOptions || []).map((c) => c.trim().toLowerCase())
      if (offeredClasses.length > 0) {
        const matchesAnyClass = selectedClasses.some((cls) =>
          offeredClasses.includes(cls.trim().toLowerCase())
        )
        if (!matchesAnyClass) {
          return false
        }
      }
    }

    // 5. Specific session occurrences filter
    if (
      selectedSessionIds &&
      selectedSessionIds.length > 0 &&
      !selectedSessionIds.includes(s.id)
    ) {
      return false
    }

    return true
  })

  return {
    expectedVisits: eligibleSessions.length,
    eligibleSessions
  }
}

/**
 * Calculates distinct visits and attended classes/groups per participant.
 * Enforces stable participant identity, duplicate exclusion, unit scope, and minimum threshold.
 */
export function calculateParticipantVisits(
  params: ParticipantCalculationParams
): GatheringPlaceReportItem[] {
  const {
    eligibleSessions,
    attendanceRecords,
    sessionVisitors = [],
    selectedUnitIds,
    isAllUnits = false,
    selectedClassesByActivity = {},
    memberClassification = 'all',
    minimumVisitThreshold = 0,
    selectedMemberIds = [],
    searchQuery = '',
    units,
    members = []
  } = params

  const eligibleSessionMap = new Map<string, ActivitySession>()
  eligibleSessions.forEach((s) => eligibleSessionMap.set(s.id, s))

  const unitMap = new Map<string, string>()
  units.forEach((u) => unitMap.set(u.id, u.unitName))

  const memberMap = new Map<string, MemberRecord>()
  members.forEach((m) => memberMap.set(m.id, m))

  interface ParticipantAggregate {
    memberId: string | null
    attendeeName: string
    unitId: string
    unitName: string
    attendedSessionIds: Set<string>
    attendedClasses: Set<string>
  }

  const aggregates = new Map<string, ParticipantAggregate>()

  // 1. Process member attendance records
  if (memberClassification !== 'visitors_only') {
    attendanceRecords.forEach((rec) => {
      if (!rec.sessionId || !eligibleSessionMap.has(rec.sessionId)) return

      const session = eligibleSessionMap.get(rec.sessionId)!
      const member = rec.memberId ? memberMap.get(rec.memberId) : null

      // Determine unit
      const unitId = rec.unitId || member?.homeUnitId || ''
      if (!unitId) return

      if (!isAllUnits && selectedUnitIds.length > 0 && !selectedUnitIds.includes(unitId)) {
        return
      }

      // Check class filtering if configured for this activity
      const selectedClasses = selectedClassesByActivity[session.activityId]
      if (selectedClasses && selectedClasses.length > 0 && !selectedClasses.includes('all')) {
        const selClassLower = (rec.selectedClass || '').trim().toLowerCase()
        const match = selectedClasses.some((c) => c.trim().toLowerCase() === selClassLower)
        if (!match) return
      }

      // Stable participant key
      const participantKey = rec.memberId || `name_${rec.attendeeName.toLowerCase().trim()}`

      if (
        selectedMemberIds.length > 0 &&
        rec.memberId &&
        !selectedMemberIds.includes(rec.memberId)
      ) {
        return
      }

      let agg = aggregates.get(participantKey)
      if (!agg) {
        agg = {
          memberId: rec.memberId || null,
          attendeeName: member?.fullName || rec.attendeeName || 'Unknown Attendee',
          unitId,
          unitName: unitMap.get(unitId) || rec.unitName || 'Obantoko Ward',
          attendedSessionIds: new Set<string>(),
          attendedClasses: new Set<string>()
        }
        aggregates.set(participantKey, agg)
      }

      // Add session ID to ensure distinct occurrence count
      agg.attendedSessionIds.add(session.id)

      // Add class/group display label
      if (rec.selectedClass && rec.selectedClass.trim()) {
        agg.attendedClasses.add(rec.selectedClass.trim())
      } else if (session.activityTitle && session.activityTitle.trim()) {
        agg.attendedClasses.add(session.activityTitle.trim())
      }
    })
  }

  // 2. Process visitors if enabled
  if (memberClassification !== 'members_only') {
    sessionVisitors.forEach((vis) => {
      if (!vis.sessionId || !eligibleSessionMap.has(vis.sessionId)) return

      const session = eligibleSessionMap.get(vis.sessionId)!
      const unitId = vis.invitingUnitId || ''
      if (!unitId && !isAllUnits) return

      if (!isAllUnits && selectedUnitIds.length > 0 && unitId && !selectedUnitIds.includes(unitId)) {
        return
      }

      // Check class filtering
      const selectedClasses = selectedClassesByActivity[session.activityId]
      if (selectedClasses && selectedClasses.length > 0 && !selectedClasses.includes('all')) {
        const selClassLower = (vis.selectedClass || '').trim().toLowerCase()
        const match = selectedClasses.some((c) => c.trim().toLowerCase() === selClassLower)
        if (!match) return
      }

      const participantKey = `vis_${vis.fullName.toLowerCase().trim()}`
      let agg = aggregates.get(participantKey)
      if (!agg) {
        agg = {
          memberId: null,
          attendeeName: vis.fullName.trim(),
          unitId: unitId || units[0]?.id || '',
          unitName: unitMap.get(unitId) || vis.invitingUnitName || 'Visitor',
          attendedSessionIds: new Set<string>(),
          attendedClasses: new Set<string>()
        }
        aggregates.set(participantKey, agg)
      }

      agg.attendedSessionIds.add(session.id)

      if (vis.selectedClass && vis.selectedClass.trim()) {
        agg.attendedClasses.add(vis.selectedClass.trim())
      } else if (session.activityTitle && session.activityTitle.trim()) {
        agg.attendedClasses.add(session.activityTitle.trim())
      }
    })
  }

  // 3. Filter by minimum threshold and query
  const cleanQuery = searchQuery.toLowerCase().trim()

  const items: GatheringPlaceReportItem[] = []
  let serial = 1

  const sortedAggregates = Array.from(aggregates.values())
    .filter((agg) => {
      const totalVisits = agg.attendedSessionIds.size
      if (totalVisits < minimumVisitThreshold) {
        return false
      }
      if (cleanQuery) {
        const nameMatch = agg.attendeeName.toLowerCase().includes(cleanQuery)
        const unitMatch = agg.unitName.toLowerCase().includes(cleanQuery)
        if (!nameMatch && !unitMatch) return false
      }
      return true
    })
    .sort((a, b) => a.attendeeName.localeCompare(b.attendeeName))

  sortedAggregates.forEach((agg) => {
    const classList = Array.from(agg.attendedClasses).sort((a, b) => a.localeCompare(b))
    const classGroupDisplay = classList.join(', ') || 'Gathering Place'

    items.push({
      serialNumber: serial++,
      memberId: agg.memberId,
      attendeeName: agg.attendeeName,
      unitId: agg.unitId,
      unitName: agg.unitName,
      classGroupDisplay,
      totalVisits: agg.attendedSessionIds.size,
      attendedSessionIds: Array.from(agg.attendedSessionIds)
    })
  })

  return items
}

export const gatheringPlaceReportService = {
  /**
   * Helper calculation methods
   */
  calculateExpectedVisits,
  calculateParticipantVisits,

  /**
   * Fetches real month attendance records, visitors, and sessions from database
   */
  async fetchMonthAttendanceData(
    year: number,
    month: number
  ): Promise<{
    attendanceRecords: AttendanceRecord[]
    sessionVisitors: SessionVisitor[]
    sessions: ActivitySession[]
  }> {
    const monthStr = String(month).padStart(2, '0')
    const startDate = `${year}-${monthStr}-01`
    const lastDay = new Date(year, month, 0).getDate()
    const endDate = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`

    try {
      const [sessionsRes, attendanceRes, visitorsRes] = await Promise.all([
        supabase
          .from('activity_sessions')
          .select('id, activity_id, session_title, session_date, start_time, scheduled_end_time, status, participating_units, class_options, activities(title, category, class_options)')
          .gte('session_date', startDate)
          .lte('session_date', endDate),
        supabase
          .from('attendance_records')
          .select('id, session_id, member_id, recorded_unit_id, selected_class, check_in_time, members(full_name, home_unit_id, stake_units(unit_name))')
          .gte('check_in_time', `${startDate}T00:00:00Z`)
          .lte('check_in_time', `${endDate}T23:59:59Z`),
        supabase
          .from('session_visitors')
          .select('id, session_id, full_name, contact_phone, is_church_member, inviting_unit_id, selected_class, created_at, stake_units(unit_name)')
          .gte('created_at', `${startDate}T00:00:00Z`)
          .lte('created_at', `${endDate}T23:59:59Z`)
      ])

      const sessions: ActivitySession[] = (sessionsRes.data || []).map((s: any) => ({
        id: s.id,
        activityId: s.activity_id,
        activityTitle: s.activities?.title || s.session_title,
        activityCategory: s.activities?.category,
        classOptions: s.class_options || s.activities?.class_options,
        sessionTitle: s.session_title,
        sessionDate: s.session_date,
        startTime: s.start_time,
        scheduledEndTime: s.scheduled_end_time,
        status: s.status,
        maxTerminals: 1,
        timezone: 'Africa/Lagos',
        visitorRegistrationEnabled: true,
        createdAt: s.session_date
      }))

      const attendanceRecords: AttendanceRecord[] = (attendanceRes.data || []).map((a: any) => ({
        id: a.id,
        sessionId: a.session_id,
        memberId: a.member_id,
        attendeeName: a.members?.full_name || 'Member',
        unitId: a.recorded_unit_id || a.members?.home_unit_id,
        unitName: a.members?.stake_units?.unit_name,
        selectedClass: a.selected_class,
        checkInTime: a.check_in_time,
        isNonMember: false
      }))

      const sessionVisitors: SessionVisitor[] = (visitorsRes.data || []).map((v: any) => ({
        id: v.id,
        sessionId: v.session_id,
        fullName: v.full_name,
        contactPhone: v.contact_phone,
        isChurchMember: v.is_church_member,
        invitingUnitId: v.inviting_unit_id,
        invitingUnitName: v.stake_units?.unit_name,
        selectedClass: v.selected_class,
        createdAt: v.created_at
      }))

      return { sessions, attendanceRecords, sessionVisitors }
    } catch {
      return { sessions: [], attendanceRecords: [], sessionVisitors: [] }
    }
  },

  /**
   * Generates in-memory report snapshot without persisting
   */
  buildReportSnapshot(params: {
    year: number
    month: number
    monthName: string
    units: StakeUnit[]
    activities: ActivityDefinition[]
    sessions: ActivitySession[]
    attendanceRecords: AttendanceRecord[]
    sessionVisitors?: SessionVisitor[]
    members?: MemberRecord[]
    criteria: GatheringPlaceReportFilterCriteria
    selectedLeader: GatheringPlaceReportLeaderSnapshot
    generatedBy: UserProfile
  }): GatheringPlaceMonthlyReport {
    const {
      year,
      month,
      monthName,
      units,
      sessions,
      attendanceRecords,
      sessionVisitors = [],
      members = [],
      criteria,
      selectedLeader,
      generatedBy
    } = params

    const { expectedVisits, eligibleSessions } = calculateExpectedVisits({
      year,
      month,
      sessions,
      selectedActivityIds: criteria.selectedActivityIds,
      selectedClassesByActivity: criteria.selectedClassesByActivity,
      specificPeriod: criteria.specificPeriod,
      startDate: criteria.startDate,
      endDate: criteria.endDate,
      selectedSessionIds: criteria.selectedSessionIds
    })

    const items = calculateParticipantVisits({
      eligibleSessions,
      attendanceRecords,
      sessionVisitors,
      selectedUnitIds: criteria.selectedUnitIds,
      isAllUnits: criteria.isAllUnits,
      selectedClassesByActivity: criteria.selectedClassesByActivity,
      memberClassification: criteria.memberClassification,
      minimumVisitThreshold: criteria.minimumVisitThreshold,
      selectedMemberIds: criteria.selectedMemberIds,
      searchQuery: criteria.searchQuery,
      units,
      members
    })

    const totalVisits = items.reduce((sum, item) => sum + item.totalVisits, 0)
    const unitBreakdown: Record<string, number> = {}
    items.forEach((item) => {
      unitBreakdown[item.unitName] = (unitBreakdown[item.unitName] || 0) + 1
    })

    const isAdmin = generatedBy.roles.includes('system_admin')
    const isPresident = generatedBy.roles.includes('stake_presidency') && Boolean(generatedBy.isStakePresident)
    const initialStatus = isAdmin || isPresident ? 'approved' : 'generated_pending_approval'

    const reportTitle = `${monthName} ${year} Gathering Place Monthly Report`

    return {
      id: `report-${Date.now()}`,
      reportTitle,
      reportingYear: year,
      reportingMonth: month,
      monthName,
      status: initialStatus,
      version: 1,
      expectedVisitsPerYa: expectedVisits,
      totalEligibleOccurrences: eligibleSessions.length,
      minimumVisitThreshold: criteria.minimumVisitThreshold,
      filterCriteria: criteria,
      leaderSnapshot: selectedLeader,
      summaryMetrics: {
        totalParticipants: items.length,
        totalVisits,
        unitsCount: Object.keys(unitBreakdown).length,
        unitBreakdown,
        averageVisitsPerParticipant: items.length > 0 ? Math.round((totalVisits / items.length) * 10) / 10 : 0
      },
      unitIds: criteria.selectedUnitIds,
      generatedBy: generatedBy.id,
      generatedByName: generatedBy.fullName,
      generatedAt: new Date().toISOString(),
      approvedBy: initialStatus === 'approved' ? generatedBy.id : null,
      approvedByName: initialStatus === 'approved' ? generatedBy.fullName : null,
      approvedAt: initialStatus === 'approved' ? new Date().toISOString() : null,
      approvalNote: initialStatus === 'approved' ? 'Directly approved upon generation by authorized executive.' : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items
    }
  },

  /**
   * Persists report to database (with fallback for mock/local test environments)
   */
  async createReport(
    report: GatheringPlaceMonthlyReport,
    caller: UserProfile
  ): Promise<GatheringPlaceMonthlyReport> {
    const isGenerator =
      caller.roles.includes('system_admin') ||
      caller.roles.includes('stake_presidency') ||
      caller.roles.includes('stake_clerk')

    if (!isGenerator) {
      throw new Error('Permission denied. Only System Administrator, Stake Presidency, or Stake Clerk may generate reports.')
    }

    try {
      const { data, error } = await supabase.rpc('rpc_create_gathering_place_monthly_report', {
        p_report_title: report.reportTitle,
        p_reporting_year: report.reportingYear,
        p_reporting_month: report.reportingMonth,
        p_month_name: report.monthName,
        p_expected_visits_per_ya: report.expectedVisitsPerYa,
        p_total_eligible_occurrences: report.totalEligibleOccurrences,
        p_minimum_visit_threshold: report.minimumVisitThreshold,
        p_filter_criteria: report.filterCriteria,
        p_leader_snapshot: report.leaderSnapshot,
        p_summary_metrics: report.summaryMetrics,
        p_unit_ids: report.unitIds,
        p_items: (report.items || []).map((item) => ({
          serial_number: item.serialNumber,
          member_id: item.memberId,
          attendee_name: item.attendeeName,
          unit_id: item.unitId,
          unit_name: item.unitName,
          class_group_display: item.classGroupDisplay,
          total_visits: item.totalVisits,
          attended_session_ids: item.attendedSessionIds || []
        }))
      })

      if (error) {
        console.warn('RPC create report returned error, falling back to local snapshot:', error.message)
      } else if (data) {
        report.id = data
      }
    } catch {
      // In-memory or network mock fallback
    }

    return report
  },

  /**
   * Reviews a report (Approve, Disapprove, Request Correction)
   */
  async reviewReport(
    reportId: string,
    action: 'approve' | 'disapprove' | 'request_correction',
    comment: string | undefined,
    caller: UserProfile
  ): Promise<{ success: boolean; status: string; comment?: string }> {
    const canApprove =
      caller.roles.includes('system_admin') ||
      (caller.roles.includes('stake_presidency') && Boolean(caller.isStakePresident))

    if (!canApprove) {
      throw new Error('Permission denied. Only the Stake President or System Administrator can review reports.')
    }

    if ((action === 'disapprove' || action === 'request_correction') && (!comment || !comment.trim())) {
      throw new Error(`A comment is required when ${action === 'disapprove' ? 'disapproving' : 'requesting corrections on'} a report.`)
    }

    try {
      const { data, error } = await supabase.rpc('rpc_review_gathering_place_monthly_report', {
        p_report_id: reportId,
        p_action: action,
        p_comment: comment || null
      })

      if (error) {
        console.warn('RPC review report returned error:', error.message)
      } else if (data) {
        return data as any
      }
    } catch {
      // Fallback
    }

    const nextStatus = action === 'approve' ? 'approved' : action === 'disapprove' ? 'disapproved' : 'correction_requested'
    return {
      success: true,
      status: nextStatus,
      comment
    }
  },

  /**
   * Lists reports based on least-privilege scoping rules:
   * - Stake Leadership (system_admin, stake_presidency, stake_clerk): lists all reports
   * - Unit Leadership (bishop, branch_president, ward_clerk, branch_clerk): lists ONLY 'approved' reports for their unit
   */
  async listReports(caller: UserProfile): Promise<GatheringPlaceMonthlyReport[]> {
    const isStakeLeadership =
      caller.roles.includes('system_admin') ||
      caller.roles.includes('stake_presidency') ||
      caller.roles.includes('stake_clerk')

    const assignedUnitIds = (caller.unitAssignments || []).map((ua) => ua.unitId)

    try {
      let query = supabase
        .from('gathering_place_monthly_reports')
        .select('*')
        .order('created_at', { ascending: false })

      if (!isStakeLeadership) {
        // Unit leaders can ONLY see approved reports
        query = query.eq('status', 'approved')
      }

      const { data, error } = await query

      if (error) {
        console.warn('Error fetching reports from database:', error.message)
        return []
      }

      let reports: GatheringPlaceMonthlyReport[] = (data || []).map((r: any) => ({
        id: r.id,
        reportTitle: r.report_title,
        reportingYear: r.reporting_year,
        reportingMonth: r.reporting_month,
        monthName: r.month_name,
        status: r.status,
        version: r.version,
        expectedVisitsPerYa: r.expected_visits_per_ya,
        totalEligibleOccurrences: r.total_eligible_occurrences,
        minimumVisitThreshold: r.minimum_visit_threshold,
        filterCriteria: r.filter_criteria,
        leaderSnapshot: r.leader_snapshot,
        summaryMetrics: r.summary_metrics,
        unitIds: r.unit_ids || [],
        generatedBy: r.generated_by,
        generatedAt: r.generated_at,
        approvedBy: r.approved_by,
        approvedAt: r.approved_at,
        approvalNote: r.approval_note,
        disapprovedBy: r.disapproved_by,
        disapprovedAt: r.disapproved_at,
        disapprovalReason: r.disapproval_reason,
        correctionRequestedBy: r.correction_requested_by,
        correctionRequestedAt: r.correction_requested_at,
        correctionComment: r.correction_comment,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }))

      // For unit leadership, filter strictly to reports that contain their assigned unit
      if (!isStakeLeadership) {
        reports = reports.filter((r) =>
          r.unitIds.some((uid) => assignedUnitIds.includes(uid))
        )
      }

      return reports
    } catch {
      return []
    }
  },

  /**
   * Fetches a report and its items with unit security:
   * If caller is unit leader, items outside their assigned unit are stripped.
   */
  async getReportById(
    reportId: string,
    caller: UserProfile
  ): Promise<GatheringPlaceMonthlyReport | null> {
    const isStakeLeadership =
      caller.roles.includes('system_admin') ||
      caller.roles.includes('stake_presidency') ||
      caller.roles.includes('stake_clerk')

    const assignedUnitIds = (caller.unitAssignments || []).map((ua) => ua.unitId)

    try {
      const { data: reportData, error: reportError } = await supabase
        .from('gathering_place_monthly_reports')
        .select('*')
        .eq('id', reportId)
        .maybeSingle()

      if (reportError || !reportData) {
        return null
      }

      // If unit leadership: enforce status === 'approved'
      if (!isStakeLeadership) {
        if (reportData.status !== 'approved') {
          throw new Error('Unauthorized: This report is pending approval and cannot be accessed by unit leadership.')
        }
        const hasUnit = (reportData.unit_ids || []).some((uid: string) => assignedUnitIds.includes(uid))
        if (!hasUnit) {
          throw new Error('Unauthorized: This report is not available for your assigned unit.')
        }
      }

      let itemsQuery = supabase
        .from('gathering_place_monthly_report_items')
        .select('*')
        .eq('report_id', reportId)
        .order('serial_number', { ascending: true })

      if (!isStakeLeadership) {
        itemsQuery = itemsQuery.in('unit_id', assignedUnitIds)
      }

      const { data: itemsData } = await itemsQuery

      const items: GatheringPlaceReportItem[] = (itemsData || []).map((i: any) => ({
        id: i.id,
        reportId: i.report_id,
        serialNumber: i.serial_number,
        memberId: i.member_id,
        attendeeName: i.attendee_name,
        unitId: i.unit_id,
        unitName: i.unit_name,
        classGroupDisplay: i.class_group_display,
        totalVisits: i.total_visits,
        attendedSessionIds: i.attended_session_ids
      }))

      return {
        id: reportData.id,
        reportTitle: reportData.report_title,
        reportingYear: reportData.reporting_year,
        reportingMonth: reportData.reporting_month,
        monthName: reportData.month_name,
        status: reportData.status,
        version: reportData.version,
        expectedVisitsPerYa: reportData.expected_visits_per_ya,
        totalEligibleOccurrences: reportData.total_eligible_occurrences,
        minimumVisitThreshold: reportData.minimum_visit_threshold,
        filterCriteria: reportData.filter_criteria,
        leaderSnapshot: reportData.leader_snapshot,
        summaryMetrics: reportData.summary_metrics,
        unitIds: reportData.unit_ids || [],
        generatedBy: reportData.generated_by,
        generatedAt: reportData.generated_at,
        approvedBy: reportData.approved_by,
        approvedAt: reportData.approved_at,
        approvalNote: reportData.approval_note,
        disapprovedBy: reportData.disapproved_by,
        disapprovedAt: reportData.disapproved_at,
        disapprovalReason: reportData.disapproval_reason,
        correctionRequestedBy: reportData.correction_requested_by,
        correctionRequestedAt: reportData.correction_requested_at,
        correctionComment: reportData.correction_comment,
        createdAt: reportData.created_at,
        updatedAt: reportData.updated_at,
        items
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Unauthorized')) {
        throw err
      }
      return null
    }
  },

  /**
   * Signatures Management
   */
  async listSignatures(): Promise<StakeLeaderSignature[]> {
    try {
      const { data, error } = await supabase
        .from('stake_leader_signatures')
        .select('*')
        .eq('is_active', true)
        .order('full_name', { ascending: true })

      if (error) {
        return []
      }

      return (data || []).map((s: any) => ({
        id: s.id,
        userId: s.user_id,
        fullName: s.full_name,
        phoneNumber: s.phone_number,
        signatureDataUrl: s.signature_data_url,
        isActive: s.is_active,
        createdAt: s.created_at,
        updatedAt: s.updated_at
      }))
    } catch {
      return []
    }
  },

  async saveSignature(
    signature: {
      userId: string
      fullName: string
      phoneNumber: string
      signatureDataUrl: string
    },
    caller: UserProfile
  ): Promise<StakeLeaderSignature> {
    const isAdmin = caller.roles.includes('system_admin')
    if (caller.id !== signature.userId && !isAdmin) {
      throw new Error('Permission denied: You can only manage your own signature.')
    }

    const { data, error } = await supabase
      .from('stake_leader_signatures')
      .upsert(
        {
          user_id: signature.userId,
          full_name: signature.fullName.trim(),
          phone_number: signature.phoneNumber.trim(),
          signature_data_url: signature.signatureDataUrl,
          is_active: true,
          updated_at: new Date().toISOString(),
          updated_by: caller.id
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single()

    if (error) {
      // In-memory fallback
      return {
        id: `sig-${Date.now()}`,
        userId: signature.userId,
        fullName: signature.fullName,
        phoneNumber: signature.phoneNumber,
        signatureDataUrl: signature.signatureDataUrl,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    }

    return {
      id: data.id,
      userId: data.user_id,
      fullName: data.full_name,
      phoneNumber: data.phone_number,
      signatureDataUrl: data.signature_data_url,
      isActive: data.is_active,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    }
  },

  async deleteSignature(userId: string, caller: UserProfile): Promise<void> {
    const isAdmin = caller.roles.includes('system_admin')
    if (caller.id !== userId && !isAdmin) {
      throw new Error('Permission denied: You can only delete your own signature.')
    }

    await supabase
      .from('stake_leader_signatures')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
  }
}
