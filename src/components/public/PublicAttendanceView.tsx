import React, { useState } from 'react'
import { ShieldCheck, ArrowRight, Smartphone, AlertCircle, Loader2 } from 'lucide-react'
import { attendanceService } from '../../services/attendanceService'

interface PublicAttendanceViewProps {
  initialCode?: string
  onCodeRedeemed: (sessionCode: string, sessionTitle?: string, sessionDate?: string) => void
}

export const PublicAttendanceView: React.FC<PublicAttendanceViewProps> = ({
  initialCode = '',
  onCodeRedeemed
}) => {
  const [code, setCode] = useState(initialCode)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleanCode = code.trim().toUpperCase()

    if (!cleanCode) {
      setError('Please enter a session code.')
      return
    }

    if (cleanCode.length !== 6) {
      setError('Session codes are exactly 6 characters.')
      return
    }

    setError(null)
    setIsSubmitting(true)

    // Invoke atomic terminal authorization RPC
    const res = await attendanceService.authorizeTerminal(cleanCode, 'Public Terminal Kiosk')
    setIsSubmitting(false)

    if (res.success) {
      onCodeRedeemed(cleanCode, res.sessionTitle, res.sessionDate)
    } else {
      setError(res.error || 'Failed to connect terminal. Please verify session code.')
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-emerald-950/80 border border-emerald-500/30 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Smartphone className="w-7 h-7" />
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Attendance Check-in</h2>
          <p className="text-sm text-slate-400 mt-1">
            Enter the 6-character session code provided by your YSA leader.
          </p>
        </div>

        {error && (
          <div
            className="mb-6 p-3.5 bg-red-950/60 border border-red-800/60 rounded-xl flex items-center space-x-3 text-red-200 text-sm"
            role="alert"
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="session-code" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Session Code
            </label>
            <input
              id="session-code"
              type="text"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. 5BV21F"
              autoComplete="off"
              disabled={isSubmitting}
              className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-center text-2xl font-mono font-bold tracking-widest text-emerald-400 placeholder:text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition uppercase disabled:opacity-50"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl shadow-lg shadow-emerald-900/30 flex items-center justify-center space-x-2 transition disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Authorizing Kiosk...</span>
              </>
            ) : (
              <>
                <span>Connect to Session</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-800/80 text-center">
          <div className="flex items-center justify-center space-x-1.5 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>Authorized by Abeokuta Nigeria Obantoko Stake</span>
          </div>
        </div>
      </div>
    </div>
  )
}
