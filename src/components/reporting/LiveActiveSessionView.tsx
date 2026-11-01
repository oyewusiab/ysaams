import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  ActivityDefinition,
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
import {
  isSkillAcquisitionActivity,
  normalizeClassOptions
} from '../../services/activityService'
import {
  exportToCsvAdvanced,
  exportToXlsxAdvanced
} from '../../lib/exportUtils'
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
  X,
  BookOpen,
  Download,
  FileSpreadsheet,
  Filter
} from 'lucide-react'

export interface LiveActiveSessionViewProps {
  session: ActivitySession
  activity?: ActivityDefinition | null
  units: StakeUnit[]
  activeCode?: string | null
  onClose?: () => void
}

export interface RecentCheckInItem {
  id: string
  attendeeId: string
  attendeeName: string
  attendeeType: 'member' | 'visitor'
  unitId: string | null
  unitName: string
  selectedClass?: string | null
  checkInTime: string
  isManual: boolean
}

export interface LiveUnitBreakdownRow {
  unitId: string
  unitName: string
  members: number
  visitors: number
  total: number
  isUnassigned?: boolean
}

export interface LiveClassBreakdownRow {
  className: string
  members: number
  visitors: number
  total: number
  isConfigured: boolean
}

export interface ComputeLiveSessionMetricsParams {
  sessionId: string
  sessionStatus?: string
  rawMemberRows: any[]
  rawVisitorRows: any[]
  units: StakeUnit[]
  participatingUnits?: string[] | null
  authorizedUnitIds?: string[] | null
  configuredClasses?: string[] | null
  isSkillAcquisition?: boolean
  selectedClassFilter?: string
  memberDirectoryMap?: Map<string, { fullName: string; homeUnitId?: string | null }>
}

export interface LiveSessionComputedSnapshot {
  allMemberRecords: AttendanceRecord[]
  allVisitorRecords: {
    id: string
    sessionId: string
    fullName: string
    contactPhone?: string | null
    isChurchMember: boolean
    invitingUnitId: string | null
    invitingUnitName: string
    selectedClass: string | null
    checkInTime: string
  }[]
  filteredMemberRecords: AttendanceRecord[]
  filteredVisitorRecords: {
    id: string
    sessionId: string
    fullName: string
    contactPhone?: string | null
    isChurchMember: boolean
    invitingUnitId: string | null
    invitingUnitName: string
    selectedClass: string | null
    checkInTime: string
  }[]
  totalValidCheckIns: number
  distinctAttendeesCount: number
  memberCount: number
  visitorCount: number
  unitBreakdown: LiveUnitBreakdownRow[]
  classBreakdown: LiveClassBreakdownRow[]
  recentItems: RecentCheckInItem[]
  filteredRecentItems: RecentCheckInItem[]
  reconciled: {
    memberVisitorReconciled: boolean
    unitBreakdownReconciled: boolean
    classBreakdownReconciled: boolean
  }
}

/**
 * Pure, deterministic reconciliation engine for Live Session Monitoring.
 * - Filters strictly to the target sessionId and excludes cancelled/invalid rows.
 * - Deduplicates repeated realtime deliveries by record ID and enforces unique (session_id, member_id).
 * - Computes distinct attendees using stable database IDs (never names alone).
 * - Guarantees 100% reconciliation across total check-ins, members vs visitors, unit breakdown
 *   (including transparent Unassigned unit handling), and Skill Acquisition class breakdown.
 */
