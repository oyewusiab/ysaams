import React, { useState, useEffect } from 'react'
import {
  LayoutDashboard,
  Calendar,
  ClipboardCheck,
  Users,
  BarChart3,
  Building2,
  UserCog,
  FileText,
  Settings,
  Lock,
  ArrowRight,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  UserCheck,
  Plus,
  Download,
  Shield,
  Printer,
  Copy,
  X
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import {
  LeadershipRoute,
  StakeUnit,
  UserProfile,
  MemberRecord,
  ActivityDefinition,
  ActivitySession,
  AppRole,
  SessionVisitor
} from '../../types/database'
import { authService } from '../../services/authService'
import { adminService } from '../../services/adminService'
import { memberService } from '../../services/memberService'
import { activityService } from '../../services/activityService'
import { attendanceService } from '../../services/attendanceService'
import {
  reportService,
  UnitMonthlyStat,
  IndividualAttendanceHistory
} from '../../services/reportService'

interface LeadershipPortalViewProps {
  currentSubpath: LeadershipRoute
  onNavigateSubpath: (subpath: LeadershipRoute) => void
}

export const LeadershipPortalView: React.FC<LeadershipPortalViewProps> = ({
  currentSubpath,
  onNavigateSubpath
}) => {
  const {
    isAuthenticated,
    user,
    isSystemAdmin,
    isStakeLeader,
    hasStakeWideReadAccess,
    canManageActivities,
    canManageMembers,
    canRecordManualAttendance,
    manageableUnitIds,
    reportUnitFilter
  } = useAuth()

  // Sign In & Recovery State
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginNotice, setLoginNotice] = useState<string | null>(null)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [isResetMode, setIsResetMode] = useState(false)

  // Common Data State
  const [units, setUnits] = useState<StakeUnit[]>([])
  const [members, setMembers] = useState<MemberRecord[]>([])
  const [activities, setActivities] = useState<ActivityDefinition[]>([])
  const [sessions, setSessions] = useState<ActivitySession[]>([])
  const [usersList, setUsersList] = useState<UserProfile[]>([])
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [stakeSummary, setStakeSummary] = useState<any>(null)
  const [unitMonthlyStats, setUnitMonthlyStats] = useState<UnitMonthlyStat[]>([])
  const [visitorsList, setVisitorsList] = useState<(SessionVisitor & { sessionTitle?: string; sessionDate?: string })[]>([])

  // Reports Filter & Individual Lookup State
  const [reportYear, setReportYear] = useState(() => new Date().getFullYear())
  const [reportMonth, setReportMonth] = useState(() => new Date().getMonth() + 1)
  const [selectedHistoryMemberId, setSelectedHistoryMemberId] = useState('')
  const [memberHistory, setMemberHistory] = useState<IndividualAttendanceHistory | null>(null)

  // Action / Form States
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [, setIsLoadingData] = useState(false)

  // 1. Attendance Manual Check-in
  const [manualSessionId, setManualSessionId] = useState('')
  const [manualMemberId, setManualMemberId] = useState('')
  const [manualNotes, setManualNotes] = useState('')
  const [isSubmittingManual, setIsSubmittingManual] = useState(false)

  // 2. Unit Management Form
  const [newUnitName, setNewUnitName] = useState('')
  const [newUnitType, setNewUnitType] = useState<'ward' | 'branch'>('ward')

  // 3. User Governance Form
  const [assignUserId, setAssignUserId] = useState('')
  const [assignRole, setAssignRole] = useState<AppRole>('ysa_leader')
  const [assignUnitId, setAssignUnitId] = useState('')

  // 4. Member Census Form
  const [newMemberName, setNewMemberName] = useState('')
  const [newMemberPrefName, setNewMemberPrefName] = useState('')
  const [newMemberPhone, setNewMemberPhone] = useState('')
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [newMemberGender, setNewMemberGender] = useState<'male' | 'female'>('male')
  const [newMemberUnitId, setNewMemberUnitId] = useState('')
  const [newMemberNumber, setNewMemberNumber] = useState('')

  // 5. Activity Creation Form
  const [newActTitle, setNewActTitle] = useState('')
  const [newActCategory, setNewActCategory] = useState<'spiritual' | 'social' | 'service' | 'sports' | 'temple' | 'educational' | 'other'>('spiritual')
  const [newActDesc, setNewActDesc] = useState('')

  // 6. Session Creation Form
  const [newSessActivityId, setNewSessActivityId] = useState('')
  const [newSessTitle, setNewSessTitle] = useState('')
  const [newSessDate, setNewSessDate] = useState(() => new Date().toISOString().split('T')[0])
  const [newSessStartTime, setNewSessStartTime] = useState('16:00')
  const [newSessMaxTerminals, setNewSessMaxTerminals] = useState(2)
  const [newSessVisitorEnabled, setNewSessVisitorEnabled] = useState(true)
  const [newSessSelectedUnits, setNewSessSelectedUnits] = useState<string[]>([])

  // 7. Initiate & Reopen Session State
  const [activeSessionCodes, setActiveSessionCodes] = useState<Record<string, string>>({})
  const [reopenReason, setReopenReason] = useState('')
  const [reopenSessionId, setReopenSessionId] = useState('')

  const unitFilter: string[] | null = reportUnitFilter

  const loadCurrentSubpathData = async () => {
    if (!isAuthenticated) return
    setIsLoadingData(true)
    try {
      if (currentSubpath === 'dashboard') {
        const [sum, sList] = await Promise.all([
          reportService.getStakeSummary(unitFilter),
          activityService.listSessions()
        ])
        setStakeSummary(sum)
        setSessions(sList.slice(0, 5))
      } else if (currentSubpath === 'units') {
        const uList = await adminService.listUnits()
        setUnits(uList)
      } else if (currentSubpath === 'members') {
        const [uList, mList] = await Promise.all([
          adminService.listUnits(),
          memberService.listMembers(unitFilter)
        ])
        setUnits(uList)
        setMembers(mList)
        if (!isStakeLeader && manageableUnitIds.length === 1 && !newMemberUnitId) {
          setNewMemberUnitId(manageableUnitIds[0])
        }
      } else if (currentSubpath === 'activities') {
        const [uList, aList, sList] = await Promise.all([
          adminService.listUnits(),
          activityService.listActivities(),
          activityService.listSessions()
        ])
        setUnits(uList)
        setActivities(aList)
        setSessions(sList)
      } else if (currentSubpath === 'attendance') {
        const [sList, mList] = await Promise.all([
          activityService.listSessions(),
          memberService.listMembers(isStakeLeader ? null : manageableUnitIds)
        ])
        const activeSessions = sList.filter(s => s.status === 'active')
        setSessions(activeSessions)
        setMembers(mList.filter(m => m.isActive))
        if (activeSessions.length > 0 && !manualSessionId) {
          setManualSessionId(activeSessions[0].id)
        }
      } else if (currentSubpath === 'reports') {
        const [stats, mList, vList] = await Promise.all([
          reportService.getUnitMonthlyRegister(reportYear, reportMonth, unitFilter),
          memberService.listMembers(unitFilter),
          reportService.listSessionVisitors(unitFilter)
        ])
        setUnitMonthlyStats(stats)
        setMembers(mList)
        setVisitorsList(vList)
      } else if (currentSubpath === 'users') {
        if (isStakeLeader) {
          const [uList, userProfiles] = await Promise.all([
            adminService.listUnits(),
            adminService.listUsers()
          ])
          setUnits(uList)
          setUsersList(userProfiles)
        }
      } else if (currentSubpath === 'audit-logs') {
        if (isStakeLeader) {
          const logs = await adminService.listAuditLogs(100)
          setAuditLogs(logs)
        }
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Failed to load module data' })
    } finally {
      setIsLoadingData(false)
    }
  }

  useEffect(() => {
    setStatusMsg(null)
    loadCurrentSubpathData()
  }, [currentSubpath, isAuthenticated, reportYear, reportMonth])

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError(null)
    setLoginNotice(null)

    if (isResetMode) {
      if (!loginEmail.trim()) {
        setLoginError('Please enter your leadership email address to receive a recovery link.')
        return
      }
      setIsLoggingIn(true)
      const resetRes = await authService.resetPasswordForEmail(loginEmail)
      setIsLoggingIn(false)
      if (resetRes.success) {
        setLoginNotice('Password recovery instructions have been sent to your email address.')
        setIsResetMode(false)
      } else {
        setLoginError(resetRes.error || 'Failed to send password reset email.')
      }
      return
    }

    if (!loginEmail.trim() || !loginPassword) {
      setLoginError('Email and password are required.')
      return
    }

    setIsLoggingIn(true)
    const res = await authService.signInWithPassword(loginEmail, loginPassword)
    setIsLoggingIn(false)

    if (!res.success) {
      setLoginError(res.error || 'Failed to sign in. Please verify your credentials.')
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
          <div className="text-center mb-6">
            <div className="w-14 h-14 bg-emerald-950/80 border border-emerald-500/30 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Lock className="w-7 h-7" />
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Leadership Portal</h2>
            <p className="text-sm text-slate-400 mt-1">
              Authorized stake presidency, bishops, branch presidents & YSA leaders only.
            </p>
          </div>

          <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl mb-6 text-xs text-slate-400 flex items-start space-x-2.5">
            <ShieldAlert className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <span>
              Self-signup is disabled. Privileged accounts must be provisioned by a Stake System Administrator.
            </span>
          </div>

          {loginError && (
            <div className="mb-4 p-3 bg-red-950/70 border border-red-800 rounded-xl text-xs text-red-200 flex items-center space-x-2" role="alert">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          {loginNotice && (
            <div className="mb-4 p-3 bg-emerald-950/70 border border-emerald-800 rounded-xl text-xs text-emerald-200 flex items-center space-x-2" role="status">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>{loginNotice}</span>
            </div>
          )}

          <form onSubmit={handleSignIn} className="space-y-4">
            <div>
              <label htmlFor="leader-email" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Leader Email
              </label>
              <input
                id="leader-email"
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="leader@churchofjesuschrist.org"
                required
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              />
            </div>

            {!isResetMode && (
              <div>
                <label htmlFor="leader-password" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Password
                </label>
                <input
                  id="leader-password"
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl shadow-lg shadow-emerald-900/30 flex items-center justify-center space-x-2 transition text-sm disabled:opacity-50"
            >
              <span>
                {isLoggingIn
                  ? 'Processing...'
                  : isResetMode
                  ? 'Send Recovery Link'
                  : 'Sign In to Portal'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsResetMode(!isResetMode)
                  setLoginError(null)
                  setLoginNotice(null)
                }}
                className="text-xs text-slate-400 hover:text-emerald-400 transition"
              >
                {isResetMode ? 'Return to Password Sign In' : 'Forgot password? Request recovery link'}
              </button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  const navItems: { id: LeadershipRoute; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'activities', label: 'Activities & Sessions', icon: Calendar },
    { id: 'attendance', label: 'Authorized Check-in', icon: ClipboardCheck },
    { id: 'members', label: 'Member Census', icon: Users },
    { id: 'reports', label: 'Reports & Export', icon: BarChart3 },
    { id: 'units', label: 'Stake Units', icon: Building2 },
    { id: 'users', label: 'User Governance', icon: UserCog },
    { id: 'audit-logs', label: 'Audit Trail', icon: FileText },
    { id: 'settings', label: 'Settings', icon: Settings }
  ]

  // Scoped units available when registering members (strictly manageable units, excluding clerk-only assignments)
  const memberCreatableUnits = isStakeLeader
    ? units.filter(u => u.isActive)
    : units.filter(u => u.isActive && manageableUnitIds.includes(u.id))

  // Scoped members eligible for the currently selected manual check-in session
  const selectedManualSession = sessions.find(s => s.id === manualSessionId)
  const eligibleManualMembers = members.filter(m => {
    if (!m.isActive) return false
    if (
      selectedManualSession?.participatingUnits &&
      selectedManualSession.participatingUnits.length > 0
    ) {
      return selectedManualSession.participatingUnits.includes(m.homeUnitId)
    }
    return true
  })

  // Handlers for modules
  const handleCreateUnit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isSystemAdmin || !newUnitName.trim()) return
    try {
      const createdName = newUnitName.trim()
      await adminService.createUnit(createdName, newUnitType)
      setNewUnitName('')
      await loadCurrentSubpathData()
      setStatusMsg({ type: 'success', text: `Unit "${createdName}" successfully created.` })
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Failed to create unit' })
    }
  }

  const handleToggleUnitStatus = async (unit: StakeUnit) => {
    if (!isSystemAdmin) return
    try {
      await adminService.toggleUnitActive(unit.id, !unit.isActive)
      await loadCurrentSubpathData()
      setStatusMsg({
        type: 'success',
        text: `Unit "${unit.unitName}" ${!unit.isActive ? 'activated' : 'deactivated'}.`
      })
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Failed to update unit status' })
    }
  }

  const handleCreateMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canManageMembers) {
      setStatusMsg({ type: 'error', text: 'Unauthorized: Clerk accounts have read-only access and cannot modify member census.' })
      return
    }
    if (!newMemberName.trim() || !newMemberUnitId) {
      setStatusMsg({ type: 'error', text: 'Full name and home unit are required.' })
      return
    }
    if (!isStakeLeader && !manageableUnitIds.includes(newMemberUnitId)) {
      setStatusMsg({ type: 'error', text: 'Unauthorized: You can only register members into your assigned ward or branch.' })
      return
    }
    try {
      await memberService.createMember({
        fullName: newMemberName,
        preferredName: newMemberPrefName || undefined,
        gender: newMemberGender,
        phoneNumber: newMemberPhone || undefined,
        email: newMemberEmail || undefined,
        homeUnitId: newMemberUnitId,
        memberNumber: newMemberNumber || undefined
      })
      setNewMemberName('')
      setNewMemberPrefName('')
      setNewMemberPhone('')
      setNewMemberEmail('')
      setNewMemberNumber('')
      await loadCurrentSubpathData()
      setStatusMsg({ type: 'success', text: 'Member record registered in census.' })
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Failed to register member' })
    }
  }

  const handleCreateActivity = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canManageActivities || !newActTitle.trim()) return
    try {
      await activityService.createActivity(
        {
          title: newActTitle,
          category: newActCategory,
          description: newActDesc
        },
        user!.id
      )
      setNewActTitle('')
      setNewActDesc('')
      await loadCurrentSubpathData()
      setStatusMsg({ type: 'success', text: 'Activity definition created.' })
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Failed to create activity' })
    }
  }

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canManageActivities) return
    if (!newSessActivityId || !newSessTitle.trim()) {
      setStatusMsg({ type: 'error', text: 'Activity and session title are required.' })
      return
    }
    try {
      const clampedTerminals = Math.min(Math.max(1, Number(newSessMaxTerminals) || 2), 10)
      await activityService.createSession({
        activityId: newSessActivityId,
        sessionTitle: newSessTitle,
        sessionDate: newSessDate,
        startTime: newSessStartTime,
        maxTerminals: clampedTerminals,
        visitorRegistrationEnabled: newSessVisitorEnabled,
        participatingUnits: newSessSelectedUnits.length > 0 ? newSessSelectedUnits : null
      })
      setNewSessTitle('')
      setNewSessSelectedUnits([])
      await loadCurrentSubpathData()
      setStatusMsg({ type: 'success', text: 'New activity session scheduled.' })
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Failed to schedule session' })
    }
  }

  const handleInitiateSession = async (session: ActivitySession) => {
    if (!canManageActivities) return
    const code = activityService.generateCode()
    const maxTerminals = Math.min(Math.max(1, session.maxTerminals || 2), 10)
    try {
      const res = await activityService.initiateSession(session.id, code, maxTerminals)
      if (res.success) {
        setActiveSessionCodes(prev => ({ ...prev, [session.id]: code }))
        await loadCurrentSubpathData()
        setStatusMsg({
          type: 'success',
          text: `Session "${session.sessionTitle}" activated with 6-character code: ${code} (Max terminals: ${maxTerminals})`
        })
      } else {
        setStatusMsg({ type: 'error', text: res.error || 'Failed to initiate session' })
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Failed to initiate session' })
    }
  }

  const handleCloseSession = async (sessionId: string) => {
    if (!canManageActivities) return
    try {
      const res = await activityService.closeSession(sessionId)
      if (res.success) {
        setActiveSessionCodes(prev => {
          const next = { ...prev }
          delete next[sessionId]
          return next
        })
        await loadCurrentSubpathData()
        setStatusMsg({ type: 'success', text: 'Session closed and active terminal leases revoked.' })
      } else {
        setStatusMsg({ type: 'error', text: res.error || 'Failed to close session' })
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Failed to close session' })
    }
  }

  const handleReopenSession = async (sessionId: string) => {
    if (!isStakeLeader) return
    if (!reopenReason.trim() || reopenReason.trim().length < 5) {
      setStatusMsg({ type: 'error', text: 'A justification reason of at least 5 characters is required to reopen a closed session.' })
      return
    }
    try {
      const res = await activityService.reopenSession(sessionId, reopenReason)
      if (res.success) {
        setReopenSessionId('')
        setReopenReason('')
        await loadCurrentSubpathData()
        setStatusMsg({ type: 'success', text: 'Session reopened and audited successfully.' })
      } else {
        setStatusMsg({ type: 'error', text: res.error || 'Failed to reopen session' })
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Failed to reopen session' })
    }
  }

  const handleManualCheckIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canRecordManualAttendance) {
      setStatusMsg({ type: 'error', text: 'Unauthorized: Clerk accounts are read-only and cannot record manual check-ins.' })
      return
    }
    if (!manualSessionId.trim() || !manualMemberId.trim()) {
      setStatusMsg({ type: 'error', text: 'Active session and member are required.' })
      return
    }
    setIsSubmittingManual(true)
    setStatusMsg(null)
    const result = await attendanceService.recordManualAttendance({
      sessionId: manualSessionId.trim(),
      memberId: manualMemberId.trim(),
      notes: manualNotes.trim() || undefined
    })
    setIsSubmittingManual(false)
    if (result.success && result.record) {
      setStatusMsg({
        type: 'success',
        text: `Checked in: ${result.record.attendeeName} marked present.`
      })
      setManualMemberId('')
      setManualNotes('')
    } else {
      setStatusMsg({
        type: 'error',
        text: result.error || 'Failed to record manual check-in.'
      })
    }
  }

  const handleLoadMemberHistory = async (memberId: string) => {
    setSelectedHistoryMemberId(memberId)
    if (!memberId) {
      setMemberHistory(null)
      return
    }
    try {
      const history = await reportService.getIndividualHistory(memberId, unitFilter)
      setMemberHistory(history)
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Failed to load individual member history' })
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Sub-navigation bar */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-4 mb-8 border-b border-slate-800 scrollbar-none">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = currentSubpath === item.id
          return (
            <button
              key={item.id}
              onClick={() => onNavigateSubpath(item.id)}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
                isActive
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>

      {/* Main Container */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-slate-800 gap-4">
          <div>
            <span className="text-xs font-mono uppercase tracking-widest text-emerald-400 font-semibold">
              Leadership Portal • /la/{currentSubpath}
            </span>
            <h2 className="text-2xl font-bold text-white capitalize mt-1">
              {currentSubpath.replace('-', ' ')}
            </h2>
          </div>

          <div className="text-xs bg-slate-950 px-3.5 py-2 rounded-xl border border-slate-800 text-slate-400 flex items-center space-x-2">
            <span>Scoped User:</span>
            <span className="font-semibold text-slate-200">{user?.fullName || 'Stake Leader'}</span>
            <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
              {hasStakeWideReadAccess
                ? 'Stake Wide'
                : (user?.unitAssignments || []).map(ua => ua.unitName).filter(Boolean).join(', ') || 'Unit Assigned'}
            </span>
          </div>
        </div>

        {/* Status Alerts */}
        {statusMsg && (
          <div
            className={`mb-6 p-4 rounded-xl flex items-center justify-between text-xs border ${
              statusMsg.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-800/60 text-emerald-200'
                : 'bg-red-950/60 border-red-800/60 text-red-200'
            }`}
            role="status"
          >
            <div className="flex items-center space-x-3">
              {statusMsg.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-400" />
              )}
              <span>{statusMsg.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusMsg(null)}
              className="text-slate-400 hover:text-white ml-3"
              aria-label="Dismiss alert"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 1. DASHBOARD VIEW */}
        {currentSubpath === 'dashboard' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl">
                <p className="text-xs text-slate-400">Active Stake Units</p>
                <p className="text-2xl font-bold text-white mt-1">{stakeSummary?.totalUnits ?? '-'}</p>
              </div>
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl">
                <p className="text-xs text-slate-400">Scoped Active Members</p>
                <p className="text-2xl font-bold text-white mt-1">{stakeSummary?.totalMembers ?? '-'}</p>
              </div>
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl">
                <p className="text-xs text-slate-400">Activities</p>
                <p className="text-2xl font-bold text-white mt-1">{stakeSummary?.totalActivities ?? '-'}</p>
              </div>
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl">
                <p className="text-xs text-slate-400">Total Sessions</p>
                <p className="text-2xl font-bold text-white mt-1">{stakeSummary?.totalSessions ?? '-'}</p>
              </div>
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl">
                <p className="text-xs text-slate-400">Scoped Check-Ins</p>
                <p className="text-2xl font-bold text-emerald-400 mt-1">{stakeSummary?.totalCheckIns ?? '-'}</p>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3">Recent Activity Sessions</h3>
              <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-xs text-left text-slate-300">
                  <thead className="bg-slate-900 border-b border-slate-800 uppercase text-[10px] text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Session Title</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr key={s.id} className="border-b border-slate-900 hover:bg-slate-900/50">
                        <td className="px-4 py-3 font-semibold text-white">{s.sessionTitle}</td>
                        <td className="px-4 py-3">{s.sessionDate}</td>
                        <td className="px-4 py-3">{s.startTime}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-semibold ${
                            s.status === 'active' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-slate-800 text-slate-400'
                          }`}>
                            {s.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {sessions.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-slate-500">No sessions scheduled yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 2. UNITS MANAGEMENT VIEW */}
        {currentSubpath === 'units' && (
          <div className="space-y-6">
            {isSystemAdmin ? (
              <form onSubmit={handleCreateUnit} className="bg-slate-950 border border-slate-800 p-4 rounded-xl flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-[11px] font-semibold text-slate-300 uppercase mb-1">Unit Name</label>
                  <input
                    type="text"
                    value={newUnitName}
                    onChange={(e) => setNewUnitName(e.target.value)}
                    placeholder="Enter official ward or branch name"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                  />
                </div>
                <div className="w-36">
                  <label className="block text-[11px] font-semibold text-slate-300 uppercase mb-1">Type</label>
                  <select
                    value={newUnitType}
                    onChange={(e) => setNewUnitType(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                  >
                    <option value="ward">Ward</option>
                    <option value="branch">Branch</option>
                  </select>
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Stake Unit</span>
                </button>
              </form>
            ) : (
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-400">
                Viewing official stake units. Creating or deactivating stake units requires Stake System Administrator (`system_admin`) authority.
              </div>
            )}

            <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-xs text-left text-slate-300">
                <thead className="bg-slate-900 border-b border-slate-800 uppercase text-[10px] text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Unit Name</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Status</th>
                    {isSystemAdmin && <th className="px-4 py-3 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id} className="border-b border-slate-900 hover:bg-slate-900/50">
                      <td className="px-4 py-3 font-semibold text-white">{u.unitName}</td>
                      <td className="px-4 py-3 capitalize">{u.unitType}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] ${u.isActive ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-red-950 text-red-400'}`}>
                          {u.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      {isSystemAdmin && (
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleToggleUnitStatus(u)}
                            className="text-[11px] text-slate-400 hover:text-white"
                          >
                            {u.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {units.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-slate-500">No stake units registered.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 3. ACTIVITIES & SESSIONS VIEW */}
        {currentSubpath === 'activities' && (
          <div className="space-y-8">
            {canManageActivities ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Activity Definition Form */}
                <form onSubmit={handleCreateActivity} className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-3">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Create Activity Template</h3>
                  <div>
                    <label className="block text-[11px] text-slate-300 uppercase mb-1">Title</label>
                    <input
                      type="text"
                      value={newActTitle}
                      onChange={(e) => setNewActTitle(e.target.value)}
                      placeholder="e.g. Stake YSA Institute Night"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-300 uppercase mb-1">Category</label>
                    <select
                      value={newActCategory}
                      onChange={(e) => setNewActCategory(e.target.value as any)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                    >
                      <option value="spiritual">Spiritual</option>
                      <option value="social">Social</option>
                      <option value="service">Service</option>
                      <option value="sports">Sports</option>
                      <option value="temple">Temple</option>
                      <option value="educational">Educational</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-300 uppercase mb-1">Description</label>
                    <input
                      type="text"
                      value={newActDesc}
                      onChange={(e) => setNewActDesc(e.target.value)}
                      placeholder="Optional notes or objectives"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                    />
                  </div>
                  <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold">
                    Save Activity
                  </button>
                </form>

                {/* Schedule Session Form */}
                <form onSubmit={handleCreateSession} className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-3">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Schedule Live Session</h3>
                  <div>
                    <label className="block text-[11px] text-slate-300 uppercase mb-1">Activity</label>
                    <select
                      value={newSessActivityId}
                      onChange={(e) => setNewSessActivityId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                    >
                      <option value="">Select Activity</option>
                      {activities.map(a => <option key={a.id} value={a.id}>{a.title} ({a.category})</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-300 uppercase mb-1">Session Title</label>
                    <input
                      type="text"
                      value={newSessTitle}
                      onChange={(e) => setNewSessTitle(e.target.value)}
                      placeholder="e.g. Obantoko Stake YSA Gathering"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-300 uppercase mb-1">Date</label>
                      <input
                        type="date"
                        value={newSessDate}
                        onChange={(e) => setNewSessDate(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-300 uppercase mb-1">Start Time</label>
                      <input
                        type="time"
                        value={newSessStartTime}
                        onChange={(e) => setNewSessStartTime(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-300 uppercase mb-1">Max Terminals</label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={newSessMaxTerminals}
                        onChange={(e) => setNewSessMaxTerminals(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                      />
                    </div>
                  </div>

                  {units.length > 0 && (
                    <div>
                      <label className="block text-[11px] text-slate-300 uppercase mb-1">
                        Participating Units (Leave unchecked for Stake-Wide)
                      </label>
                      <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto p-2 bg-slate-900 border border-slate-800 rounded-lg">
                        {units.filter(u => u.isActive).map(u => {
                          const checked = newSessSelectedUnits.includes(u.id)
                          return (
                            <label key={u.id} className="inline-flex items-center space-x-1.5 text-[11px] text-slate-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setNewSessSelectedUnits(prev => [...prev, u.id])
                                  } else {
                                    setNewSessSelectedUnits(prev => prev.filter(id => id !== u.id))
                                  }
                                }}
                                className="rounded border-slate-700 bg-slate-950 text-emerald-600"
                              />
                              <span>{u.unitName}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <label className="inline-flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newSessVisitorEnabled}
                        onChange={(e) => setNewSessVisitorEnabled(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-900 text-emerald-600"
                      />
                      <span>Allow Non-Member Visitor Check-In</span>
                    </label>
                    <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold">
                      Schedule Session
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-400">
                Viewing scheduled activities and sessions. Creating activities or initiating terminal codes requires Stake Presidency, System Admin, or YSA Leader authorization.
              </div>
            )}

            {/* Live Sessions Table */}
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3">All Sessions & Terminal Codes</h3>
              <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-xs text-left text-slate-300">
                  <thead className="bg-slate-900 border-b border-slate-800 uppercase text-[10px] text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Session</th>
                      <th className="px-4 py-3">Date & Time</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Terminals</th>
                      <th className="px-4 py-3">Active Kiosk Code</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => {
                      const generatedCode = activeSessionCodes[s.id]
                      return (
                        <tr key={s.id} className="border-b border-slate-900 hover:bg-slate-900/50">
                          <td className="px-4 py-3 font-semibold text-white">
                            {s.sessionTitle}
                            {s.participatingUnits && s.participatingUnits.length > 0 && (
                              <span className="ml-2 text-[10px] text-slate-400 font-normal">
                                ({s.participatingUnits.length} unit{s.participatingUnits.length > 1 ? 's' : ''})
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">{s.sessionDate} • {s.startTime}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-semibold ${
                              s.status === 'active' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-slate-800 text-slate-400'
                            }`}>
                              {s.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">{s.maxTerminals} max</td>
                          <td className="px-4 py-3">
                            {s.status === 'active' && generatedCode ? (
                              <div className="inline-flex items-center space-x-2 bg-slate-900 border border-emerald-700/60 px-2.5 py-1 rounded-lg">
                                <span className="font-mono font-bold text-emerald-400 tracking-widest">{generatedCode}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (typeof navigator !== 'undefined' && navigator.clipboard) {
                                      navigator.clipboard.writeText(`${window.location.origin}/${generatedCode}`)
                                      setStatusMsg({ type: 'success', text: `Direct kiosk link copied: ${window.location.origin}/${generatedCode}` })
                                    }
                                  }}
                                  className="text-slate-400 hover:text-white"
                                  title="Copy Direct Kiosk Link"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : s.status === 'active' ? (
                              <span className="text-[11px] text-slate-400">Code active (hashed)</span>
                            ) : (
                              <span className="text-[11px] text-slate-600">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right space-x-2">
                            {canManageActivities && s.status === 'draft' && (
                              <button
                                onClick={() => handleInitiateSession(s)}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-semibold"
                              >
                                Activate Code
                              </button>
                            )}
                            {canManageActivities && s.status === 'active' && (
                              <>
                                <button
                                  onClick={() => handleInitiateSession(s)}
                                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-[11px] font-semibold"
                                >
                                  Rotate Code
                                </button>
                                <button
                                  onClick={() => handleCloseSession(s.id)}
                                  className="px-2.5 py-1 bg-red-950 hover:bg-red-900 border border-red-800 text-red-300 rounded text-[11px] font-semibold"
                                >
                                  Close Session
                                </button>
                              </>
                            )}
                            {s.status === 'closed' && isStakeLeader && (
                              <button
                                onClick={() => setReopenSessionId(s.id)}
                                className="px-2.5 py-1 bg-amber-950 hover:bg-amber-900 border border-amber-800 text-amber-300 rounded text-[11px] font-semibold"
                              >
                                Reopen
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {sessions.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-slate-500">No sessions scheduled yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Reopen Modal */}
              {reopenSessionId && (
                <div className="mt-4 p-4 bg-slate-950 border border-amber-800/60 rounded-xl space-y-2">
                  <p className="text-xs font-semibold text-amber-400">Reopen Closed Attendance Session</p>
                  <input
                    type="text"
                    value={reopenReason}
                    onChange={(e) => setReopenReason(e.target.value)}
                    placeholder="Enter justification rationale (required, min 5 chars)..."
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                  />
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleReopenSession(reopenSessionId)}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded"
                    >
                      Authorize Reopen (60 min)
                    </button>
                    <button
                      onClick={() => { setReopenSessionId(''); setReopenReason('') }}
                      className="px-3 py-1.5 bg-slate-800 text-slate-300 text-xs rounded"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 4. AUTHORIZED ATTENDANCE CHECK-IN VIEW */}
        {currentSubpath === 'attendance' && (
          <div className="max-w-xl mx-auto py-4">
            {!canRecordManualAttendance ? (
              <div className="p-8 bg-slate-950 border border-slate-800 rounded-2xl text-center text-slate-400">
                <Shield className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                <p className="text-sm font-semibold text-white mb-1">Read-Only Clerk Scope</p>
                <p className="text-xs">
                  Authorized manual attendance check-in is restricted to Stake Presidency, System Administrators, Bishops, Branch Presidents, and YSA Leaders. Clerks have read-only access to attendance and reports.
                </p>
              </div>
            ) : (
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-center space-x-3 mb-4">
                  <div className="p-2.5 bg-emerald-950/80 border border-emerald-500/30 text-emerald-400 rounded-xl">
                    <UserCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Authorized Leader Check-In</h3>
                    <p className="text-xs text-slate-400">
                      Directly check in an active member within your unit authority. Audited with caller credentials.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleManualCheckIn} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Active Session</label>
                    <select
                      value={manualSessionId}
                      onChange={(e) => {
                        setManualSessionId(e.target.value)
                        setManualMemberId('')
                      }}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white"
                    >
                      <option value="">Select Active Session</option>
                      {sessions.map(s => <option key={s.id} value={s.id}>{s.sessionTitle} ({s.sessionDate})</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                      Select Active Member ({eligibleManualMembers.length} in scope)
                    </label>
                    <select
                      value={manualMemberId}
                      onChange={(e) => setManualMemberId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white"
                    >
                      <option value="">Select Member</option>
                      {eligibleManualMembers.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.fullName} ({m.homeUnitName || 'Unit'})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Leader Notes (Optional)</label>
                    <input
                      type="text"
                      value={manualNotes}
                      onChange={(e) => setManualNotes(e.target.value)}
                      placeholder="e.g. In-person verification"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmittingManual}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-xs transition disabled:opacity-50"
                  >
                    {isSubmittingManual ? 'Checking in...' : 'Record Check-In'}
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

        {/* 5. MEMBER CENSUS VIEW */}
        {currentSubpath === 'members' && (
          <div className="space-y-6">
            {canManageMembers ? (
              <form onSubmit={handleCreateMember} className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-3">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Register New Member in Census</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-300 uppercase mb-1">Full Name *</label>
                    <input
                      type="text"
                      value={newMemberName}
                      onChange={(e) => setNewMemberName(e.target.value)}
                      placeholder="e.g. Oluwatosin Adeyemi"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-300 uppercase mb-1">Preferred Name</label>
                    <input
                      type="text"
                      value={newMemberPrefName}
                      onChange={(e) => setNewMemberPrefName(e.target.value)}
                      placeholder="e.g. Tosin"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-300 uppercase mb-1">Home Ward / Branch *</label>
                    <select
                      value={newMemberUnitId}
                      onChange={(e) => setNewMemberUnitId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                    >
                      <option value="">Select Unit</option>
                      {memberCreatableUnits.map(u => <option key={u.id} value={u.id}>{u.unitName}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-300 uppercase mb-1">Gender</label>
                    <select
                      value={newMemberGender}
                      onChange={(e) => setNewMemberGender(e.target.value as any)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                    >
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-300 uppercase mb-1">Phone</label>
                    <input
                      type="tel"
                      value={newMemberPhone}
                      onChange={(e) => setNewMemberPhone(e.target.value)}
                      placeholder="080 1234 5678"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-300 uppercase mb-1">Email</label>
                    <input
                      type="email"
                      value={newMemberEmail}
                      onChange={(e) => setNewMemberEmail(e.target.value)}
                      placeholder="member@example.com"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-300 uppercase mb-1">Member Number (Optional)</label>
                    <input
                      type="text"
                      value={newMemberNumber}
                      onChange={(e) => setNewMemberNumber(e.target.value)}
                      placeholder="Record number"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                    />
                  </div>
                </div>
                <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold">
                  Register Member
                </button>
              </form>
            ) : (
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-400">
                Read-only member census view for your assigned scope. Registering or archiving members requires Stake Presidency, System Admin, Bishop, Branch President, or assigned YSA Leader authority.
              </div>
            )}

            <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-xs text-left text-slate-300">
                <thead className="bg-slate-900 border-b border-slate-800 uppercase text-[10px] text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Full Name</th>
                    <th className="px-4 py-3">Unit</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">Status</th>
                    {canManageMembers && <th className="px-4 py-3 text-right">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => (
                    <tr key={m.id} className="border-b border-slate-900 hover:bg-slate-900/50">
                      <td className="px-4 py-3 font-semibold text-white">{m.fullName} {m.preferredName && `(${m.preferredName})`}</td>
                      <td className="px-4 py-3">{m.homeUnitName || 'Unit'}</td>
                      <td className="px-4 py-3">{m.phoneNumber || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] ${m.isActive ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-red-950 text-red-400'}`}>
                          {m.isActive ? 'Active' : 'Archived'}
                        </span>
                      </td>
                      {canManageMembers && (
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={async () => {
                              try {
                                await memberService.toggleMemberStatus(m.id, !m.isActive)
                                await loadCurrentSubpathData()
                              } catch (err: any) {
                                setStatusMsg({ type: 'error', text: err?.message || 'Failed to update member status' })
                              }
                            }}
                            className="text-[11px] text-slate-400 hover:text-white"
                          >
                            {m.isActive ? 'Archive' : 'Restore'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {members.length === 0 && (
                    <tr>
                      <td colSpan={canManageMembers ? 5 : 4} className="px-4 py-6 text-center text-slate-500">No members registered in census yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 6. REPORTS & EXPORTS VIEW */}
        {currentSubpath === 'reports' && (
          <div className="space-y-8">
            {/* Monthly Unit Register */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold text-white">Monthly Attendance Register</h3>
                  <p className="text-xs text-slate-400">Calculates percentages against actual activity opportunities in period.</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Report Year"
                    value={reportYear}
                    onChange={(e) => setReportYear(Number(e.target.value))}
                    className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                  >
                    {[2025, 2026, 2027].map(yr => (
                      <option key={yr} value={yr}>{yr}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Report Month"
                    value={reportMonth}
                    onChange={(e) => setReportMonth(Number(e.target.value))}
                    className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                  >
                    {Array.from({ length: 12 }, (_, idx) => idx + 1).map(m => (
                      <option key={m} value={m}>
                        {new Date(2026, m - 1, 1).toLocaleString('en-US', { month: 'long' })}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center space-x-1.5"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print / PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      reportService.exportToCsv(
                        unitMonthlyStats,
                        `ysa_attendance_register_${reportYear}_${String(reportMonth).padStart(2, '0')}`
                      )
                    }
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </button>
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-xs text-left text-slate-300">
                  <thead className="bg-slate-900 border-b border-slate-800 uppercase text-[10px] text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Stake Unit</th>
                      <th className="px-4 py-3">Active Census</th>
                      <th className="px-4 py-3">Total Check-Ins</th>
                      <th className="px-4 py-3">Eligible Opps</th>
                      <th className="px-4 py-3">Attendance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unitMonthlyStats.map(stat => (
                      <tr key={stat.unitId} className="border-b border-slate-900 hover:bg-slate-900/50">
                        <td className="px-4 py-3 font-semibold text-white">{stat.unitName}</td>
                        <td className="px-4 py-3">{stat.totalMembers}</td>
                        <td className="px-4 py-3">{stat.totalAttended}</td>
                        <td className="px-4 py-3">{stat.totalOpportunities}</td>
                        <td className="px-4 py-3 font-bold text-emerald-400">
                          {stat.percentage !== null ? `${stat.percentage}%` : 'N/A (No events)'}
                        </td>
                      </tr>
                    ))}
                    {unitMonthlyStats.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-slate-500">No attendance data in selected period.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Individual Member Attendance History */}
            <div className="space-y-4 pt-6 border-t border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold text-white">Individual Attendance History</h3>
                  <p className="text-xs text-slate-400">Inspect complete check-in history for any member in your unit scope.</p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Inspect Member History"
                    value={selectedHistoryMemberId}
                    onChange={(e) => handleLoadMemberHistory(e.target.value)}
                    className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white min-w-[220px]"
                  >
                    <option value="">Select Member to Inspect...</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.fullName} ({m.homeUnitName || 'Unit'})
                      </option>
                    ))}
                  </select>
                  {memberHistory && memberHistory.sessions.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        reportService.exportToCsv(
                          memberHistory.sessions,
                          `ysa_member_history_${memberHistory.fullName.replace(/\s+/g, '_').toLowerCase()}`
                        )
                      }
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center space-x-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export History</span>
                    </button>
                  )}
                </div>
              </div>

              {memberHistory && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-slate-900/70 border-b border-slate-800 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-bold text-white">{memberHistory.fullName}</span>
                      <span className="text-slate-400 ml-2">({memberHistory.homeUnitName})</span>
                    </div>
                    <span className="px-2.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-semibold">
                      Total Sessions Attended: {memberHistory.attendedCount}
                    </span>
                  </div>
                  <table className="w-full text-xs text-left text-slate-300">
                    <thead className="bg-slate-900 border-b border-slate-800 uppercase text-[10px] text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5">Session Title</th>
                        <th className="px-4 py-2.5">Session Date</th>
                        <th className="px-4 py-2.5">Check-In Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {memberHistory.sessions.map((s) => (
                        <tr key={`${s.sessionId}-${s.checkInTime}`} className="border-b border-slate-900">
                          <td className="px-4 py-2.5 font-semibold text-white">{s.sessionTitle}</td>
                          <td className="px-4 py-2.5">{s.sessionDate}</td>
                          <td className="px-4 py-2.5 font-mono text-[11px]">{new Date(s.checkInTime).toLocaleString()}</td>
                        </tr>
                      ))}
                      {memberHistory.sessions.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-4 py-4 text-center text-slate-500">No recorded check-ins for this member yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Session Visitors Register */}
            <div className="space-y-4 pt-6 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white">Session Visitors Register</h3>
                  <p className="text-xs text-slate-400">
                    Scoped to inviting unit assignments for ward/branch leaders; unassigned visitors visible only to stake-wide leaders.
                  </p>
                </div>
                {visitorsList.length > 0 && (
                  <button
                    type="button"
                    onClick={() => reportService.exportToCsv(visitorsList, `ysa_visitors_register_${reportYear}`)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center space-x-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export Visitors CSV</span>
                  </button>
                )}
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-xs text-left text-slate-300">
                  <thead className="bg-slate-900 border-b border-slate-800 uppercase text-[10px] text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Visitor Name</th>
                      <th className="px-4 py-3">Inviting Unit</th>
                      <th className="px-4 py-3">Session</th>
                      <th className="px-4 py-3">Contact Phone</th>
                      <th className="px-4 py-3">Check-In Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visitorsList.map(v => (
                      <tr key={v.id} className="border-b border-slate-900 hover:bg-slate-900/50">
                        <td className="px-4 py-3 font-semibold text-white">{v.fullName}</td>
                        <td className="px-4 py-3">{v.invitingUnitName}</td>
                        <td className="px-4 py-3">{v.sessionTitle} ({v.sessionDate})</td>
                        <td className="px-4 py-3">{v.contactPhone || '-'}</td>
                        <td className="px-4 py-3 font-mono text-[11px]">{new Date(v.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                    {visitorsList.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-slate-500">No visitor records in scope.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 7. USER GOVERNANCE VIEW */}
        {currentSubpath === 'users' && (
          <div className="space-y-6">
            {!isStakeLeader ? (
              <div className="p-8 text-center text-slate-500">
                <Shield className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                <p>User provisioning and governance is restricted to Stake System Administrators and Stake Presidency.</p>
              </div>
            ) : (
              <>
                {isSystemAdmin ? (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault()
                      if (!assignUserId) return
                      const unitRequiredRoles: AppRole[] = ['bishop', 'branch_president', 'ysa_leader', 'ward_clerk', 'branch_clerk']
                      if (unitRequiredRoles.includes(assignRole) && !assignUnitId) {
                        setStatusMsg({ type: 'error', text: `Selecting a target ward or branch is required when assigning "${assignRole}".` })
                        return
                      }
                      try {
                        await adminService.assignUserRole(assignUserId, assignRole)
                        if (assignUnitId && unitRequiredRoles.includes(assignRole)) {
                          await adminService.assignUserUnit(assignUserId, assignUnitId, assignRole as any)
                        }
                        await loadCurrentSubpathData()
                        setStatusMsg({ type: 'success', text: 'Role and unit assignment saved.' })
                      } catch (err: any) {
                        setStatusMsg({ type: 'error', text: err?.message || 'Assignment failed' })
                      }
                    }}
                    className="bg-slate-950 border border-slate-800 p-4 rounded-xl flex flex-wrap gap-3 items-end"
                  >
                    <div className="flex-1 min-w-[200px]">
                      <label className="block text-[11px] text-slate-300 uppercase mb-1">Leader User</label>
                      <select
                        value={assignUserId}
                        onChange={(e) => setAssignUserId(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                      >
                        <option value="">Select User Profile</option>
                        {usersList.map(u => <option key={u.id} value={u.id}>{u.fullName} ({u.email})</option>)}
                      </select>
                    </div>
                    <div className="w-44">
                      <label className="block text-[11px] text-slate-300 uppercase mb-1">Assign Role</label>
                      <select
                        value={assignRole}
                        onChange={(e) => setAssignRole(e.target.value as any)}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                      >
                        <option value="ysa_leader">YSA Leader</option>
                        <option value="bishop">Bishop</option>
                        <option value="branch_president">Branch President</option>
                        <option value="ward_clerk">Ward Clerk</option>
                        <option value="branch_clerk">Branch Clerk</option>
                        <option value="stake_clerk">Stake Clerk</option>
                        <option value="stake_presidency">Stake Presidency</option>
                        <option value="system_admin">System Admin</option>
                      </select>
                    </div>
                    <div className="w-44">
                      <label className="block text-[11px] text-slate-300 uppercase mb-1">Assign Unit</label>
                      <select
                        value={assignUnitId}
                        onChange={(e) => setAssignUnitId(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                      >
                        <option value="">None / Stake Wide</option>
                        {units.map(u => <option key={u.id} value={u.id}>{u.unitName}</option>)}
                      </select>
                    </div>
                    <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold">
                      Authorize Role
                    </button>
                  </form>
                ) : (
                  <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-400">
                    Read-only directory view. Assigning or revoking leadership roles and account status requires `system_admin` authority.
                  </div>
                )}

                {/* Users List */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left text-slate-300">
                    <thead className="bg-slate-900 border-b border-slate-800 uppercase text-[10px] text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Name & Email</th>
                        <th className="px-4 py-3">Roles</th>
                        <th className="px-4 py-3">Unit Assignments</th>
                        <th className="px-4 py-3">Account Status</th>
                        {isSystemAdmin && <th className="px-4 py-3 text-right">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {usersList.map(u => (
                        <tr key={u.id} className="border-b border-slate-900 hover:bg-slate-900/50">
                          <td className="px-4 py-3">
                            <p className="font-semibold text-white">{u.fullName}</p>
                            <p className="text-[11px] text-slate-400">{u.email}</p>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {u.roles.map(r => (
                                <span key={r} className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-emerald-400 border border-slate-700">
                                  <span>{r}</span>
                                  {isSystemAdmin && (
                                    <button
                                      type="button"
                                      title={`Revoke role ${r}`}
                                      onClick={async () => {
                                        try {
                                          await adminService.removeUserRole(u.id, r)
                                          await loadCurrentSubpathData()
                                          setStatusMsg({ type: 'success', text: `Revoked role "${r}" from ${u.fullName}.` })
                                        } catch (err: any) {
                                          setStatusMsg({ type: 'error', text: err?.message || 'Failed to revoke role' })
                                        }
                                      }}
                                      className="text-slate-400 hover:text-red-400 ml-1"
                                    >
                                      ×
                                    </button>
                                  )}
                                </span>
                              ))}
                              {u.roles.length === 0 && (
                                <span className="text-[11px] text-slate-500">No roles</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="space-y-1">
                              {(u.unitAssignments || []).map(ua => (
                                <div key={ua.id} className="flex items-center space-x-1.5 text-[11px] text-slate-300">
                                  <span>{ua.unitName} ({ua.assignedRole})</span>
                                  {isSystemAdmin && (
                                    <button
                                      type="button"
                                      title="Remove unit assignment"
                                      onClick={async () => {
                                        try {
                                          await adminService.removeUserUnitAssignment(ua.id)
                                          await loadCurrentSubpathData()
                                          setStatusMsg({ type: 'success', text: 'Unit assignment removed.' })
                                        } catch (err: any) {
                                          setStatusMsg({ type: 'error', text: err?.message || 'Failed to remove unit assignment' })
                                        }
                                      }}
                                      className="text-slate-500 hover:text-red-400"
                                    >
                                      ×
                                    </button>
                                  )}
                                </div>
                              ))}
                              {(!u.unitAssignments || u.unitAssignments.length === 0) && (
                                <span className="text-slate-500 text-[11px]">Stake-wide / None</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-semibold ${
                              u.accountStatus === 'active' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-red-950 text-red-400'
                            }`}>
                              {u.accountStatus}
                            </span>
                          </td>
                          {isSystemAdmin && (
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={async () => {
                                  const nextStatus = u.accountStatus === 'active' ? 'deactivated' : 'active'
                                  try {
                                    await adminService.updateUserStatus(u.id, nextStatus)
                                    await loadCurrentSubpathData()
                                    setStatusMsg({ type: 'success', text: `User account status updated to "${nextStatus}".` })
                                  } catch (err: any) {
                                    setStatusMsg({ type: 'error', text: err?.message || 'Failed to update account status' })
                                  }
                                }}
                                className="text-[11px] text-slate-400 hover:text-white"
                              >
                                {u.accountStatus === 'active' ? 'Deactivate' : 'Activate'}
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* 8. AUDIT LOGS VIEW */}
        {currentSubpath === 'audit-logs' && (
          <div className="space-y-4">
            {!isStakeLeader ? (
              <div className="p-8 text-center text-slate-500">
                <Shield className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                <p>Security audit logs are restricted to Stake Presidency and System Administrators.</p>
              </div>
            ) : (
              <>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Immutable Security Audit Trail</h3>
                <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left text-slate-300">
                    <thead className="bg-slate-900 border-b border-slate-800 uppercase text-[10px] text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Timestamp</th>
                        <th className="px-4 py-3">Actor</th>
                        <th className="px-4 py-3">Action</th>
                        <th className="px-4 py-3">Target Table</th>
                        <th className="px-4 py-3">Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map(l => (
                        <tr key={l.id} className="border-b border-slate-900 hover:bg-slate-900/50 font-mono text-[11px]">
                          <td className="px-4 py-3">{new Date(l.createdAt).toLocaleString()}</td>
                          <td className="px-4 py-3 text-white font-sans">{l.actorName}</td>
                          <td className="px-4 py-3 font-semibold text-emerald-400">{l.action}</td>
                          <td className="px-4 py-3 text-slate-400">{l.targetTable || '-'}</td>
                          <td className="px-4 py-3 uppercase text-[10px]">
                            <span className={l.outcome === 'success' ? 'text-emerald-400' : 'text-red-400'}>
                              {l.outcome}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {auditLogs.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-slate-500">No audit records found.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* 9. SETTINGS & SECURITY PROFILE VIEW */}
        {currentSubpath === 'settings' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-5 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Stake & System Configuration</h3>
                <div className="text-xs space-y-2 text-slate-300">
                  <div className="flex justify-between py-1.5 border-b border-slate-900">
                    <span className="text-slate-400">Stake Name</span>
                    <span className="font-semibold text-white">Abeokuta Nigeria Obantoko Stake</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-900">
                    <span className="text-slate-400">Canonical Timezone</span>
                    <span className="font-mono text-emerald-400">Africa/Lagos (WAT, UTC+1)</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-900">
                    <span className="text-slate-400">Kiosk Lease Policy</span>
                    <span>10-min lease / 4-min heartbeat</span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-slate-400">Audit Trail Policy</span>
                    <span>Append-only (SECURITY DEFINER RPCs)</span>
                  </div>
                </div>
              </div>

              <div className="p-5 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Authenticated Leader Profile</h3>
                <div className="text-xs space-y-2 text-slate-300">
                  <div className="flex justify-between py-1.5 border-b border-slate-900">
                    <span className="text-slate-400">Full Name</span>
                    <span className="font-semibold text-white">{user?.fullName}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-900">
                    <span className="text-slate-400">Email</span>
                    <span>{user?.email}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-900">
                    <span className="text-slate-400">Account Status</span>
                    <span className="uppercase text-emerald-400 font-semibold">{user?.accountStatus}</span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-slate-400">Assigned Roles</span>
                    <span className="font-mono text-emerald-400">{(user?.roles || []).join(', ')}</span>
                  </div>
                </div>
                {user?.email && (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await authService.resetPasswordForEmail(user.email)
                        if (res.success) {
                          setStatusMsg({ type: 'success', text: `Password reset email sent to ${user.email}.` })
                        } else {
                          setStatusMsg({ type: 'error', text: res.error || 'Failed to send password reset email.' })
                        }
                      }}
                      className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold"
                    >
                      Send Password Reset Link
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
