import React, { useState } from 'react'
import {
  LayoutDashboard,
  Calendar,
  ClipboardCheck,
  Users,
  BarChart3,
  Building2,
  UserCog,
  Settings,
  FileText,
  Lock,
  ArrowRight,
  ShieldAlert
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { LeadershipRoute } from '../../types/database'

interface LeadershipPortalViewProps {
  currentSubpath: LeadershipRoute
  onNavigateSubpath: (subpath: LeadershipRoute) => void
}

export const LeadershipPortalView: React.FC<LeadershipPortalViewProps> = ({
  currentSubpath,
  onNavigateSubpath
}) => {
  const { isAuthenticated, user } = useAuth()
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  if (!isAuthenticated) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
          <div className="text-center mb-6">
            <div className="w-14 h-14 bg-emerald-950/80 border border-emerald-500/30 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Lock className="w-7 h-7" />
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Leadership Portal</h2>
            <p className="text-sm text-slate-400 mt-1">
              Authorized stake presidency, bishops, branch presidents & YSA leaders only.
            </p>
          </div>

          <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl mb-6 text-xs text-slate-400 flex items-start space-x-2.5">
            <ShieldAlert className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <span>
              Self-signup is disabled. Privileged accounts must be provisioned by a Stake System Administrator.
            </span>
          </div>

          <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Leader Email
              </label>
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="leader@churchofjesuschrist.org"
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Password
              </label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              />
            </div>

            <button
              type="button"
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl shadow-lg shadow-emerald-900/30 flex items-center justify-center space-x-2 transition text-sm"
            >
              <span>Sign In to Portal</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    )
  }

  const navItems: { id: LeadershipRoute; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'activities', label: 'Activities', icon: Calendar },
    { id: 'attendance', label: 'Live Attendance', icon: ClipboardCheck },
    { id: 'members', label: 'Member Census', icon: Users },
    { id: 'reports', label: 'Reports & Export', icon: BarChart3 },
    { id: 'units', label: 'Stake Units', icon: Building2 },
    { id: 'users', label: 'User Provisioning', icon: UserCog },
    { id: 'settings', label: 'Stake Settings', icon: Settings },
    { id: 'audit-logs', label: 'Audit Logs', icon: FileText }
  ]

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Sub-navigation bar */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-4 mb-8 border-b border-slate-800 scrollbar-none">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = currentSubpath === item.id
          return (
            <button
              key={item.id}
              onClick={() => onNavigateSubpath(item.id)}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
                isActive
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>

      {/* Main View Shell */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-slate-800 gap-4">
          <div>
            <span className="text-xs font-mono uppercase tracking-widest text-emerald-400 font-semibold">
              Leadership Portal • /la/{currentSubpath}
            </span>
            <h2 className="text-2xl font-bold text-white capitalize mt-1">
              {currentSubpath.replace('-', ' ')}
            </h2>
          </div>

          <div className="text-xs bg-slate-950 px-3.5 py-2 rounded-xl border border-slate-800 text-slate-400 flex items-center space-x-2">
            <span>Scoped User:</span>
            <span className="font-semibold text-slate-200">{user?.fullName || 'Stake Leader'}</span>
          </div>
        </div>

        <div className="py-12 text-center text-slate-400">
          <p className="text-sm">
            Module <strong>/la/{currentSubpath}</strong> registered in application architecture.
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Business logic and database persistence will be implemented in subsequent phases.
          </p>
        </div>
      </div>
    </div>
  )
}
