import React, { useState, useEffect, useMemo } from 'react'
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
  Shield,
  Copy,
  X,
  Search,
  Loader2,
  Radio,
  ExternalLink,
  Upload,
  FileSpreadsheet
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import {
  LeadershipRoute,
  StakeUnit,
  UserProfile,
  MemberRecord,
  ActivityDefinition,
  STANDARD_ACTIVITY_CATEGORIES,
  ActivitySession,
  AppRole
} from '../../types/database'
import { authService } from '../../services/authService'
import { adminService } from '../../services/adminService'
import { memberService } from '../../services/memberService'
import { activityService, parseActivitiesCsv, ActivityImportResult } from '../../services/activityService'
import { attendanceService } from '../../services/attendanceService'
import { reportService } from '../../services/reportService'
import { ReportingWorkspace } from '../reporting/ReportingWorkspace'
import { LiveActiveSessionView } from '../reporting/LiveActiveSessionView'
import {
  copyActivityCode,
  copyAttendanceLink,
  saveActiveSessionCode,
  getAllActiveSessionCodes,
  removeActiveSessionCode,
  syncActiveSessionCodes
} from '../../lib/clipboardUtils'
import { humanizeErrorMessage } from '../../lib/errorUtils'

interface LeadershipPortalViewProps {
  currentSubpath: LeadershipRoute
  onNavigateSubpath: (subpath: LeadershipRoute) => void
}

export interface RoleNavAccess {
  isStakeLeader: boolean
  canRecordManualAttendance: boolean
}

