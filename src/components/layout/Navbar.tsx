import React from 'react'
import { Shield, Users, LogOut } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'

interface NavbarProps {
  currentPath: string
  onNavigate: (path: string) => void
}

export const Navbar: React.FC<NavbarProps> = ({ currentPath, onNavigate }) => {
  const { user, isAuthenticated, signOut } = useAuth()
  const { theme } = useTheme()
  const isLeadershipRoute = currentPath.startsWith('/la')

  // Public terminal is always light mode; leadership portal respects user dark toggle
  const logoSrc =
    isLeadershipRoute && theme === 'dark'
      ? '/ams_logo_horizontal_green_bg.png'
      : '/ams_logo_horizontal_light_bg.png'

  return (
    <header className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/90 dark:border-slate-800 text-slate-900 dark:text-slate-100 sticky top-0 z-50 no-print shadow-xs transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="flex items-center space-x-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-xl p-1 transition"
          aria-label="YSA AMS Home - Public Attendance"
        >
          <img
            src={logoSrc}
            alt="YSA AMS - Young Single Adult Attendance Management System"
            className="h-8 sm:h-9 w-auto max-w-[210px] object-contain"
          />
        </button>

        <nav className="flex items-center space-x-2" aria-label="Main Navigation">
          {!isLeadershipRoute ? (
            <button
              onClick={() => onNavigate('/la')}
              className="inline-flex items-center px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 transition cursor-pointer shadow-2xs"
              aria-label="Leadership Portal"
            >
              <Shield className="w-4 h-4 mr-2 text-emerald-600" />
              Leadership Portal
            </button>
          ) : (
            <div className="flex items-center space-x-2 sm:space-x-3">
              <button
                onClick={() => onNavigate('/')}
                className="inline-flex items-center px-3 py-1.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 transition cursor-pointer"
                aria-label="Public Interface"
              >
                <Users className="w-4 h-4 mr-1.5 text-emerald-600 dark:text-emerald-400" />
                <span className="hidden xs:inline sm:inline">Public Terminal</span>
                <span className="xs:hidden sm:hidden">Terminal</span>
              </button>

              {isAuthenticated && (
                <div className="flex items-center space-x-2 sm:space-x-3 border-l border-slate-200 dark:border-slate-700 pl-2 sm:pl-3">
                  <div className="text-right">
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 hidden sm:block">{user?.fullName}</p>
                    <p className="text-[10px] text-emerald-700 dark:text-emerald-400 uppercase tracking-wider font-mono font-medium">
                      {user?.roles?.[0]?.replace('_', ' ') || 'Leader'}
                    </p>
                  </div>
                  <button
                    onClick={() => signOut()}
                    className="p-1.5 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 transition cursor-pointer"
                    title="Sign Out"
                    aria-label="Sign Out"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </nav>
      </div>
    </header>
  )
}
