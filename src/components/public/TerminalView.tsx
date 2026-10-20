import React, { useState, useEffect, useRef } from 'react'
import {
  CheckCircle2,
  User,
  Church,
  AlertCircle,
  LogOut,
  Phone,
  UserCheck,
  Sparkles,
  ArrowRight,
  HeartHandshake,
  Loader2
} from 'lucide-react'
import { attendanceService, humanizeTerminalError } from '../../services/attendanceService'
import { adminService } from '../../services/adminService'
import { memberService } from '../../services/memberService'
import { StakeUnit, MemberRecord } from '../../types/database'
import { formatAttendeeFirstName, getActivityWelcomeMessage } from '../../lib/terminalPersonalization'

interface TerminalViewProps {
  sessionTitle?: string
  sessionDate?: string
  onReleaseTerminal: () => void
}

interface ConfirmedAttendee {
  fullName: string
  firstName: string
  isNonMember: boolean
  unitName?: string | null
  checkInTime: string
}

export const TerminalView: React.FC<TerminalViewProps> = ({
  sessionTitle = 'Active YSA Activity Session',
  sessionDate = 'Today',
  onReleaseTerminal
}) => {
  const [attendeeName, setAttendeeName] = useState('')
  const [isNonMember, setIsNonMember] = useState(false)
  const [selectedUnit, setSelectedUnit] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)

  const [units, setUnits] = useState<StakeUnit[]>([])
  const [members, setMembers] = useState<MemberRecord[]>([])
  const [filteredMembers, setFilteredMembers] = useState<MemberRecord[]>([])

  const [statusMessage, setStatusMessage] = useState<{ type: 'error'; text: string } | null>(null)
  const [confirmedAttendee, setConfirmedAttendee] = useState<ConfirmedAttendee | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const nameInputRef = useRef<HTMLInputElement>(null)
  const nextAttendeeButtonRef = useRef<HTMLButtonElement>(null)

  // Focus management: focus name input initially or after confirmation reset
  useEffect(() => {
    if (!confirmedAttendee && nameInputRef.current) {
      nameInputRef.current.focus()
    } else if (confirmedAttendee && nextAttendeeButtonRef.current) {
      nextAttendeeButtonRef.current.focus()
    }
  }, [confirmedAttendee])

  // Load participating units and ensure terminal heartbeat loop is active
  useEffect(() => {
    const meta = attendanceService.getStoredSessionMetadata()
    adminService.listUnits().then((allUnits) => {
      if (meta.participatingUnits && meta.participatingUnits.length > 0) {
        setUnits(allUnits.filter((u) => u.isActive && meta.participatingUnits!.includes(u.id)))
      } else {
        setUnits(allUnits.filter((u) => u.isActive))
      }
    }).catch(() => {})
    memberService.listMembers().then(setMembers).catch(() => {})

    const token = attendanceService.getStoredTerminalToken()
    if (token) {
      attendanceService.startHeartbeatLoop(token, () => {
        setStatusMessage({
          type: 'error',
          text: 'This check-in session has expired or was closed by a leader. Please ask a YSA leader for assistance.'
        })
        onReleaseTerminal()
      })
    }

    return () => {
      attendanceService.stopHeartbeatLoop()
    }
  }, [onReleaseTerminal])

  // Query suggestions from previously recorded attendance names and census
  useEffect(() => {
    if (isNonMember) {
      setFilteredMembers([])
      return
    }

    let cancelled = false
    const sessionId = typeof window !== 'undefined' ? sessionStorage.getItem('ysaams_terminal_session_id') : null
    const q = attendeeName.trim()

    const resolveSuggestions = async () => {
      if (sessionId && (q.length >= 2 || selectedUnit)) {
        const rpcResults = await attendanceService.searchTerminalSuggestions(sessionId, selectedUnit || null, q)
        if (!cancelled) {
          setFilteredMembers(rpcResults.slice(0, 8))
        }
      } else if (members.length > 0 && (q.length >= 2 || selectedUnit)) {
        let list = members.filter((m) => m.isActive)
        if (selectedUnit) {
          list = list.filter((m) => m.homeUnitId === selectedUnit)
        }
        if (q.length >= 2) {
          const lower = q.toLowerCase()
          list = list.filter(
            (m) =>
              m.fullName.toLowerCase().includes(lower) ||
              (m.preferredName && m.preferredName.toLowerCase().includes(lower))
          )
        }
        if (!cancelled) {
          setFilteredMembers(list.slice(0, 8))
        }
      } else if (!cancelled) {
        setFilteredMembers([])
      }
    }

    resolveSuggestions()
    return () => {
      cancelled = true
    }
  }, [selectedUnit, attendeeName, isNonMember, members])

  const handleSelectMember = (m: MemberRecord) => {
    setAttendeeName(m.fullName)
    setSelectedMemberId(m.id)
    setSelectedUnit(m.homeUnitId)
    setFilteredMembers([])
  }

  const handleNextCheckIn = () => {
    setConfirmedAttendee(null)
    setAttendeeName('')
    setSelectedMemberId(null)
    setContactPhone('')
    setSelectedUnit('')
    setIsNonMember(false)
    setStatusMessage(null)
    setFilteredMembers([])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const cleanName = attendeeName.trim()
    if (!cleanName) {
      setStatusMessage({ type: 'error', text: 'Please enter your name to check in.' })
      return
    }

    if (!isNonMember && !selectedUnit) {
      setStatusMessage({ type: 'error', text: 'Please select your ward or branch.' })
      return
    }

    // Retrieve active session ID from sessionStorage
    const sessionId = typeof window !== 'undefined' ? sessionStorage.getItem('ysaams_terminal_session_id') : null
    if (!sessionId) {
      setStatusMessage({ type: 'error', text: 'Terminal session connection was lost. Please reconnect using the session code.' })
      return
    }

    setIsSubmitting(true)
    setStatusMessage(null)

    // For church members who selected a suggestion, use that selectedMemberId.
    // If typing a brand-new name without prior registration, selectedMemberId is null,
    // and the backend records attendance directly.
    const res = await attendanceService.recordAttendance({
      sessionId,
      attendeeName: cleanName,
      memberId: selectedMemberId || undefined,
      isNonMember,
      unitId: selectedUnit || null,
      contactPhone: contactPhone.trim() || undefined
    })

    setIsSubmitting(false)

    if (res.success && res.record) {
      const selectedUnitObj = units.find((u) => u.id === selectedUnit)
      const firstName = formatAttendeeFirstName(res.record.attendeeName)

      // Personalize celebration state
      setConfirmedAttendee({
        fullName: res.record.attendeeName,
        firstName,
        isNonMember: res.record.isNonMember,
        unitName: selectedUnitObj ? selectedUnitObj.unitName : null,
        checkInTime: res.record.checkInTime
      })
      setStatusMessage(null)
    } else {
      setStatusMessage({
        type: 'error',
        text: humanizeTerminalError(res.error)
      })
    }
  }

  const handleRelease = async () => {
    await attendanceService.releaseTerminal()
    onReleaseTerminal()
  }

  // --- CELEBRATION / CONFIRMATION SCREEN ---
  if (confirmedAttendee) {
    const welcome = getActivityWelcomeMessage(
      sessionTitle,
      confirmedAttendee.isNonMember,
      confirmedAttendee.firstName
    )

    return (
      <div className="max-w-xl mx-auto px-4 py-8 sm:py-12">
        <div className="bg-slate-900 border border-emerald-500/30 rounded-3xl p-6 sm:p-10 shadow-2xl text-center relative overflow-hidden animate-terminal-enter">
          {/* Subtle decorative glow */}
          <div className="absolute -top-24 -left-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Celebratory Checkmark Icon */}
          <div className="w-20 h-20 bg-gradient-to-tr from-emerald-600 to-teal-500 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-emerald-950/60 animate-checkmark-pop">
            <CheckCircle2 className="w-10 h-10 text-white" />
          </div>

          <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 mb-3">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            Attendance Recorded Successfully
          </span>

          <h2 className="text-3xl font-extrabold text-white tracking-tight mb-2">
            {welcome.heading}
          </h2>

          <p className="text-base text-slate-300 font-medium mb-1 leading-relaxed">
            {welcome.message}
          </p>

          <p className="text-sm text-slate-400 mb-6">
            {welcome.submessage}
          </p>

          {/* Confirmed Details Badge */}
          <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl mb-8 text-left text-xs space-y-1.5">
            <div className="flex justify-between items-center text-slate-400">
              <span>Attendee</span>
              <span className="font-semibold text-white">{confirmedAttendee.fullName}</span>
            </div>
            <div className="flex justify-between items-center text-slate-400">
              <span>Status</span>
              <span className="text-emerald-400 font-medium">
                {confirmedAttendee.isNonMember ? 'Guest / Friend' : 'Church Member'}
              </span>
            </div>
            {confirmedAttendee.unitName && (
              <div className="flex justify-between items-center text-slate-400">
                <span>Unit</span>
                <span className="text-slate-300">{confirmedAttendee.unitName}</span>
              </div>
            )}
            <div className="flex justify-between items-center text-slate-400">
              <span>Activity</span>
              <span className="text-slate-300 truncate max-w-[200px]">{sessionTitle}</span>
            </div>
          </div>

          <button
            ref={nextAttendeeButtonRef}
            type="button"
            onClick={handleNextCheckIn}
            className="w-full py-4 px-6 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-2xl shadow-xl shadow-emerald-950/50 flex items-center justify-center space-x-2 transition cursor-pointer"
          >
            <span>Next Attendee Check In</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    )
  }

  // --- ATTENDANCE FORM SCREEN ---
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-10 animate-terminal-enter">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl">
        {/* Terminal Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-slate-800 gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse-gentle" />
              <span className="text-xs uppercase font-mono tracking-widest text-emerald-400 font-semibold">
                Terminal Connected • Ready for Check-in
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white mt-1.5 tracking-tight">{sessionTitle}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{sessionDate} • Africa/Lagos Time</p>
          </div>

          <button
            onClick={handleRelease}
            className="inline-flex items-center px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition cursor-pointer self-start sm:self-auto"
            title="Disconnect Terminal Station"
          >
            <LogOut className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
            Disconnect Terminal
          </button>
        </div>

        {/* Friendly Error Alert */}
        {statusMessage && (
          <div
            className="mb-6 p-4 rounded-2xl flex items-start space-x-3 text-sm bg-red-950/70 border border-red-800/80 text-red-200 shadow-md animate-terminal-enter"
            role="alert"
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-400 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold block text-red-300 mb-0.5">Check-in Issue</span>
              <span className="text-xs leading-relaxed text-red-200">{statusMessage.text}</span>
            </div>
          </div>
        )}

        {/* Welcoming Subtitle */}
        <div className="mb-6 bg-slate-950/60 border border-slate-800/60 rounded-2xl p-4 flex items-center space-x-3 text-slate-300">
          <HeartHandshake className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <p className="text-xs sm:text-sm">
            <strong className="text-white">Welcome!</strong> We're glad you're here. Enter your name below to mark your attendance.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Non-Member / Visitor Toggle */}
          <div className="flex items-center space-x-3 p-4 bg-slate-950/80 border border-slate-800 rounded-2xl hover:border-slate-700 transition">
            <input
              id="non-member-toggle"
              type="checkbox"
              checked={isNonMember}
              onChange={(e) => {
                setIsNonMember(e.target.checked)
                setSelectedMemberId(null)
              }}
              className="w-4 h-4 rounded border-slate-700 text-emerald-600 focus:ring-emerald-500 bg-slate-900 cursor-pointer"
            />
            <label htmlFor="non-member-toggle" className="text-sm font-medium text-slate-200 cursor-pointer select-none">
              I am a guest / friend (non-member of the Church)
            </label>
          </div>

          {/* Attendee Name Input with Suggestions */}
          <div className="relative">
            <label htmlFor="attendee-name" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              {isNonMember ? 'Your Full Name' : 'Full Name (Search or Type New)'}
            </label>
            <div className="relative">
              <User className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-500" />
              <input
                ref={nameInputRef}
                id="attendee-name"
                type="text"
                value={attendeeName}
                onChange={(e) => {
                  setAttendeeName(e.target.value)
                  setSelectedMemberId(null)
                }}
                placeholder={isNonMember ? 'e.g. Oluwaseun Adeleke' : 'Type your name...'}
                autoComplete="off"
                disabled={isSubmitting}
                className="w-full pl-11 pr-4 py-3.5 bg-slate-950 border border-slate-800 rounded-2xl text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm transition"
              />
            </div>

            {/* Member Suggestions Dropdown */}
            {!isNonMember && filteredMembers.length > 0 && (
              <div
                className="absolute z-20 left-0 right-0 mt-2 bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl"
                role="listbox"
                aria-label="Name suggestions"
              >
                <div className="px-3.5 py-2 bg-slate-900/80 border-b border-slate-800 text-[11px] font-semibold text-slate-400">
                  Select your name if listed, or continue typing:
                </div>
                {filteredMembers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={selectedMemberId === m.id}
                    onClick={() => handleSelectMember(m)}
                    className="w-full px-4 py-3 text-left text-xs hover:bg-slate-800/90 flex items-center justify-between border-b border-slate-900 last:border-b-0 transition cursor-pointer"
                  >
                    <div className="flex items-center space-x-2.5">
                      <UserCheck className="w-4 h-4 text-emerald-400" />
                      <span className="font-semibold text-white">{m.fullName}</span>
                      {m.preferredName && <span className="text-slate-400">({m.preferredName})</span>}
                    </div>
                    <span className="text-slate-400 text-[11px] bg-slate-900 px-2 py-0.5 rounded-lg border border-slate-800">
                      {m.homeUnitName || 'Unit'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Unit Selection */}
          <div>
            <label htmlFor="unit-select" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              {isNonMember ? 'Inviting Ward or Branch (Optional)' : 'Home Ward or Branch (Required)'}
            </label>
            <div className="relative">
              <Church className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-500 pointer-events-none" />
              <select
                id="unit-select"
                value={selectedUnit}
                onChange={(e) => setSelectedUnit(e.target.value)}
                disabled={isSubmitting}
                className="w-full pl-11 pr-4 py-3.5 bg-slate-950 border border-slate-800 rounded-2xl text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm transition"
              >
                <option value="">{isNonMember ? 'None / Stake Wide' : 'Select your Ward or Branch'}</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.unitName} ({u.unitType})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Contact Phone (for Visitors) */}
          {isNonMember && (
            <div className="animate-terminal-enter">
              <label htmlFor="contact-phone" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Contact Phone Number (Optional)
              </label>
              <div className="relative">
                <Phone className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-500" />
                <input
                  id="contact-phone"
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="080 1234 5678"
                  disabled={isSubmitting}
                  className="w-full pl-11 pr-4 py-3.5 bg-slate-950 border border-slate-800 rounded-2xl text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm transition"
                />
              </div>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-2xl shadow-xl shadow-emerald-950/50 flex items-center justify-center space-x-2 transition disabled:opacity-50 cursor-pointer text-sm"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Recording Your Attendance...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                <span>Confirm Check In</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}

