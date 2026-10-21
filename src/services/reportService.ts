/**
 * Comprehensive Reporting, Registers, Analytics and Export Service.
 * Abeokuta Nigeria Obantoko Stake — YSA AMS (Phase 4)
 * Strict timezone: 'Africa/Lagos'
 */

import { supabase } from '../lib/supabase'
import { SessionVisitor, StakeUnit } from '../types/database'
import {
  getLagosDate,
  getTodayRangeLagos,
  getThisWeekRangeLagos,
  getThisMonthRangeLagos,
  getPreviousMonthRangeLagos,
  getSelectedMonthRangeLagos,
  getComparablePreviousPeriod,
  formatLagosDateDisplay
} from '../lib/timezone'

export function calculateAttendancePercentage(
  attended: number,
  eligibleOpportunities: number
): number | null {
  if (eligibleOpportunities <= 0) {
    return null
  }
  return Math.round((attended / eligibleOpportunities) * 1000) / 10
}

export function getMonthDateRange(year: number, month: number): { startDate: string; endDate: string } {
  return getSelectedMonthRangeLagos(year, month)
}

export interface UnitMonthlyStat {
  unitId: string
  unitName: string
  totalMembers: number
  totalAttended: number
  totalOpportunities: number
  percentage: number | null
}

export interface IndividualAttendanceHistory {
  memberId: string
  fullName: string
  homeUnitName: string
  attendedCount: number
  sessions: { sessionId: string; sessionTitle: string; sessionDate: string; checkInTime: string }[]
}

export type ReportType =
  | 'monthly_register'
  | 'detailed_register'
  | 'individual_history'
  | 'selected_person'
  | 'members_only'
  | 'visitors_only'
  | 'activity_session'
  | 'unit_level'
  | 'multi_unit_comparison'
  | 'date_range'
  | 'trend_analysis'
  | 'stake_summary'

export type PeriodType =
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'previous_month'
  | 'selected_month'
  | 'custom_range'
  | 'specific_date'
  | 'all_time'

export type SortField =
  | 'attendeeName'
  | 'sessionDate'
  | 'checkInTime'
  | 'activityTitle'
  | 'recordedUnitName'
  | 'attendanceType'
  | 'sessionTitle'

export type GroupByOption =
  | 'none'
  | 'by_person'
  | 'by_activity'
  | 'by_unit'
  | 'by_month'
  | 'by_type'

export interface ReportFilterCriteria {
  reportType: ReportType
  periodType: PeriodType
  startDate?: string // YYYY-MM-DD
  endDate?: string   // YYYY-MM-DD
  year?: number
  month?: number
  selectedUnitIds: string[]
  selectedActivityIds: string[]
  selectedSessionIds: string[]
  activityCategory?: string
  memberVisitorClassification: 'all' | 'members_only' | 'visitors_only'
  selectedMemberIds: string[]
  nameQuery: string
  sessionStatus: 'all' | 'active_and_closed' | 'active_only' | 'closed_only' | 'cancelled_only'
  sortBy: SortField
  sortDirection: 'asc' | 'desc'
  groupBy: GroupByOption
}

export interface UnifiedAttendanceRecord {
  id: string
  attendanceType: 'member' | 'visitor'
  attendeeId?: string | null
  attendeeName: string
  memberNumber?: string | null
  homeUnitId?: string | null
  homeUnitName?: string | null
  recordedUnitId: string
  recordedUnitName: string
  activityId: string
  activityTitle: string
  activityCategory: string
  sessionId: string
  sessionTitle: string
  sessionDate: string
  checkInTime: string
  contactPhone?: string | null
  isChurchMember?: boolean
}

export interface ReportSummaryMetrics {
  totalRecords: number
  uniqueAttendees: number
  memberRecords: number
  visitorRecords: number
  heldSessionsCount: number
  avgAttendancePerSession: number | null
  periodTrendPercentage: number | null
  comparablePrevPeriodRecords: number
}

export interface GroupedReportResult {
  groupKey: string
  groupTitle: string
  recordsCount: number
  uniqueAttendeesCount: number
  records: UnifiedAttendanceRecord[]
}

export interface ChartDataset {
  trendTimeline: { periodLabel: string; recordsCount: number; membersCount: number; visitorsCount: number }[]
  unitBreakdown: { unitId: string; unitName: string; recordsCount: number; percentage: number }[]
  activityBreakdown: { activityId: string; activityTitle: string; recordsCount: number }[]
  typeBreakdown: { members: number; visitors: number; memberPct: number; visitorPct: number }
}

