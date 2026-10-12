import React, { useState } from 'react'
import { CheckCircle2, User, Church, AlertCircle, LogOut } from 'lucide-react'

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
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!attendeeName.trim()) {
      setStatusMessage({ type: 'error', text: 'Attendee name is required.' })
      return
    }

    if (!isNonMember && !selectedUnit) {
      setStatusMessage({ type: 'error', text: 'Unit is required for Church members. Please select your ward or branch.' })
      return
    }

    // In Phase 1 initialization, confirm successful form validation
    setStatusMessage({
      type: 'success',
      text: `Attendance ready for submission: ${attendeeName.trim()} (${isNonMember ? 'Non-member visitor' : 'Member'}).`
    })

    setAttendeeName('')
    setSelectedUnit('')
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
            onClick={onReleaseTerminal}
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
          <div>
            <label htmlFor="attendee-name" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Full Name
            </label>
            <div className="relative">
              <User className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-500" />
              <input
                id="attendee-name"
                type="text"
                value={attendeeName}
                onChange={(e) => setAttendeeName(e.target.value)}
                placeholder="Enter attendee's full name"
                className="w-full pl-11 pr-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
              />
            </div>
          </div>

          <div className="flex items-center space-x-3 p-3.5 bg-slate-950/60 border border-slate-800/80 rounded-xl">
            <input
              id="non-member-toggle"
              type="checkbox"
              checked={isNonMember}
              onChange={(e) => setIsNonMember(e.target.checked)}
              className="w-4 h-4 rounded border-slate-700 text-emerald-600 focus:ring-emerald-500 bg-slate-900"
            />
            <label htmlFor="non-member-toggle" className="text-sm font-medium text-slate-300 cursor-pointer">
              Non-Member Visitor / Friend
            </label>
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
                className="w-full pl-11 pr-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
              >
                <option value="">Select Ward or Branch</option>
                <option value="unit-pending-confirmation" disabled>
                  Stake Units awaiting confirmation (Phase 2)
                </option>
              </select>
            </div>
            {isNonMember && (
              <p className="text-xs text-slate-400 mt-1.5">
                Visitors can optionally indicate which ward or branch invited them.
              </p>
            )}
          </div>

          <button
            type="submit"
            className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl shadow-lg shadow-emerald-900/30 flex items-center justify-center space-x-2 transition"
          >
            <CheckCircle2 className="w-5 h-5" />
            <span>Mark Present</span>
          </button>
        </form>
      </div>
    </div>
  )
}
