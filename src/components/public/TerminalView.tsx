import React, { useState, useEffect } from 'react'
import {
  CheckCircle2,
  User,
  Church,
  AlertCircle,
  LogOut,
  Phone,
  UserCheck
} from 'lucide-react'
import { attendanceService } from '../../services/attendanceService'
import { adminService } from '../../services/adminService'
import { memberService } from '../../services/memberService'
import { StakeUnit, MemberRecord } from '../../types/database'

interface TerminalViewProps {
  sessionTitle?: string
  sessionDate?: string
  onReleaseTerminal: () => void
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

  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Load participating units, and ensure terminal heartbeat loop is active
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
          text: 'Terminal lease expired or session was closed by a leader. Please reconnect.'
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!attendeeName.trim()) {
      setStatusMessage({ type: 'error', text: 'Attendee name is required.' })
      return
    }

    if (!isNonMember && !selectedUnit) {
      setStatusMessage({ type: 'error', text: 'Unit is required for Church members. Please select your ward or branch.' })
      return
    }

    // Retrieve active session ID from sessionStorage
    const sessionId = typeof window !== 'undefined' ? sessionStorage.getItem('ysaams_terminal_session_id') : null
    if (!sessionId) {
      setStatusMessage({ type: 'error', text: 'Terminal session lost. Please re-enter session code.' })
      return
    }

    setIsSubmitting(true)
    setStatusMessage(null)

    // For church members who selected a suggestion, use that selectedMemberId.
    // If typing a brand-new name without prior registration, selectedMemberId is null,
    // and the backend records attendance directly (Requirement A).
    const res = await attendanceService.recordAttendance({
      sessionId,
      attendeeName: attendeeName.trim(),
      memberId: selectedMemberId || undefined,
      isNonMember,
      unitId: selectedUnit || null,
      contactPhone: contactPhone.trim() || undefined
    })

    setIsSubmitting(false)

    if (res.success && res.record) {
      setStatusMessage({
        type: 'success',
        text: `Checked in successfully: ${res.record.attendeeName} (${isNonMember ? 'Visitor' : 'Member'}).`
      })
      setAttendeeName('')
      setSelectedMemberId(null)
      setContactPhone('')
      setFilteredMembers([])
    } else {
      setStatusMessage({
        type: 'error',
        text: res.error || 'Check-in failed. Please try again.'
      })
    }
  }

  const handleRelease = async () => {
    await attendanceService.releaseTerminal()
    onReleaseTerminal()
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-slate-800 gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-xs uppercase font-mono tracking-widest text-emerald-400 font-semibold">
                Terminal Connected
              </span>
            </div>
            <h2 className="text-xl font-bold text-white mt-1">{sessionTitle}</h2>
            <p className="text-xs text-slate-400">{sessionDate} • Africa/Lagos Time</p>
          </div>

          <button
            onClick={handleRelease}
            className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
          >
            <LogOut className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
            Release Terminal
          </button>
        </div>

        {statusMessage && (
          <div
            className={`mb-6 p-4 rounded-xl flex items-center space-x-3 text-sm border ${
              statusMessage.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-800/60 text-emerald-200'
                : 'bg-red-950/60 border-red-800/60 text-red-200'
            }`}
            role="status"
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-400" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="flex items-center space-x-3 p-3.5 bg-slate-950/60 border border-slate-800/80 rounded-xl">
            <input
              id="non-member-toggle"
              type="checkbox"
              checked={isNonMember}
              onChange={(e) => {
                setIsNonMember(e.target.checked)
                setSelectedMemberId(null)
              }}
              className="w-4 h-4 rounded border-slate-700 text-emerald-600 focus:ring-emerald-500 bg-slate-900"
            />
            <label htmlFor="non-member-toggle" className="text-sm font-medium text-slate-300 cursor-pointer">
              Non-Member Visitor / Friend
            </label>
          </div>

          <div className="relative">
            <label htmlFor="attendee-name" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              {isNonMember ? 'Visitor Full Name' : 'Member Full Name'}
            </label>
            <div className="relative">
              <User className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-500" />
              <input
                id="attendee-name"
                type="text"
                value={attendeeName}
                onChange={(e) => {
                  setAttendeeName(e.target.value)
                  setSelectedMemberId(null)
                }}
                placeholder={isNonMember ? 'e.g. Oluwaseun Adeleke' : 'Type name to search census...'}
                className="w-full pl-11 pr-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              />
            </div>

            {/* Member Census Auto-Suggestions */}
            {!isNonMember && filteredMembers.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
                {filteredMembers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleSelectMember(m)}
                    className="w-full px-4 py-2.5 text-left text-xs hover:bg-slate-800 flex items-center justify-between border-b border-slate-900 last:border-b-0"
                  >
                    <div className="flex items-center space-x-2">
                      <UserCheck className="w-4 h-4 text-emerald-400" />
                      <span className="font-semibold text-white">{m.fullName}</span>
                      {m.preferredName && <span className="text-slate-400">({m.preferredName})</span>}
                    </div>
                    <span className="text-slate-500 text-[11px]">{m.homeUnitName || 'Unit'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label htmlFor="unit-select" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              {isNonMember ? 'Inviting Unit (Optional)' : 'Home Ward / Branch (Required)'}
            </label>
            <div className="relative">
              <Church className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-500" />
              <select
                id="unit-select"
                value={selectedUnit}
                onChange={(e) => setSelectedUnit(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              >
                <option value="">{isNonMember ? 'None / Stake Wide' : 'Select Ward or Branch'}</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.unitName} ({u.unitType})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isNonMember && (
            <div>
              <label htmlFor="contact-phone" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Contact Phone (Optional)
              </label>
              <div className="relative">
                <Phone className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-500" />
                <input
                  id="contact-phone"
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="080 1234 5678"
                  className="w-full pl-11 pr-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl shadow-lg shadow-emerald-900/30 flex items-center justify-center space-x-2 transition disabled:opacity-50"
          >
            <CheckCircle2 className="w-5 h-5" />
            <span>{isSubmitting ? 'Recording Attendance...' : 'Mark Present'}</span>
          </button>
        </form>
      </div>
    </div>
  )
}