export function computeLiveSessionMetrics(
  params: ComputeLiveSessionMetricsParams
): LiveSessionComputedSnapshot {
  const {
    sessionId,
    sessionStatus,
    rawMemberRows,
    rawVisitorRows,
    units,
    participatingUnits,
    authorizedUnitIds = null,
    configuredClasses = [],
    isSkillAcquisition = false,
    selectedClassFilter = 'all',
    memberDirectoryMap
  } = params

  const unitMap = new Map<string, string>()
  for (const u of units || []) {
    if (u && u.id) {
      unitMap.set(u.id, u.unitName)
    }
  }

  // If the session itself is cancelled, no attendance records are valid for an active monitor
  const isSessionCancelled = sessionStatus === 'cancelled'
  const isScopeEmpty = Array.isArray(authorizedUnitIds) && authorizedUnitIds.length === 0

  const seenMemberRecordIds = new Set<string>()
  const seenMemberPersonIds = new Set<string>()
  const allMemberRecords: AttendanceRecord[] = []

  if (!isSessionCancelled && !isScopeEmpty) {
    // Sort raw member rows by check_in_time ascending first so the earliest record wins on duplicate member_id
    const sortedRawMembers = [...(rawMemberRows || [])].sort((a, b) => {
      const tA = new Date(a?.check_in_time || a?.checkInTime || a?.created_at || 0).getTime()
      const tB = new Date(b?.check_in_time || b?.checkInTime || b?.created_at || 0).getTime()
      return tA - tB
    })

    for (const r of sortedRawMembers) {
      if (!r || !r.id) continue
      const rowSessionId = r.session_id ?? r.sessionId
      if (rowSessionId && rowSessionId !== sessionId) continue
      if (r.is_cancelled === true || r.status === 'cancelled' || r.status === 'invalid') continue

      const recordId = String(r.id)
      if (seenMemberRecordIds.has(recordId)) continue

      const memberId = r.member_id ?? r.memberId ?? r.members?.id ?? null
      const directoryEntry = memberId && memberDirectoryMap ? memberDirectoryMap.get(memberId) : undefined
      const unitId: string | null =
        r.recorded_unit_id ??
        r.unitId ??
        r.members?.home_unit_id ??
        directoryEntry?.homeUnitId ??
        null

      if (Array.isArray(authorizedUnitIds)) {
        if (!unitId || !authorizedUnitIds.includes(unitId)) continue
      }

      // Enforce unique (session_id, member_id) invariant so duplicate check-in attempts are never double-counted
      const stableMemberKey = memberId ? String(memberId) : `rec:${recordId}`
      if (seenMemberPersonIds.has(stableMemberKey)) {
        continue
      }

      seenMemberRecordIds.add(recordId)
      seenMemberPersonIds.add(stableMemberKey)

      const resolvedName =
        r.members?.full_name ||
        directoryEntry?.fullName ||
        r.attendee_name ||
        r.attendeeName ||
        'Member'

      const resolvedUnitName =
        r.stake_units?.unit_name ||
        (unitId ? unitMap.get(unitId) : undefined) ||
        r.unitName ||
        (unitId ? 'Unit' : 'Unassigned / No Unit Specified')

      const isManual =
        r.is_manual !== undefined
          ? Boolean(r.is_manual)
          : r.isManual !== undefined
          ? Boolean(r.isManual)
          : r.recorded_by_terminal_id === null

      const rawClass = r.selected_class ?? r.selectedClass
      const cleanClass =
        typeof rawClass === 'string' && rawClass.trim().length > 0 ? rawClass.trim() : null

      allMemberRecords.push({
        id: recordId,
        sessionId,
        memberId: memberId ? String(memberId) : null,
        attendeeName: String(resolvedName).trim() || 'Member',
        isNonMember: false,
        unitId,
        unitName: resolvedUnitName,
        selectedClass: cleanClass,
        checkInTime: r.check_in_time || r.checkInTime || r.created_at || new Date().toISOString(),
        recordedByTerminalId: r.recorded_by_terminal_id ?? r.recordedByTerminalId ?? null,
        isManual
      })
    }
  }

  const seenVisitorRecordIds = new Set<string>()
  const allVisitorRecords: LiveSessionComputedSnapshot['allVisitorRecords'] = []

  if (!isSessionCancelled && !isScopeEmpty) {
    const sortedRawVisitors = [...(rawVisitorRows || [])].sort((a, b) => {
      const tA = new Date(a?.created_at || a?.checkInTime || 0).getTime()
      const tB = new Date(b?.created_at || b?.checkInTime || 0).getTime()
      return tA - tB
    })

    for (const v of sortedRawVisitors) {
      if (!v || !v.id) continue
      const rowSessionId = v.session_id ?? v.sessionId
      if (rowSessionId && rowSessionId !== sessionId) continue
      if (v.is_cancelled === true || v.status === 'cancelled' || v.status === 'invalid') continue

      const visitorRecordId = String(v.id)
      if (seenVisitorRecordIds.has(visitorRecordId)) continue

      const invitingUnitId: string | null =
        v.inviting_unit_id ?? v.invitingUnitId ?? v.unitId ?? null

      if (Array.isArray(authorizedUnitIds)) {
        if (!invitingUnitId || !authorizedUnitIds.includes(invitingUnitId)) continue
      }

      seenVisitorRecordIds.add(visitorRecordId)

      const resolvedVisitorName = String(v.full_name || v.fullName || v.attendeeName || 'Visitor').trim() || 'Visitor'
      const resolvedVisitorUnitName =
        v.stake_units?.unit_name ||
        (invitingUnitId ? unitMap.get(invitingUnitId) : undefined) ||
        v.invitingUnitName ||
        (invitingUnitId ? 'Unit' : 'Unassigned / No Inviting Unit')

      const rawClass = v.selected_class ?? v.selectedClass
      const cleanClass =
        typeof rawClass === 'string' && rawClass.trim().length > 0 ? rawClass.trim() : null

      allVisitorRecords.push({
        id: visitorRecordId,
        sessionId,
        fullName: resolvedVisitorName,
        contactPhone: v.contact_phone ?? v.contactPhone ?? null,
        isChurchMember: Boolean(v.is_church_member ?? v.isChurchMember ?? false),
        invitingUnitId,
        invitingUnitName: resolvedVisitorUnitName,
        selectedClass: cleanClass,
        checkInTime: v.created_at || v.checkInTime || new Date().toISOString()
      })
    }
  }

  // Skill Acquisition Class Breakdown across all valid records for the session
  const normalizedConfiguredClasses = normalizeClassOptions(configuredClasses)
  const classMap = new Map<string, LiveClassBreakdownRow>()
  for (const cls of normalizedConfiguredClasses) {
    classMap.set(cls.toLowerCase(), {
      className: cls,
      members: 0,
      visitors: 0,
      total: 0,
      isConfigured: true
    })
  }

  let unassignedClassMembers = 0
  let unassignedClassVisitors = 0

  for (const m of allMemberRecords) {
    const raw = m.selectedClass ? m.selectedClass.trim() : ''
    if (!raw) {
      unassignedClassMembers++
      continue
    }
    const key = raw.toLowerCase()
    const existing = classMap.get(key) || {
      className: raw,
      members: 0,
      visitors: 0,
      total: 0,
      isConfigured: false
    }
    existing.members++
    existing.total++
    classMap.set(key, existing)
  }

  for (const v of allVisitorRecords) {
    const raw = v.selectedClass ? v.selectedClass.trim() : ''
    if (!raw) {
      unassignedClassVisitors++
      continue
    }
    const key = raw.toLowerCase()
    const existing = classMap.get(key) || {
      className: raw,
      members: 0,
      visitors: 0,
      total: 0,
      isConfigured: false
    }
    existing.visitors++
    existing.total++
    classMap.set(key, existing)
  }

  const classBreakdown: LiveClassBreakdownRow[] = Array.from(classMap.values())
  if (
    unassignedClassMembers + unassignedClassVisitors > 0 &&
    (isSkillAcquisition || classBreakdown.length > 0)
  ) {
    classBreakdown.push({
      className: 'Unassigned / Not Specified',
      members: unassignedClassMembers,
      visitors: unassignedClassVisitors,
      total: unassignedClassMembers + unassignedClassVisitors,
      isConfigured: false
    })
  }

  // Filter records by active selectedClassFilter
  const filteredMemberRecords = allMemberRecords.filter((m) => {
    if (selectedClassFilter === 'all') return true
    if (selectedClassFilter === '__unassigned__') {
      return !m.selectedClass || !m.selectedClass.trim()
    }
    return (m.selectedClass || '').trim().toLowerCase() === selectedClassFilter.toLowerCase()
  })

  const filteredVisitorRecords = allVisitorRecords.filter((v) => {
    if (selectedClassFilter === 'all') return true
    if (selectedClassFilter === '__unassigned__') {
      return !v.selectedClass || !v.selectedClass.trim()
    }
    return (v.selectedClass || '').trim().toLowerCase() === selectedClassFilter.toLowerCase()
  })

  const memberCount = filteredMemberRecords.length
  const visitorCount = filteredVisitorRecords.length
  const totalValidCheckIns = memberCount + visitorCount

  // Distinct attendees using stable database IDs (never names alone)
  const distinctMemberIds = new Set(
    filteredMemberRecords.map((m) => m.memberId || `mem_rec:${m.id}`)
  )
  const distinctVisitorIds = new Set(
    filteredVisitorRecords.map((v) => `vis_rec:${v.id}`)
  )
  const distinctAttendeesCount = distinctMemberIds.size + distinctVisitorIds.size

  // Participating Units Breakdown (100% reconciled with filteredMemberRecords + filteredVisitorRecords)
  const baseUnitIds =
    participatingUnits && participatingUnits.length > 0
      ? [...participatingUnits]
      : units.map((u) => u.id)

  const orderedUnitIds: string[] = []
  const seenUnitIds = new Set<string>()

  for (const uid of baseUnitIds) {
    if (!uid || seenUnitIds.has(uid)) continue
    if (Array.isArray(authorizedUnitIds) && !authorizedUnitIds.includes(uid)) continue
    seenUnitIds.add(uid)
    orderedUnitIds.push(uid)
  }

  // Also include any unit ID referenced by a valid attendance record that wasn't in baseUnitIds
  for (const m of filteredMemberRecords) {
    if (m.unitId && !seenUnitIds.has(m.unitId)) {
      if (!Array.isArray(authorizedUnitIds) || authorizedUnitIds.includes(m.unitId)) {
        seenUnitIds.add(m.unitId)
        orderedUnitIds.push(m.unitId)
      }
    }
  }
  for (const v of filteredVisitorRecords) {
    if (v.invitingUnitId && !seenUnitIds.has(v.invitingUnitId)) {
      if (!Array.isArray(authorizedUnitIds) || authorizedUnitIds.includes(v.invitingUnitId)) {
        seenUnitIds.add(v.invitingUnitId)
        orderedUnitIds.push(v.invitingUnitId)
      }
    }
  }

  const unitBreakdown: LiveUnitBreakdownRow[] = orderedUnitIds.map((uid) => {
    const mCount = filteredMemberRecords.filter((m) => m.unitId === uid).length
    const vCount = filteredVisitorRecords.filter((v) => v.invitingUnitId === uid).length
    const fallbackName =
      filteredMemberRecords.find((m) => m.unitId === uid)?.unitName ||
      filteredVisitorRecords.find((v) => v.invitingUnitId === uid)?.invitingUnitName ||
      'Unit'
    return {
      unitId: uid,
      unitName: unitMap.get(uid) || fallbackName,
      members: mCount,
      visitors: vCount,
      total: mCount + vCount
    }
  })

  // Transparently account for any valid records without a unit (e.g., guests with inviting_unit_id = NULL)
  const unassignedUnitMembers = filteredMemberRecords.filter((m) => !m.unitId).length
  const unassignedUnitVisitors = filteredVisitorRecords.filter((v) => !v.invitingUnitId).length
  if (unassignedUnitMembers + unassignedUnitVisitors > 0) {
    unitBreakdown.push({
      unitId: '__unassigned_unit__',
      unitName: 'Unassigned / No Inviting Unit',
      members: unassignedUnitMembers,
      visitors: unassignedUnitVisitors,
      total: unassignedUnitMembers + unassignedUnitVisitors,
      isUnassigned: true
    })
  }

  // Build unified recent check-in stream (sorted newest first, tie-broken by ID)
  const buildRecentList = (
    memList: AttendanceRecord[],
    visList: LiveSessionComputedSnapshot['allVisitorRecords']
  ): RecentCheckInItem[] => {
    const list: RecentCheckInItem[] = []
    for (const m of memList) {
      list.push({
        id: m.id,
        attendeeId: m.memberId || m.id,
        attendeeName: m.attendeeName,
        attendeeType: 'member',
        unitId: m.unitId || null,
        unitName: m.unitName || 'Unit',
        selectedClass: m.selectedClass || null,
        checkInTime: m.checkInTime,
        isManual: Boolean(m.isManual)
      })
    }
    for (const v of visList) {
      list.push({
        id: v.id,
        attendeeId: v.id,
        attendeeName: v.fullName,
        attendeeType: 'visitor',
        unitId: v.invitingUnitId || null,
        unitName: v.invitingUnitName,
        selectedClass: v.selectedClass || null,
        checkInTime: v.checkInTime,
        isManual: false
      })
    }
    list.sort((a, b) => {
      const diff = new Date(b.checkInTime).getTime() - new Date(a.checkInTime).getTime()
      if (diff !== 0) return diff
      return a.id.localeCompare(b.id)
    })
    return list
  }

  const recentItems = buildRecentList(allMemberRecords, allVisitorRecords)
  const filteredRecentItems = buildRecentList(filteredMemberRecords, filteredVisitorRecords).slice(
    0,
    25
  )

  const unitSum = unitBreakdown.reduce((sum, u) => sum + u.total, 0)
  const allValidTotal = allMemberRecords.length + allVisitorRecords.length
  const classSum =
    classBreakdown.length > 0
      ? classBreakdown.reduce((sum, c) => sum + c.total, 0)
      : allValidTotal

  return {
    allMemberRecords,
    allVisitorRecords,
    filteredMemberRecords,
    filteredVisitorRecords,
    totalValidCheckIns,
    distinctAttendeesCount,
    memberCount,
    visitorCount,
    unitBreakdown,
    classBreakdown,
    recentItems,
    filteredRecentItems,
    reconciled: {
      memberVisitorReconciled: memberCount + visitorCount === totalValidCheckIns,
      unitBreakdownReconciled: unitSum === totalValidCheckIns,
      classBreakdownReconciled: classSum === allValidTotal
    }
  }
}