export function getRolePermittedNavItems(
  access: RoleNavAccess
): { id: LeadershipRoute; label: string; icon: React.FC<{ className?: string }> }[] {
  const items: { id: LeadershipRoute; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'activities', label: 'Activities & Sessions', icon: Calendar }
  ]

  // Authorized manual attendance check-in is relevant to presiding leaders, hidden for read-only clerks
  if (access.canRecordManualAttendance) {
    items.push({ id: 'attendance', label: 'Authorized Check-in', icon: ClipboardCheck })
  }

  items.push(
    { id: 'members', label: 'Member Census', icon: Users },
    { id: 'reports', label: 'Reports & Export', icon: BarChart3 },
    { id: 'units', label: 'Stake Units', icon: Building2 }
  )

  // Governance and audit logs are strictly restricted to stake presidency and system admin
  if (access.isStakeLeader) {
    items.push(
      { id: 'users', label: 'User Governance', icon: UserCog },
      { id: 'audit-logs', label: 'Audit Trail', icon: FileText }
    )
  }

  items.push({ id: 'settings', label: 'Settings', icon: Settings })

  return items
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
    reportUnitFilter,
    isPasswordRecovery,
    recoveryEmail,
    authCallbackError,
    authCallbackNotice,
    completePasswordRecovery,
    cancelPasswordRecovery,
    clearAuthCallbackFeedback
  } = useAuth()

  // Sign In & Recovery State
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginNotice, setLoginNotice] = useState<string | null>(null)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [isResetMode, setIsResetMode] = useState(false)

  // New Password Setup State (Supabase PASSWORD_RECOVERY / Invite callback on /la)
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)

  // Common Data State
  const [units, setUnits] = useState<StakeUnit[]>([])
  const [members, setMembers] = useState<MemberRecord[]>([])
  const [activities, setActivities] = useState<ActivityDefinition[]>([])
  const [sessions, setSessions] = useState<ActivitySession[]>([])
  const [usersList, setUsersList] = useState<UserProfile[]>([])
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [stakeSummary, setStakeSummary] = useState<any>(null)

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
  const [provName, setProvName] = useState('')
  const [provEmail, setProvEmail] = useState('')
  const [provRole, setProvRole] = useState<AppRole>('ysa_leader')
  const [provUnitId, setProvUnitId] = useState('')
  const [showProvForm, setShowProvForm] = useState(false)

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
  const [newActCategory, setNewActCategory] = useState<string>('spiritual')
  const [newActDesc, setNewActDesc] = useState('')

  // Activity CSV Import State
  const [showActivityCsvModal, setShowActivityCsvModal] = useState(false)
  const [activityCsvText, setActivityCsvText] = useState('')
  const [isImportingActivities, setIsImportingActivities] = useState(false)
  const [_activityImportResult, setActivityImportResult] = useState<ActivityImportResult | null>(null)

  // 6. Session Creation Form
  const [newSessActivityId, setNewSessActivityId] = useState('')
  const [newSessTitle, setNewSessTitle] = useState('')
  const [newSessDate, setNewSessDate] = useState(() => new Date().toISOString().split('T')[0])
  const [newSessStartTime, setNewSessStartTime] = useState('16:00')
  const [newSessEndTime, setNewSessEndTime] = useState('18:00')
  const [newSessGraceMinutes, setNewSessGraceMinutes] = useState(0)
  const [newSessMaxTerminals, setNewSessMaxTerminals] = useState(2)
  const [newSessVisitorEnabled, setNewSessVisitorEnabled] = useState(true)
  const [newSessSelectedUnits, setNewSessSelectedUnits] = useState<string[]>([])

  // Dynamic Category Suggestions derived from standard categories + existing activities
  const categorySuggestions = useMemo(() => {
    const set = new Set<string>(STANDARD_ACTIVITY_CATEGORIES)
    activities.forEach(a => {
      if (a.category && a.category.trim()) {
        set.add(a.category.trim())
      }
    })
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [activities])

  // Parsed CSV rows preview
  const parsedCsvPreview = useMemo(() => {
    if (!activityCsvText.trim()) return null
    return parseActivitiesCsv(activityCsvText)
  }, [activityCsvText])

  // 7. Initiate, Reopen, Cancel, Postpone & Adjust Session State
  const [activeSessionCodes, setActiveSessionCodes] = useState<Record<string, string>>(() => getAllActiveSessionCodes())
  const [liveMonitorSession, setLiveMonitorSession] = useState<ActivitySession | null>(null)
  const [reopenReason, setReopenReason] = useState('')
  const [reopenSessionId, setReopenSessionId] = useState('')

  const [cancelSessionId, setCancelSessionId] = useState('')
  const [cancelReason, setCancelReason] = useState('')

  const [postponeSessionId, setPostponeSessionId] = useState('')
  const [postponeNewDate, setPostponeNewDate] = useState('')
  const [postponeNewStartTime, setPostponeNewStartTime] = useState('')
  const [postponeNewEndTime, setPostponeNewEndTime] = useState('')
  const [postponeReason, setPostponeReason] = useState('')

  const [adjustSessionId, setAdjustSessionId] = useState('')
  const [adjustTitle, setAdjustTitle] = useState('')
  const [adjustEndTime, setAdjustEndTime] = useState('')
  const [adjustGraceMinutes, setAdjustGraceMinutes] = useState(0)
  const [adjustSelectedUnits, setAdjustSelectedUnits] = useState<string[]>([])
  const [adjustReason, setAdjustReason] = useState('')

  // Modal & Confirmation States
  const [closeSessionId, setCloseSessionId] = useState('')
  const [isExecutingAction, setIsExecutingAction] = useState(false)

  // Loading states for form submissions
  const [isSubmittingUnit, setIsSubmittingUnit] = useState(false)
  const [isSubmittingMember, setIsSubmittingMember] = useState(false)
  const [isSubmittingActivity, setIsSubmittingActivity] = useState(false)
  const [isSubmittingSession, setIsSubmittingSession] = useState(false)
  const [isActivatingSessionId, setIsActivatingSessionId] = useState<string | null>(null)

  // Member Census Search & Filter
  const [memberSearchQuery, setMemberSearchQuery] = useState('')
  const [memberUnitFilter, setMemberUnitFilter] = useState('all')
  const [memberStatusFilter, setMemberStatusFilter] = useState<'all' | 'active' | 'archived'>('active')

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
        syncActiveSessionCodes(sList.filter(s => s.status === 'active').map(s => s.id))
        setActiveSessionCodes(getAllActiveSessionCodes())
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
        const [uList, mList, actList, sList] = await Promise.all([
          adminService.listUnits(),
          memberService.listMembers(unitFilter),
          activityService.listActivities(),
          activityService.listSessions()
        ])
        setUnits(uList)
        setMembers(mList)
        setActivities(actList)
        setSessions(sList)
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
  }, [currentSubpath, isAuthenticated])

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError(null)
    setLoginNotice(null)
    clearAuthCallbackFeedback()

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

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError(null)
    setLoginNotice(null)

    setIsUpdatingPassword(true)
    const res = await authService.updatePassword(newPassword, confirmNewPassword)
    if (!res.success) {
      setIsUpdatingPassword(false)
      setLoginError(res.error || 'Failed to update password.')
      return
    }

    const completion = await completePasswordRecovery()
    setIsUpdatingPassword(false)
    setNewPassword('')
    setConfirmNewPassword('')
    if (completion.authorized) {
      setStatusMsg({
        type: 'success',
        text: completion.message || 'Your leadership password has been updated.'
      })
    } else {
      setLoginNotice(
        completion.message ||
          'Your password has been updated. Please sign in with your new password.'
      )
    }
  }

  if (isPasswordRecovery) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
          <div className="text-center mb-6">
            <div className="w-14 h-14 bg-emerald-950/80 border border-emerald-500/30 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Lock className="w-7 h-7" />
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Set Leadership Password</h2>
            <p className="text-sm text-slate-400 mt-1">
              {recoveryEmail
                ? `Create a new password for ${recoveryEmail}`
                : 'Enter and confirm your new leadership portal password below.'}
            </p>
          </div>

          {loginError && (
            <div className="mb-4 p-3 bg-red-950/70 border border-red-800 rounded-xl text-xs text-red-200 space-y-2" role="alert">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <span>{loginError}</span>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (recoveryEmail) setLoginEmail(recoveryEmail)
                  setLoginError(null)
                  await cancelPasswordRecovery()
                  setIsResetMode(true)
                }}
                className="inline-flex items-center text-xs font-semibold text-emerald-400 hover:text-emerald-300 underline"
              >
                Request a fresh recovery link
              </button>
            </div>
          )}

          <form onSubmit={handleUpdatePassword} className="space-y-4">
            <div>
              <label htmlFor="new-leader-password" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                New Password
              </label>
              <input
                id="new-leader-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                minLength={8}
                required
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              />
            </div>

            <div>
              <label htmlFor="confirm-leader-password" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Confirm New Password
              </label>
              <input
                id="confirm-leader-password"
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                placeholder="Re-enter new password"
                minLength={8}
                required
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={isUpdatingPassword}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl shadow-lg shadow-emerald-900/30 flex items-center justify-center space-x-2 transition text-sm disabled:opacity-50"
            >
              <span>{isUpdatingPassword ? 'Updating Password...' : 'Save New Password'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={async () => {
                  setLoginError(null)
                  await cancelPasswordRecovery()
                }}
                className="text-xs text-slate-400 hover:text-emerald-400 transition"
              >
                Cancel and return to Sign In
              </button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    const displayedError = loginError || authCallbackError
    const displayedNotice = loginNotice || authCallbackNotice

    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
          <div className="text-center mb-6">
            <div className="w-14 h-14 bg-emerald-950/80 border border-emerald-500/30 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Lock className="w-7 h-7" />
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Leadership Portal</h2>
            <p className="text-sm text-slate-400 mt-1">
              Authorized stake presidency, bishops, branch presidents, clerks & YSA leaders only.
            </p>
          </div>

          <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl mb-6 text-xs text-slate-400 flex items-start space-x-2.5">
            <ShieldAlert className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <span>
              Self-signup is disabled. Privileged accounts must be provisioned by a Stake System Administrator.
            </span>
          </div>

          {displayedError && (
            <div className="mb-4 p-3 bg-red-950/70 border border-red-800 rounded-xl text-xs text-red-200 space-y-2" role="alert">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <span>{displayedError}</span>
              </div>
              {authCallbackError && !isResetMode && (
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      clearAuthCallbackFeedback()
                      setLoginError(null)
                      setIsResetMode(true)
                    }}
                    className="inline-flex items-center text-xs font-semibold text-emerald-400 hover:text-emerald-300 underline"
                  >
                    Request a fresh recovery link
                  </button>
                </div>
              )}
            </div>
          )}

          {displayedNotice && (
            <div className="mb-4 p-3 bg-emerald-950/70 border border-emerald-800 rounded-xl text-xs text-emerald-200 flex items-center space-x-2" role="status">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>{displayedNotice}</span>
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
                  clearAuthCallbackFeedback()
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

  const navItems = getRolePermittedNavItems({
    isStakeLeader,
    canRecordManualAttendance
  })

  // Filtered members for Member Census search & filter
  const filteredMembersList = members.filter((m) => {
    if (memberStatusFilter === 'active' && !m.isActive) return false
    if (memberStatusFilter === 'archived' && m.isActive) return false
    if (memberUnitFilter && memberUnitFilter !== 'all' && m.homeUnitId !== memberUnitFilter) return false
    if (memberSearchQuery.trim()) {
      const q = memberSearchQuery.toLowerCase().trim()
      const matchesName = m.fullName.toLowerCase().includes(q)
      const matchesPref = m.preferredName?.toLowerCase().includes(q)
      const matchesPhone = m.phoneNumber?.toLowerCase().includes(q)
      const matchesNumber = m.memberNumber?.toLowerCase().includes(q)
      if (!matchesName && !matchesPref && !matchesPhone && !matchesNumber) return false
    }
    return true
  })

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
    if (!isSystemAdmin || !newUnitName.trim() || isSubmittingUnit) return
    setIsSubmittingUnit(true)
    try {
      const createdName = newUnitName.trim()
      await adminService.createUnit(createdName, newUnitType)
      setNewUnitName('')
      await loadCurrentSubpathData()
      setStatusMsg({ type: 'success', text: `Unit "${createdName}" successfully created.` })
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Failed to create unit' })
    } finally {
      setIsSubmittingUnit(false)
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
    if (!canManageMembers || isSubmittingMember) {
      if (!canManageMembers) {
        setStatusMsg({ type: 'error', text: 'Unauthorized: Clerk accounts have read-only access and cannot modify member census.' })
      }
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
    setIsSubmittingMember(true)
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
    } finally {
      setIsSubmittingMember(false)
    }
  }

  const handleCreateActivity = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canManageActivities || !newActTitle.trim() || !newActCategory.trim() || isSubmittingActivity) return
    setIsSubmittingActivity(true)
    try {
      await activityService.createActivity(
        {
          title: newActTitle.trim(),
          category: newActCategory.trim(),
          description: newActDesc.trim() || undefined
        },
        user!.id
      )
      setNewActTitle('')
      setNewActDesc('')
      setNewActCategory('spiritual')
      await loadCurrentSubpathData()
      setStatusMsg({ type: 'success', text: 'Activity definition created.' })
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Failed to create activity' })
    } finally {
      setIsSubmittingActivity(false)
    }
  }

  const handleActivityCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      setActivityCsvText(text || '')
      setActivityImportResult(null)
    }
    reader.readAsText(file)
  }

  const handleExecuteActivityCsvImport = async () => {
    if (!activityCsvText.trim() || !user?.id || isImportingActivities) return
    setIsImportingActivities(true)
    try {
      const res = await activityService.importActivitiesFromCsv(activityCsvText, user.id)
      setActivityImportResult(res)
      if (res.successCount > 0) {
        setStatusMsg({
          type: 'success',
          text: `Successfully imported ${res.successCount} ${res.successCount === 1 ? 'activity' : 'activities'}${res.errorCount > 0 ? ` (${res.errorCount} row(s) had errors)` : ''}.`
        })
        await loadCurrentSubpathData()
        if (res.errorCount === 0) {
          setShowActivityCsvModal(false)
          setActivityCsvText('')
          setActivityImportResult(null)
        }
      } else {
        setStatusMsg({
          type: 'error',
          text: `Activity import failed: ${res.errors.map(err => `Row ${err.row}: ${err.error}`).join('; ')}`
        })
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Failed to import activities from CSV.' })
    } finally {
      setIsImportingActivities(false)
    }
  }

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canManageActivities || isSubmittingSession) return
    if (!newSessActivityId || !newSessTitle.trim()) {
      setStatusMsg({ type: 'error', text: 'Activity and session title are required.' })
      return
    }
    setIsSubmittingSession(true)
    try {
      const clampedTerminals = Math.min(Math.max(1, Number(newSessMaxTerminals) || 2), 10)
      await activityService.createSession({
        activityId: newSessActivityId,
        sessionTitle: newSessTitle,
        sessionDate: newSessDate,
        startTime: newSessStartTime,
        scheduledEndTime: newSessEndTime || undefined,
        gracePeriodMinutes: Number(newSessGraceMinutes) || 0,
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
    } finally {
      setIsSubmittingSession(false)
    }
  }

  const handleInitiateSession = async (session: ActivitySession) => {
    if (!canManageActivities) return
    setIsActivatingSessionId(session.id)
    const code = activityService.generateCode()
    const maxTerminals = Math.min(Math.max(1, session.maxTerminals || 2), 10)
    try {
      const res = await activityService.initiateSession(session.id, code, maxTerminals)
      if (res.success) {
        saveActiveSessionCode(session.id, code)
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
    } finally {
      setIsActivatingSessionId(null)
    }
  }

  const handleCloseSession = async (sessionId: string) => {
    if (!canManageActivities) return
    try {
      const res = await activityService.closeSession(sessionId)
      if (res.success) {
        removeActiveSessionCode(sessionId)
        setLiveMonitorSession(prev => (prev?.id === sessionId ? null : prev))
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
    setIsExecutingAction(true)
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
    } finally {
      setIsExecutingAction(false)
    }
  }

  const handleCancelSession = async (sessionId: string) => {
    if (!canManageActivities) return
    if (!cancelReason.trim() || cancelReason.trim().length < 5) {
      setStatusMsg({ type: 'error', text: 'A cancellation reason of at least 5 characters is required.' })
      return
    }
    setIsExecutingAction(true)
    try {
      const res = await activityService.cancelSession(sessionId, cancelReason)
      if (res.success) {
        removeActiveSessionCode(sessionId)
        setLiveMonitorSession(prev => (prev?.id === sessionId ? null : prev))
        setCancelSessionId('')
        setCancelReason('')
        await loadCurrentSubpathData()
        setStatusMsg({ type: 'success', text: 'Session cancelled and terminal codes revoked.' })
      } else {
        setStatusMsg({ type: 'error', text: res.error || 'Failed to cancel session' })
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Failed to cancel session' })
    } finally {
      setIsExecutingAction(false)
    }
  }

  const handlePostponeSession = async (sessionId: string) => {
    if (!canManageActivities) return
    if (!postponeNewDate || !postponeNewStartTime) {
      setStatusMsg({ type: 'error', text: 'New session date and start time are required.' })
      return
    }
    if (!postponeReason.trim() || postponeReason.trim().length < 5) {
      setStatusMsg({ type: 'error', text: 'A postponement reason of at least 5 characters is required.' })
      return
    }
    setIsExecutingAction(true)
    try {
      const res = await activityService.postponeSession(
        sessionId,
        postponeNewDate,
        postponeNewStartTime,
        postponeNewEndTime || undefined,
        postponeReason
      )
      if (res.success) {
        setPostponeSessionId('')
        setPostponeReason('')
        setPostponeNewDate('')
        setPostponeNewStartTime('')
        setPostponeNewEndTime('')
        await loadCurrentSubpathData()
        setStatusMsg({ type: 'success', text: 'Session postponed and reset to draft with new schedule.' })
      } else {
        setStatusMsg({ type: 'error', text: res.error || 'Failed to postpone session' })
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Failed to postpone session' })
    } finally {
      setIsExecutingAction(false)
    }
  }

  const handleAdjustSession = async (sessionId: string) => {
    if (!canManageActivities) return
    if (!adjustReason.trim() || adjustReason.trim().length < 5) {
      setStatusMsg({ type: 'error', text: 'A mandatory justification reason (at least 5 characters) is required for adjustments.' })
      return
    }
    setIsExecutingAction(true)
    try {
      const res = await activityService.adjustActiveSession(sessionId, adjustReason, {
        title: adjustTitle.trim() || undefined,
        scheduledEndTime: adjustEndTime || null,
        gracePeriodMinutes: Number(adjustGraceMinutes) || 0,
        participatingUnits: adjustSelectedUnits.length > 0 ? adjustSelectedUnits : null
      })
      if (res.success) {
        setAdjustSessionId('')
        setAdjustReason('')
        await loadCurrentSubpathData()
        setStatusMsg({ type: 'success', text: 'Active session adjustments applied and audited successfully.' })
      } else {
        setStatusMsg({ type: 'error', text: res.error || 'Failed to adjust session' })
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Failed to adjust session' })
    } finally {
      setIsExecutingAction(false)
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
        text: humanizeErrorMessage(result.error, 'Failed to record manual check-in.')
      })
    }
  }

  const isSubpathPermitted =
    currentSubpath === 'not-found' || navItems.some((item) => item.id === currentSubpath)

  if (!isSubpathPermitted) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-10 text-center max-w-lg mx-auto my-12 shadow-xl">
          <div className="w-14 h-14 bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800/80 rounded-2xl flex items-center justify-center mx-auto mb-4 text-amber-600 dark:text-amber-400">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Access Restricted</h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
            This page isn&apos;t available to your account. Your assigned leadership role or unit assignments do not permit viewing this module.
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => onNavigateSubpath('dashboard')}
              className="inline-flex items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition"
            >
              Return to Dashboard
            </button>
            <button
              onClick={() => onNavigateSubpath('reports')}
              className="inline-flex items-center px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold transition"
            >
              Open Reports
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Leadership Breadcrumb Header */}
      <div className="mb-4 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <div className="flex items-center space-x-2">
          <span>Leadership Portal</span>
          <span>/</span>
          <span className="font-semibold text-slate-900 dark:text-white capitalize">
            {currentSubpath.replace('-', ' ')}
          </span>
        </div>
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
            {sessions.find((s) => s.status === 'active') && (
              <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-700/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 rounded-lg">
                    <Radio className="w-5 h-5 animate-pulse" />
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-emerald-800 dark:text-emerald-300 tracking-wider">
                      Active Activity Session in Progress
                    </span>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                      {sessions.find((s) => s.status === 'active')?.sessionTitle}
                    </h4>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const s = sessions.find((sess) => sess.status === 'active')
                    if (s) {
                      setLiveMonitorSession(s)
                      onNavigateSubpath('activities')
                    }
                  }}
                  className="inline-flex items-center space-x-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-xs transition"
                >
                  <Radio className="w-3.5 h-3.5" />
                  <span>Open Live Monitor</span>
                </button>
              </div>
            )}
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
                  disabled={isSubmittingUnit}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5"
                >
                  {isSubmittingUnit ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Adding...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Stake Unit</span>
                    </>
                  )}
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
            {liveMonitorSession && (
              <div className="mb-6">
                <LiveActiveSessionView
                  session={liveMonitorSession}
                  units={units}
                  activeCode={activeSessionCodes[liveMonitorSession.id]}
                  onClose={() => setLiveMonitorSession(null)}
                />
              </div>
            )}
            {canManageActivities ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Activity Definition Form */}
                <form onSubmit={handleCreateActivity} className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">Create Activity Template</h3>
                    <button
                      type="button"
                      onClick={() => {
                        setShowActivityCsvModal(true)
                        setActivityImportResult(null)
                      }}
                      className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-md text-[11px] font-medium flex items-center space-x-1.5 transition-colors"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Import CSV</span>
                    </button>
                  </div>
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
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] text-slate-300 uppercase">Category</label>
                      <span className="text-[10px] text-slate-400">Select or type custom (e.g. Gathering Place)</span>
                    </div>
                    <input
                      type="text"
                      list="activity-category-suggestions"
                      value={newActCategory}
                      onChange={(e) => setNewActCategory(e.target.value)}
                      placeholder="e.g. Gathering Place, Skill Acquisition, Spiritual..."
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                    <datalist id="activity-category-suggestions">
                      {categorySuggestions.map(cat => (
                        <option key={cat} value={cat}>
                          {cat.charAt(0).toUpperCase() + cat.slice(1)}
                        </option>
                      ))}
                    </datalist>
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
                  <button
                    type="submit"
                    disabled={isSubmittingActivity}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5"
                  >
                    {isSubmittingActivity ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <span>Save Activity</span>
                    )}
                  </button>
                </form>

                {/* Schedule Session Form */}
                <form onSubmit={handleCreateSession} className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-3">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Schedule Live Session</h3>
                  {activities.length === 0 && (
                    <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-lg text-xs text-amber-200">
                      Create an activity template above before scheduling a session.
                    </div>
                  )}
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
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
                      <label className="block text-[11px] text-slate-300 uppercase mb-1">Scheduled End</label>
                      <input
                        type="time"
                        value={newSessEndTime}
                        onChange={(e) => setNewSessEndTime(e.target.value)}
                        placeholder="Optional"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-300 uppercase mb-1">Grace Period</label>
                      <select
                        value={newSessGraceMinutes}
                        onChange={(e) => setNewSessGraceMinutes(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                      >
                        <option value={0}>Lock immediately</option>
                        <option value={5}>5 minutes grace</option>
                        <option value={10}>10 minutes grace</option>
                        <option value={15}>15 minutes grace</option>
                        <option value={30}>30 minutes grace</option>
                        <option value={60}>60 minutes grace</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
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
                    {newSessEndTime && (
                      <div className="flex flex-col justify-end pb-1 text-[11px] text-emerald-400">
                        <span>Server Lock Time:</span>
                        <span className="font-mono text-white">
                          {newSessEndTime} {newSessGraceMinutes > 0 ? `(+${newSessGraceMinutes}m grace)` : '(Immediate)'} WAT
                        </span>
                      </div>
                    )}
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
                    <button
                      type="submit"
                      disabled={isSubmittingSession || activities.length === 0}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5"
                    >
                      {isSubmittingSession ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Scheduling...</span>
                        </>
                      ) : (
                        <span>Schedule Session</span>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-400">
                Viewing scheduled activities and sessions. Creating activities or initiating terminal codes requires Stake Presidency, System Admin, or YSA Leader authorization.
              </div>
            )}

{/* Activity CSV Import Modal */}
            {showActivityCsvModal && (
              <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 space-y-4 shadow-2xl overflow-y-auto max-h-[90vh]">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <div className="flex items-center space-x-2.5">
                      <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider">Import Activities from CSV</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowActivityCsvModal(false)
                        setActivityCsvText('')
                        setActivityImportResult(null)
                      }}
                      className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    Upload a CSV file containing activity definitions. New and custom categories (such as <strong className="text-emerald-300">Gathering Place</strong> or <strong className="text-emerald-300">Skill Acquisition</strong>) are supported alongside standard categories.
                  </p>

                  <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl space-y-2">
                    <div className="text-[11px] font-semibold text-slate-300">Expected CSV Format:</div>
                    <pre className="text-[10px] text-slate-400 font-mono bg-slate-950 p-2 rounded border border-slate-800 overflow-x-auto">
                      title,category,description{`\n`}
                      "Stake Gathering Place","Gathering Place","Weekly activity center"{`\n`}
                      "Skill Acquisition Workshop","Skill Acquisition","Vocational training"{`\n`}
                      "Stake YSA Sports Night","sports","Friendly football and volleyball"
                    </pre>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-300 uppercase mb-1.5 font-medium">Select CSV File</label>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleActivityCsvFileChange}
                      className="w-full text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-600 file:text-white hover:file:bg-emerald-500 cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-300 uppercase mb-1 font-medium">Or Paste CSV Content</label>
                    <textarea
                      rows={5}
                      value={activityCsvText}
                      onChange={(e) => {
                        setActivityCsvText(e.target.value)
                        setActivityImportResult(null)
                      }}
                      placeholder="Paste CSV text here..."
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  {/* Preview Section */}
                  {parsedCsvPreview && (
                    <div className="space-y-2 border-t border-slate-800 pt-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-white">Parsed Preview:</span>
                        <div className="flex items-center space-x-3 text-[11px]">
                          <span className="text-emerald-400 font-medium">Valid: {parsedCsvPreview.valid.length}</span>
                          {parsedCsvPreview.errors.length > 0 && (
                            <span className="text-rose-400 font-medium">Errors: {parsedCsvPreview.errors.length}</span>
                          )}
                        </div>
                      </div>

                      {/* Display Row-by-Row Errors */}
                      {parsedCsvPreview.errors.length > 0 && (
                        <div className="bg-rose-950/40 border border-rose-900/60 rounded-lg p-2.5 space-y-1 text-xs text-rose-300 max-h-32 overflow-y-auto">
                          <div className="font-bold flex items-center space-x-1">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>Row Validation Issues:</span>
                          </div>
                          <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                            {parsedCsvPreview.errors.map((err, idx) => (
                              <li key={idx}>Row {err.row}: {err.error}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Valid Rows Preview Table */}
                      {parsedCsvPreview.valid.length > 0 && (
                        <div className="max-h-36 overflow-y-auto border border-slate-800 rounded-lg">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-900 text-slate-400 text-[10px] uppercase">
                              <tr>
                                <th className="p-1.5">Line</th>
                                <th className="p-1.5">Title</th>
                                <th className="p-1.5">Category</th>
                                <th className="p-1.5">Description</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60">
                              {parsedCsvPreview.valid.map((r, i) => (
                                <tr key={i} className="hover:bg-slate-900/40 text-slate-300">
                                  <td className="p-1.5 font-mono text-[10px] text-slate-500">{r.rowNumber}</td>
                                  <td className="p-1.5 font-medium text-white">{r.title}</td>
                                  <td className="p-1.5">
                                    <span className="px-1.5 py-0.5 bg-slate-800 rounded text-[10px] text-emerald-300 font-mono">
                                      {r.category}
                                    </span>
                                  </td>
                                  <td className="p-1.5 text-slate-400 truncate max-w-[150px]">{r.description || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => {
                        setShowActivityCsvModal(false)
                        setActivityCsvText('')
                        setActivityImportResult(null)
                      }}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-lg text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isImportingActivities || !parsedCsvPreview || parsedCsvPreview.valid.length === 0}
                      onClick={handleExecuteActivityCsvImport}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5"
                    >
                      {isImportingActivities ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Importing...</span>
                        </>
                      ) : (
                        <>
                          <Upload className="w-3.5 h-3.5" />
                          <span>Import {parsedCsvPreview?.valid.length || 0} Activities</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
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
                      <th className="px-4 py-3">Date & Schedule</th>
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
                          <td className="px-4 py-3">
                            <div>{s.sessionDate} • {s.startTime}</div>
                            {s.scheduledEndTime && (
                              <div className="text-[10px] text-slate-400">
                                Lock: {s.scheduledEndTime} {s.gracePeriodMinutes ? `(+${s.gracePeriodMinutes}m)` : ''}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-semibold ${
                              s.status === 'active'
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                : s.status === 'cancelled'
                                ? 'bg-red-950 text-red-400 border border-red-800'
                                : 'bg-slate-800 text-slate-400'
                            }`}>
                              {s.status}
                            </span>
                            {s.status === 'cancelled' && s.cancellationReason && (
                              <div className="text-[10px] text-red-300 truncate max-w-[140px]" title={s.cancellationReason}>
                                {s.cancellationReason}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">{s.maxTerminals} max</td>
                          <td className="px-4 py-3">
                            {s.status === 'active' && generatedCode ? (
                              <div className="inline-flex items-center space-x-1.5 bg-slate-100 dark:bg-slate-900 border border-emerald-600/40 dark:border-emerald-700/60 px-2 py-1 rounded-lg">
                                <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 tracking-wider text-xs">{generatedCode}</span>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const res = await copyActivityCode(generatedCode)
                                    setStatusMsg({ type: res.success ? 'success' : 'error', text: res.message })
                                  }}
                                  className="p-1 text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-white rounded"
                                  title="Copy 6-character activity code"
                                  aria-label="Copy activity code"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const res = await copyAttendanceLink(window.location.origin, generatedCode)
                                    setStatusMsg({ type: res.success ? 'success' : 'error', text: res.message })
                                  }}
                                  className="p-1 text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-white rounded"
                                  title="Copy public attendance link"
                                  aria-label="Copy attendance link"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : s.status === 'active' ? (
                              <span className="text-[11px] text-slate-400">Code active (hashed)</span>
                            ) : (
                              <span className="text-[11px] text-slate-600">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right space-x-1">
                            {canManageActivities && s.status === 'draft' && (
                              <>
                                <button
                                  onClick={() => handleInitiateSession(s)}
                                  disabled={isActivatingSessionId === s.id}
                                  className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded text-[11px] font-semibold"
                                >
                                  {isActivatingSessionId === s.id ? 'Activating...' : 'Activate'}
                                </button>
                                <button
                                  onClick={() => {
                                    setPostponeSessionId(s.id)
                                    setPostponeNewDate(s.sessionDate)
                                    setPostponeNewStartTime(s.startTime)
                                    setPostponeNewEndTime(s.scheduledEndTime || '')
                                  }}
                                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-[11px] font-semibold"
                                >
                                  Postpone
                                </button>
                                <button
                                  onClick={() => setCancelSessionId(s.id)}
                                  className="px-2 py-1 bg-red-950 hover:bg-red-900 border border-red-800 text-red-300 rounded text-[11px] font-semibold"
                                >
                                  Cancel
                                </button>
                              </>
                            )}
                            {s.status === 'active' && (
                                <button
                                  type="button"
                                  onClick={() => setLiveMonitorSession(s)}
                                  className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-semibold inline-flex items-center space-x-1"
                                  title="Open Live Attendance Monitor"
                                >
                                  <Radio className="w-3 h-3 animate-pulse" />
                                  <span>Live Monitor</span>
                                </button>
                              )}
                              {canManageActivities && s.status === 'active' && (
                              <>
                                <button
                                  onClick={() => handleInitiateSession(s)}
                                  disabled={isActivatingSessionId === s.id}
                                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 rounded text-[11px] font-semibold"
                                >
                                  {isActivatingSessionId === s.id ? 'Rotating...' : 'Rotate'}
                                </button>
                                <button
                                  onClick={() => {
                                    setAdjustSessionId(s.id)
                                    setAdjustTitle(s.sessionTitle)
                                    setAdjustEndTime(s.scheduledEndTime || '')
                                    setAdjustGraceMinutes(s.gracePeriodMinutes || 0)
                                    setAdjustSelectedUnits(s.participatingUnits || [])
                                  }}
                                  className="px-2 py-1 bg-blue-950 hover:bg-blue-900 border border-blue-800 text-blue-300 rounded text-[11px] font-semibold"
                                >
                                  Adjust
                                </button>
                                <button
                                  onClick={() => setCloseSessionId(s.id)}
                                  className="px-2 py-1 bg-red-950 hover:bg-red-900 border border-red-800 text-red-300 rounded text-[11px] font-semibold"
                                >
                                  Close
                                </button>
                                <button
                                  onClick={() => {
                                    setPostponeSessionId(s.id)
                                    setPostponeNewDate(s.sessionDate)
                                    setPostponeNewStartTime(s.startTime)
                                    setPostponeNewEndTime(s.scheduledEndTime || '')
                                  }}
                                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-[11px] font-semibold"
                                >
                                  Postpone
                                </button>
                                <button
                                  onClick={() => setCancelSessionId(s.id)}
                                  className="px-2 py-1 bg-red-950 hover:bg-red-900 border border-red-800 text-red-300 rounded text-[11px] font-semibold"
                                >
                                  Cancel
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

              {/* 1. Close Session Confirmation Modal */}
              {closeSessionId && (
                <div
                  className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="close-session-title"
                >
                  <div className="bg-slate-900 border border-red-800/80 rounded-2xl p-6 max-w-md w-full shadow-2xl animate-terminal-enter">
                    <div className="flex items-center space-x-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-red-950/80 border border-red-800 flex items-center justify-center text-red-400">
                        <AlertCircle className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 id="close-session-title" className="text-base font-bold text-white">Close Activity Session</h3>
                        <p className="text-xs text-slate-400">Revoke terminal access and finalize check-in</p>
                      </div>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed mb-6">
                      Closing this session will immediately disconnect all active kiosk terminals and end attendee check-ins. Closed sessions can only be reopened by a Stake Leader with documented justification.
                    </p>
                    <div className="flex justify-end space-x-3">
                      <button
                        type="button"
                        onClick={() => setCloseSessionId('')}
                        disabled={isExecutingAction}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          setIsExecutingAction(true)
                          await handleCloseSession(closeSessionId)
                          setIsExecutingAction(false)
                          setCloseSessionId('')
                        }}
                        disabled={isExecutingAction}
                        className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5"
                      >
                        {isExecutingAction ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Closing...</span>
                          </>
                        ) : (
                          <span>Confirm Close Session</span>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 2. Adjust Modal Dialog */}
              {adjustSessionId && (
                <div
                  className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="adjust-modal-title"
                >
                  <div className="bg-slate-900 border border-blue-800/80 rounded-2xl p-6 max-w-lg w-full shadow-2xl animate-terminal-enter my-8">
                    <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
                      <div>
                        <h3 id="adjust-modal-title" className="text-sm font-bold text-white">Adjust Active Session</h3>
                        <p className="text-[11px] text-blue-400">Controlled adjustment with mandatory audit justification</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setAdjustSessionId(''); setAdjustReason('') }}
                        className="text-slate-400 hover:text-white p-1 rounded-lg"
                        aria-label="Close dialog"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-[11px] text-slate-300 uppercase mb-1 font-semibold">Adjusted Title</label>
                        <input
                          type="text"
                          value={adjustTitle}
                          onChange={(e) => setAdjustTitle(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] text-slate-300 uppercase mb-1 font-semibold">Scheduled End Time</label>
                          <input
                            type="time"
                            value={adjustEndTime}
                            onChange={(e) => setAdjustEndTime(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-300 uppercase mb-1 font-semibold">Grace Period</label>
                          <select
                            value={adjustGraceMinutes}
                            onChange={(e) => setAdjustGraceMinutes(Number(e.target.value))}
                            className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            <option value={0}>Lock immediately</option>
                            <option value={5}>5 min grace</option>
                            <option value={10}>10 min grace</option>
                            <option value={15}>15 min grace</option>
                            <option value={30}>30 min grace</option>
                            <option value={60}>60 min grace</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] text-slate-300 uppercase mb-1 font-semibold">
                          Mandatory Justification Reason <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          value={adjustReason}
                          onChange={(e) => setAdjustReason(e.target.value)}
                          placeholder="Operational reason for schedule or title adjustment (min 5 chars)..."
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>

                      <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => { setAdjustSessionId(''); setAdjustReason('') }}
                          disabled={isExecutingAction}
                          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAdjustSession(adjustSessionId)}
                          disabled={isExecutingAction || adjustReason.trim().length < 5}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5"
                        >
                          {isExecutingAction ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Applying...</span>
                            </>
                          ) : (
                            <span>Authorize & Apply Adjustments</span>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 3. Postpone Modal Dialog */}
              {postponeSessionId && (
                <div
                  className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="postpone-modal-title"
                >
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl animate-terminal-enter my-8">
                    <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
                      <div>
                        <h3 id="postpone-modal-title" className="text-sm font-bold text-white">Postpone Scheduled Session</h3>
                        <p className="text-[11px] text-slate-400">Reschedule session date and times</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setPostponeSessionId(''); setPostponeReason('') }}
                        className="text-slate-400 hover:text-white p-1 rounded-lg"
                        aria-label="Close dialog"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[11px] text-slate-400 uppercase mb-1 font-semibold">New Date</label>
                          <input
                            type="date"
                            value={postponeNewDate}
                            onChange={(e) => setPostponeNewDate(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-400 uppercase mb-1 font-semibold">New Start Time</label>
                          <input
                            type="time"
                            value={postponeNewStartTime}
                            onChange={(e) => setPostponeNewStartTime(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-400 uppercase mb-1 font-semibold">New End Time</label>
                          <input
                            type="time"
                            value={postponeNewEndTime}
                            onChange={(e) => setPostponeNewEndTime(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] text-slate-400 uppercase mb-1 font-semibold">
                          Postponement Reason <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          value={postponeReason}
                          onChange={(e) => setPostponeReason(e.target.value)}
                          placeholder="e.g. Venue double-booked, rescheduled to next Saturday (min 5 chars)..."
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                        />
                      </div>

                      <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => { setPostponeSessionId(''); setPostponeReason('') }}
                          disabled={isExecutingAction}
                          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePostponeSession(postponeSessionId)}
                          disabled={isExecutingAction || !postponeNewDate || !postponeNewStartTime || postponeReason.trim().length < 5}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5"
                        >
                          {isExecutingAction ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Postponing...</span>
                            </>
                          ) : (
                            <span>Authorize Postponement</span>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 4. Cancel Modal Dialog */}
              {cancelSessionId && (
                <div
                  className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="cancel-modal-title"
                >
                  <div className="bg-slate-900 border border-red-800/80 rounded-2xl p-6 max-w-md w-full shadow-2xl animate-terminal-enter">
                    <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
                      <div>
                        <h3 id="cancel-modal-title" className="text-sm font-bold text-white">Cancel Activity Session</h3>
                        <p className="text-[11px] text-red-400">Terminal codes will be revoked</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setCancelSessionId(''); setCancelReason('') }}
                        className="text-slate-400 hover:text-white p-1 rounded-lg"
                        aria-label="Close dialog"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-[11px] text-slate-300 uppercase mb-1 font-semibold">
                          Cancellation Reason <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          value={cancelReason}
                          onChange={(e) => setCancelReason(e.target.value)}
                          placeholder="Enter reason for cancellation (min 5 chars)..."
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                        />
                      </div>

                      <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => { setCancelSessionId(''); setCancelReason('') }}
                          disabled={isExecutingAction}
                          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg"
                        >
                          Back
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancelSession(cancelSessionId)}
                          disabled={isExecutingAction || cancelReason.trim().length < 5}
                          className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5"
                        >
                          {isExecutingAction ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Cancelling...</span>
                            </>
                          ) : (
                            <span>Confirm Session Cancellation</span>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 5. Reopen Modal Dialog */}
              {reopenSessionId && (
                <div
                  className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="reopen-modal-title"
                >
                  <div className="bg-slate-900 border border-amber-800/80 rounded-2xl p-6 max-w-md w-full shadow-2xl animate-terminal-enter">
                    <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
                      <div>
                        <h3 id="reopen-modal-title" className="text-sm font-bold text-white">Reopen Closed Session</h3>
                        <p className="text-[11px] text-amber-400">Audited 60-minute reopening</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setReopenSessionId(''); setReopenReason('') }}
                        className="text-slate-400 hover:text-white p-1 rounded-lg"
                        aria-label="Close dialog"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-[11px] text-slate-300 uppercase mb-1 font-semibold">
                          Justification Rationale <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          value={reopenReason}
                          onChange={(e) => setReopenReason(e.target.value)}
                          placeholder="Operational reason to reopen closed attendance (min 5 chars)..."
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                        />
                      </div>

                      <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => { setReopenSessionId(''); setReopenReason('') }}
                          disabled={isExecutingAction}
                          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReopenSession(reopenSessionId)}
                          disabled={isExecutingAction || reopenReason.trim().length < 5}
                          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5"
                        >
                          {isExecutingAction ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Reopening...</span>
                            </>
                          ) : (
                            <span>Authorize Reopen (60 min)</span>
                          )}
                        </button>
                      </div>
                    </div>
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
              <div className="p-8 bg-slate-950 border border-slate-800 rounded-2xl text-center text-slate-400 space-y-4">
                <div className="w-14 h-14 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-center mx-auto text-emerald-400 shadow-md">
                  <Shield className="w-7 h-7 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white mb-1">Clerk Read-Only Reporting Scope</h3>
                  <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                    Direct manual attendance check-in is restricted to presiding leaders (Stake Presidency, Bishops, Branch Presidents, and YSA Leaders). As a Clerk, you have complete read-only reporting and audit access.
                  </p>
                </div>
                <div className="flex justify-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => onNavigateSubpath('reports')}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition"
                  >
                    Open Reporting Workspace
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigateSubpath('dashboard')}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl text-xs font-semibold transition"
                  >
                    Return to Dashboard
                  </button>
                </div>
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
                <button
                  type="submit"
                  disabled={isSubmittingMember}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5"
                >
                  {isSubmittingMember ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Registering...</span>
                    </>
                  ) : (
                    <span>Register Member</span>
                  )}
                </button>
              </form>
            ) : (
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-400">
                Read-only member census view for your assigned scope. Registering or archiving members requires Stake Presidency, System Admin, Bishop, Branch President, or assigned YSA Leader authority.
              </div>
            )}

            {/* Census Search & Filter Toolbar */}
            <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl flex flex-wrap gap-3 items-center justify-between">
              <div className="flex flex-wrap gap-3 items-center flex-1 min-w-[240px]">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
                  <input
                    type="text"
                    value={memberSearchQuery}
                    onChange={(e) => setMemberSearchQuery(e.target.value)}
                    placeholder="Search by name, phone, or number..."
                    className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    aria-label="Search members"
                  />
                  {memberSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setMemberSearchQuery('')}
                      className="absolute right-2.5 top-2 text-slate-500 hover:text-white"
                      aria-label="Clear search"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {units.length > 0 && (
                  <select
                    value={memberUnitFilter}
                    onChange={(e) => setMemberUnitFilter(e.target.value)}
                    className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    aria-label="Filter census by unit"
                  >
                    <option value="all">All Units ({units.length})</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.unitName}
                      </option>
                    ))}
                  </select>
                )}

                <select
                  value={memberStatusFilter}
                  onChange={(e) => setMemberStatusFilter(e.target.value as any)}
                  className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  aria-label="Filter census by status"
                >
                  <option value="active">Active Members Only</option>
                  <option value="archived">Archived Records</option>
                  <option value="all">All Statuses</option>
                </select>
              </div>

              <div className="text-xs text-slate-400">
                <span>Showing <strong className="text-white">{filteredMembersList.length}</strong> of {members.length} members</span>
                {(memberSearchQuery || memberUnitFilter !== 'all' || memberStatusFilter !== 'active') && (
                  <button
                    type="button"
                    onClick={() => {
                      setMemberSearchQuery('')
                      setMemberUnitFilter('all')
                      setMemberStatusFilter('active')
                    }}
                    className="ml-3 text-emerald-400 hover:text-emerald-300 underline font-medium"
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            </div>

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
                  {filteredMembersList.map(m => (
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
                  {filteredMembersList.length === 0 && (
                    <tr>
                      <td colSpan={canManageMembers ? 5 : 4} className="px-4 py-6 text-center text-slate-500">
                        {members.length === 0
                          ? 'No members registered in census yet.'
                          : 'No members match the current search or filter criteria.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 6. REPORTS & EXPORTS VIEW */}
        {currentSubpath === 'reports' && (
          <ReportingWorkspace
            units={units}
            activities={activities}
            sessions={sessions}
            members={members}
          />
        )}

        {/* 7. USER GOVERNANCE VIEW */}
        {currentSubpath === 'users' && (
          <div className="space-y-6">
            {!isStakeLeader ? (
              <div className="p-8 bg-slate-950 border border-slate-800 rounded-2xl text-center text-slate-400 space-y-4 max-w-lg mx-auto">
                <div className="w-14 h-14 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-center mx-auto text-amber-400 shadow-md">
                  <ShieldAlert className="w-7 h-7 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white mb-1">Access Restricted to Stake Leadership</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    User provisioning, role assignment, and leadership directory governance require Stake System Administrator (<code className="text-emerald-400 font-mono">system_admin</code>) or Stake Presidency authorization.
                  </p>
                </div>
                <div className="flex justify-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => onNavigateSubpath('dashboard')}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition"
                  >
                    Return to Dashboard
                  </button>
                </div>
              </div>
            ) : (
              <>
                {isSystemAdmin ? (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center bg-slate-900/60 border border-slate-800/80 p-3 rounded-xl">
                      <div>
                        <h4 className="text-xs font-semibold text-white">Leadership Role & Account Administration</h4>
                        <p className="text-[11px] text-slate-400">Authorize roles for existing user profiles or provision newly invited leaders.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowProvForm(!showProvForm)}
                        className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
                      >
                        <UserCheck className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />
                        {showProvForm ? 'Hide Provisioning' : 'Provision User by Email'}
                      </button>
                    </div>

                    {showProvForm && (
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault()
                          try {
                            const res = await adminService.provisionLeadershipUser(
                              {
                                fullName: provName,
                                email: provEmail,
                                role: provRole,
                                unitId: provUnitId || undefined
                              },
                              units
                            )
                            setStatusMsg({ type: 'success', text: res.message })
                            setProvName('')
                            setProvEmail('')
                            setProvUnitId('')
                            setShowProvForm(false)
                            await loadCurrentSubpathData()
                          } catch (err: any) {
                            setStatusMsg({ type: 'error', text: err?.message || 'Provisioning failed' })
                          }
                        }}
                        className="bg-slate-900/80 border border-emerald-900/50 p-4 rounded-xl space-y-3"
                      >
                        <div className="flex items-center space-x-2 text-emerald-400 text-xs font-semibold">
                          <UserCheck className="w-4 h-4" />
                          <span>Provision New Leadership / Clerk Account</span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          Configure leadership role and unit scope. Leadership identities are provisioned securely; once the user account is created, their profile and role assignments are automatically activated.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                          <div>
                            <label className="block text-[11px] text-slate-300 uppercase mb-1">Full Name</label>
                            <input
                              type="text"
                              required
                              value={provName}
                              onChange={(e) => setProvName(e.target.value)}
                              placeholder="e.g. John Doe"
                              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-300 uppercase mb-1">Email Address</label>
                            <input
                              type="email"
                              required
                              value={provEmail}
                              onChange={(e) => setProvEmail(e.target.value)}
                              placeholder="leader@example.com"
                              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-300 uppercase mb-1">Role</label>
                            <select
                              value={provRole}
                              onChange={(e) => {
                                const newRole = e.target.value as AppRole
                                setProvRole(newRole)
                                if (['stake_clerk', 'stake_presidency', 'system_admin'].includes(newRole)) {
                                  setProvUnitId('')
                                }
                              }}
                              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
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
                          <div>
                            <label className="block text-[11px] text-slate-300 uppercase mb-1">Unit Assignment</label>
                            <select
                              value={provUnitId}
                              onChange={(e) => setProvUnitId(e.target.value)}
                              disabled={['stake_clerk', 'stake_presidency', 'system_admin'].includes(provRole)}
                              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white disabled:opacity-50"
                            >
                              {['stake_clerk', 'stake_presidency', 'system_admin'].includes(provRole) ? (
                                <option value="">Stake Wide (All Units)</option>
                              ) : provRole === 'ysa_leader' ? (
                                <>
                                  <option value="">Select Scope</option>
                                  <option value="all">All Stake Units (Approved YSA Scope)</option>
                                  {units.map(u => <option key={u.id} value={u.id}>{u.unitName} ({u.unitType})</option>)}
                                </>
                              ) : (provRole === 'bishop' || provRole === 'ward_clerk') ? (
                                <>
                                  <option value="">Select Ward</option>
                                  {units.filter(u => u.unitType === 'ward').map(u => <option key={u.id} value={u.id}>{u.unitName}</option>)}
                                </>
                              ) : (
                                <>
                                  <option value="">Select Branch</option>
                                  {units.filter(u => u.unitType === 'branch').map(u => <option key={u.id} value={u.id}>{u.unitName}</option>)}
                                </>
                              )}
                            </select>
                          </div>
                        </div>
                        <div className="flex justify-end pt-1">
                          <button
                            type="submit"
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold"
                          >
                            Provision Leadership Account
                          </button>
                        </div>
                      </form>
                    )}

                    <form
                      onSubmit={async (e) => {
                        e.preventDefault()
                        if (!assignUserId) return
                        const unitRequiredRoles: AppRole[] = ['bishop', 'branch_president', 'ysa_leader', 'ward_clerk', 'branch_clerk']
                        if (unitRequiredRoles.includes(assignRole) && !assignUnitId) {
                          setStatusMsg({ type: 'error', text: `Selecting a target ward, branch, or all-unit scope is required when assigning "${assignRole}".` })
                          return
                        }
                        const selectedUnit = units.find(u => u.id === assignUnitId)
                        if (assignUnitId !== 'all') {
                          if ((assignRole === 'bishop' || assignRole === 'ward_clerk') && selectedUnit && selectedUnit.unitType !== 'ward') {
                            setStatusMsg({ type: 'error', text: `${assignRole === 'bishop' ? 'Bishop' : 'Ward Clerk'} role must be assigned to a Ward, not a Branch.` })
                            return
                          }
                          if ((assignRole === 'branch_president' || assignRole === 'branch_clerk') && selectedUnit && selectedUnit.unitType !== 'branch') {
                            setStatusMsg({ type: 'error', text: `${assignRole === 'branch_president' ? 'Branch President' : 'Branch Clerk'} role must be assigned to a Branch, not a Ward.` })
                            return
                          }
                        }
                        try {
                          await adminService.assignUserRole(assignUserId, assignRole)
                          if (assignRole === 'ysa_leader' && assignUnitId === 'all') {
                            await adminService.assignYsaLeaderAllUnits(assignUserId, units)
                          } else if (assignUnitId && assignUnitId !== 'all' && unitRequiredRoles.includes(assignRole)) {
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
                        <label className="block text-[11px] text-slate-300 uppercase mb-1">Existing Leader Profile</label>
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
                          onChange={(e) => {
                            const newRole = e.target.value as any
                            setAssignRole(newRole)
                            if (['stake_clerk', 'stake_presidency', 'system_admin'].includes(newRole)) {
                              setAssignUnitId('')
                            }
                          }}
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
                      <div className="w-48">
                        <label className="block text-[11px] text-slate-300 uppercase mb-1">Assign Unit</label>
                        <select
                          value={assignUnitId}
                          onChange={(e) => setAssignUnitId(e.target.value)}
                          disabled={['stake_clerk', 'stake_presidency', 'system_admin'].includes(assignRole)}
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white disabled:opacity-50"
                        >
                          {['stake_clerk', 'stake_presidency', 'system_admin'].includes(assignRole) ? (
                            <option value="">Stake Wide / None</option>
                          ) : assignRole === 'ysa_leader' ? (
                            <>
                              <option value="">None / Specific Unit</option>
                              <option value="all">All Stake Units (Approved YSA Scope)</option>
                              {units.map(u => <option key={u.id} value={u.id}>{u.unitName} ({u.unitType})</option>)}
                            </>
                          ) : (assignRole === 'bishop' || assignRole === 'ward_clerk') ? (
                            <>
                              <option value="">Select Ward</option>
                              {units.filter(u => u.unitType === 'ward').map(u => <option key={u.id} value={u.id}>{u.unitName}</option>)}
                            </>
                          ) : (
                            <>
                              <option value="">Select Branch</option>
                              {units.filter(u => u.unitType === 'branch').map(u => <option key={u.id} value={u.id}>{u.unitName}</option>)}
                            </>
                          )}
                        </select>
                      </div>
                      <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold">
                        Authorize Role
                      </button>
                    </form>
                  </div>
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
              <div className="p-8 bg-slate-950 border border-slate-800 rounded-2xl text-center text-slate-400 space-y-4 max-w-lg mx-auto">
                <div className="w-14 h-14 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-center mx-auto text-amber-400 shadow-md">
                  <ShieldAlert className="w-7 h-7 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white mb-1">Access Restricted to Stake Leadership</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    The immutable security audit trail is restricted to Stake Presidency and Stake System Administrators.
                  </p>
                </div>
                <div className="flex justify-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => onNavigateSubpath('dashboard')}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition"
                  >
                    Return to Dashboard
                  </button>
                </div>
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
                        <th className="px-4 py-3">Record Type</th>
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
                    <span>Append-only (Server Enforced)</span>
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

        {/* 10. NOT FOUND VIEW */}
        {currentSubpath === 'not-found' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center max-w-lg mx-auto my-12 shadow-xl">
            <div className="w-14 h-14 bg-red-950/60 border border-red-800/80 rounded-2xl flex items-center justify-center mx-auto mb-4 text-red-400">
              <AlertCircle className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-bold text-white mb-2">Leadership Module Not Found</h2>
            <p className="text-xs text-slate-400 mb-6 leading-relaxed">
              The requested leadership subpath does not exist or may have been relocated.
            </p>
            <button
              onClick={() => onNavigateSubpath('dashboard')}
              className="inline-flex items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition"
            >
              Return to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
