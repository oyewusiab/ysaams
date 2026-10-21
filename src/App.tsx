import React, { useState, useEffect } from 'react'
import { AlertCircle } from 'lucide-react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { Navbar } from './components/layout/Navbar'
import { LeadershipSidebar } from './components/layout/LeadershipSidebar'
import { IdleSessionWatcher } from './components/layout/IdleTimeoutModal'
import { PublicAttendanceView } from './components/public/PublicAttendanceView'
import { TerminalView } from './components/public/TerminalView'
import { LeadershipPortalView } from './components/leadership/LeadershipPortalView'
import { LeadershipRoute } from './types/database'
import { attendanceService } from './services/attendanceService'
import { parseAuthCallbackUrl } from './services/authService'

/**
 * Pure route resolution helper functions.
 * Exported for comprehensive unit testing.
 */
export function isLeadershipPath(path: string): boolean {
  return path === '/la' || path.startsWith('/la/')
}

export function resolveInitialRoutePath(
  pathname: string,
  hash = '',
  search = ''
): string {
  if (isLeadershipPath(pathname)) {
    return pathname
  }
  const callback = parseAuthCallbackUrl(hash, search)
  if (callback.hasAuthCallback) {
    return '/la'
  }
  return pathname
}

export function resolveLeadershipSubpath(path: string): LeadershipRoute {
  if (path === '/la' || path === '/la/') {
    return 'dashboard'
  }
  const clean = path.replace(/^\/la\/?/, '').replace(/\/$/, '')

  // Supported Route Aliases
  if (clean === 'sessions') return 'activities'
  if (clean === 'audit') return 'audit-logs'
  if (clean === 'admin') return 'users'

  const validSubpaths: LeadershipRoute[] = [
    'dashboard',
    'activities',
    'attendance',
    'members',
    'reports',
    'units',
    'users',
    'settings',
    'audit-logs'
  ]
  if (validSubpaths.includes(clean as LeadershipRoute)) {
    return clean as LeadershipRoute
  }
  return 'not-found'
}

export function extractSessionCode(path: string): string | null {
  // Never match leadership or terminal paths as session codes
  if (isLeadershipPath(path) || path === '/terminal' || path === '/terminal/') {
    return null
  }
  // Matches exact 6-char alphanumeric code (e.g., /5BV21F)
  const regex = /^\/([2-9A-HJ-NP-Za-z0-9]{6})\/?$/
  const match = path.match(regex)
  return match ? match[1].toUpperCase() : null
}

export const AppContent: React.FC = () => {
  const { isAuthenticated, isPasswordRecovery, authCallbackError } = useAuth()
  const [currentPath, setCurrentPath] = useState(() =>
    typeof window !== 'undefined'
      ? resolveInitialRoutePath(
          window.location.pathname,
          window.location.hash,
          window.location.search
        )
      : '/'
  )
  const [activeTerminalCode, setActiveTerminalCode] = useState<string | null>(() => {
    const meta = attendanceService.getStoredSessionMetadata()
    return meta.token ? 'Active Kiosk' : null
  })
  const [terminalSessionTitle, setTerminalSessionTitle] = useState<string>(() => {
    const meta = attendanceService.getStoredSessionMetadata()
    return meta.sessionTitle || 'Active YSA Session'
  })
  const [terminalSessionDate, setTerminalSessionDate] = useState<string>(() => {
    const meta = attendanceService.getStoredSessionMetadata()
    return meta.sessionDate || 'Today'
  })

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if ((isPasswordRecovery || authCallbackError) && !isLeadershipPath(currentPath)) {
      if (typeof window !== 'undefined' && !isLeadershipPath(window.location.pathname)) {
        window.history.replaceState({}, '', '/la')
      }
      setCurrentPath('/la')
    }
  }, [isPasswordRecovery, authCallbackError, currentPath])

  const navigateTo = (path: string) => {
    if (typeof window !== 'undefined' && window.location.pathname !== path) {
      window.history.pushState({}, '', path)
    }
    setCurrentPath(path)
  }

  // 1. Leadership Portal Route Resolution
  if (isLeadershipPath(currentPath)) {
    const subpath = resolveLeadershipSubpath(currentPath)

    if (isAuthenticated) {
      return (
        <div className="min-h-screen flex flex-col lg:flex-row bg-slate-50 dark:bg-slate-950 leadership-theme-scope">
          <IdleSessionWatcher onIdleExpired={() => navigateTo('/la')} />
          <LeadershipSidebar
            currentSubpath={subpath}
            onNavigateSubpath={(newSubpath) => navigateTo(`/la/${newSubpath}`)}
            onNavigateHome={() => navigateTo('/')}
          />
          <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
            <main className="flex-1">
              <LeadershipPortalView
                currentSubpath={subpath}
                onNavigateSubpath={(newSubpath) => navigateTo(`/la/${newSubpath}`)}
              />
            </main>
          </div>
        </div>
      )
    }

    // Unauthenticated Leadership Access (Sign-in form, recovery, invite activation)
    return (
      <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 leadership-theme-scope">
        <Navbar currentPath={currentPath} onNavigate={navigateTo} />
        <main className="flex-1">
          <LeadershipPortalView
            currentSubpath={subpath}
            onNavigateSubpath={(newSubpath) => navigateTo(`/la/${newSubpath}`)}
          />
        </main>
      </div>
    )
  }

  // 2. Terminal Redeemed Route
  if (currentPath === '/terminal' || activeTerminalCode !== null) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
        <Navbar currentPath={currentPath} onNavigate={navigateTo} />
        <main className="flex-1">
          <TerminalView
            sessionTitle={terminalSessionTitle}
            sessionDate={terminalSessionDate}
            onReleaseTerminal={() => {
              setActiveTerminalCode(null)
              navigateTo('/')
            }}
          />
        </main>
      </div>
    )
  }

  // 3. Public Direct Link /:sessionCode or Root /
  const initialCode = extractSessionCode(currentPath)
  const isPublicRoot = currentPath === '/' || currentPath === ''

  if (isPublicRoot || initialCode !== null) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
        <Navbar currentPath={currentPath} onNavigate={navigateTo} />
        <main className="flex-1">
          <PublicAttendanceView
            initialCode={initialCode || undefined}
            onCodeRedeemed={(code, title, date) => {
              setActiveTerminalCode(code)
              if (title) setTerminalSessionTitle(title)
              if (date) setTerminalSessionDate(date)
              // Atomically scrub code from URL to clean /terminal path
              navigateTo('/terminal')
            }}
          />
        </main>
      </div>
    )
  }

  // 4. Unknown Top-Level Route (404 Not Found)
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <Navbar currentPath={currentPath} onNavigate={navigateTo} />
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 text-center shadow-xl shadow-slate-200/50">
          <div className="w-14 h-14 bg-red-50 border border-red-200 rounded-2xl flex items-center justify-center mx-auto mb-4 text-red-600">
            <AlertCircle className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Page Not Found</h2>
          <p className="text-sm text-slate-600 mb-6">
            The requested page <code className="text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 font-mono text-xs">{currentPath}</code> does not exist.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => navigateTo('/')}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-xl text-xs font-semibold transition cursor-pointer"
            >
              Public Check-in
            </button>
            <button
              onClick={() => navigateTo('/la')}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
            >
              Leadership Portal
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