export const LiveActiveSessionView: React.FC<LiveActiveSessionViewProps> = ({
  session,
  activity,
  units,
  activeCode: propCode,
  onClose
}) => {
  const { hasStakeWideReadAccess, reportUnitFilter, assignedUnitIds } = useAuth()

  // Authorized unit filter for leader's scoping:
  // - Stake-wide roles (system_admin, stake_presidency, stake_clerk) have null filter (all units).
  // - Unit-scoped roles (ysa_leader, bishop, branch_president, ward_clerk, branch_clerk) are scoped to their assignedUnitIds.
  const authorizedUnitIds = useMemo<string[] | null>(() => {
    if (hasStakeWideReadAccess) return null
    if (reportUnitFilter !== null) return reportUnitFilter
    return assignedUnitIds
  }, [hasStakeWideReadAccess, reportUnitFilter, assignedUnitIds])

  // Session code: prioritize prop, fallback to persistent storage
  const [currentCode] = useState<string | null>(() => {
    if (propCode) return propCode
    return getActiveSessionCode(session.id)
  })

  // Raw authoritative database rows
  const [rawMemberRows, setRawMemberRows] = useState<any[]>([])
  const [rawVisitorRows, setRawVisitorRows] = useState<any[]>([])
  const [memberDirectoryMap, setMemberDirectoryMap] = useState<
    Map<string, { fullName: string; homeUnitId?: string | null }>
  >(() => new Map())

  const [selectedClassFilter, setSelectedClassFilter] = useState<string>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [statusState, setStatusState] = useState<'live' | 'refreshing' | 'stale'>('refreshing')
  const [realtimeSubscribed, setRealtimeSubscribed] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [feedbackToast, setFeedbackToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Monotonic sequence counter to discard out-of-order concurrent responses
  const requestSeqRef = useRef(0)

  const configuredClasses = useMemo(
    () => normalizeClassOptions(session.classOptions ?? activity?.classOptions),
    [session.classOptions, activity?.classOptions]
  )

  const isSkillAcquisition = useMemo(
    () =>
      isSkillAcquisitionActivity({
        category: session.activityCategory ?? activity?.category,
        title: session.activityTitle ?? activity?.title ?? session.sessionTitle,
        classOptions: configuredClasses
      }),
    [
      session.activityCategory,
      session.activityTitle,
      session.sessionTitle,
      activity?.category,
      activity?.title,
      configuredClasses
    ]
  )

  // Clear feedback toast after 4s
  useEffect(() => {
    if (feedbackToast) {
      const t = setTimeout(() => setFeedbackToast(null), 4000)
      return () => clearTimeout(t)
    }
  }, [feedbackToast])

  // Authoritative data fetcher
  const fetchAuthoritativeData = useCallback(
    async (silent = false) => {
      const seq = ++requestSeqRef.current

      if (!silent) {
        setIsRefreshing(true)
        setStatusState('refreshing')
      }

      // If unit-scoped user has 0 assigned units, return empty authoritative snapshot immediately
      if (Array.isArray(authorizedUnitIds) && authorizedUnitIds.length === 0) {
        if (seq === requestSeqRef.current) {
          setRawMemberRows([])
          setRawVisitorRows([])
          setHasLoadedOnce(true)
          setLastUpdated(new Date().toISOString())
          setErrorMessage(null)
          setIsLoading(false)
          setIsRefreshing(false)
          setStatusState('live')
        }
        return
      }

      try {
        // 1. Fetch Member Attendance Records for this session using ONLY actual schema columns
        let attQuery = supabase
          .from('attendance_records')
          .select(
            'id, session_id, member_id, recorded_unit_id, recorded_by_terminal_id, selected_class, check_in_time, created_at, members(id, full_name, preferred_name, member_number, home_unit_id)'
          )
          .eq('session_id', session.id)

        if (Array.isArray(authorizedUnitIds) && authorizedUnitIds.length > 0) {
          attQuery = attQuery.in('recorded_unit_id', authorizedUnitIds)
        }

        // 2. Fetch Visitor Records for this session
        let visQuery = supabase
          .from('session_visitors')
          .select(
            'id, session_id, full_name, contact_phone, is_church_member, inviting_unit_id, selected_class, created_at, recorded_by_terminal_id'
          )
          .eq('session_id', session.id)

        if (Array.isArray(authorizedUnitIds) && authorizedUnitIds.length > 0) {
          visQuery = visQuery.in('inviting_unit_id', authorizedUnitIds)
        }

        const [attRes, visRes] = await Promise.all([attQuery, visQuery])

        if (attRes.error) throw attRes.error
        if (visRes.error) throw visRes.error

        const rawAtt = attRes.data || []
        const rawVis = visRes.data || []

        // If any member attendance row is missing embedded member full_name, resolve from public.members
        const missingMemberIds = Array.from(
          new Set(
            rawAtt
              .filter((r: any) => r?.member_id && !r?.members?.full_name && !r?.attendee_name)
              .map((r: any) => String(r.member_id))
          )
        )

        const nextDirectoryMap = new Map<string, { fullName: string; homeUnitId?: string | null }>()
        if (missingMemberIds.length > 0) {
          const memQuery = supabase
            .from('members')
            .select('id, full_name, home_unit_id')
            .in('id', missingMemberIds)
          if (memQuery && typeof memQuery.then === 'function') {
            const { data: rawMembers } = await memQuery
            for (const m of rawMembers || []) {
              if (m?.id) {
                nextDirectoryMap.set(String(m.id), {
                  fullName: m.full_name || 'Member',
                  homeUnitId: m.home_unit_id || null
                })
              }
            }
          }
        }

        // Ignore stale out-of-order response
        if (seq !== requestSeqRef.current) return

        setMemberDirectoryMap(nextDirectoryMap)
        setRawMemberRows(rawAtt)
        setRawVisitorRows(rawVis)
        setHasLoadedOnce(true)
        setErrorMessage(null)
        setLastUpdated(new Date().toISOString())
        setStatusState('live')
      } catch (err: unknown) {
        if (seq !== requestSeqRef.current) return
        setStatusState('stale')
        setErrorMessage(humanizeErrorMessage(err, 'Could not refresh live attendance records.'))
      } finally {
        if (seq === requestSeqRef.current) {
          setIsLoading(false)
          setIsRefreshing(false)
        }
      }
    },
    [session.id, authorizedUnitIds]
  )

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
          setRealtimeSubscribed(true)
          setStatusState((prev) => (prev === 'stale' ? 'live' : prev))
        } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          setRealtimeSubscribed(false)
          setStatusState('stale')
        }
      })

    // Bounded polling fallback: runs every 10 seconds only when tab is visible
    const pollingInterval = setInterval(() => {
      if (!mounted) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
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

  // Compute reconciled live session metrics from authoritative records
  const snapshot = useMemo(
    () =>
      computeLiveSessionMetrics({
        sessionId: session.id,
        sessionStatus: session.status,
        rawMemberRows,
        rawVisitorRows,
        units,
        participatingUnits: session.participatingUnits,
        authorizedUnitIds,
        configuredClasses,
        isSkillAcquisition,
        selectedClassFilter,
        memberDirectoryMap
      }),
    [
      session.id,
      session.status,
      rawMemberRows,
      rawVisitorRows,
      units,
      session.participatingUnits,
      authorizedUnitIds,
      configuredClasses,
      isSkillAcquisition,
      selectedClassFilter,
      memberDirectoryMap
    ]
  )

  const {
    allMemberRecords,
    allVisitorRecords,
    filteredMemberRecords,
    filteredVisitorRecords,
    totalValidCheckIns,
    distinctAttendeesCount,
    memberCount,
    visitorCount,
    unitBreakdown,
    classBreakdown,
    filteredRecentItems
  } = snapshot

  const hasAnyClassData = isSkillAcquisition || classBreakdown.some((c) => c.total > 0)
  const initialLoadFailed = !isLoading && !hasLoadedOnce && Boolean(errorMessage)

  // Export Live Session Records (respecting active class filter)
  const handleExportLiveSession = async (format: 'csv' | 'xlsx') => {
    const exportRows = [
      ...filteredMemberRecords.map((m) => ({
        attendeeName: m.attendeeName,
        attendeeType: 'Member',
        unitName: m.unitName || 'Unit',
        selectedClass: m.selectedClass || 'N/A',
        checkInTime: formatLagosTimestampDisplay(m.checkInTime),
        source: m.isManual ? 'Manual' : 'Terminal'
      })),
      ...filteredVisitorRecords.map((v) => ({
        attendeeName: v.fullName || 'Visitor',
        attendeeType: 'Visitor',
        unitName: v.invitingUnitName || 'Unassigned / No Inviting Unit',
        selectedClass: v.selectedClass || 'N/A',
        checkInTime: formatLagosTimestampDisplay(v.checkInTime),
        source: 'Terminal'
      }))
    ]

    const metadata = {
      title: `${session.sessionTitle}${selectedClassFilter !== 'all' ? ` — Class: ${selectedClassFilter}` : ''}`,
      subtitle: 'Abeokuta Nigeria Obantoko Stake — Live Session Attendance Register',
      generatedAt: formatLagosTimestampDisplay(new Date().toISOString()),
      periodLabel: session.sessionDate,
      scopeLabel: selectedClassFilter === 'all' ? 'All Classes' : `Class: ${selectedClassFilter}`,
      totalRecords: exportRows.length,
      uniqueAttendees: distinctAttendeesCount
    }

    const cols = [
      { key: 'attendeeName', label: 'Attendee Name' },
      { key: 'attendeeType', label: 'Classification' },
      { key: 'unitName', label: 'Unit' },
      { key: 'selectedClass', label: 'Skill Acquisition Class' },
      { key: 'checkInTime', label: 'Check-In Time (Lagos)' },
      { key: 'source', label: 'Entry Source' }
    ]

    const baseName = `live_session_${session.sessionDate}${selectedClassFilter !== 'all' ? `_${selectedClassFilter.replace(/\s+/g, '_').toLowerCase()}` : ''}`
    if (format === 'csv') {
      exportToCsvAdvanced(baseName, metadata, cols, exportRows)
    } else {
      await exportToXlsxAdvanced(baseName, metadata, cols, exportRows)
    }
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

  const renderMetricValue = (val: number) => {
    if (isLoading) return '...'
    if (initialLoadFailed) return '—'
    return val
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
            {isSkillAcquisition && (
              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700/60">
                <BookOpen className="w-3 h-3" />
                <span>Multi-Class Skill Acquisition</span>
              </span>
            )}
          </div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{session.sessionTitle}</h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status & Freshness Indicator */}
          <div
            className="inline-flex items-center space-x-2 px-3 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
            data-testid="live-monitor-connection-status"
          >
            {statusState === 'live' && !errorMessage && (
              <>
                <Radio className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 animate-pulse" />
                <span className="font-medium text-emerald-700 dark:text-emerald-400">
                  {realtimeSubscribed ? 'Live (Realtime + Sync)' : 'Live (Auto-Sync)'}
                </span>
              </>
            )}
            {statusState === 'refreshing' && (
              <>
                <RefreshCw className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 animate-spin" />
                <span className="font-medium text-blue-600 dark:text-blue-400">Refreshing</span>
              </>
            )}
            {(statusState === 'stale' || Boolean(errorMessage)) && statusState !== 'refreshing' && (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span className="font-medium text-amber-600 dark:text-amber-400">
                  {hasLoadedOnce ? 'Stale — Reconnecting' : 'Connection Error'}
                </span>
              </>
            )}
            <span className="text-[10px] text-slate-400 font-mono">
              {lastUpdated
                ? `Updated ${formatLagosTimestampDisplay(lastUpdated)}`
                : 'Awaiting initial sync'}
            </span>
          </div>

          {/* Class-level / Session Export Buttons */}
          <button
            type="button"
            onClick={() => handleExportLiveSession('csv')}
            disabled={totalValidCheckIns === 0 || initialLoadFailed}
            className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-40 text-xs font-semibold text-slate-700 dark:text-slate-200 transition"
            title="Export live attendance to CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>
          <button
            type="button"
            onClick={() => handleExportLiveSession('xlsx')}
            disabled={totalValidCheckIns === 0 || initialLoadFailed}
            className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-40 text-xs font-semibold text-slate-700 dark:text-slate-200 transition"
            title="Export live attendance to Excel"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Excel</span>
          </button>

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
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/80 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between gap-3"
        >
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              {errorMessage}
              {hasLoadedOnce && lastUpdated
                ? ` Showing last verified snapshot from ${formatLagosTimestampDisplay(lastUpdated)}.`
                : ' Attendance figures cannot be displayed until connection is restored.'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => fetchAuthoritativeData(false)}
            className="px-2.5 py-1 rounded-lg bg-amber-200/60 dark:bg-amber-900/70 hover:bg-amber-200 dark:hover:bg-amber-800 text-amber-900 dark:text-amber-200 font-semibold shrink-0"
          >
            Retry Now
          </button>
        </div>
      )}

      {/* Session Code & Link Bar */}
      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 rounded-lg">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold block">
              Active Check-In Code {isSkillAcquisition ? '(Shared Across All Skill Classes)' : ''}
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
          <div
            data-testid="live-metric-total-checkins"
            className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1"
          >
            {renderMetricValue(totalValidCheckIns)}
          </div>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">
            {initialLoadFailed
              ? 'Failed to load records'
              : selectedClassFilter === 'all'
              ? 'Authoritative records'
              : `Filtered: ${selectedClassFilter}`}
          </span>
        </div>

        <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Distinct Attendees</span>
          <div
            data-testid="live-metric-distinct-attendees"
            className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-400 mt-1"
          >
            {renderMetricValue(distinctAttendeesCount)}
          </div>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">Deduplicated identity</span>
        </div>

        <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Church Members</span>
          <div
            data-testid="live-metric-members"
            className="text-2xl font-extrabold text-blue-700 dark:text-blue-400 mt-1"
          >
            {renderMetricValue(memberCount)}
          </div>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">Census-verified</span>
        </div>

        <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Visitors & Guests</span>
          <div
            data-testid="live-metric-visitors"
            className="text-2xl font-extrabold text-purple-700 dark:text-purple-400 mt-1"
          >
            {renderMetricValue(visitorCount)}
          </div>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">Invited guests</span>
        </div>
      </div>

      {/* Live Attendance by Skill Acquisition Class */}
      {hasAnyClassData && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              <BookOpen className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Attendance by Skill Acquisition Class
              </h3>
            </div>
            <div className="flex items-center space-x-2">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <label htmlFor="live-class-filter" className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Filter Class:
              </label>
              <select
                id="live-class-filter"
                aria-label="Filter by Skill Acquisition Class"
                value={selectedClassFilter}
                onChange={(e) => setSelectedClassFilter(e.target.value)}
                className="px-2.5 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200"
              >
                <option value="all">
                  All Classes ({allMemberRecords.length + allVisitorRecords.length})
                </option>
                {classBreakdown.map((c) => {
                  const val = c.className === 'Unassigned / Not Specified' ? '__unassigned__' : c.className
                  return (
                    <option key={c.className} value={val}>
                      {c.className} ({c.total})
                    </option>
                  )
                })}
              </select>
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 uppercase text-[10px] text-slate-600 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5">Skill Acquisition Class</th>
                  <th className="px-4 py-2.5 text-center">Members</th>
                  <th className="px-4 py-2.5 text-center">Visitors</th>
                  <th className="px-4 py-2.5 text-right font-bold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {classBreakdown.map((cls) => {
                  const filterVal = cls.className === 'Unassigned / Not Specified' ? '__unassigned__' : cls.className
                  const isSelected = selectedClassFilter === filterVal
                  return (
                    <tr
                      key={cls.className}
                      onClick={() => setSelectedClassFilter(isSelected ? 'all' : filterVal)}
                      className={`cursor-pointer transition ${
                        isSelected
                          ? 'bg-emerald-50/80 dark:bg-emerald-950/40'
                          : 'hover:bg-slate-100/50 dark:hover:bg-slate-900/50'
                      }`}
                    >
                      <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-200">
                        <span>{cls.className}</span>
                        {!cls.isConfigured && cls.className !== 'Unassigned / Not Specified' && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                            Historical
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center text-slate-700 dark:text-slate-300">{cls.members}</td>
                      <td className="px-4 py-2.5 text-center text-slate-700 dark:text-slate-300">{cls.visitors}</td>
                      <td className="px-4 py-2.5 text-right font-bold text-emerald-700 dark:text-emerald-400">{cls.total}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-slate-100/80 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-800 font-bold text-slate-900 dark:text-white">
                <tr>
                  <td className="px-4 py-2">Reconciled Session Total</td>
                  <td className="px-4 py-2 text-center">{allMemberRecords.length}</td>
                  <td className="px-4 py-2 text-center">{allVisitorRecords.length}</td>
                  <td className="px-4 py-2 text-right text-emerald-700 dark:text-emerald-400">
                    {allMemberRecords.length + allVisitorRecords.length}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

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
                      {initialLoadFailed
                        ? 'Unable to load unit breakdown.'
                        : 'No participating units registered for this session.'}
                    </td>
                  </tr>
                ) : (
                  unitBreakdown.map((u) => (
                    <tr key={u.unitId} className="hover:bg-slate-100/50 dark:hover:bg-slate-900/50">
                      <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-200">
                        <span>{u.unitName}</span>
                        {u.isUnassigned && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                            No Unit Specified
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center text-slate-700 dark:text-slate-300">{u.members}</td>
                      <td className="px-4 py-2.5 text-center text-slate-700 dark:text-slate-300">{u.visitors}</td>
                      <td className="px-4 py-2.5 text-right font-bold text-emerald-700 dark:text-emerald-400">{u.total}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {unitBreakdown.length > 0 && !initialLoadFailed && (
                <tfoot className="bg-slate-100/80 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-800 font-bold text-slate-900 dark:text-white">
                  <tr>
                    <td className="px-4 py-2">Reconciled Unit Total</td>
                    <td className="px-4 py-2 text-center">{memberCount}</td>
                    <td className="px-4 py-2 text-center">{visitorCount}</td>
                    <td className="px-4 py-2 text-right text-emerald-700 dark:text-emerald-400">
                      {totalValidCheckIns}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Recent Live Check-Ins Stream */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Recent Check-Ins ({initialLoadFailed ? '—' : filteredRecentItems.length})
              </h3>
            </div>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Realtime stream</span>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden max-h-[300px] overflow-y-auto">
            {filteredRecentItems.length === 0 ? (
              <div className="p-8 text-center text-slate-500 italic text-xs">
                {isLoading
                  ? 'Loading check-ins...'
                  : initialLoadFailed
                  ? 'Unable to load attendance records. Please check your connection and retry.'
                  : 'No attendees checked in yet for this session.'}
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredRecentItems.map((item) => (
                  <div
                    key={`${item.attendeeType}-${item.id}`}
                    className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-100/60 dark:hover:bg-slate-900/50 text-xs"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center flex-wrap gap-1.5">
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
                        {item.selectedClass && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                            {item.selectedClass}
                          </span>
                        )}
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
