import React, { useState, useEffect } from 'react'
import { ShieldCheck, ArrowRight, AlertCircle, Loader2 } from 'lucide-react'
import { attendanceService, humanizeTerminalError } from '../../services/attendanceService'

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

  // Function to redeem a 6-character session code
  const redeemCode = async (codeToRedeem: string) => {
    const cleanCode = codeToRedeem.trim().toUpperCase()

    if (!cleanCode) {
      setError('Please enter an activity code to continue.')
      return
    }

    if (cleanCode.length !== 6) {
      setError('Activity codes are exactly 6 letters or numbers.')
      return
    }

    setError(null)
    setIsSubmitting(true)

    try {
      const res = await attendanceService.authorizeTerminal(cleanCode, 'Public Terminal Kiosk')
      setIsSubmitting(false)

      if (res.success) {
        onCodeRedeemed(cleanCode, res.sessionTitle, res.sessionDate)
      } else {
        setError(humanizeTerminalError(res.error))
      }
    } catch {
      setIsSubmitting(false)
      setError('We could not connect to this activity. Please verify the code or check your internet connection.')
    }
  }

  // Automatically attempt connection if navigated via direct link (/:sessionCode)
  useEffect(() => {
    if (initialCode && initialCode.trim().length === 6) {
      redeemCode(initialCode)
    }
  }, [initialCode])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await redeemCode(code)
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 sm:p-6 relative overflow-hidden bg-gradient-to-b from-slate-50 via-white to-emerald-50/20">
      {/* Restrained decorative background motif representing connection and community */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden" aria-hidden="true">
        <div className="w-[600px] h-[600px] rounded-full bg-emerald-100/40 blur-3xl opacity-70 animate-pulse-gentle" />
        <svg
          className="absolute w-[800px] h-[800px] opacity-[0.06] text-emerald-800"
          viewBox="0 0 400 400"
          fill="none"
          stroke="currentColor"
        >
          <circle cx="200" cy="200" r="160" strokeWidth="1" strokeDasharray="4 6" />
          <circle cx="200" cy="200" r="120" strokeWidth="1.5" />
          <circle cx="200" cy="200" r="80" strokeWidth="1" strokeDasharray="6 6" />
          <path d="M200 40 L200 360 M40 200 L360 200" strokeWidth="0.75" />
        </svg>
      </div>

      <div className="w-full max-w-lg bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-10 shadow-xl shadow-slate-200/60 relative z-10 animate-terminal-enter">
        {/* Brand Presentation */}
        <div className="text-center mb-6">
          <div className="inline-flex justify-center mb-4">
            <img
              src="/YSA AMS logo.png"
              alt="YSA AMS Emblem"
              className="h-16 sm:h-20 w-auto object-contain mx-auto"
            />
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-800 mb-3">
            <span>Abeokuta Nigeria Obantoko Stake</span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Welcome! We're glad you're here.
          </h2>
          <p className="text-sm sm:text-base text-slate-600 mt-2.5 leading-relaxed max-w-md mx-auto">
            Enter the activity code shared by your leader to check in. Whether you're a regular attendee or joining us for the first time, you're welcome.
          </p>
        </div>

        {/* Accessible Error State */}
        {error && (
          <div
            className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start space-x-3 text-red-900 text-sm shadow-xs animate-terminal-enter"
            role="alert"
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-600 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold block text-red-900 mb-0.5">Check-in Unavailable</span>
              <span className="text-xs leading-relaxed text-red-700">{error}</span>
            </div>
          </div>
        )}

        {/* Code Input Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="session-code"
              className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 text-center sm:text-left"
            >
              6-Character Activity Code
            </label>
            <input
              id="session-code"
              type="text"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="CODE24"
              autoComplete="off"
              spellCheck={false}
              disabled={isSubmitting}
              aria-label="6-Character Activity Code"
              className="w-full px-4 py-3.5 sm:py-4 bg-slate-50 hover:bg-slate-100/60 focus:bg-white border-2 border-slate-200 focus:border-emerald-600 rounded-2xl text-center text-3xl sm:text-4xl font-mono font-bold tracking-[0.25em] text-emerald-800 placeholder:text-slate-300 placeholder:font-normal placeholder:tracking-normal focus:outline-none focus:ring-4 focus:ring-emerald-500/15 transition shadow-inner uppercase disabled:opacity-50"
            />
            <p className="text-[11px] text-slate-500 text-center mt-2 font-medium">
              Codes are 6 letters and numbers, shared on screen or by your activity leader.
            </p>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 px-6 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold rounded-2xl shadow-lg shadow-emerald-700/20 flex items-center justify-center space-x-2 transition disabled:opacity-60 cursor-pointer text-sm sm:text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Connecting to Activity...</span>
              </>
            ) : (
              <>
                <span>Connect & Check In</span>
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-100 text-center">
          <div className="flex items-center justify-center space-x-1.5 text-xs font-medium text-slate-600">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Young Single Adult Attendance System</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            No account required. All young single adults and friends are warmly welcome!
          </p>
        </div>
      </div>
    </div>
  )
}
