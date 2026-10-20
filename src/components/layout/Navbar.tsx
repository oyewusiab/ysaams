import React from 'react'
import { Shield, Users, LogOut, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

interface NavbarProps {
  currentPath: string
  onNavigate: (path: string) => void
}

export const Navbar: React.FC<NavbarProps> = ({ currentPath, onNavigate }) => {
  const { user, isAuthenticated, signOut } = useAuth()
  const isLeadershipRoute = currentPath.startsWith('/la')

  return (
    <header className="bg-slate-900 border-b border-slate-800 text-slate-100 sticky top-0 z-50 no-print">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="flex items-center space-x-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-xl p-1 transition"
          aria-label="YSA AMS Home - Public Attendance"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center shadow-md flex-shrink-0">
            <CheckCircle2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white tracking-tight leading-tight">YSA AMS</h1>
            <p className="text-xs text-slate-400">Abeokuta Nigeria Obantoko Stake</p>
          </div>
        </button>

        <nav className="flex items-center space-x-2" aria-label="Main Navigation">
          {!isLeadershipRoute ? (
            <button
              onClick={() => onNavigate('/la')}
              className="inline-flex items-center px-3.5 py-1.5 rounded-lg text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 transition"
              aria-label="Leadership Portal"
            >
              <Shield className="w-4 h-4 mr-2 text-emerald-400" />
              Leadership Portal
            </button>
          ) : (
            <div className="flex items-center space-x-2 sm:space-x-3">
              <button
                onClick={() => onNavigate('/')}
                className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 transition"
                aria-label="Public Interface"
              >
                <Users className="w-4 h-4 mr-1.5" />
                <span className="hidden xs:inline sm:inline">Public Terminal</span>
                <span className="xs:hidden sm:hidden">Terminal</span>
              </button>

              {isAuthenticated && (
                <div className="flex items-center space-x-2 sm:space-x-3 border-l border-slate-700 pl-2 sm:pl-3">
                  <div className="text-right">
                    <p className="text-xs font-semibold text-slate-200 hidden sm:block">{user?.fullName}</p>
                    <p className="text-[10px] text-emerald-400 uppercase tracking-wider font-mono font-medium">
                      {user?.roles?.[0]?.replace('_', ' ') || 'Leader'}
                    </p>
                  </div>
                  <button
                    onClick={() => signOut()}
                    className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 transition"
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
