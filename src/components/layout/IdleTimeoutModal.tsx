import React, { useState, useEffect, useRef, useCallback } from 'react'
import { ShieldAlert, LogOut, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import {
  calculateIdleState,
  shouldThrottleActivity,
  getStoredLastActivity,
  setStoredLastActivity,
  broadcastSignOut,
  clearIdleStorage,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_WARNING_THRESHOLD_MS,
  STORAGE_KEY_LAST_ACTIVITY,
  STORAGE_KEY_SIGNOUT_BROADCAST
} from '../../lib/idleTimer'

interface IdleSessionWatcherProps {
  timeoutMs?: number
  warningThresholdMs?: number
  onIdleExpired?: () => void
}

export const IdleSessionWatcher: React.FC<IdleSessionWatcherProps> = ({
  timeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  warningThresholdMs = DEFAULT_WARNING_THRESHOLD_MS,
  onIdleExpired
}) => {
  const { isAuthenticated, signOut } = useAuth()
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null)
  const [showWarning, setShowWarning] = useState(false)

  const lastActivityRef = useRef<number>(Date.now())
  const lastRecordedActivityRef = useRef<number>(0)
  const isExpiringRef = useRef(false)

  const handleSignOutDueToIdle = useCallback(async () => {
    if (isExpiringRef.current) return
    isExpiringRef.current = true
    setShowWarning(false)
    setSecondsRemaining(null)
    clearIdleStorage()
    broadcastSignOut()
    if (onIdleExpired) {
      onIdleExpired()
    }
    await signOut()
  }, [signOut, onIdleExpired])

  const handleUserActivity = useCallback(() => {
    const now = Date.now()
    if (shouldThrottleActivity(lastRecordedActivityRef.current, now)) {
      return
    }
    lastRecordedActivityRef.current = now
    lastActivityRef.current = now
    setStoredLastActivity(now)

    // If warning was showing, hide it on active interaction
    if (showWarning) {
      setShowWarning(false)
      setSecondsRemaining(null)
    }
  }, [showWarning])

  const handleStaySignedIn = () => {
    const now = Date.now()
    lastActivityRef.current = now
    lastRecordedActivityRef.current = now
    setStoredLastActivity(now)
    setShowWarning(false)
    setSecondsRemaining(null)
  }

  // Cross-tab synchronization & activity listeners
  useEffect(() => {
    if (!isAuthenticated) {
      setShowWarning(false)
      setSecondsRemaining(null)
      return
    }

    // Initialize last activity
    const stored = getStoredLastActivity()
    lastActivityRef.current = stored
    isExpiringRef.current = false

    // Track user input events
    const eventNames = ['mousedown', 'keydown', 'scroll', 'touchstart', 'pointerdown']
    const onUserEvent = () => handleUserActivity()

    eventNames.forEach((event) => {
      window.addEventListener(event, onUserEvent, { passive: true })
    })

    // Listen for storage events from other tabs
    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY_LAST_ACTIVITY && e.newValue) {
        const remoteTime = parseInt(e.newValue, 10)
        if (!isNaN(remoteTime) && remoteTime > lastActivityRef.current) {
          lastActivityRef.current = remoteTime
          if (showWarning) {
            setShowWarning(false)
            setSecondsRemaining(null)
          }
        }
      } else if (e.key === STORAGE_KEY_SIGNOUT_BROADCAST) {
        // Another tab triggered sign-out
        handleSignOutDueToIdle()
      }
    }

    window.addEventListener('storage', handleStorageEvent)

    // Tick interval to check remaining time
    const interval = setInterval(() => {
      const now = Date.now()
      // Always consult stored authoritative timestamp in case another tab updated it
      const currentLastActivity = Math.max(lastActivityRef.current, getStoredLastActivity(lastActivityRef.current))
      lastActivityRef.current = currentLastActivity

      const state = calculateIdleState(currentLastActivity, now, timeoutMs, warningThresholdMs)

      if (state.isExpired) {
        clearInterval(interval)
        handleSignOutDueToIdle()
      } else if (state.isWarning) {
        setShowWarning(true)
        setSecondsRemaining(state.secondsRemaining)
      } else {
        if (showWarning) {
          setShowWarning(false)
          setSecondsRemaining(null)
        }
      }
    }, 1000)

    return () => {
      eventNames.forEach((event) => {
        window.removeEventListener(event, onUserEvent)
      })
      window.removeEventListener('storage', handleStorageEvent)
      clearInterval(interval)
    }
  }, [isAuthenticated, timeoutMs, warningThresholdMs, handleUserActivity, handleSignOutDueToIdle, showWarning])

  if (!showWarning || secondsRemaining === null) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-warning-title"
      aria-describedby="idle-warning-desc"
    >
      <div className="bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-2xl animate-terminal-enter text-center">
        <div className="w-14 h-14 bg-amber-50 dark:bg-amber-950/80 border border-amber-300 dark:border-amber-700/80 rounded-2xl flex items-center justify-center mx-auto mb-4 text-amber-600 dark:text-amber-400">
          <ShieldAlert className="w-7 h-7" />
        </div>

        <h2 id="idle-warning-title" className="text-lg font-bold text-slate-900 dark:text-white mb-2">
          Session Inactivity Warning
        </h2>

        <p id="idle-warning-desc" className="text-sm text-slate-600 dark:text-slate-300 mb-6">
          Your leadership session has been inactive. For security, you will be automatically signed out in{' '}
          <span className="font-mono font-bold text-amber-600 dark:text-amber-400 text-base">
            {secondsRemaining} second{secondsRemaining === 1 ? '' : 's'}
          </span>
          .
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            type="button"
            onClick={handleStaySignedIn}
            className="w-full sm:w-auto px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-semibold shadow-md transition flex items-center justify-center space-x-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Stay Signed In</span>
          </button>
          <button
            type="button"
            onClick={handleSignOutDueToIdle}
            className="w-full sm:w-auto px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-sm font-medium transition flex items-center justify-center space-x-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out Now</span>
          </button>
        </div>
      </div>
    </div>
  )
}