export interface ComprehensiveReportData {
  criteria: ReportFilterCriteria
  effectiveStartDate: string | null
  effectiveEndDate: string | null
  metrics: ReportSummaryMetrics
  insights: string[]
  records: UnifiedAttendanceRecord[]
  groupedRecords: GroupedReportResult[]
  charts: ChartDataset
  unitMonthlyStats?: UnitMonthlyStat[]
}

export interface SavedReportPreset {
  id: string
  name: string
  createdAt: string
  criteria: ReportFilterCriteria
}

const PRESETS_STORAGE_KEY = 'ysaams_saved_report_presets'

export const reportService = {
  calculateAttendancePercentage,
  getMonthDateRange,

  // --- Saved Configurations (Presets) ---
  getSavedPresets(): SavedReportPreset[] {
    try {
      const raw = localStorage.getItem(PRESETS_STORAGE_KEY)
      if (!raw) return []
      return JSON.parse(raw)
    } catch {
      return []
    }
  },

  savePreset(name: string, criteria: ReportFilterCriteria): SavedReportPreset {
    const existing = this.getSavedPresets()
    const newPreset: SavedReportPreset = {
      id: `preset_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: name.trim() || 'Untitled Report Preset',
      createdAt: new Date().toISOString(),
      criteria: { ...criteria }
    }
    const updated = [newPreset, ...existing.filter(p => p.name.toLowerCase() !== newPreset.name.toLowerCase())]
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(updated.slice(0, 20)))
    return newPreset
  },

  deletePreset(id: string): void {
    const existing = this.getSavedPresets()
    const updated = existing.filter(p => p.id !== id)
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(updated))
  },

  // --- Effective Period Computation in Africa/Lagos ---
  resolveEffectiveDateRange(criteria: Pick<ReportFilterCriteria, 'periodType' | 'startDate' | 'endDate' | 'year' | 'month'>): {
    startDate: string | null
    endDate: string | null
    periodLabel: string
  } {
    const now = new Date()
    switch (criteria.periodType) {
      case 'today': {
        const { startDate, endDate } = getTodayRangeLagos()
        return { startDate, endDate, periodLabel: `Today (${formatLagosDateDisplay(startDate)})` }
      }
      case 'this_week': {
        const { startDate, endDate } = getThisWeekRangeLagos(now)
        return {
          startDate,
          endDate,
          periodLabel: `This Week (${formatLagosDateDisplay(startDate)} – ${formatLagosDateDisplay(endDate)})`
        }
      }
      case 'this_month': {
        const { startDate, endDate } = getThisMonthRangeLagos(now)
        return {
          startDate,
          endDate,
          periodLabel: `This Month (${formatLagosDateDisplay(startDate)} – ${formatLagosDateDisplay(endDate)})`
        }
      }
      case 'previous_month': {
        const { startDate, endDate } = getPreviousMonthRangeLagos(now)
        return {
          startDate,
          endDate,
          periodLabel: `Previous Month (${formatLagosDateDisplay(startDate)} – ${formatLagosDateDisplay(endDate)})`
        }
      }
      case 'selected_month': {
        const yr = criteria.year || now.getFullYear()
        const mo = criteria.month || now.getMonth() + 1
        const { startDate, endDate } = getSelectedMonthRangeLagos(yr, mo)
        const monthName = new Date(Date.UTC(yr, mo - 1, 1, 12, 0, 0)).toLocaleString('en-US', { month: 'long' })
        return { startDate, endDate, periodLabel: `${monthName} ${yr}` }
      }
      case 'specific_date': {
        const d = criteria.startDate || getLagosDate(now)
        return { startDate: d, endDate: d, periodLabel: `Date: ${formatLagosDateDisplay(d)}` }
      }
      case 'custom_range': {
        const s = criteria.startDate || getLagosDate(now)
        const e = criteria.endDate || s
        return {
          startDate: s,
          endDate: e,
          periodLabel: `${formatLagosDateDisplay(s)} – ${formatLagosDateDisplay(e)}`
        }
      }
      case 'all_time':
      default:
        return { startDate: null, endDate: null, periodLabel: 'All Recorded Time' }
    }
  },

  // --- Core Comprehensive Reporting Engine ---
  async getComprehensiveReport(
    criteria: ReportFilterCriteria,
    userScopeUnitIds: string[] | null
  ): Promise<ComprehensiveReportData> {
    const { startDate, endDate } = this.resolveEffectiveDateRange(criteria)

    // 1. Fetch Units in scope
    let unitQuery = supabase.from('stake_units').select('id, unit_name, unit_type, is_active').order('unit_name', { ascending: true })
    if (userScopeUnitIds && userScopeUnitIds.length > 0) {
      unitQuery = unitQuery.in('id', userScopeUnitIds)
    }
    const { data: rawUnits } = await unitQuery
    const authorizedUnits: StakeUnit[] = (rawUnits || []).map((u: any) => ({
      id: u.id,
      unitName: u.unit_name,
      unitType: u.unit_type,
      isActive: u.is_active,
      createdAt: ''
    }))

    const authorizedUnitIds = authorizedUnits.map(u => u.id)
    const unitMap = new Map<string, StakeUnit>()
    authorizedUnits.forEach(u => unitMap.set(u.id, u))

    // Determine target filtered unit IDs
    let targetUnitIds: string[] = authorizedUnitIds
    if (criteria.selectedUnitIds && criteria.selectedUnitIds.length > 0) {
      targetUnitIds = criteria.selectedUnitIds.filter(uid => authorizedUnitIds.includes(uid))
    }

    // 2. Fetch Activities and Sessions
    let sessionsQuery = supabase
      .from('activity_sessions')
      .select('id, activity_id, session_title, session_date, start_time, scheduled_end_time, status, participating_units')
      .order('session_date', { ascending: false })

    if (startDate) {
      sessionsQuery = sessionsQuery.gte('session_date', startDate)
    }
    if (endDate) {
      sessionsQuery = sessionsQuery.lte('session_date', endDate)
    }
    if (criteria.selectedSessionIds && criteria.selectedSessionIds.length > 0) {
      sessionsQuery = sessionsQuery.in('id', criteria.selectedSessionIds)
    }
    if (criteria.sessionStatus === 'active_only') {
      sessionsQuery = sessionsQuery.eq('status', 'active')
    } else if (criteria.sessionStatus === 'closed_only') {
      sessionsQuery = sessionsQuery.eq('status', 'closed')
    } else if (criteria.sessionStatus === 'cancelled_only') {
      sessionsQuery = sessionsQuery.eq('status', 'cancelled')
    } else if (criteria.sessionStatus === 'active_and_closed') {
      sessionsQuery = sessionsQuery.in('status', ['active', 'closed'])
    }

    const { data: rawSessions } = await sessionsQuery
    let sessionList = rawSessions || []

    // Fetch activities for these sessions
    const activityIdsInSessions = Array.from(new Set(sessionList.map((s: any) => s.activity_id)))
    let activitiesQuery = supabase.from('activities').select('id, title, category')
    if (activityIdsInSessions.length > 0) {
      activitiesQuery = activitiesQuery.in('id', activityIdsInSessions)
    }
    const { data: rawActivities } = await activitiesQuery
    const activityMap = new Map<string, { id: string; title: string; category: string }>()
    ;(rawActivities || []).forEach((a: any) => activityMap.set(a.id, a))

    // Filter sessions by activity ID and activity category if selected
    if (criteria.selectedActivityIds && criteria.selectedActivityIds.length > 0) {
      sessionList = sessionList.filter((s: any) => criteria.selectedActivityIds.includes(s.activity_id))
    }
    if (criteria.activityCategory && criteria.activityCategory !== 'all') {
      const targetCat = criteria.activityCategory.trim().toLowerCase()
      sessionList = sessionList.filter((s: any) => {
        const act = activityMap.get(s.activity_id)
        return (act?.category || '').trim().toLowerCase() === targetCat
      })
    }

    const matchingSessionIds = sessionList.map((s: any) => s.id)
    const sessionMap = new Map<string, any>()
    sessionList.forEach((s: any) => sessionMap.set(s.id, s))

    const unifiedRecords: UnifiedAttendanceRecord[] = []

    // 3. Fetch Member Attendance Records
    const shouldFetchMembers =
      criteria.memberVisitorClassification === 'all' ||
      criteria.memberVisitorClassification === 'members_only'

    if (shouldFetchMembers && matchingSessionIds.length > 0 && targetUnitIds.length > 0) {
      let attQuery = supabase
        .from('attendance_records')
        .select('id, session_id, member_id, recorded_unit_id, check_in_time, created_at')
        .in('session_id', matchingSessionIds)
        .in('recorded_unit_id', targetUnitIds)

      if (criteria.selectedMemberIds && criteria.selectedMemberIds.length > 0) {
        attQuery = attQuery.in('member_id', criteria.selectedMemberIds)
      }

      const { data: rawAtt } = await attQuery
      const attRecords = rawAtt || []

      // Fetch member profiles
      const memberIds = Array.from(new Set(attRecords.map((r: any) => r.member_id)))
      let memberMap = new Map<string, any>()
      if (memberIds.length > 0) {
        const { data: rawMembers } = await supabase
          .from('members')
          .select('id, full_name, preferred_name, member_number, home_unit_id')
          .in('id', memberIds)
        ;(rawMembers || []).forEach((m: any) => memberMap.set(m.id, m))
      }

      for (const r of attRecords) {
        const session = sessionMap.get(r.session_id)
        if (!session) continue
        const activity = activityMap.get(session.activity_id)
        const member = memberMap.get(r.member_id)
        const recordedUnit = unitMap.get(r.recorded_unit_id)
        const homeUnit = member?.home_unit_id ? unitMap.get(member.home_unit_id) : undefined

        unifiedRecords.push({
          id: r.id,
          attendanceType: 'member',
          attendeeId: r.member_id,
          attendeeName: member?.full_name || 'Member',
          memberNumber: member?.member_number || null,
          homeUnitId: member?.home_unit_id || null,
          homeUnitName: homeUnit?.unitName || (member?.home_unit_id ? 'Unit' : null),
          recordedUnitId: r.recorded_unit_id,
          recordedUnitName: recordedUnit?.unitName || 'Unit',
          activityId: session.activity_id,
          activityTitle: activity?.title || session.session_title,
          activityCategory: activity?.category || 'other',
          sessionId: session.id,
          sessionTitle: session.session_title,
          sessionDate: session.session_date,
          checkInTime: r.check_in_time,
          isChurchMember: true
        })
      }
    }

    // 4. Fetch Visitor Records
    const shouldFetchVisitors =
      criteria.memberVisitorClassification === 'all' ||
      criteria.memberVisitorClassification === 'visitors_only'

    // If a specific member list was filtered, visitors are excluded
    const skipVisitorsForMemberSelection = criteria.selectedMemberIds && criteria.selectedMemberIds.length > 0

    if (shouldFetchVisitors && !skipVisitorsForMemberSelection && matchingSessionIds.length > 0) {
      let visQuery = supabase
        .from('session_visitors')
        .select('id, session_id, full_name, contact_phone, is_church_member, inviting_unit_id, created_at')
        .in('session_id', matchingSessionIds)

      if (targetUnitIds.length > 0) {
        // Scoped to inviting unit
        visQuery = visQuery.in('inviting_unit_id', targetUnitIds)
      }

      const { data: rawVis } = await visQuery
      const visRecords = rawVis || []

      for (const v of visRecords) {
        const session = sessionMap.get(v.session_id)
        if (!session) continue
        const activity = activityMap.get(session.activity_id)
        const unit = v.inviting_unit_id ? unitMap.get(v.inviting_unit_id) : undefined

        unifiedRecords.push({
          id: v.id,
          attendanceType: 'visitor',
          attendeeId: v.id,
          attendeeName: v.full_name,
          recordedUnitId: v.inviting_unit_id || 'unassigned',
          recordedUnitName: unit?.unitName || (v.inviting_unit_id ? 'Unit' : 'Stake-wide / Unassigned'),
          activityId: session.activity_id,
          activityTitle: activity?.title || session.session_title,
          activityCategory: activity?.category || 'other',
          sessionId: session.id,
          sessionTitle: session.session_title,
          sessionDate: session.session_date,
          checkInTime: v.created_at,
          contactPhone: v.contact_phone,
          isChurchMember: v.is_church_member
        })
      }
    }

    // 5. Name Query Filtering
    let filteredRecords = unifiedRecords
    if (criteria.nameQuery && criteria.nameQuery.trim().length > 0) {
      const q = criteria.nameQuery.trim().toLowerCase()
      filteredRecords = filteredRecords.filter(r =>
        r.attendeeName.toLowerCase().includes(q) ||
        (r.memberNumber && r.memberNumber.toLowerCase().includes(q))
      )
    }

    // 6. Metrics Calculations
    const totalRecords = filteredRecords.length
    const memberRecords = filteredRecords.filter(r => r.attendanceType === 'member').length
    const visitorRecords = filteredRecords.filter(r => r.attendanceType === 'visitor').length

    // Unique attendees: distinct member UUIDs + distinct visitor identities
    const distinctMemberIds = new Set<string>()
    const distinctVisitorKeys = new Set<string>()
    for (const r of filteredRecords) {
      if (r.attendanceType === 'member' && r.attendeeId) {
        distinctMemberIds.add(r.attendeeId)
      } else {
        // For visitors without a member UUID, identify distinctly by (id) or (fullName + phone)
        const key = r.attendeeId || `${r.attendeeName.toLowerCase().trim()}_${r.contactPhone || ''}`
        distinctVisitorKeys.add(key)
      }
    }
    const uniqueAttendees = distinctMemberIds.size + distinctVisitorKeys.size

    // Held sessions (non-cancelled sessions that had activity)
    const heldSessions = sessionList.filter((s: any) => s.status !== 'cancelled')
    const heldSessionsCount = heldSessions.length
    const avgAttendancePerSession =
      heldSessionsCount > 0 ? Math.round((totalRecords / heldSessionsCount) * 10) / 10 : null

    // Previous comparable period trend calculation
    let periodTrendPercentage: number | null = null
    let comparablePrevPeriodRecords = 0
    if (startDate && endDate) {
      const prev = getComparablePreviousPeriod(startDate, endDate)
      // Fetch prior count for comparable scope
      const { data: prevSessions } = await supabase
        .from('activity_sessions')
        .select('id')
        .gte('session_date', prev.startDate)
        .lte('session_date', prev.endDate)
      const prevSessIds = (prevSessions || []).map((s: any) => s.id)
      if (prevSessIds.length > 0 && targetUnitIds.length > 0) {
        const { count: prevAttCount } = await supabase
          .from('attendance_records')
          .select('id', { count: 'exact', head: true })
          .in('session_id', prevSessIds)
          .in('recorded_unit_id', targetUnitIds)
        comparablePrevPeriodRecords = prevAttCount || 0
        if (comparablePrevPeriodRecords > 0) {
          const diff = totalRecords - comparablePrevPeriodRecords
          periodTrendPercentage = Math.round((diff / comparablePrevPeriodRecords) * 1000) / 10
        }
      }
    }

    const metrics: ReportSummaryMetrics = {
      totalRecords,
      uniqueAttendees,
      memberRecords,
      visitorRecords,
      heldSessionsCount,
      avgAttendancePerSession,
      periodTrendPercentage,
      comparablePrevPeriodRecords
    }

    // 7. Factual Dynamic Insights Generation
    const insights: string[] = []
    insights.push(`Recorded ${totalRecords} total attendance event${totalRecords === 1 ? '' : 's'} across ${heldSessionsCount} held session${heldSessionsCount === 1 ? '' : 's'}.`)
    if (totalRecords > 0) {
      insights.push(`Engaged ${uniqueAttendees} distinct individual${uniqueAttendees === 1 ? '' : 's'} (${memberRecords} member check-in${memberRecords === 1 ? '' : 's'}, ${visitorRecords} visitor/guest check-in${visitorRecords === 1 ? '' : 's'}).`)
    }
    if (periodTrendPercentage !== null) {
      const dir = periodTrendPercentage >= 0 ? 'increased' : 'decreased'
      insights.push(`Attendance ${dir} by ${Math.abs(periodTrendPercentage)}% compared to the prior comparable period (${comparablePrevPeriodRecords} records).`)
    }
    if (heldSessionsCount > 0 && avgAttendancePerSession !== null) {
      insights.push(`Average attendance was ${avgAttendancePerSession} attendees per session.`)
    }

    // Activity with highest attendance
    const actCountMap = new Map<string, { title: string; count: number }>()
    for (const r of filteredRecords) {
      const curr = actCountMap.get(r.activityTitle) || { title: r.activityTitle, count: 0 }
      curr.count += 1
      actCountMap.set(r.activityTitle, curr)
    }
    const topActivities = Array.from(actCountMap.values()).sort((a, b) => b.count - a.count)
    if (topActivities.length > 0) {
      insights.push(`Top attended activity was "${topActivities[0].title}" with ${topActivities[0].count} check-ins.`)
    }

    // Unit with highest participation
    const unitCountMap = new Map<string, { name: string; count: number }>()
    for (const r of filteredRecords) {
      const curr = unitCountMap.get(r.recordedUnitName) || { name: r.recordedUnitName, count: 0 }
      curr.count += 1
      unitCountMap.set(r.recordedUnitName, curr)
    }
    const topUnits = Array.from(unitCountMap.values()).sort((a, b) => b.count - a.count)
    if (topUnits.length > 0 && totalRecords > 0) {
      const pct = Math.round((topUnits[0].count / totalRecords) * 1000) / 10
      insights.push(`Highest participating unit was ${topUnits[0].name} with ${topUnits[0].count} check-ins (${pct}% of total).`)
    }

    // 8. Sorting
    const sortedRecords = [...filteredRecords].sort((a, b) => {
      const mult = criteria.sortDirection === 'desc' ? -1 : 1
      let valA: any = a[criteria.sortBy] || ''
      let valB: any = b[criteria.sortBy] || ''
      if (typeof valA === 'string') valA = valA.toLowerCase()
      if (typeof valB === 'string') valB = valB.toLowerCase()

      if (valA < valB) return -1 * mult
      if (valA > valB) return 1 * mult
      // Stable secondary sort
      return a.id.localeCompare(b.id)
    })

    // 9. Grouping
    const groupedMap = new Map<string, { title: string; records: UnifiedAttendanceRecord[] }>()
    if (criteria.groupBy !== 'none') {
      for (const r of sortedRecords) {
        let key = 'Other'
        let title = 'Other'
        if (criteria.groupBy === 'by_person') {
          key = r.attendeeId || r.attendeeName
          title = `${r.attendeeName}${r.homeUnitName ? ` (${r.homeUnitName})` : ''}`
        } else if (criteria.groupBy === 'by_activity') {
          key = r.activityId || r.activityTitle
          title = r.activityTitle
        } else if (criteria.groupBy === 'by_unit') {
          key = r.recordedUnitId
          title = r.recordedUnitName
        } else if (criteria.groupBy === 'by_month') {
          key = r.sessionDate.substring(0, 7)
          title = key
        } else if (criteria.groupBy === 'by_type') {
          key = r.attendanceType
          title = r.attendanceType === 'member' ? 'Church Members' : 'Visitors & Friends'
        }

        const g = groupedMap.get(key) || { title, records: [] }
        g.records.push(r)
        groupedMap.set(key, g)
      }
    }

    const groupedRecords: GroupedReportResult[] = Array.from(groupedMap.entries()).map(([key, data]) => {
      const memIds = new Set(data.records.filter(r => r.attendanceType === 'member').map(r => r.attendeeId))
      const visKeys = new Set(data.records.filter(r => r.attendanceType === 'visitor').map(r => r.attendeeId || r.attendeeName))
      return {
        groupKey: key,
        groupTitle: data.title,
        recordsCount: data.records.length,
        uniqueAttendeesCount: memIds.size + visKeys.size,
        records: data.records
      }
    })

    // 10. Chart Datasets Preparation
    // Trend timeline (daily or monthly grouping)
    const timelineMap = new Map<string, { members: number; visitors: number }>()
    for (const r of sortedRecords) {
      const tKey = r.sessionDate
      const curr = timelineMap.get(tKey) || { members: 0, visitors: 0 }
      if (r.attendanceType === 'member') curr.members += 1
      else curr.visitors += 1
      timelineMap.set(tKey, curr)
    }
    const trendTimeline = Array.from(timelineMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, counts]) => ({
        periodLabel: formatLagosDateDisplay(d),
        recordsCount: counts.members + counts.visitors,
        membersCount: counts.members,
        visitorsCount: counts.visitors
      }))

    // Unit breakdown chart data
    const unitBreakdown = Array.from(unitCountMap.entries()).map(([uName, data]) => {
      const foundUnit = Array.from(unitMap.values()).find(u => u.unitName === uName)
      return {
        unitId: foundUnit?.id || uName,
        unitName: uName,
        recordsCount: data.count,
        percentage: totalRecords > 0 ? Math.round((data.count / totalRecords) * 1000) / 10 : 0
      }
    })

    // Activity breakdown chart data
    const activityBreakdown = topActivities.slice(0, 10).map(act => {
      const found = Array.from(activityMap.values()).find(a => a.title === act.title)
      return {
        activityId: found?.id || act.title,
        activityTitle: act.title,
        recordsCount: act.count
      }
    })

    // Member vs visitor composition
    const memberPct = totalRecords > 0 ? Math.round((memberRecords / totalRecords) * 1000) / 10 : 0
    const visitorPct = totalRecords > 0 ? Math.round((visitorRecords / totalRecords) * 1000) / 10 : 0
    const typeBreakdown = {
      members: memberRecords,
      visitors: visitorRecords,
      memberPct,
      visitorPct
    }

    // 11. If Monthly Register requested, calculate unit monthly register
    let unitMonthlyStats: UnitMonthlyStat[] | undefined
    if (criteria.reportType === 'monthly_register') {
      const regYear = criteria.year || new Date().getFullYear()
      const regMonth = criteria.month || new Date().getMonth() + 1
      unitMonthlyStats = await this.getUnitMonthlyRegister(regYear, regMonth, targetUnitIds)
    }

    return {
      criteria,
      effectiveStartDate: startDate,
      effectiveEndDate: endDate,
      metrics,
      insights,
      records: sortedRecords,
      groupedRecords,
      charts: {
        trendTimeline,
        unitBreakdown,
        activityBreakdown,
        typeBreakdown
      },
      unitMonthlyStats
    }
  },

  // --- Preserved API for Stake Summary ---
  async getStakeSummary(unitIdFilter?: string | string[] | null): Promise<{
    totalUnits: number
    totalMembers: number
    totalActivities: number
    totalSessions: number
    totalCheckIns: number
    activeSessionsCount: number
  }> {
    let unitsQuery = supabase.from('stake_units').select('id', { count: 'exact', head: true }).eq('is_active', true)
    let membersQuery = supabase.from('members').select('id', { count: 'exact', head: true }).eq('is_active', true)
    let attQuery = supabase.from('attendance_records').select('id', { count: 'exact', head: true })

    if (Array.isArray(unitIdFilter)) {
      if (unitIdFilter.length === 0) {
        return {
          totalUnits: 0,
          totalMembers: 0,
          totalActivities: 0,
          totalSessions: 0,
          totalCheckIns: 0,
          activeSessionsCount: 0
        }
      }
      unitsQuery = unitsQuery.in('id', unitIdFilter)
      membersQuery = membersQuery.in('home_unit_id', unitIdFilter)
      attQuery = attQuery.in('recorded_unit_id', unitIdFilter)
    } else if (unitIdFilter) {
      unitsQuery = unitsQuery.eq('id', unitIdFilter)
      membersQuery = membersQuery.eq('home_unit_id', unitIdFilter)
      attQuery = attQuery.eq('recorded_unit_id', unitIdFilter)
    }

    const [unitsRes, membersRes, actRes, sessRes, attRes] = await Promise.all([
      unitsQuery,
      membersQuery,
      supabase.from('activities').select('id', { count: 'exact', head: true }),
      supabase.from('activity_sessions').select('id, status'),
      attQuery
    ])

    const sessions = sessRes.data || []
    const activeCount = sessions.filter((s: any) => s.status === 'active').length

    return {
      totalUnits: unitsRes.count || 0,
      totalMembers: membersRes.count || 0,
      totalActivities: actRes.count || 0,
      totalSessions: sessions.length,
      totalCheckIns: attRes.count || 0,
      activeSessionsCount: activeCount
    }
  },

  // --- Preserved API for Unit Monthly Register ---
  async getUnitMonthlyRegister(
    year: number,
    month: number,
    unitIdFilter?: string | string[] | null
  ): Promise<UnitMonthlyStat[]> {
    if (Array.isArray(unitIdFilter) && unitIdFilter.length === 0) {
      return []
    }

    let unitQuery = supabase.from('stake_units').select('id, unit_name').eq('is_active', true).order('unit_name', { ascending: true })
    if (Array.isArray(unitIdFilter)) {
      unitQuery = unitQuery.in('id', unitIdFilter)
    } else if (unitIdFilter) {
      unitQuery = unitQuery.eq('id', unitIdFilter)
    }
    const { data: units } = await unitQuery
    if (!units || units.length === 0) return []

    const scopedUnitIds = units.map((u: any) => u.id)
    const { startDate, endDate } = getSelectedMonthRangeLagos(year, month)

    const { data: sessions } = await supabase
      .from('activity_sessions')
      .select('id, session_date, participating_units')
      .gte('session_date', startDate)
      .lte('session_date', endDate)

    const sessionList = sessions || []

    const sessionIds = sessionList.map((s: any) => s.id)
    let records: any[] = []
    if (sessionIds.length > 0) {
      const { data: recs } = await supabase
        .from('attendance_records')
        .select('session_id, recorded_unit_id')
        .in('session_id', sessionIds)
        .in('recorded_unit_id', scopedUnitIds)
      records = recs || []
    }

    const { data: members } = await supabase
      .from('members')
      .select('home_unit_id')
      .eq('is_active', true)
      .in('home_unit_id', scopedUnitIds)

    const memberMap: Record<string, number> = {}
    ;(members || []).forEach((m: any) => {
      memberMap[m.home_unit_id] = (memberMap[m.home_unit_id] || 0) + 1
    })

    return units.map((u: any) => {
      const unitMembers = memberMap[u.id] || 0
      const eligibleSessions = sessionList.filter((s: any) => {
        if (!s.participating_units || s.participating_units.length === 0) return true
        return s.participating_units.includes(u.id)
      })
      const totalOpportunities = eligibleSessions.length * unitMembers
      const unitCheckIns = records.filter((r: any) => r.recorded_unit_id === u.id).length
      const percentage = calculateAttendancePercentage(unitCheckIns, totalOpportunities)

      return {
        unitId: u.id,
        unitName: u.unit_name,
        totalMembers: unitMembers,
        totalAttended: unitCheckIns,
        totalOpportunities,
        percentage
      }
    })
  },

  // --- Preserved API for Individual Attendance History ---
  async getIndividualHistory(
    memberId: string,
    unitIdFilter?: string | string[] | null
  ): Promise<IndividualAttendanceHistory | null> {
    if (Array.isArray(unitIdFilter) && unitIdFilter.length === 0) {
      return null
    }

    let memberQuery = supabase
      .from('members')
      .select('id, full_name, home_unit_id, stake_units(unit_name)')
      .eq('id', memberId)

    if (Array.isArray(unitIdFilter)) {
      memberQuery = memberQuery.in('home_unit_id', unitIdFilter)
    } else if (unitIdFilter) {
      memberQuery = memberQuery.eq('home_unit_id', unitIdFilter)
    }

    const { data: member } = await memberQuery.maybeSingle()
    if (!member) return null

    if (Array.isArray(unitIdFilter) && !unitIdFilter.includes((member as any).home_unit_id)) {
      return null
    }
    if (typeof unitIdFilter === 'string' && (member as any).home_unit_id !== unitIdFilter) {
      return null
    }

    const { data: records } = await supabase
      .from('attendance_records')
      .select('session_id, check_in_time, activity_sessions(session_title, session_date)')
      .eq('member_id', memberId)
      .order('check_in_time', { ascending: false })

    const sessions = (records || []).map((r: any) => ({
      sessionId: r.session_id,
      sessionTitle: r.activity_sessions?.session_title || 'Session',
      sessionDate: r.activity_sessions?.session_date || '',
      checkInTime: r.check_in_time
    }))

    return {
      memberId: member.id,
      fullName: member.full_name,
      homeUnitName: (member as any).stake_units?.unit_name || 'Unit',
      attendedCount: sessions.length,
      sessions
    }
  },

  // --- Preserved API for Session Visitors ---
  async listSessionVisitors(
    unitIdFilter?: string | string[] | null
  ): Promise<(SessionVisitor & { sessionTitle?: string; sessionDate?: string })[]> {
    if (Array.isArray(unitIdFilter) && unitIdFilter.length === 0) {
      return []
    }

    let query = supabase
      .from('session_visitors')
      .select('*, stake_units(unit_name), activity_sessions(session_title, session_date)')
      .order('created_at', { ascending: false })

    if (Array.isArray(unitIdFilter)) {
      query = query.in('inviting_unit_id', unitIdFilter)
    } else if (unitIdFilter) {
      query = query.eq('inviting_unit_id', unitIdFilter)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    return (data || [])
      .filter((v: any) => {
        if (Array.isArray(unitIdFilter)) {
          return v.inviting_unit_id && unitIdFilter.includes(v.inviting_unit_id)
        }
        if (unitIdFilter) {
          return v.inviting_unit_id === unitIdFilter
        }
        return true
      })
      .map((v: any) => ({
        id: v.id,
        sessionId: v.session_id,
        fullName: v.full_name,
        contactPhone: v.contact_phone,
        isChurchMember: v.is_church_member,
        invitingUnitId: v.inviting_unit_id,
        invitingUnitName: v.stake_units?.unit_name || (v.inviting_unit_id ? 'Unit' : 'Unassigned / Stake-wide'),
        recordedByTerminalId: v.recorded_by_terminal_id,
        createdAt: v.created_at,
        sessionTitle: v.activity_sessions?.session_title || 'Session',
        sessionDate: v.activity_sessions?.session_date || ''
      }))
  },

  // --- Preserved Legacy Export (with added formula-injection sanitization) ---
  exportToCsv(data: Record<string, any>[], filename: string) {
    if (data.length === 0) return
    const headers = Object.keys(data[0])
    const rows = data.map(row =>
      headers.map(field => {
        let val = row[field] === null || row[field] === undefined ? '' : String(row[field])
        if (/^[=+\-@\t\r]/.test(val)) {
          val = `'${val}`
        }
        return `"${val.replace(/"/g, '""')}"`
      }).join(',')
    )
    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `${filename}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }
}
