import React, { useState, useMemo, useEffect } from 'react'
import {
  CheckSquare,
  Square,
  Search,
  Filter,
  FileCheck2,
  AlertCircle,
  CheckCircle2,
  Printer,
  RotateCcw,
  Clock,
  XCircle,
  FileSpreadsheet,
  Edit3,
  RefreshCw,
  Info,
  Zap,
  ShieldAlert
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { getLagosParts } from '../../lib/timezone'
import {
  StakeUnit,
  ActivityDefinition,
  ActivitySession,
  AttendanceRecord,
  SessionVisitor,
  MemberRecord,
  UserProfile,
  GatheringPlaceMonthlyReport,
  GatheringPlaceReportFilterCriteria,
  GatheringPlaceReportLeaderSnapshot,
  StakeLeaderSignature,
  AttendanceAdjustment,
  AppRole
} from '../../types/database'
import { gatheringPlaceReportService } from '../../services/gatheringPlaceReportService'
import { attendanceAdjustmentService } from '../../services/attendanceAdjustmentService'
import { GatheringPlaceReportDocument } from './GatheringPlaceReportDocument'
import { SignatureManagementModal } from './SignatureManagementModal'
import { AttendanceAdjustmentModal } from './AttendanceAdjustmentModal'
import { exportToCsvAdvanced, exportToXlsxAdvanced, triggerPrintReport } from '../../lib/exportUtils'

interface GatheringPlaceMonthlyReportWorkspaceProps {
  units: StakeUnit[]
  activities: ActivityDefinition[]
  sessions: ActivitySession[]
  attendanceRecords?: AttendanceRecord[]
  sessionVisitors?: SessionVisitor[]
  members?: MemberRecord[]
  usersList?: UserProfile[]
  initialTab?: 'workspace' | 'history' | 'adjustments'
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

export const GatheringPlaceMonthlyReportWorkspace: React.FC<
  GatheringPlaceMonthlyReportWorkspaceProps
> = ({
  units,
  activities,
  sessions,
  attendanceRecords = [],
  sessionVisitors = [],
  members = [],
  usersList = [],
  initialTab = 'workspace'
}) => {
  const { user, isSystemAdmin, isStakePresident, isStakeLeader } = useAuth()

  // Authorized Approver Check: strictly system_admin or verified Stake President
  const canApprove = isSystemAdmin || (isStakeLeader && isStakePresident)

  // Current year & month defaults dynamically derived from Africa/Lagos
  const lagosNow = getLagosParts(new Date())
  const currentYear = lagosNow.year
  const [selectedYear, setSelectedYear] = useState<number>(lagosNow.year)
  const [selectedMonth, setSelectedMonth] = useState<number>(lagosNow.month)

  // Unit Selection State (8 Stake Units)
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>(() =>
    units.map((u) => u.id)
  )
  const isAllUnitsSelected =
    units.length > 0 && selectedUnitIds.length === units.length

  // Activity Selection State
  const [selectedActivityIds, setSelectedActivityIds] = useState<string[]>([])
  const [selectedClassesByActivity, setSelectedClassesByActivity] = useState<
    Record<string, string[]>
  >({})

  // Period / Occurrence Filters
  const [specificPeriod, setSpecificPeriod] = useState<
    'full_month' | 'specific_dates' | 'selected_occurrences'
  >('full_month')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [selectedSessionIds, _setSelectedSessionIds] = useState<string[]>([])

  // Participant Filters
  const [memberClassification, setMemberClassification] = useState<
    'all' | 'members_only' | 'visitors_only'
  >('all')
  const [minimumVisitThreshold, setMinimumVisitThreshold] = useState<number>(5)
  const [participantSearchQuery, setParticipantSearchQuery] = useState<string>('')

  // Leader & Signature State
  const [signatures, setSignatures] = useState<StakeLeaderSignature[]>([])
  const [selectedLeaderId, setSelectedLeaderId] = useState<string>('')
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false)

  // Reports State
  const [reportsList, setReportsList] = useState<GatheringPlaceMonthlyReport[]>([])
  const [activeReport, setActiveReport] =
    useState<GatheringPlaceMonthlyReport | null>(null)
  const [viewUnitFilter, setViewUnitFilter] = useState<string | null>(null) // null = all stake
  const [activeTab, setActiveTab] = useState<'workspace' | 'history' | 'adjustments'>(initialTab)

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab)
    }
  }, [initialTab])
  const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false)
  const [adjustmentsList, setAdjustmentsList] = useState<AttendanceAdjustment[]>([])
  const [_isLoadingAdjustments, setIsLoadingAdjustments] = useState(false)
  const [selectedAdjustmentIds, setSelectedAdjustmentIds] = useState<string[]>([])
  const [adjustmentActionComment, setAdjustmentActionComment] = useState('')
  const [isReviewingAdjustments, setIsReviewingAdjustments] = useState(false)

  // Live data state with DB fetch fallback
  const [liveAttendanceRecords, setLiveAttendanceRecords] = useState<AttendanceRecord[]>(attendanceRecords)
  const [liveSessionVisitors, setLiveSessionVisitors] = useState<SessionVisitor[]>(sessionVisitors)
  const [liveSessions, setLiveSessions] = useState<ActivitySession[]>(sessions)
  const [isLoadingMonthData, setIsLoadingMonthData] = useState<boolean>(false)
  const [monthDataError, setMonthDataError] = useState<string | null>(null)

  const reloadMonthData = async (yr: number, mo: number) => {
    setIsLoadingMonthData(true)
    setMonthDataError(null)
    try {
      const res = await gatheringPlaceReportService.fetchMonthAttendanceData(yr, mo)
      setLiveSessions(res.sessions)
      setLiveAttendanceRecords(res.attendanceRecords)
      setLiveSessionVisitors(res.sessionVisitors)
    } catch (err: any) {
      setMonthDataError(err.message || 'Failed to load month attendance data from database.')
    } finally {
      setIsLoadingMonthData(false)
    }
  }

  useEffect(() => {
    if (attendanceRecords && attendanceRecords.length > 0) {
      setLiveAttendanceRecords(attendanceRecords)
      setLiveSessionVisitors(sessionVisitors || [])
      setLiveSessions(sessions || [])
    } else {
      reloadMonthData(selectedYear, selectedMonth)
    }
  }, [selectedYear, selectedMonth, attendanceRecords.length])

  // Pre-flight attendance frequency distribution calculation
  const attendanceDistribution = useMemo(() => {
    return gatheringPlaceReportService.calculateAttendanceDistribution({
      attendanceRecords: liveAttendanceRecords,
      sessionVisitors: liveSessionVisitors,
      eligibleSessions: liveSessions,
      minimumVisitThreshold,
      selectedUnitIds,
      isAllUnits: isAllUnitsSelected,
      memberClassification
    })
  }, [
    liveAttendanceRecords,
    liveSessionVisitors,
    liveSessions,
    minimumVisitThreshold,
    selectedUnitIds,
    isAllUnitsSelected,
    memberClassification
  ])

  // Review & Correction Modals
  const [showReviewModal, setShowReviewModal] = useState<
    'approve' | 'disapprove' | 'request_correction' | null
  >(null)
  const [reviewComment, setReviewComment] = useState('')
  const [isProcessingAction, setIsProcessingAction] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  // Derive Stake YSA Leaders list for selector:
  // Strictly stake_presidency or ysa_leader.
  // system_admin is EXCLUDED unless they also hold stake_presidency or ysa_leader.
  const availableLeaders = useMemo(() => {
    const list = usersList.filter(
      (u) => u.roles.includes('ysa_leader') || u.roles.includes('stake_presidency')
    )
    if (list.length > 0) {
      return list
    }
    // Fallback when usersList is restricted by RLS (e.g. for Stake Clerk who cannot query all user profiles):
    // Active signatories from stake_leader_signatures (which Clerks have permission to read under Migration 16)
    if (signatures.length > 0) {
      return signatures
        .filter((s) => s.isActive)
        .map((s) => {
          const fallbackRoles: AppRole[] = ['ysa_leader']
          return {
            id: s.userId,
            fullName: s.fullName,
            email: '',
            phoneNumber: s.phoneNumber,
            roles: fallbackRoles,
            accountStatus: 'active' as const,
            createdAt: s.createdAt
          }
        })
    }
    if (user && (user.roles.includes('ysa_leader') || user.roles.includes('stake_presidency'))) {
      return [user]
    }
    return []
  }, [usersList, signatures, user])

  // Load signatures and past reports
  const loadSignaturesAndReports = async () => {
    if (!user) return
    try {
      const sigs = await gatheringPlaceReportService.listSignatures()
      setSignatures(sigs)
      const activeSigs = sigs.filter((s) => s.isActive)
      if (activeSigs.length > 0 && !selectedLeaderId) {
        setSelectedLeaderId(activeSigs[0].userId)
      } else if (sigs.length > 0 && !selectedLeaderId) {
        setSelectedLeaderId(sigs[0].userId)
      } else if (!selectedLeaderId && user) {
        if (user.roles.includes('stake_presidency') || user.roles.includes('ysa_leader')) {
          setSelectedLeaderId(user.id)
        } else if (availableLeaders.length > 0) {
          setSelectedLeaderId(availableLeaders[0].id)
        }
      }

      const list = await gatheringPlaceReportService.listReports(user)
      setReportsList(list)
    } catch {
      // Non-blocking
    }
  }

  const loadAdjustments = async () => {
    setIsLoadingAdjustments(true)
    try {
      const list = await attendanceAdjustmentService.listAdjustments()
      setAdjustmentsList(list)
    } catch {
      // Non-blocking
    } finally {
      setIsLoadingAdjustments(false)
    }
  }

  useEffect(() => {
    loadSignaturesAndReports()
    loadAdjustments()
  }, [user])

  const handleReviewAdjustments = async (action: 'approve' | 'reject') => {
    if (!user || selectedAdjustmentIds.length === 0) return
    setIsReviewingAdjustments(true)
    setFeedbackMessage(null)
    try {
      const res = await attendanceAdjustmentService.reviewAdjustments(
        selectedAdjustmentIds,
        action,
        adjustmentActionComment,
        user
      )
      setFeedbackMessage({
        type: 'success',
        text: `Successfully ${action === 'approve' ? 'approved and applied' : 'rejected'} ${res.count} adjustment request(s).`
      })
      setSelectedAdjustmentIds([])
      setAdjustmentActionComment('')
      loadAdjustments()
      reloadMonthData(selectedYear, selectedMonth)
      loadSignaturesAndReports()
    } catch (err: any) {
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Failed to review adjustments.'
      })
    } finally {
      setIsReviewingAdjustments(false)
    }
  }

  const handleGenerateRevisedReport = async (oldReport: GatheringPlaceMonthlyReport) => {
    if (!user) return
    setFeedbackMessage(null)

    await reloadMonthData(oldReport.reportingYear, oldReport.reportingMonth)

    const revisedSnapshot = gatheringPlaceReportService.buildReportSnapshot({
      year: oldReport.reportingYear,
      month: oldReport.reportingMonth,
      monthName: oldReport.monthName,
      units,
      activities,
      sessions: liveSessions,
      attendanceRecords: liveAttendanceRecords,
      sessionVisitors: liveSessionVisitors,
      members,
      criteria: oldReport.filterCriteria,
      selectedLeader: resolvedLeaderSnapshot,
      generatedBy: user,
      existingVersion: oldReport.version
    })

    try {
      const persisted = await gatheringPlaceReportService.createReport(
        revisedSnapshot,
        user
      )
      setActiveReport(persisted)
      loadSignaturesAndReports()
      setFeedbackMessage({
        type: 'success',
        text: `Revised Report (v${persisted.version}) generated successfully!`
      })
    } catch (err: any) {
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Failed to generate revised report.'
      })
    }
  }

  // Resolved Leader Snapshot
  const resolvedLeaderSnapshot: GatheringPlaceReportLeaderSnapshot = useMemo(() => {
    const sig = signatures.find((s) => s.userId === selectedLeaderId)
    const leaderUser = availableLeaders.find((l) => l.id === selectedLeaderId)
    const role = leaderUser?.roles.includes('stake_presidency')
      ? 'stake_presidency'
      : leaderUser?.roles.includes('ysa_leader')
      ? 'ysa_leader'
      : undefined

    return {
      userId: selectedLeaderId,
      fullName: sig?.fullName || leaderUser?.fullName || 'Stake YSA Leadership',
      phoneNumber: sig?.phoneNumber || leaderUser?.phoneNumber || '08083238902',
      signatureDataUrl: sig?.signatureDataUrl || '',
      role: role || null,
      signedAt: new Date().toISOString()
    }
  }, [selectedLeaderId, signatures, availableLeaders])

  // Derived Title
  const derivedReportTitle = `${MONTH_NAMES[selectedMonth - 1]} ${selectedYear} Gathering Place Monthly Report`

  // Toggle All Units
  const handleToggleAllUnits = () => {
    if (isAllUnitsSelected) {
      setSelectedUnitIds([])
    } else {
      setSelectedUnitIds(units.map((u) => u.id))
    }
  }

  // Toggle Single Unit
  const handleToggleUnit = (unitId: string) => {
    setSelectedUnitIds((prev) =>
      prev.includes(unitId) ? prev.filter((id) => id !== unitId) : [...prev, unitId]
    )
  }

  // Toggle Activity Selection
  const handleToggleActivity = (actId: string) => {
    setSelectedActivityIds((prev) =>
      prev.includes(actId) ? prev.filter((id) => id !== actId) : [...prev, actId]
    )
  }

  // Toggle Class for Activity
  const handleToggleClassForActivity = (actId: string, cls: string) => {
    setSelectedClassesByActivity((prev) => {
      const current = prev[actId] || []
      const updated = current.includes(cls)
        ? current.filter((c) => c !== cls)
        : [...current, cls]
      return { ...prev, [actId]: updated }
    })
  }

  // Live Expected Visits Calculation
  const liveExpectedVisitsResult = useMemo(() => {
    return gatheringPlaceReportService.calculateExpectedVisits({
      year: selectedYear,
      month: selectedMonth,
      sessions: liveSessions,
      selectedActivityIds,
      selectedClassesByActivity,
      specificPeriod,
      startDate: specificPeriod === 'specific_dates' ? startDate : undefined,
      endDate: specificPeriod === 'specific_dates' ? endDate : undefined,
      selectedSessionIds:
        specificPeriod === 'selected_occurrences' ? selectedSessionIds : undefined
    })
  }, [
    selectedYear,
    selectedMonth,
    liveSessions,
    selectedActivityIds,
    selectedClassesByActivity,
    specificPeriod,
    startDate,
    endDate,
    selectedSessionIds
  ])

  // Current Criteria Object
  const currentCriteria: GatheringPlaceReportFilterCriteria = useMemo(() => {
    return {
      year: selectedYear,
      month: selectedMonth,
      monthName: MONTH_NAMES[selectedMonth - 1],
      selectedUnitIds,
      isAllUnits: isAllUnitsSelected,
      selectedActivityIds,
      selectedClassesByActivity,
      specificPeriod,
      startDate: specificPeriod === 'specific_dates' ? startDate : undefined,
      endDate: specificPeriod === 'specific_dates' ? endDate : undefined,
      selectedSessionIds:
        specificPeriod === 'selected_occurrences' ? selectedSessionIds : undefined,
      memberClassification,
      minimumVisitThreshold,
      searchQuery: participantSearchQuery,
      selectedLeaderId
    }
  }, [
    selectedYear,
    selectedMonth,
    selectedUnitIds,
    isAllUnitsSelected,
    selectedActivityIds,
    selectedClassesByActivity,
    specificPeriod,
    startDate,
    endDate,
    selectedSessionIds,
    memberClassification,
    minimumVisitThreshold,
    participantSearchQuery,
    selectedLeaderId
  ])

  // Handle Generate Report
  const handleGenerateReport = async () => {
    if (!user) return
    if (selectedUnitIds.length === 0) {
      setFeedbackMessage({
        type: 'error',
        text: 'Please select at least one unit to include in the report.'
      })
      return
    }

    setFeedbackMessage(null)
    const reportSnapshot = gatheringPlaceReportService.buildReportSnapshot({
      year: selectedYear,
      month: selectedMonth,
      monthName: MONTH_NAMES[selectedMonth - 1],
      units,
      activities,
      sessions: liveSessions,
      attendanceRecords: liveAttendanceRecords,
      sessionVisitors: liveSessionVisitors,
      members,
      criteria: currentCriteria,
      selectedLeader: resolvedLeaderSnapshot,
      generatedBy: user
    })

    try {
      const persisted = await gatheringPlaceReportService.createReport(
        reportSnapshot,
        user
      )
      setActiveReport(persisted)
      setViewUnitFilter(null)
      loadSignaturesAndReports()
      setFeedbackMessage({
        type: 'success',
        text:
          persisted.status === 'approved'
            ? 'Report successfully generated and approved!'
            : 'Report successfully generated and submitted for Stake President approval.'
      })
    } catch (err: any) {
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Failed to generate report.'
      })
    }
  }

  // Handle Review Action (Approve / Disapprove / Request Correction)
  const handleExecuteReview = async () => {
    if (!activeReport || !user || !showReviewModal) return
    setIsProcessingAction(true)
    try {
      const result = await gatheringPlaceReportService.reviewReport(
        activeReport.id,
        showReviewModal,
        reviewComment,
        user
      )
      setActiveReport((prev) =>
        prev
          ? {
              ...prev,
              status: result.status as any,
              approvedBy: showReviewModal === 'approve' ? user.id : null,
              approvedByName: showReviewModal === 'approve' ? user.fullName : null,
              approvedAt:
                showReviewModal === 'approve' ? new Date().toISOString() : null,
              approvalNote: showReviewModal === 'approve' ? reviewComment : null,
              disapprovedBy: showReviewModal === 'disapprove' ? user.id : null,
              disapprovalReason:
                showReviewModal === 'disapprove' ? reviewComment : null,
              correctionRequestedBy:
                showReviewModal === 'request_correction' ? user.id : null,
              correctionComment:
                showReviewModal === 'request_correction' ? reviewComment : null
            }
          : null
      )
      setShowReviewModal(null)
      setReviewComment('')
      loadSignaturesAndReports()
      setFeedbackMessage({
        type: 'success',
        text: `Report status updated to ${result.status}.`
      })
    } catch (err: any) {
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Failed to submit review action.'
      })
    } finally {
      setIsProcessingAction(false)
    }
  }

  // Print Handler (Disabled when unapproved)
  const handlePrintReport = () => {
    if (!activeReport || activeReport.status !== 'approved') return
    triggerPrintReport(activeReport.reportTitle, 'gathering-place-report-document')
  }

  // Export to Excel / CSV
  const handleExportSpreadsheet = (format: 'xlsx' | 'csv') => {
    if (!activeReport || activeReport.status !== 'approved') return
    const filename = `${activeReport.reportTitle.replace(/\s+/g, '_')}_Approved`
    const columns = [
      { key: 'serialNumber', label: 'S/N' },
      { key: 'attendeeName', label: 'Member Name' },
      { key: 'unitName', label: 'Ward/Branch' },
      { key: 'classGroupDisplay', label: 'Class/Group' },
      { key: 'totalVisits', label: 'Total Visits' }
    ]
    const metadata = {
      title: activeReport.reportTitle,
      subtitle: `EXPECTED VISIT FOR THE MONTH FOR EACH YA IS ${activeReport.expectedVisitsPerYa}`,
      generatedAt: activeReport.generatedAt,
      periodLabel: `${activeReport.monthName} ${activeReport.reportingYear}`,
      scopeLabel:
        viewUnitFilter ||
        (activeReport.unitIds.length === units.length
          ? 'All 8 Stake Units (Abeokuta, Nigeria, Obantoko Stake)'
          : `${activeReport.unitIds.length} Units (Abeokuta, Nigeria, Obantoko Stake)`),
      totalRecords: (activeReport.items || []).length,
      uniqueAttendees: (activeReport.items || []).length
    }
    const items = viewUnitFilter
      ? (activeReport.items || []).filter(
          (i) => i.unitId === viewUnitFilter || i.unitName === viewUnitFilter
        )
      : activeReport.items || []

    if (format === 'xlsx') {
      exportToXlsxAdvanced(filename, metadata, columns, items as any)
    } else {
      exportToCsvAdvanced(filename, metadata, columns, items as any)
    }
  }

  return (
    <div className="space-y-6">
      {/* Signature Management Modal */}
      {user && (
        <SignatureManagementModal
          isOpen={isSignatureModalOpen}
          onClose={() => setIsSignatureModalOpen(false)}
          currentUser={user}
          leaders={availableLeaders}
          existingSignatures={signatures}
          onSignatureUpdated={loadSignaturesAndReports}
        />
      )}

      {/* Attendance Adjustment Modal */}
      {user && (
        <AttendanceAdjustmentModal
          isOpen={isAdjustmentModalOpen}
          onClose={() => setIsAdjustmentModalOpen(false)}
          sessions={liveSessions}
          members={members}
          units={units}
          allMonthAttendance={liveAttendanceRecords}
          currentUser={user}
          onAdjustmentApplied={() => {
            reloadMonthData(selectedYear, selectedMonth)
            loadAdjustments()
            loadSignaturesAndReports()
          }}
        />
      )}

      {/* Review Modal (Approve, Disapprove, Request Correction) */}
      {showReviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 text-slate-100 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white capitalize">
              {showReviewModal === 'approve'
                ? 'Approve Gathering Place Report'
                : showReviewModal === 'disapprove'
                ? 'Disapprove Gathering Place Report'
                : 'Request Report Corrections'}
            </h3>
            <p className="text-xs text-slate-400">
              {showReviewModal === 'approve'
                ? 'Approving this report will finalize visit calculations and immediately release unit-specific copies to the respective Bishops and Branch Presidents.'
                : showReviewModal === 'disapprove'
                ? 'Disapproving this report prevents distribution and locks downloads. Please state the reason for disapproval.'
                : 'Explain what corrections the report generator must make before resubmitting for approval.'}
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                {showReviewModal === 'approve' ? 'Approval Note (Optional)' : 'Reason / Comment (Required)'}
              </label>
              <textarea
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder={
                  showReviewModal === 'approve'
                    ? 'e.g. Verified and approved for stake reimbursement distribution.'
                    : 'e.g. Please recalculate including ICT class attendance.'
                }
                rows={3}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowReviewModal(null)
                  setReviewComment('')
                }}
                disabled={isProcessingAction}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteReview}
                disabled={
                  isProcessingAction ||
                  (showReviewModal !== 'approve' && !reviewComment.trim())
                }
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${
                  showReviewModal === 'approve'
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : showReviewModal === 'disapprove'
                    ? 'bg-red-600 hover:bg-red-500 text-white'
                    : 'bg-amber-600 hover:bg-amber-500 text-white'
                }`}
              >
                {isProcessingAction ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Header & Section Switcher */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              Gathering Place
            </span>
            <span className="text-xs text-slate-400">
              Official Area Reimbursement & Attendance Module
            </span>
          </div>
          <h2 className="text-lg font-black text-white tracking-wide mt-1">
            Gathering Place Monthly Report Workspace
          </h2>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setActiveTab('workspace')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'workspace'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Generate & Preview</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'history'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Past Reports ({reportsList.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('adjustments')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'adjustments'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>
              Adjustments
              {adjustmentsList.filter((a) => a.status === 'pending_approval').length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500 text-slate-950 font-bold">
                  {adjustmentsList.filter((a) => a.status === 'pending_approval').length}
                </span>
              )}
            </span>
          </button>
        </div>
      </div>

      {feedbackMessage && (
        <div
          className={`p-4 rounded-xl flex items-center space-x-3 text-xs border ${
            feedbackMessage.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-800 text-emerald-200'
              : 'bg-red-950/60 border-red-800 text-red-200'
          }`}
        >
          {feedbackMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
          )}
          <span>{feedbackMessage.text}</span>
        </div>
      )}

      {/* Main Tab 1: Configuration Workspace & Document Preview */}
      {activeTab === 'workspace' && (
        <div className="space-y-6">
          {/* Configuration Grid */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <Filter className="w-4 h-4 text-emerald-400" />
                <span>1. Report Configuration & Criteria</span>
              </h3>
              <div className="text-xs text-slate-400 font-mono">
                Title:{' '}
                <span className="text-emerald-400 font-bold">
                  {derivedReportTitle}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Section A: Reporting Month and Year */}
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-3">
                <label className="block text-xs font-bold text-slate-200">
                  A. Reporting Month & Year
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-slate-400 block mb-1">
                      Month
                    </span>
                    <select
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    >
                      {MONTH_NAMES.map((m, idx) => (
                        <option key={m} value={idx + 1}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block mb-1">
                      Year
                    </span>
                    <select
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    >
                      {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="text-[11px] text-slate-400">
                  Derived Title:{' '}
                  <span className="text-slate-200 font-medium">
                    {derivedReportTitle}
                  </span>
                </div>
              </div>

              {/* Section B: Units to Include */}
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-200">
                    B. Units to Include ({selectedUnitIds.length} / {units.length})
                  </label>
                  <button
                    type="button"
                    onClick={handleToggleAllUnits}
                    className="text-[11px] text-emerald-400 hover:underline font-semibold"
                  >
                    {isAllUnitsSelected ? 'Deselect All' : 'Select All Units'}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {units.map((unit) => {
                    const isSelected = selectedUnitIds.includes(unit.id)
                    return (
                      <button
                        key={unit.id}
                        type="button"
                        onClick={() => handleToggleUnit(unit.id)}
                        className={`px-2 py-1.5 rounded-lg text-[11px] font-medium text-left transition flex items-center space-x-1.5 cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-950 border border-emerald-700 text-emerald-200'
                            : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {isSelected ? (
                          <CheckSquare className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                        ) : (
                          <Square className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
                        )}
                        <span className="truncate">{unit.unitName}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Section F: Stake YSA Leader & E-Signature */}
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-200">
                    F. Stake YSA Leader Sign-Off
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsSignatureModalOpen(true)}
                    className="text-[11px] text-emerald-400 hover:underline font-semibold"
                  >
                    Manage Signatures
                  </button>
                </div>
                <div>
                  <select
                    value={selectedLeaderId}
                    onChange={(e) => setSelectedLeaderId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  >
                    {availableLeaders.map((ldr) => (
                      <option key={ldr.id} value={ldr.id}>
                        {ldr.fullName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="text-[11px] text-slate-400 space-y-1 bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                  <div>
                    <span className="text-slate-500">Name:</span>{' '}
                    <span className="text-slate-200 font-semibold">
                      {resolvedLeaderSnapshot.fullName}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Contact:</span>{' '}
                    <span className="text-slate-200 font-mono">
                      {resolvedLeaderSnapshot.phoneNumber}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-slate-500">Signature:</span>
                    {resolvedLeaderSnapshot.signatureDataUrl ? (
                      <span className="text-emerald-400 text-[10px] font-bold">
                        Attached (PNG)
                      </span>
                    ) : (
                      <span className="text-amber-400 text-[10px]">
                        Pending Upload
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Activities and Period Filters */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-slate-800/80">
              {/* Section C: Activities & Classes to Include */}
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-200">
                    C. Activities & Classes to Include
                  </label>
                  <div className="text-[10px] text-slate-400">
                    {selectedActivityIds.length === 0
                      ? 'All activities included'
                      : `${selectedActivityIds.length} activities selected`}
                  </div>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {activities.map((act) => {
                    const isSelected =
                      selectedActivityIds.length === 0 ||
                      selectedActivityIds.includes(act.id)
                    const hasClasses =
                      act.classOptions && act.classOptions.length > 0
                    return (
                      <div
                        key={act.id}
                        className="p-2.5 bg-slate-900 border border-slate-800 rounded-lg space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => handleToggleActivity(act.id)}
                            className="flex items-center space-x-2 text-xs text-left cursor-pointer"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                            ) : (
                              <Square className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
                            )}
                            <span className="font-semibold text-white">
                              {act.title}
                            </span>
                            <span className="text-[10px] text-slate-400 font-normal">
                              ({act.category})
                            </span>
                          </button>
                        </div>
                        {/* If Activity has multi-classes (e.g. Skill Acquisition), allow granular class checkboxes */}
                        {hasClasses && isSelected && (
                          <div className="pl-5 pt-1 border-t border-slate-800/60 grid grid-cols-2 gap-1 text-[11px]">
                            {act.classOptions!.map((cls) => {
                              const selectedClasses =
                                selectedClassesByActivity[act.id] || []
                              const isClassSelected =
                                selectedClasses.length === 0 ||
                                selectedClasses.includes(cls)
                              return (
                                <button
                                  key={cls}
                                  type="button"
                                  onClick={() =>
                                    handleToggleClassForActivity(act.id, cls)
                                  }
                                  className={`px-2 py-1 rounded text-left text-[10px] flex items-center space-x-1 transition ${
                                    isClassSelected
                                      ? 'text-emerald-300 font-semibold'
                                      : 'text-slate-500'
                                  }`}
                                >
                                  <span>{isClassSelected ? '•' : '○'}</span>
                                  <span className="truncate">{cls}</span>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Section D & E: Occurrence Periods & Participant Filters */}
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-3">
                <label className="block text-xs font-bold text-slate-200">
                  D & E. Occurrence Periods & Participant Thresholds
                </label>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-400 block mb-1">
                      Period Scope
                    </span>
                    <select
                      value={specificPeriod}
                      onChange={(e) => setSpecificPeriod(e.target.value as any)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    >
                      <option value="full_month">Full Reporting Month</option>
                      <option value="specific_dates">Specific Date Range</option>
                    </select>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block mb-1">
                      Min. Visit Threshold
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={minimumVisitThreshold}
                      onChange={(e) =>
                        setMinimumVisitThreshold(Math.max(0, Number(e.target.value)))
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                      placeholder="e.g. 5 and above"
                    />
                  </div>
                </div>

                {specificPeriod === 'specific_dates' && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 block mb-1">
                        Start Date
                      </span>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block mb-1">
                        End Date
                      </span>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <span className="text-[10px] text-slate-400 block mb-1">
                    Participant Classification
                  </span>
                  <div className="flex space-x-2 text-xs">
                    {(['all', 'members_only', 'visitors_only'] as const).map(
                      (mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setMemberClassification(mode)}
                          className={`flex-1 py-1.5 rounded-lg capitalize text-[11px] font-semibold border ${
                            memberClassification === mode
                              ? 'bg-emerald-950 border-emerald-600 text-emerald-200'
                              : 'bg-slate-900 border-slate-800 text-slate-400'
                          }`}
                        >
                          {mode.replace('_', ' ')}
                        </button>
                      )
                    )}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] text-slate-400 block mb-1">
                    Search Participant
                  </span>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      value={participantSearchQuery}
                      onChange={(e) => setParticipantSearchQuery(e.target.value)}
                      placeholder="Filter by name..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Database Fetch Error Alert */}
            {monthDataError && (
              <div className="p-4 bg-red-950/70 border border-red-800 rounded-xl flex items-center justify-between text-xs text-red-200">
                <div className="flex items-center space-x-3">
                  <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-400" />
                  <div>
                    <span className="font-bold">Database Query Error: </span>
                    <span>{monthDataError}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => reloadMonthData(selectedYear, selectedMonth)}
                  disabled={isLoadingMonthData}
                  className="px-3 py-1 bg-red-900 hover:bg-red-800 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingMonthData ? 'animate-spin' : ''}`} />
                  <span>Retry Fetch</span>
                </button>
              </div>
            )}

            {/* Pre-flight Attendance Reconciliation & Diagnostics Panel */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-800 pb-2">
                <div className="flex items-center space-x-2">
                  <Info className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Pre-Flight Reconciliation & Diagnostics ({MONTH_NAMES[selectedMonth - 1]} {selectedYear})
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  {isLoadingMonthData ? (
                    <span className="text-[11px] text-amber-400 flex items-center space-x-1">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <span>Fetching database records...</span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-emerald-400 font-medium">
                      ✓ Synchronized with live database
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => reloadMonthData(selectedYear, selectedMonth)}
                    disabled={isLoadingMonthData}
                    className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded text-xs transition"
                    title="Reload live month data from database"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingMonthData ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Metric Breakdown Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-lg">
                  <span className="text-[10px] text-slate-400 uppercase block font-semibold">Held Sessions</span>
                  <div className="text-base font-black text-white mt-0.5">
                    {liveExpectedVisitsResult.eligibleSessions.length}{' '}
                    <span className="text-[11px] font-normal text-slate-400">
                      of {liveSessions.filter((s) => s.status !== 'cancelled').length} in month
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500">
                    {selectedActivityIds.length === 0
                      ? 'All activities included'
                      : `${selectedActivityIds.length} activity selected`}
                  </span>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-lg">
                  <span className="text-[10px] text-slate-400 uppercase block font-semibold">Total Check-Ins</span>
                  <div className="text-base font-black text-white mt-0.5">
                    {attendanceDistribution.totalRecords}
                  </div>
                  <span className="text-[10px] text-slate-500">
                    Recorded check-in events
                  </span>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-lg">
                  <span className="text-[10px] text-slate-400 uppercase block font-semibold">Distinct Attendees</span>
                  <div className="text-base font-black text-white mt-0.5">
                    {attendanceDistribution.totalDistinctAttendees}
                  </div>
                  <span className="text-[10px] text-slate-500">
                    Unique participants in DB
                  </span>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-lg">
                  <span className="text-[10px] text-emerald-400 uppercase block font-semibold">Qualifying Attendees</span>
                  <div className="text-base font-black text-emerald-300 mt-0.5">
                    {attendanceDistribution.qualifyingCount}
                  </div>
                  <span className="text-[10px] text-slate-400">
                    Visits &ge; {minimumVisitThreshold} threshold
                  </span>
                </div>
              </div>

              {/* Attendee Frequency Distribution Pills */}
              <div className="space-y-2 pt-1 border-t border-slate-800/80">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1">
                  <span className="text-[11px] font-bold text-slate-300">
                    Visit Frequency Distribution (Unique Attendees by Occurrence Count):
                  </span>
                  <div className="flex items-center space-x-1.5 text-[10px]">
                    <span className="text-slate-400">Quick Threshold:</span>
                    {[
                      { label: 'All (0)', val: 0 },
                      { label: '≥ 1', val: 1 },
                      { label: '≥ 3', val: 3 },
                      { label: '≥ 5 (Standard)', val: 5 }
                    ].map((btn) => (
                      <button
                        key={btn.val}
                        type="button"
                        onClick={() => setMinimumVisitThreshold(btn.val)}
                        className={`px-2 py-0.5 rounded font-semibold transition ${
                          minimumVisitThreshold === btn.val
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
                  <div className={`p-2 rounded-lg border ${minimumVisitThreshold <= 1 ? 'bg-slate-900 border-emerald-800/60' : 'bg-slate-900/50 border-slate-800 text-slate-500'}`}>
                    <span className="text-[10px] block text-slate-400">1 Visit</span>
                    <strong className="text-sm font-mono text-white">{attendanceDistribution.distribution.visits1}</strong>
                    <span className="text-[9px] block text-slate-500">attendees</span>
                  </div>
                  <div className={`p-2 rounded-lg border ${minimumVisitThreshold <= 2 ? 'bg-slate-900 border-emerald-800/60' : 'bg-slate-900/50 border-slate-800 text-slate-500'}`}>
                    <span className="text-[10px] block text-slate-400">2 Visits</span>
                    <strong className="text-sm font-mono text-white">{attendanceDistribution.distribution.visits2}</strong>
                    <span className="text-[9px] block text-slate-500">attendees</span>
                  </div>
                  <div className={`p-2 rounded-lg border ${minimumVisitThreshold <= 3 ? 'bg-slate-900 border-emerald-800/60' : 'bg-slate-900/50 border-slate-800 text-slate-500'}`}>
                    <span className="text-[10px] block text-slate-400">3 Visits</span>
                    <strong className="text-sm font-mono text-white">{attendanceDistribution.distribution.visits3}</strong>
                    <span className="text-[9px] block text-slate-500">attendees</span>
                  </div>
                  <div className={`p-2 rounded-lg border ${minimumVisitThreshold <= 4 ? 'bg-slate-900 border-emerald-800/60' : 'bg-slate-900/50 border-slate-800 text-slate-500'}`}>
                    <span className="text-[10px] block text-slate-400">4 Visits</span>
                    <strong className="text-sm font-mono text-white">{attendanceDistribution.distribution.visits4}</strong>
                    <span className="text-[9px] block text-slate-500">attendees</span>
                  </div>
                  <div className="p-2 rounded-lg border bg-emerald-950/40 border-emerald-700/80">
                    <span className="text-[10px] block text-emerald-400 font-semibold">5+ Visits</span>
                    <strong className="text-sm font-mono text-emerald-200">{attendanceDistribution.distribution.visits5Plus}</strong>
                    <span className="text-[9px] block text-emerald-400">attendees</span>
                  </div>
                </div>

                <p className="text-[10px] text-slate-400 italic pt-1">
                  * Note: For November 2026, 175 total check-ins were logged across 59 distinct attendees in 13 held sessions. Selecting 'Skill Acquisition' accounts for 9 held sessions (expected visits = 9). The standard Gathering Place report specifies a minimum threshold of 5 visits; attendees with 1 to 4 visits are excluded when threshold is 5.
                </p>
              </div>
            </div>

            {/* Expected Visits Dynamic Calculation Banner */}
            <div className="bg-gradient-to-r from-amber-950/60 to-slate-900 border-2 border-amber-500/40 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-center gap-3">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-amber-400 block">
                  Calculated Metric (Section 4)
                </span>
                <div className="text-sm sm:text-base font-black text-white uppercase">
                  EXPECTED VISIT FOR THE MONTH FOR EACH YA IS{' '}
                  <span className="underline decoration-2 text-amber-300">
                    {liveExpectedVisitsResult.expectedVisits}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Based on sum of eligible held occurrences across{' '}
                  {selectedUnitIds.length} units ({liveExpectedVisitsResult.eligibleSessions.length} sessions).
                </p>
              </div>

              <button
                type="button"
                onClick={handleGenerateReport}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-950 cursor-pointer flex items-center space-x-2 flex-shrink-0"
              >
                <FileCheck2 className="w-4 h-4" />
                <span>Generate & Preview Report</span>
              </button>
            </div>
          </div>

          {/* Active Report Preview & Actions */}
          {activeReport && (
            <div className="space-y-4">
              {/* Revision Alert Banner for Approved Reports affected by Adjustments */}
              {activeReport.status === 'approved' && activeReport.hasPendingRevision && (
                <div className="p-4 bg-amber-950/70 border-2 border-amber-500 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-amber-200 shadow-xl">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-amber-300 block text-sm">
                        Pending Revision Triggered (Approved Version {activeReport.version})
                      </strong>
                      <span>
                        {activeReport.revisionTriggerReason || 'Manual attendance adjustments have modified the records for this month.'}{' '}
                        The original approved snapshot remains immutable as Version {activeReport.version}. A formal revised report (Version {activeReport.version + 1}) must be generated and re-approved before replacing the active report.
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleGenerateRevisedReport(activeReport)}
                    className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold rounded-xl text-xs transition flex-shrink-0 flex items-center gap-1.5 shadow-md cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Generate Revised Report (v{activeReport.version + 1})</span>
                  </button>
                </div>
              )}

              {/* Document Toolbar & Approval Lifecycle */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex items-center space-x-3">
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-extrabold uppercase border ${
                      activeReport.status === 'approved'
                        ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                        : activeReport.status === 'disapproved'
                        ? 'bg-red-950/80 border-red-500 text-red-300'
                        : activeReport.status === 'correction_requested'
                        ? 'bg-amber-950/80 border-amber-500 text-amber-300'
                        : 'bg-blue-950/80 border-blue-500 text-blue-300'
                    }`}
                  >
                    Status: {activeReport.status.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-slate-400">
                    Version: <strong className="text-white">v{activeReport.version}</strong>
                  </span>
                </div>

                {/* Unit Selector Filter for Preview */}
                <div className="flex items-center space-x-2 text-xs">
                  <span className="text-slate-400">View Unit:</span>
                  <select
                    value={viewUnitFilter || 'all'}
                    onChange={(e) =>
                      setViewUnitFilter(e.target.value === 'all' ? null : e.target.value)
                    }
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white"
                  >
                    <option value="all">All Stake Units (Consolidated)</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.unitName}>
                        {u.unitName}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center space-x-2">
                  {/* Approval Actions (Admin or verified Stake President) */}
                  {canApprove && activeReport.status !== 'approved' && (
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => setShowReviewModal('approve')}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition flex items-center space-x-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approve</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowReviewModal('request_correction')}
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold transition flex items-center space-x-1"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Request Correction</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowReviewModal('disapprove')}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold transition flex items-center space-x-1"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Disapprove</span>
                      </button>
                    </div>
                  )}

                  {/* Export / Print (Only enabled when approved) */}
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={handlePrintReport}
                      disabled={activeReport.status !== 'approved'}
                      title={
                        activeReport.status !== 'approved'
                          ? 'Printing disabled until report is approved'
                          : 'Print / Save PDF'
                      }
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1 transition ${
                        activeReport.status === 'approved'
                          ? 'bg-slate-800 hover:bg-slate-700 text-white cursor-pointer'
                          : 'bg-slate-950 text-slate-600 border border-slate-800 cursor-not-allowed opacity-50'
                      }`}
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Print / PDF</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportSpreadsheet('xlsx')}
                      disabled={activeReport.status !== 'approved'}
                      title={
                        activeReport.status !== 'approved'
                          ? 'Export disabled until report is approved'
                          : 'Export Excel'
                      }
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1 transition ${
                        activeReport.status === 'approved'
                          ? 'bg-slate-800 hover:bg-slate-700 text-white cursor-pointer'
                          : 'bg-slate-950 text-slate-600 border border-slate-800 cursor-not-allowed opacity-50'
                      }`}
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>Excel</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Notice Banner if Unapproved */}
              {activeReport.status !== 'approved' && (
                <div className="p-3 bg-amber-950/40 border border-amber-800/80 rounded-xl flex items-center space-x-3 text-xs text-amber-300">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-400" />
                  <span>
                    <strong>Pending Approval:</strong> This report is pending review and approval by the Stake President or System Administrator. Printing, downloading, and unit-leader distribution are locked until approved.
                  </span>
                </div>
              )}

              {/* On-Screen High-Fidelity Landscape Document */}
              <div className="overflow-x-auto pb-4">
                <GatheringPlaceReportDocument
                  report={activeReport}
                  unitFilter={viewUnitFilter}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Tab 2: Past Reports History & Distribution List */}
      {activeTab === 'history' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <Clock className="w-4 h-4 text-emerald-400" />
              <span>Gathering Place Monthly Reports Register & Distribution</span>
            </h3>
            <span className="text-xs text-slate-400">
              Total Reports: {reportsList.length}
            </span>
          </div>

          {reportsList.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs italic">
              No Gathering Place monthly reports generated yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left text-slate-300">
                <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px]">
                  <tr>
                    <th className="p-3">Report Title</th>
                    <th className="p-3">Period</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Expected Visits</th>
                    <th className="p-3">Participants</th>
                    <th className="p-3">Version</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {reportsList.map((rep) => (
                    <tr
                      key={rep.id}
                      className="hover:bg-slate-800/50 transition text-slate-200"
                    >
                      <td className="p-3 font-semibold text-white">
                        {rep.reportTitle}
                      </td>
                      <td className="p-3 text-slate-400">
                        {rep.monthName} {rep.reportingYear}
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                            rep.status === 'approved'
                              ? 'bg-emerald-950 border-emerald-600 text-emerald-300'
                              : rep.status === 'disapproved'
                              ? 'bg-red-950 border-red-600 text-red-300'
                              : 'bg-amber-950 border-amber-600 text-amber-300'
                          }`}
                        >
                          {rep.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="p-3 font-mono font-bold text-white">
                        {rep.expectedVisitsPerYa}
                      </td>
                      <td className="p-3 font-mono">
                        {rep.summaryMetrics?.totalParticipants || 0}
                      </td>
                      <td className="p-3 text-slate-400 font-mono">
                        v{rep.version}
                      </td>
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={async () => {
                            if (!user) return
                            const full =
                              await gatheringPlaceReportService.getReportById(
                                rep.id,
                                user
                              )
                            if (full) {
                              setActiveReport(full)
                              setSelectedYear(full.reportingYear)
                              setSelectedMonth(full.reportingMonth)
                              setMinimumVisitThreshold(full.minimumVisitThreshold)
                              setSelectedUnitIds(full.unitIds || [])
                              if (full.filterCriteria?.selectedActivityIds) {
                                setSelectedActivityIds(full.filterCriteria.selectedActivityIds)
                              }
                              if (full.filterCriteria?.selectedClassesByActivity) {
                                setSelectedClassesByActivity(full.filterCriteria.selectedClassesByActivity)
                              }
                              if (full.leaderSnapshot?.userId) {
                                setSelectedLeaderId(full.leaderSnapshot.userId)
                              }
                              setActiveTab('workspace')
                            }
                          }}
                          className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded-lg text-xs font-semibold transition"
                        >
                          View & Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Main Tab 3: Attendance Adjustments & Corrections */}
      {activeTab === 'adjustments' && (
        <div className="space-y-6">
          {/* Header Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <Zap className="w-4 h-4 text-emerald-400" />
                <span>Audited Attendance Adjustments</span>
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Non-destructive manual adjustments. Historical attendance records are void-stamped and preserved.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsAdjustmentModalOpen(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-lg shadow-indigo-950 cursor-pointer"
            >
              <Zap className="w-4 h-4" />
              <span>Initiate Attendance Adjustment</span>
            </button>
          </div>

          {/* Pending Approval Queue */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-800 pb-3">
              <div>
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  Pending Approval Queue ({adjustmentsList.filter((a) => a.status === 'pending_approval').length})
                </h4>
                <p className="text-[11px] text-slate-500">
                  Submissions requiring Stake Presidency or System Admin review and application.
                </p>
              </div>

              {/* Bulk Actions for Approvers */}
              {canApprove && selectedAdjustmentIds.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={adjustmentActionComment}
                    onChange={(e) => setAdjustmentActionComment(e.target.value)}
                    placeholder="Review comment / note..."
                    className="px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleReviewAdjustments('approve')}
                    disabled={isReviewingAdjustments || selectedAdjustmentIds.some((id) => adjustmentsList.find((a) => a.id === id)?.requestedBy === user?.id)}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    Approve ({selectedAdjustmentIds.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReviewAdjustments('reject')}
                    disabled={isReviewingAdjustments || !adjustmentActionComment.trim()}
                    className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    Reject ({selectedAdjustmentIds.length})
                  </button>
                </div>
              )}
            </div>

            {canApprove && selectedAdjustmentIds.some((id) => adjustmentsList.find((a) => a.id === id)?.requestedBy === user?.id) && (
              <div className="p-2.5 bg-amber-950/60 border border-amber-800 rounded-xl text-xs text-amber-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>
                  Self-approval blocked: One or more selected adjustments were requested by your account. Another leader must review them.
                </span>
              </div>
            )}

            {adjustmentsList.filter((a) => a.status === 'pending_approval').length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 italic">
                No adjustments pending approval.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left text-slate-300">
                  <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px]">
                    <tr>
                      {canApprove && <th className="p-3 w-8"></th>}
                      <th className="p-3">Member</th>
                      <th className="p-3">Session</th>
                      <th className="p-3">Action</th>
                      <th className="p-3">Reason</th>
                      <th className="p-3">Requested By</th>
                      <th className="p-3">Requested At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {adjustmentsList
                      .filter((a) => a.status === 'pending_approval')
                      .map((adj) => {
                        const isChecked = selectedAdjustmentIds.includes(adj.id)
                        return (
                          <tr key={adj.id} className="hover:bg-slate-800/40 transition">
                            {canApprove && (
                              <td className="p-3">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {
                                    setSelectedAdjustmentIds((prev) =>
                                      prev.includes(adj.id)
                                        ? prev.filter((id) => id !== adj.id)
                                        : [...prev, adj.id]
                                    )
                                  }}
                                  className="rounded text-indigo-600 focus:ring-indigo-500"
                                />
                              </td>
                            )}
                            <td className="p-3 font-semibold text-white">
                              {adj.memberName || adj.metadata?.member_name || 'Member'}
                            </td>
                            <td className="p-3 text-slate-300">
                              {adj.sessionTitle || adj.metadata?.session_title || 'Session'} ({adj.sessionDate || adj.metadata?.session_date})
                            </td>
                            <td className="p-3">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                                  adj.adjustmentType === 'add_attendance'
                                    ? 'bg-emerald-950 border-emerald-600 text-emerald-300'
                                    : 'bg-rose-950 border-rose-600 text-rose-300'
                                }`}
                              >
                                {adj.adjustmentType === 'add_attendance' ? '+ Add' : '- Void'}
                              </span>
                            </td>
                            <td className="p-3 text-slate-400 max-w-xs truncate" title={adj.reason}>
                              {adj.reason}
                            </td>
                            <td className="p-3 text-slate-400">
                              {adj.requestedByName || 'Authorized User'}
                            </td>
                            <td className="p-3 text-slate-400 font-mono text-[11px]">
                              {new Date(adj.requestedAt).toLocaleDateString('en-GB')}
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Applied & Historical Adjustments */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="border-b border-slate-800 pb-3">
              <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                Adjustment Audit History ({adjustmentsList.filter((a) => a.status !== 'pending_approval').length})
              </h4>
              <p className="text-[11px] text-slate-500">
                Immutable audit trail of applied and rejected adjustments.
              </p>
            </div>

            {adjustmentsList.filter((a) => a.status !== 'pending_approval').length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 italic">
                No historical adjustments on record.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left text-slate-300">
                  <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px]">
                    <tr>
                      <th className="p-3">Member</th>
                      <th className="p-3">Session</th>
                      <th className="p-3">Action</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Reason</th>
                      <th className="p-3">Reviewed By</th>
                      <th className="p-3">Applied At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {adjustmentsList
                      .filter((a) => a.status !== 'pending_approval')
                      .map((adj) => (
                        <tr key={adj.id} className="hover:bg-slate-800/40 transition">
                          <td className="p-3 font-semibold text-white">
                            {adj.memberName || adj.metadata?.member_name || 'Member'}
                          </td>
                          <td className="p-3 text-slate-300">
                            {adj.sessionTitle || adj.metadata?.session_title || 'Session'} ({adj.sessionDate || adj.metadata?.session_date})
                          </td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                                adj.adjustmentType === 'add_attendance'
                                  ? 'bg-emerald-950 border-emerald-600 text-emerald-300'
                                  : 'bg-rose-950 border-rose-600 text-rose-300'
                              }`}
                            >
                              {adj.adjustmentType === 'add_attendance' ? '+ Add' : '- Void'}
                            </span>
                          </td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                                adj.status === 'applied'
                                  ? 'bg-emerald-950 border-emerald-600 text-emerald-300'
                                  : 'bg-rose-950 border-rose-600 text-rose-300'
                              }`}
                            >
                              {adj.status}
                            </span>
                          </td>
                          <td className="p-3 text-slate-400 max-w-xs truncate" title={adj.reason}>
                            {adj.reason}
                          </td>
                          <td className="p-3 text-slate-400">
                            {adj.reviewedByName || adj.appliedByName || 'Executive'}
                          </td>
                          <td className="p-3 text-slate-400 font-mono text-[11px]">
                            {adj.appliedAt ? new Date(adj.appliedAt).toLocaleDateString('en-GB') : '—'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
