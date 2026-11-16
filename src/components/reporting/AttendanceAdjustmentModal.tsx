import React, { useState, useMemo } from 'react'
import {
  X,
  AlertTriangle,
  CheckCircle2,
  UserCheck,
  UserMinus,
  Search,
  ShieldAlert,
  Send,
  Zap
} from 'lucide-react'
import {
  ActivitySession,
  AttendanceRecord,
  MemberRecord,
  StakeUnit,
  UserProfile,
  AdjustmentType,
  AdjustmentBatchPreview
} from '../../types/database'
import { attendanceAdjustmentService } from '../../services/attendanceAdjustmentService'

interface AttendanceAdjustmentModalProps {
  isOpen: boolean
  onClose: () => void
  sessions: ActivitySession[]
  members: MemberRecord[]
  units: StakeUnit[]
  allMonthAttendance: AttendanceRecord[]
  currentUser: UserProfile
  onAdjustmentApplied?: () => void
}

export const AttendanceAdjustmentModal: React.FC<AttendanceAdjustmentModalProps> = ({
  isOpen,
  onClose,
  sessions,
  members,
  units,
  allMonthAttendance,
  currentUser,
  onAdjustmentApplied
}) => {
  const [selectedSessionId, setSelectedSessionId] = useState<string>('')
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>('add_attendance')
  const [selectedClass, setSelectedClass] = useState<string>('')
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [memberSearch, setMemberSearch] = useState<string>('')
  const [unitFilter, setUnitFilter] = useState<string>('all')
  const [reason, setReason] = useState<string>('')
  const [isDirectApply, setIsDirectApply] = useState<boolean>(false)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const canApprove =
    currentUser.roles.includes('system_admin') ||
    currentUser.roles.includes('stake_presidency')
  const isClerk = currentUser.roles.includes('stake_clerk')

  // Selected session object
  const currentSession = useMemo(() => {
    return sessions.find((s) => s.id === selectedSessionId) || null
  }, [sessions, selectedSessionId])

  // Session eligibility check
  const sessionEligibility = useMemo(() => {
    if (!currentSession) return null
    const existingCount = allMonthAttendance.filter(
      (a) => a.sessionId === currentSession.id && !a.isVoided
    ).length
    return attendanceAdjustmentService.validateSessionEligibility(currentSession, existingCount)
  }, [currentSession, allMonthAttendance])

  // Class options for session
  const availableClasses = useMemo(() => {
    if (!currentSession) return []
    return currentSession.classOptions || []
  }, [currentSession])

  // Filtered members list
  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      if (unitFilter !== 'all' && m.homeUnitId !== unitFilter) return false
      if (!memberSearch.trim()) return true
      const q = memberSearch.toLowerCase().trim()
      return (
        m.fullName.toLowerCase().includes(q) ||
        (m.memberNumber && m.memberNumber.toLowerCase().includes(q))
      )
    })
  }, [members, unitFilter, memberSearch])

  // Selected member objects
  const targetMembers = useMemo(() => {
    return members.filter((m) => selectedMemberIds.includes(m.id))
  }, [members, selectedMemberIds])

  // Batch Preview calculation
  const preview: AdjustmentBatchPreview | null = useMemo(() => {
    if (!currentSession || targetMembers.length === 0) return null
    return attendanceAdjustmentService.calculateBatchPreview({
      session: currentSession,
      members: targetMembers,
      adjustmentType,
      className: selectedClass || undefined,
      allMonthAttendance,
      minimumVisitThreshold: 5
    })
  }, [currentSession, targetMembers, adjustmentType, selectedClass, allMonthAttendance])

  const handleToggleMember = (memberId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    )
  }

  const handleSelectAllFiltered = () => {
    const idsToAdd = filteredMembers.map((m) => m.id)
    setSelectedMemberIds((prev) => Array.from(new Set([...prev, ...idsToAdd])))
  }

  const handleClearSelection = () => {
    setSelectedMemberIds([])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)

    if (!currentSession) {
      setErrorMessage('Please select an activity session.')
      return
    }

    if (!sessionEligibility?.eligible) {
      setErrorMessage(sessionEligibility?.reason || 'Selected session is ineligible.')
      return
    }

    if (selectedMemberIds.length === 0) {
      setErrorMessage('Please select at least one member to adjust.')
      return
    }

    if (!reason.trim() || reason.trim().length < 5) {
      setErrorMessage('A mandatory adjustment reason (minimum 5 characters) is required.')
      return
    }

    if (preview?.hasConflicts) {
      setErrorMessage('Cannot submit: One or more selected attendees have conflict errors (e.g. already present or not present).')
      return
    }

    setIsSubmitting(true)

    try {
      const result = await attendanceAdjustmentService.submitAdjustment(
        {
          sessionId: currentSession.id,
          memberIds: selectedMemberIds,
          adjustmentType,
          className: selectedClass || null,
          reason: reason.trim(),
          directApply: isDirectApply && canApprove
        },
        currentUser
      )

      setSuccessMessage(
        result.status === 'applied'
          ? `Successfully applied adjustment to ${result.count} attendee(s). Attendance records updated and audit history logged.`
          : `Successfully submitted adjustment for ${result.count} attendee(s). Request is pending Stake Presidency approval.`
      )

      setTimeout(() => {
        onAdjustmentApplied?.()
        onClose()
      }, 1500)
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to submit attendance adjustment.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="bg-slate-900 rounded-2xl shadow-2xl border border-slate-800 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden my-auto attendance-modal-dark text-slate-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-emerald-400" />
              Audited Attendance Adjustment
            </h2>
            <p className="text-xs text-slate-400">
              Non-destructive manual attendance adjustments with full audit history and preview.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMessage && (
            <div className="p-3 bg-rose-950/60 border border-rose-800/80 rounded-xl flex items-start gap-3 text-rose-200 text-xs">
              <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              <div>{errorMessage}</div>
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-emerald-950/60 border border-emerald-800/80 rounded-xl flex items-center gap-3 text-emerald-200 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <div>{successMessage}</div>
            </div>
          )}

          {/* Section 1: Session & Type */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">
                Target Session <span className="text-rose-400">*</span>
              </label>
              <select
                value={selectedSessionId}
                onChange={(e) => {
                  setSelectedSessionId(e.target.value)
                  setSelectedClass('')
                }}
                className="w-full px-3 py-2 border border-slate-700 rounded-lg text-xs bg-slate-950 text-slate-100 dark-form-select focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                required
              >
                <option value="" className="bg-slate-900 text-slate-300 py-1.5">-- Select Held Activity Session --</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id} className="bg-slate-900 text-slate-100 py-1.5">
                    {s.sessionDate} — {s.sessionTitle} ({s.status})
                  </option>
                ))}
              </select>

              {sessionEligibility && !sessionEligibility.eligible && (
                <div className="mt-1 text-xs text-rose-400 flex items-center gap-1 font-semibold">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {sessionEligibility.reason}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">
                Adjustment Action <span className="text-rose-400">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustmentType('add_attendance')}
                  className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                    adjustmentType === 'add_attendance'
                      ? 'bg-emerald-950/70 border-emerald-500 text-emerald-200 ring-2 ring-emerald-500/30'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <UserCheck className="w-4 h-4 text-emerald-400" />
                  Add Attendance
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustmentType('remove_attendance')}
                  className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                    adjustmentType === 'remove_attendance'
                      ? 'bg-rose-950/70 border-rose-500 text-rose-200 ring-2 ring-rose-500/30'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <UserMinus className="w-4 h-4 text-rose-400" />
                  Void Attendance
                </button>
              </div>
            </div>
          </div>

          {/* Optional Class Selector */}
          {availableClasses.length > 0 && adjustmentType === 'add_attendance' && (
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">
                Skill Acquisition Class Option
              </label>
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="w-full md:w-1/2 px-3 py-2 border border-slate-700 rounded-lg text-xs bg-slate-950 text-slate-100 dark-form-select focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
              >
                <option value="" className="bg-slate-900 text-slate-300 py-1.5">-- General / No Specific Class --</option>
                {availableClasses.map((cls) => (
                  <option key={cls} value={cls} className="bg-slate-900 text-slate-100 py-1.5">
                    {cls}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Section 2: Member Selection */}
          <div className="border border-slate-800 rounded-xl p-4 bg-slate-950/60 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Select Member(s) ({selectedMemberIds.length} selected)
                </span>
                <p className="text-[11px] text-slate-400">
                  Search by name or filter by home ward/branch.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAllFiltered}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs font-medium text-slate-200 transition cursor-pointer"
                >
                  Select All Filtered
                </button>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs font-medium text-slate-200 transition cursor-pointer"
                >
                  Clear Selection
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search member name..."
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-500 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
              <div>
                <select
                  value={unitFilter}
                  onChange={(e) => setUnitFilter(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 text-slate-100 dark-form-select rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="all" className="bg-slate-900 text-slate-100 py-1.5">All Stake Units</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id} className="bg-slate-900 text-slate-100 py-1.5">
                      {u.unitName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Member Checkbox List */}
            <div className="max-h-48 overflow-y-auto border border-slate-800 rounded-lg bg-slate-900 divide-y divide-slate-800/80">
              {filteredMembers.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400">
                  No members found matching your search.
                </div>
              ) : (
                filteredMembers.map((m) => {
                  const isChecked = selectedMemberIds.includes(m.id)
                  return (
                    <label
                      key={m.id}
                      className={`px-3 py-2 flex items-center justify-between text-xs cursor-pointer hover:bg-slate-800/80 transition ${
                        isChecked ? 'bg-emerald-950/40 border-l-2 border-emerald-500' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleMember(m.id)}
                          className="rounded bg-slate-950 border-slate-700 text-emerald-500 focus:ring-emerald-500"
                        />
                        <span className="font-semibold text-slate-100">{m.fullName}</span>
                      </div>
                      <span className="text-slate-400 text-[11px]">
                        {m.homeUnitName || 'Unit'}
                      </span>
                    </label>
                  )
                })
              )}
            </div>
          </div>

          {/* Section 3: Live Batch Impact Preview */}
          {preview && (
            <div className="border border-emerald-900/50 bg-emerald-950/20 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-emerald-400" />
                  Pre-Flight Batch Impact Preview
                </span>
                <span className="text-xs font-mono font-bold text-emerald-300">
                  Net Visit Change: {preview.totalNetVisitChange > 0 ? `+${preview.totalNetVisitChange}` : preview.totalNetVisitChange}
                </span>
              </div>

              {preview.hasConflicts && (
                <div className="p-2.5 bg-rose-950/70 border border-rose-800 rounded-lg text-rose-200 text-xs font-medium">
                  One or more members have conflicts. Adjustments cannot be applied until resolved.
                </div>
              )}

              <div className="max-h-44 overflow-y-auto border border-slate-800 rounded-lg bg-slate-900 overflow-hidden text-xs">
                <table className="w-full text-left divide-y divide-slate-800">
                  <thead className="bg-slate-950 text-[11px] font-bold text-slate-400 uppercase">
                    <tr>
                      <th className="px-3 py-2">Member</th>
                      <th className="px-3 py-2">Unit</th>
                      <th className="px-3 py-2 text-center">Current</th>
                      <th className="px-3 py-2 text-center">Resulting</th>
                      <th className="px-3 py-2 text-center">Threshold Impact</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-900">
                    {preview.items.map((item) => (
                      <tr key={item.memberId} className={item.isConflict ? 'bg-rose-950/40' : ''}>
                        <td className="px-3 py-1.5 font-semibold text-slate-200">{item.memberName}</td>
                        <td className="px-3 py-1.5 text-slate-400">{item.unitName}</td>
                        <td className="px-3 py-1.5 text-center font-mono font-bold text-slate-300">{item.currentVisitsThisMonth}</td>
                        <td className="px-3 py-1.5 text-center font-mono font-bold text-emerald-400">
                          {item.resultingVisitsThisMonth}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          {item.crossesThreshold ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                              Crosses 5-Visit Threshold
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[11px]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {item.isConflict ? (
                            <span className="text-rose-400 font-bold text-[11px]">
                              {item.conflictReason}
                            </span>
                          ) : (
                            <span className="text-emerald-400 font-bold text-[11px]">Valid</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Section 4: Mandatory Reason */}
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">
              Mandatory Adjustment Reason <span className="text-rose-400">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Provide a detailed rationale (e.g., Kiosk terminal hardware failure during Session #4; member verified present by class instructor)."
              rows={3}
              required
              minLength={5}
              className="w-full px-3 py-2 border border-slate-700 bg-slate-950 text-slate-100 placeholder-slate-500 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Minimum 5 characters. This justification is permanently recorded in the database audit log.
            </p>
          </div>

          {/* Section 5: Direct Apply toggle for Authorized Roles */}
          {canApprove && (
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-200">Direct Application</span>
                <p className="text-[11px] text-slate-400">
                  As Stake Presidency / Admin, apply immediately without entering the pending approval queue.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isDirectApply}
                  onChange={(e) => setIsDirectApply(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>
          )}

          {isClerk && (
            <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-lg text-xs text-amber-200 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span>
                Stake Clerk Submission: Adjustments will be queued with status <strong>Pending Approval</strong> for Stake Presidency review. Direct application is restricted.
              </span>
            </div>
          )}

          {/* Non-destructive notice */}
          <div className="text-[11px] text-slate-400 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
            <strong>Historical Integrity:</strong> Voided attendance records are never deleted; they are marked with an immutable void stamp, timestamp, and actor identity to ensure 100% auditability.
          </div>

          {/* Footer Actions */}
          <div className="pt-2 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 border border-slate-700 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-bold text-slate-300 transition cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={
                isSubmitting ||
                !currentSession ||
                !sessionEligibility?.eligible ||
                selectedMemberIds.length === 0 ||
                reason.trim().length < 5 ||
                Boolean(preview?.hasConflicts)
              }
              className="px-5 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-500 transition flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-emerald-950 cursor-pointer"
            >
              {isSubmitting ? (
                <span>Processing...</span>
              ) : isDirectApply && canApprove ? (
                <>
                  <Zap className="w-4 h-4" />
                  <span>Apply Adjustment Immediately</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Submit for Approval</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
