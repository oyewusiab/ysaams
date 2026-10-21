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
    adminService
      .listUnits()
      .then((allUnits) => {
        if (meta.participatingUnits && meta.participatingUnits.length > 0) {
          setUnits(allUnits.filter((u) => u.isActive && meta.participatingUnits!.includes(u.id)))
        } else {
          setUnits(allUnits.filter((u) => u.isActive))
        }
      })
      .catch(() => {})
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
      setStatusMessage({
        type: 'error',
        text: 'Terminal session connection was lost. Please reconnect using the activity code.'
      })
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

    const personalizedHeadline =
      confirmedAttendee.firstName && confirmedAttendee.firstName !== 'friend'
        ? `You're checked in, ${confirmedAttendee.firstName} — we're happy you're here!`
        : "You're checked in — we're happy you're here!"

    return (
      <div className="max-w-xl mx-auto px-4 py-8 sm:py-12">
        <div className="bg-white border border-emerald-200/90 rounded-3xl p-6 sm:p-10 shadow-xl shadow-slate-200/60 text-center relative overflow-hidden animate-terminal-enter">
          {/* Subtle decorative glow in light emerald tones */}
          <div className="absolute -top-24 -left-24 w-48 h-48 bg-emerald-100/60 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-teal-100/60 rounded-full blur-3xl pointer-events-none" />

          {/* Celebratory Checkmark Icon */}
          <div className="w-20 h-20 bg-gradient-to-tr from-emerald-600 to-teal-500 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-600/30 animate-checkmark-pop">
            <CheckCircle2 className="w-10 h-10 text-white" />
          </div>

          <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-800 mb-3">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            Attendance Recorded Successfully
          </span>

          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mb-2">
            {personalizedHeadline}
          </h2>

          <p className="text-base text-slate-700 font-medium mb-1 leading-relaxed">
            {welcome.message}
          </p>

          <p className="text-sm text-slate-500 mb-6">
            {welcome.submessage}
          </p>

          {/* Confirmed Details Badge */}
          <div className="p-4 sm:p-5 bg-slate-50 border border-slate-200 rounded-2xl mb-8 text-left text-xs sm:text-sm space-y-2">
            <div className="flex justify-between items-center text-slate-500">
              <span className="font-medium">Attendee</span>
              <span className="font-bold text-slate-900">{confirmedAttendee.fullName}</span>
            </div>
            <div className="flex justify-between items-center text-slate-500">
              <span className="font-medium">Status</span>
              <span className="text-emerald-700 font-semibold">
                {confirmedAttendee.isNonMember ? 'Guest / Friend' : 'Church Member'}
              </span>
            </div>
            {confirmedAttendee.unitName && (
              <div className="flex justify-between items-center text-slate-500">
                <span className="font-medium">Unit</span>
                <span className="text-slate-800 font-medium">{confirmedAttendee.unitName}</span>
              </div>
            )}
            <div className="flex justify-between items-center text-slate-500">
              <span className="font-medium">Activity</span>
              <span className="text-slate-800 font-medium truncate max-w-[220px]">{sessionTitle}</span>
            </div>
          </div>

          <button
            ref={nextAttendeeButtonRef}
            type="button"
            onClick={handleNextCheckIn}
            className="w-full py-4 px-6 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold rounded-2xl shadow-lg shadow-emerald-700/20 flex items-center justify-center space-x-2 transition cursor-pointer text-sm sm:text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
          >
            <span>Next Attendee Check In</span>
            <ArrowRight className="w-5 h-5" />
          </button>
          <p className="text-[11px] text-slate-400 mt-3 font-medium">Ready for the next person to check in</p>
        </div>
      </div>
    )
  }

  // --- ATTENDANCE FORM SCREEN ---
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-10 animate-terminal-enter">
      <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xl shadow-slate-200/60">
        {/* Terminal Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-slate-100 gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse-gentle" />
              <span className="text-xs uppercase font-mono tracking-wider text-emerald-700 font-bold">
                Terminal Connected • Ready for Check-in
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1.5 tracking-tight">{sessionTitle}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{sessionDate} • Africa/Lagos Time</p>
          </div>

          <button
            type="button"
            onClick={handleRelease}
            className="inline-flex items-center px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition cursor-pointer self-start sm:self-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            title="Disconnect Terminal Station"
          >
            <LogOut className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
            Disconnect Terminal
          </button>
        </div>

        {/* Friendly Error Alert */}
        {statusMessage && (
          <div
            className="mb-6 p-4 rounded-2xl flex items-start space-x-3 text-sm bg-red-50 border border-red-200 text-red-900 shadow-xs animate-terminal-enter"
            role="alert"
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-600 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold block text-red-900 mb-0.5">Check-in Issue</span>
              <span className="text-xs leading-relaxed text-red-700">{statusMessage.text}</span>
            </div>
          </div>
        )}

        {/* Welcoming Subtitle */}
        <div className="mb-6 bg-emerald-50/70 border border-emerald-200/70 rounded-2xl p-4 flex items-center space-x-3 text-slate-700">
          <HeartHandshake className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <p className="text-xs sm:text-sm">
            <strong className="text-slate-900 font-bold">Welcome!</strong> We're glad you're here. Enter your name below to mark your attendance.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Non-Member / Visitor Toggle */}
          <div className="flex items-center space-x-3 p-4 bg-slate-50 hover:bg-slate-100/70 border border-slate-200 rounded-2xl transition cursor-pointer">
            <input
              id="non-member-toggle"
              type="checkbox"
              checked={isNonMember}
              onChange={(e) => {
                setIsNonMember(e.target.checked)
                setSelectedMemberId(null)
              }}
              className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
            />
            <label htmlFor="non-member-toggle" className="text-sm font-semibold text-slate-800 cursor-pointer select-none">
              I am a guest / friend (non-member of the Church)
            </label>
          </div>

          {/* Attendee Name Input with Suggestions */}
          <div className="relative">
            <label htmlFor="attendee-name" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              {isNonMember ? 'Your Full Name' : 'Full Name (Search or Type New)'}
            </label>
            <div className="relative">
              <User className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-400" />
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
                spellCheck={false}
                disabled={isSubmitting}
                className="w-full pl-11 pr-4 py-3.5 bg-slate-50/60 focus:bg-white border border-slate-300 focus:border-emerald-600 rounded-2xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-sm transition shadow-2xs"
              />
            </div>

            {/* Member Suggestions Dropdown */}
            {!isNonMember && filteredMembers.length > 0 && (
              <div
                className="absolute z-20 left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xl shadow-slate-200/70"
                role="listbox"
                aria-label="Name suggestions"
              >
                <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                  Select your name if listed, or continue typing:
                </div>
                {filteredMembers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={selectedMemberId === m.id}
                    onClick={() => handleSelectMember(m)}
                    className="w-full px-4 py-3 text-left text-xs hover:bg-emerald-50 flex items-center justify-between border-b border-slate-100 last:border-b-0 transition cursor-pointer"
                  >
                    <div className="flex items-center space-x-2.5">
                      <UserCheck className="w-4 h-4 text-emerald-600" />
                      <span className="font-semibold text-slate-900">{m.fullName}</span>
                      {m.preferredName && <span className="text-slate-500">({m.preferredName})</span>}
                    </div>
                    <span className="text-slate-600 text-[11px] bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200 font-medium">
                      {m.homeUnitName || 'Unit'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Unit Selection */}
          <div>
            <label htmlFor="unit-select" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              {isNonMember ? 'Inviting Ward or Branch (Optional)' : 'Home Ward or Branch (Required)'}
            </label>
            <div className="relative">
              <Church className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-400 pointer-events-none" />
              <select
                id="unit-select"
                value={selectedUnit}
                onChange={(e) => setSelectedUnit(e.target.value)}
                disabled={isSubmitting}
                className="w-full pl-11 pr-4 py-3.5 bg-slate-50/60 focus:bg-white border border-slate-300 focus:border-emerald-600 rounded-2xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-sm transition shadow-2xs"
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
              <label htmlFor="contact-phone" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                Contact Phone Number (Optional)
              </label>
              <div className="relative">
                <Phone className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-400" />
                <input
                  id="contact-phone"
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="080 1234 5678"
                  disabled={isSubmitting}
                  className="w-full pl-11 pr-4 py-3.5 bg-slate-50/60 focus:bg-white border border-slate-300 focus:border-emerald-600 rounded-2xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-sm transition shadow-2xs"
                />
              </div>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold rounded-2xl shadow-lg shadow-emerald-700/20 flex items-center justify-center space-x-2 transition disabled:opacity-50 cursor-pointer text-sm sm:text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
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
