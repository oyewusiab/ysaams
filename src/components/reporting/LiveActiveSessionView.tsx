import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  ActivitySession,
  StakeUnit,
  AttendanceRecord
} from '../../types/database'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import {
  copyActivityCode,
  copyAttendanceLink,
  getActiveSessionCode
} from '../../lib/clipboardUtils'
import { humanizeErrorMessage } from '../../lib/errorUtils'
import { formatLagosTimestampDisplay } from '../../lib/timezone'
import {
  Radio,
  RefreshCw,
  Copy,
  ExternalLink,
  Building2,
  Clock,
  AlertCircle,
  CheckCircle2,
  X
} from 'lucide-react'

interface LiveActiveSessionViewProps {
  session: ActivitySession
  units: StakeUnit[]
  activeCode?: string | null
  onClose?: () => void
}

interface RecentCheckInItem {
  id: string
  attendeeName: string
  attendeeType: 'member' | 'visitor'
  unitName: string
  checkInTime: string
  isManual: boolean
}

export const LiveActiveSessionView: React.FC<LiveActiveSessionViewProps> = ({
  session,
  units,
  activeCode: propCode,
  onClose
}) => {
  const { isStakeLeader, reportUnitFilter, manageableUnitIds } = useAuth()

  // Authorized unit filter for leader's scoping
  const authorizedUnitIds = isStakeLeader
    ? null
    : (reportUnitFilter && reportUnitFilter.length > 0 ? reportUnitFilter : manageableUnitIds)

  // Session code: prioritize prop, fallback to persistent storage
  const [currentCode] = useState<string | null>(() => {
    if (propCode) return propCode
    return getActiveSessionCode(session.id)
  })

  // Live reporting state
  const [memberRecords, setMemberRecords] = useState<AttendanceRecord[]>([])
  const [visitorRecords, setVisitorRecords] = useState<any[]>([])
  const [recentItems, setRecentItems] = useState<RecentCheckInItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [statusState, setStatusState] = useState<'live' | 'refreshing' | 'stale'>('refreshing')
  const [lastUpdated, setLastUpdated] = useState<string>(new Date().toISOString())
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [feedbackToast, setFeedbackToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Map units for quick lookup
  const unitMap = useRef(new Map<string, string>())
  useEffect(() => {
    const map = new Map<string, string>()
    units.forEach((u) => map.set(u.id, u.unitName))
    unitMap.current = map
  }, [units])

  // Clear feedback toast after 4s
  useEffect(() => {
    if (feedbackToast) {
      const t = setTimeout(() => setFeedbackToast(null), 4000)
      return () => clearTimeout(t)
    }
  }, [feedbackToast])

  // Authoritative data fetcher
  const fetchAuthoritativeData = useCallback(async (silent = false) => {
    if (!silent) {
      setIsRefreshing(true)
      setStatusState('refreshing')
    }
    setErrorMessage(null)

    try {
      // 1. Fetch Member Attendance Records for this session
      let attQuery = supabase
        .from('attendance_records')
        .select('id, session_id, member_id, attendee_name, is_non_member, recorded_unit_id, check_in_time, is_manual, members(id, full_name, home_unit_id)')
        .eq('session_id', session.id)

      if (authorizedUnitIds && authorizedUnitIds.length > 0) {
        attQuery = attQuery.in('recorded_unit_id', authorizedUnitIds)
      }

      // 2. Fetch Visitor Records for this session
      let visQuery = supabase
        .from('session_visitors')
        .select('id, session_id, full_name, is_church_member, inviting_unit_id, created_at, recorded_by_terminal_id')
        .eq('session_id', session.id)

      if (authorizedUnitIds && authorizedUnitIds.length > 0) {
        visQuery = visQuery.in('inviting_unit_id', authorizedUnitIds)
      }

      const [attRes, visRes] = await Promise.all([attQuery, visQuery])

      if (attRes.error) throw attRes.error
      if (visRes.error) throw visRes.error

      const rawAtt = attRes.data || []
      const rawVis = visRes.data || []

      // Map member records
      const mappedMembers: AttendanceRecord[] = rawAtt.map((r: any) => ({
        id: r.id,
        sessionId: r.session_id,
        memberId: r.member_id,
        attendeeName: r.members?.full_name || r.attendee_name || 'Member',
        isNonMember: false,
        unitId: r.recorded_unit_id,
        unitName: unitMap.current.get(r.recorded_unit_id) || 'Unit',
        checkInTime: r.check_in_time,
        isManual: !!r.is_manual
      }))

      setMemberRecords(mappedMembers)
      setVisitorRecords(rawVis)

      // Build unified recent items (sorted by time descending)
      const recentList: RecentCheckInItem[] = []

      for (const m of mappedMembers) {
        recentList.push({
          id: m.id,
          attendeeName: m.attendeeName,
          attendeeType: 'member',
          unitName: m.unitName || 'Unit',
          checkInTime: m.checkInTime,
          isManual: !!m.isManual
        })
      }

      for (const v of rawVis) {
        recentList.push({
          id: v.id,
          attendeeName: v.full_name || 'Visitor',
          attendeeType: 'visitor',
          unitName: (v.inviting_unit_id && unitMap.current.get(v.inviting_unit_id)) || 'Guest',
          checkInTime: v.created_at,
          isManual: false
        })
      }

      recentList.sort((a, b) => new Date(b.checkInTime).getTime() - new Date(a.checkInTime).getTime())
      setRecentItems(recentList.slice(0, 20))

      setLastUpdated(new Date().toISOString())
      setStatusState('live')
    } catch (err: unknown) {
      setStatusState('stale')
      setErrorMessage(humanizeErrorMessage(err, 'Could not refresh live attendance records.'))
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [session.id, authorizedUnitIds])

  // Setup Realtime & Bounded Polling
  useEffect(() => {
    let mounted = true
    fetchAuthoritativeData(false)

    // Setup Supabase Realtime channel
    const channel = supabase
      .channel(`live-session-attendance-${session.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'attendance_records',
          filter: `session_id=eq.${session.id}`
        },
        () => {
          if (mounted) fetchAuthoritativeData(true)
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'session_visitors',
          filter: `session_id=eq.${session.id}`
        },
        () => {
          if (mounted) fetchAuthoritativeData(true)
        }
      )
      .subscribe((status) => {
        if (!mounted) return
        if (status === 'SUBSCRIBED') {
          setStatusState('live')
        } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
          setStatusState('stale')
        }
      })

    // Bounded polling fallback: runs every 10 seconds only when tab is visible
    const pollingInterval = setInterval(() => {
      if (!mounted) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return // pause polling while backgrounded
      }
      fetchAuthoritativeData(true)
    }, 10000)

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && mounted) {
        fetchAuthoritativeData(true)
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      mounted = false
      supabase.removeChannel(channel)
      clearInterval(pollingInterval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [session.id, fetchAuthoritativeData])

  // Aggregate Metrics (using stable database IDs)
  const totalValidCheckIns = memberRecords.length + visitorRecords.length

  // Distinct attendees using stable identity (member_id for members, id for visitors)
  const distinctMemberIds = new Set(memberRecords.map((m) => m.memberId || m.id))
  const distinctVisitorIds = new Set(visitorRecords.map((v) => v.id))
  const distinctAttendeesCount = distinctMemberIds.size + distinctVisitorIds.size

  const memberCount = memberRecords.length
  const visitorCount = visitorRecords.length

  // Participating unit breakdown
  const unitBreakdown: { unitId: string; unitName: string; members: number; visitors: number; total: number }[] = []
  const participatingUnitIds = session.participatingUnits && session.participatingUnits.length > 0
    ? session.participatingUnits
    : units.map((u) => u.id)

  for (const uid of participatingUnitIds) {
    // If user is restricted to certain units, only show permitted units
    if (authorizedUnitIds && !authorizedUnitIds.includes(uid)) {
      continue
    }
    const uName = unitMap.current.get(uid) || 'Unit'
    const mCount = memberRecords.filter((m) => m.unitId === uid).length
    const vCount = visitorRecords.filter((v) => v.inviting_unit_id === uid).length
    unitBreakdown.push({
      unitId: uid,
      unitName: uName,
      members: mCount,
      visitors: vCount,
      total: mCount + vCount
    })
  }

  // Handle Copy Code
  const handleCopyCode = async () => {
    if (!currentCode) return
    const res = await copyActivityCode(currentCode)
    setFeedbackToast({
      type: res.success ? 'success' : 'error',
      text: res.message
    })
  }

  // Handle Copy Link
  const handleCopyLink = async () => {
    if (!currentCode) return
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await copyAttendanceLink(origin, currentCode)
    setFeedbackToast({
      type: res.success ? 'success' : 'error',
      text: res.message
    })
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-sm">
      {/* Feedback Toast Notification */}
      {feedbackToast && (
        <div
          role="status"
          aria-live="polite"
          className={`p-3 rounded-xl text-xs font-semibold flex items-center justify-between shadow-md transition animate-terminal-enter ${
            feedbackToast.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
              : 'bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800'
          }`}
        >
          <div className="flex items-center space-x-2">
            {feedbackToast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" />
            )}
            <span>{feedbackToast.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackToast(null)}
            className="p-1 hover:opacity-75 rounded"
            aria-label="Dismiss feedback"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800 gap-4">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700/60">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Active Session Monitor</span>
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">• {session.sessionDate}</span>
          </div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{session.sessionTitle}</h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status Indicator */}
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
            {statusState === 'live' && (
              <>
                <Radio className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 animate-pulse" />
                <span className="font-medium text-emerald-700 dark:text-emerald-400">Live</span>
              </>
            )}
            {statusState === 'refreshing' && (
              <>
                <RefreshCw className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 animate-spin" />
                <span className="font-medium text-blue-600 dark:text-blue-400">Refreshing</span>
              </>
            )}
            {statusState === 'stale' && (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span className="font-medium text-amber-600 dark:text-amber-400">Reconnecting</span>
              </>
            )}
            <span className="text-[10px] text-slate-400 font-mono hidden md:inline">
              Updated {formatLagosTimestampDisplay(lastUpdated)}
            </span>
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => fetchAuthoritativeData(false)}
            disabled={isRefreshing}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition focus-visible:ring-2 focus-visible:ring-emerald-500"
            title="Refresh Live Data"
            aria-label="Refresh Live Data"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition"
              title="Close Live Monitor"
              aria-label="Close Live Monitor"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Error state if failed to load */}
      {errorMessage && (
        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/80 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Session Code & Link Bar (Requirement 4) */}
      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 rounded-lg">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold block">
              Active Check-In Code
            </span>
            {currentCode ? (
              <span className="font-mono text-xl font-extrabold text-emerald-700 dark:text-emerald-400 tracking-wider">
                {currentCode}
              </span>
            ) : (
              <span className="text-xs text-slate-500 dark:text-slate-400 italic">
                Active in system (re-initiating or rotating will display code)
              </span>
            )}
          </div>
        </div>

        {currentCode && (
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleCopyCode}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-2xs transition focus-visible:ring-2 focus-visible:ring-emerald-500"
              title="Copy the 6-character activity code only"
            >
              <Copy className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Copy Code</span>
            </button>
            <button
              type="button"
              onClick={handleCopyLink}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-2xs transition focus-visible:ring-2 focus-visible:ring-emerald-500"
              title="Copy the direct public check-in link"
            >
              <ExternalLink className="w-3.5 h-3.5 text-white" />
              <span>Copy Link</span>
            </button>
          </div>
        )}
      </div>

      {/* KPI Cards (4 metrics: Total, Distinct, Members, Visitors) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Total Valid Check-Ins</span>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
            {isLoading ? '...' : totalValidCheckIns}
          </div>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">Authoritative records</span>
        </div>

        <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Distinct Attendees</span>
          <div className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-400 mt-1">
            {isLoading ? '...' : distinctAttendeesCount}
          </div>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">Deduplicated identity</span>
        </div>

        <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Church Members</span>
          <div className="text-2xl font-extrabold text-blue-700 dark:text-blue-400 mt-1">
            {isLoading ? '...' : memberCount}
          </div>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">Census-verified</span>
        </div>

        <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Visitors & Guests</span>
          <div className="text-2xl font-extrabold text-purple-700 dark:text-purple-400 mt-1">
            {isLoading ? '...' : visitorCount}
          </div>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">Invited guests</span>
        </div>
      </div>

      {/* Participating Units Breakdown & Live Check-in Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Unit Breakdown */}
        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <Building2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Participating Units Breakdown
            </h3>
          </div>
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 uppercase text-[10px] text-slate-600 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5">Unit</th>
                  <th className="px-4 py-2.5 text-center">Members</th>
                  <th className="px-4 py-2.5 text-center">Visitors</th>
                  <th className="px-4 py-2.5 text-right font-bold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {unitBreakdown.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-500 italic">
                      No participating units registered for this session.
                    </td>
                  </tr>
                ) : (
                  unitBreakdown.map((u) => (
                    <tr key={u.unitId} className="hover:bg-slate-100/50 dark:hover:bg-slate-900/50">
                      <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-200">{u.unitName}</td>
                      <td className="px-4 py-2.5 text-center text-slate-700 dark:text-slate-300">{u.members}</td>
                      <td className="px-4 py-2.5 text-center text-slate-700 dark:text-slate-300">{u.visitors}</td>
                      <td className="px-4 py-2.5 text-right font-bold text-emerald-700 dark:text-emerald-400">{u.total}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Live Check-Ins Stream */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Recent Check-Ins ({recentItems.length})
              </h3>
            </div>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Realtime stream</span>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden max-h-[300px] overflow-y-auto">
            {recentItems.length === 0 ? (
              <div className="p-8 text-center text-slate-500 italic text-xs">
                {isLoading ? 'Loading check-ins...' : 'No attendees checked in yet for this session.'}
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {recentItems.map((item) => (
                  <div
                    key={item.id}
                    className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-100/60 dark:hover:bg-slate-900/50 text-xs"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-slate-900 dark:text-white truncate">
                          {item.attendeeName}
                        </span>
                        <span
                          className={`text-[9px] uppercase px-1.5 py-0.2 rounded font-semibold ${
                            item.attendeeType === 'member'
                              ? 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300'
                              : 'bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300'
                          }`}
                        >
                          {item.attendeeType}
                        </span>
                        {item.isManual && (
                          <span className="text-[9px] text-amber-700 dark:text-amber-400 font-mono">
                            Manual
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 block truncate">
                        {item.unitName}
                      </span>
                    </div>

                    <div className="shrink-0 text-right font-mono text-[10px] text-slate-500 dark:text-slate-400">
                      {formatLagosTimestampDisplay(item.checkInTime).split(' ')[1] || item.checkInTime.slice(11, 16)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
