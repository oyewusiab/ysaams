import React, { useState, useEffect } from 'react'
import { AuthProvider } from './context/AuthContext'
import { Navbar } from './components/layout/Navbar'
import { PublicAttendanceView } from './components/public/PublicAttendanceView'
import { TerminalView } from './components/public/TerminalView'
import { LeadershipPortalView } from './components/leadership/LeadershipPortalView'
import { LeadershipRoute } from './types/database'

/**
 * Pure route resolution helper functions.
 * Exported for comprehensive unit testing.
 */
export function isLeadershipPath(path: string): boolean {
  return path === '/la' || path.startsWith('/la/')
}

export function resolveLeadershipSubpath(path: string): LeadershipRoute {
  if (path === '/la' || path === '/la/') {
    return 'dashboard'
  }
  const clean = path.replace(/^\/la\/?/, '').replace(/\/$/, '')
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
  return 'dashboard'
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
  const [currentPath, setCurrentPath] = useState(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/'
  )
  const [activeTerminalCode, setActiveTerminalCode] = useState<string | null>(null)

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigateTo = (path: string) => {
    if (typeof window !== 'undefined' && window.location.pathname !== path) {
      window.history.pushState({}, '', path)
    }
    setCurrentPath(path)
  }

  // 1. Leadership Portal Route Resolution
  if (isLeadershipPath(currentPath)) {
    const subpath = resolveLeadershipSubpath(currentPath)
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
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
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar currentPath={currentPath} onNavigate={navigateTo} />
        <main className="flex-1">
          <TerminalView
            sessionTitle={`Session ${activeTerminalCode || 'Terminal'}`}
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
  const initialCode = extractSessionCode(currentPath) || undefined

  return (
    <div className="min-h-screen flex flex-col bg-slate-950">
      <Navbar currentPath={currentPath} onNavigate={navigateTo} />
      <main className="flex-1">
        <PublicAttendanceView
          initialCode={initialCode}
          onCodeRedeemed={(code) => {
            setActiveTerminalCode(code)
            // Atomically scrub code from URL to clean /terminal path
            navigateTo('/terminal')
          }}
        />
      </main>
    </div>
  )
}

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App
