import React, { useState, useEffect } from 'react'
import { ShieldCheck, ArrowRight, Smartphone, AlertCircle, Loader2, Sparkles } from 'lucide-react'
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
      setError('Please enter a session code.')
      return
    }

    if (cleanCode.length !== 6) {
      setError('Session codes are exactly 6 characters.')
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
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl animate-terminal-enter">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-tr from-emerald-950 to-emerald-900/60 border border-emerald-500/30 text-emerald-400 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-950/40">
            <Smartphone className="w-8 h-8" />
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-950/70 border border-emerald-800/60 text-emerald-300 mb-2.5">
            <Sparkles className="w-3.5 h-3.5" />
            Welcome to YSA Check-in
          </span>
          <h2 className="text-2xl font-bold text-white tracking-tight">You're in the Right Place</h2>
          <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">
            Enter the 6-character activity code provided by your leader or scan your activity check-in link.
          </p>
        </div>

        {error && (
          <div
            className="mb-6 p-4 bg-red-950/70 border border-red-800/80 rounded-2xl flex items-start space-x-3 text-red-200 text-sm shadow-md animate-terminal-enter"
            role="alert"
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-400 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold block text-red-300 mb-0.5">Check-in Unavailable</span>
              <span className="text-xs leading-relaxed text-red-200">{error}</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="session-code" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              6-Character Activity Code
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
              aria-label="Activity Session Code"
              className="w-full px-4 py-3.5 bg-slate-950 border border-slate-800 rounded-2xl text-center text-3xl font-mono font-bold tracking-widest text-emerald-400 placeholder:text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition uppercase disabled:opacity-50"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-2xl shadow-xl shadow-emerald-950/50 flex items-center justify-center space-x-2 transition disabled:opacity-50 cursor-pointer"
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

        <div className="mt-8 pt-6 border-t border-slate-800/80 text-center">
          <div className="flex items-center justify-center space-x-1.5 text-xs text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>Abeokuta Nigeria Obantoko Stake</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            No account required. All young single adults and friends are welcome!
          </p>
        </div>
      </div>
    </div>
  )
}

