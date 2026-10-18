import { supabase } from '../lib/supabase'

export function calculateAttendancePercentage(
  attended: number,
  eligibleOpportunities: number
): number | null {
  if (eligibleOpportunities <= 0) {
    return null
  }
  return Math.round((attended / eligibleOpportunities) * 1000) / 10
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

export const reportService = {
  calculateAttendancePercentage,

  async getStakeSummary(): Promise<{
    totalUnits: number
    totalMembers: number
    totalActivities: number
    totalSessions: number
    totalCheckIns: number
    activeSessionsCount: number
  }> {
    const [unitsRes, membersRes, actRes, sessRes, attRes] = await Promise.all([
      supabase.from('stake_units').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('members').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('activities').select('id', { count: 'exact', head: true }),
      supabase.from('activity_sessions').select('id, status'),
      supabase.from('attendance_records').select('id', { count: 'exact', head: true })
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

  async getUnitMonthlyRegister(year: number, month: number, unitIdFilter?: string | null): Promise<UnitMonthlyStat[]> {
    // 1. Fetch units
    let unitQuery = supabase.from('stake_units').select('id, unit_name').eq('is_active', true)
    if (unitIdFilter) {
      unitQuery = unitQuery.eq('id', unitIdFilter)
    }
    const { data: units } = await unitQuery
    if (!units || units.length === 0) return []

    // 2. Fetch sessions in that month
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const endDate = `${year}-${String(month).padStart(2, '0')}-31`

    const { data: sessions } = await supabase
      .from('activity_sessions')
      .select('id, session_date, participating_units')
      .gte('session_date', startDate)
      .lte('session_date', endDate)

    const sessionList = sessions || []

    // 3. Fetch attendance records in those sessions
    const sessionIds = sessionList.map((s: any) => s.id)
    let records: any[] = []
    if (sessionIds.length > 0) {
      const { data: recs } = await supabase
        .from('attendance_records')
        .select('session_id, recorded_unit_id')
        .in('session_id', sessionIds)
      records = recs || []
    }

    // 4. Fetch member counts per unit
    const { data: members } = await supabase
      .from('members')
      .select('home_unit_id')
      .eq('is_active', true)

    const memberMap: Record<string, number> = {}
    ;(members || []).forEach((m: any) => {
      memberMap[m.home_unit_id] = (memberMap[m.home_unit_id] || 0) + 1
    })

    return units.map((u: any) => {
      const unitMembers = memberMap[u.id] || 0
      // Calculate eligible opportunities: sessions where unit was eligible * member count
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

  async getIndividualHistory(memberId: string): Promise<IndividualAttendanceHistory | null> {
    const { data: member } = await supabase
      .from('members')
      .select('id, full_name, stake_units(unit_name)')
      .eq('id', memberId)
      .single()

    if (!member) return null

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

  exportToCsv(data: Record<string, any>[], filename: string) {
    if (data.length === 0) return
    const headers = Object.keys(data[0])
    const rows = data.map(row =>
      headers.map(field => {
        const val = row[field] === null || row[field] === undefined ? '' : String(row[field])
        return `"${val.replace(/"/g, '""')}"`
      }).join(',')
    )
    const csvContent = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `${filename}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }
}
