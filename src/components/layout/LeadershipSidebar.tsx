import React, { useState, useEffect } from 'react'
import {
  LayoutDashboard,
  Calendar,
  ClipboardCheck,
  Users,
  BarChart3,
  Building2,
  UserCog,
  FileText,
  Settings,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  LogOut,
  Sun,
  Moon,
  ExternalLink
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { LeadershipRoute } from '../../types/database'

export interface RoleNavAccess {
  isStakeLeader: boolean
  canRecordManualAttendance: boolean
}

export function getRolePermittedNavItems(
  access: RoleNavAccess
): { id: LeadershipRoute; label: string; icon: React.FC<{ className?: string }> }[] {
  const items: { id: LeadershipRoute; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'activities', label: 'Activities & Sessions', icon: Calendar }
  ]

  // Authorized manual attendance check-in is relevant to presiding leaders, hidden for read-only clerks
  if (access.canRecordManualAttendance) {
    items.push({ id: 'attendance', label: 'Authorized Check-in', icon: ClipboardCheck })
  }

  items.push(
    { id: 'members', label: 'Member Census', icon: Users },
    { id: 'reports', label: 'Reports & Export', icon: BarChart3 },
    { id: 'units', label: 'Stake Units', icon: Building2 }
  )

  // Governance and audit logs are strictly restricted to stake presidency and system admin
  if (access.isStakeLeader) {
    items.push(
      { id: 'users', label: 'User Governance', icon: UserCog },
      { id: 'audit-logs', label: 'Audit Trail', icon: FileText }
    )
  }

  items.push({ id: 'settings', label: 'Settings', icon: Settings })

  return items
}

interface LeadershipSidebarProps {
  currentSubpath: LeadershipRoute
  onNavigateSubpath: (subpath: LeadershipRoute) => void
  onNavigateHome?: () => void
}

const STORAGE_KEY_SIDEBAR = 'ysaams_sidebar_collapsed'

export const LeadershipSidebar: React.FC<LeadershipSidebarProps> = ({
  currentSubpath,
  onNavigateSubpath,
  onNavigateHome
}) => {
  const { user, isStakeLeader, canRecordManualAttendance, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()

  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem(STORAGE_KEY_SIDEBAR) === 'true'
    } catch {
      return false
    }
  })

  const [isMobileOpen, setIsMobileOpen] = useState(false)

  const toggleCollapsed = () => {
    setIsCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(STORAGE_KEY_SIDEBAR, String(next))
      } catch {
        // Non-blocking
      }
      return next
    })
  }

  // Close mobile drawer on route change or Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMobileOpen) {
        setIsMobileOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isMobileOpen])

  const navItems = getRolePermittedNavItems({
    isStakeLeader,
    canRecordManualAttendance
  })

  const roleDisplay = user?.roles?.[0]?.replace(/_/g, ' ') || 'Leader'

  return (
    <>
      {/* Mobile Top Header */}
      <header className="lg:hidden sticky top-0 z-40 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 h-14 flex items-center justify-between no-print shadow-xs">
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={() => setIsMobileOpen(true)}
            className="p-2 -ml-1 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            aria-label="Open leadership navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center space-x-2">
            <img
              src={theme === 'dark' ? '/ams_logo_horizontal_green_bg.png' : '/ams_logo_horizontal_light_bg.png'}
              alt="YSA AMS"
              className="h-7 w-auto max-w-[140px] object-contain"
            />
          </div>
        </div>

        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={toggleTheme}
            className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
          </button>
          <button
            type="button"
            onClick={() => signOut()}
            className="p-2 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 rounded-lg transition"
            title="Sign Out"
            aria-label="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Mobile Drawer Backdrop */}
      {isMobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs transition-opacity"
          onClick={() => setIsMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile Drawer Menu */}
      <div
        className={`lg:hidden fixed top-0 bottom-0 left-0 z-50 w-72 max-w-[85vw] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col transform transition-transform duration-200 ease-in-out ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Leadership Navigation Drawer"
      >
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <img
              src={theme === 'dark' ? '/ams_logo_horizontal_green_bg.png' : '/ams_logo_horizontal_light_bg.png'}
              alt="YSA AMS"
              className="h-8 w-auto max-w-[150px] object-contain"
            />
          </div>
          <button
            type="button"
            onClick={() => setIsMobileOpen(false)}
            className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User banner in mobile drawer */}
        <div className="p-3.5 mx-3 mt-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl">
          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{user?.fullName || 'Leader'}</p>
          <span className="inline-block mt-0.5 text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-400 rounded">
            {roleDisplay}
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1" aria-label="Leadership Navigation">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = currentSubpath === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onNavigateSubpath(item.id)
                  setIsMobileOpen(false)
                }}
                className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                  isActive
                    ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 font-bold border-l-4 border-emerald-600'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
          {onNavigateHome && (
            <button
              type="button"
              onClick={() => {
                onNavigateHome()
                setIsMobileOpen(false)
              }}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <span>Public Terminal</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={toggleTheme}
              className="flex items-center space-x-2 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-2 py-1.5 rounded-lg"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400" />
                  <span>Light Mode</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-slate-600" />
                  <span>Dark Mode</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => signOut()}
              className="flex items-center space-x-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 px-2 py-1.5 rounded-lg transition"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>

      {/* Desktop Sticky Left Sidebar */}
      <aside
        className={`hidden lg:flex flex-col shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-200 ease-in-out sticky top-0 h-screen select-none z-30 no-print ${
          isCollapsed ? 'w-20' : 'w-64'
        }`}
        aria-label="Leadership Sidebar Navigation"
      >
        {/* Brand Header */}
        <div className="h-16 px-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3 overflow-hidden">
            {!isCollapsed ? (
              <img
                src={theme === 'dark' ? '/ams_logo_horizontal_green_bg.png' : '/ams_logo_horizontal_light_bg.png'}
                alt="YSA AMS"
                className="h-8 w-auto max-w-[150px] object-contain"
              />
            ) : (
              <img
                src="/favicon_green_bg.png"
                alt="YSA AMS"
                className="w-8 h-8 rounded-lg object-contain shadow-xs"
              />
            )}
          </div>

          <button
            type="button"
            onClick={toggleCollapsed}
            className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-4 space-y-1" aria-label="Leadership Navigation">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = currentSubpath === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigateSubpath(item.id)}
                className={`w-full flex items-center rounded-xl text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                  isCollapsed ? 'justify-center p-3' : 'space-x-3 px-3.5 py-2.5 text-left'
                } ${
                  isActive
                    ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 font-bold border-l-4 border-emerald-600 shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                }`}
                title={isCollapsed ? item.label : undefined}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`} />
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </button>
            )
          })}
        </nav>

        {/* Footer Area: User Profile, Public Link, Theme Toggle & Sign Out */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 shrink-0 space-y-2">
          {/* Public Terminal Shortcut */}
          {onNavigateHome && !isCollapsed && (
            <button
              type="button"
              onClick={onNavigateHome}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              title="Open Public Attendance Terminal"
            >
              <span className="truncate">Public Terminal</span>
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            </button>
          )}

          {/* User Info Card */}
          <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} p-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800`}>
            {!isCollapsed ? (
              <div className="min-w-0 pr-2">
                <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{user?.fullName || 'Leader'}</p>
                <p className="text-[10px] text-emerald-700 dark:text-emerald-400 font-mono uppercase tracking-wider truncate font-medium">
                  {roleDisplay}
                </p>
              </div>
            ) : (
              <div
                className="w-8 h-8 rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 font-bold text-xs flex items-center justify-center uppercase font-mono"
                title={`${user?.fullName || 'Leader'} (${roleDisplay})`}
              >
                {user?.fullName?.charAt(0) || 'L'}
              </div>
            )}

            {!isCollapsed && (
              <div className="flex items-center space-x-1 shrink-0">
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition"
                  title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-slate-600" />}
                </button>
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="p-1.5 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition"
                  title="Sign Out"
                  aria-label="Sign Out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Quick icon actions when collapsed */}
          {isCollapsed && (
            <div className="flex flex-col items-center space-y-1 pt-1">
              <button
                type="button"
                onClick={toggleTheme}
                className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
              </button>
              <button
                type="button"
                onClick={() => signOut()}
                className="p-2 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                title="Sign Out"
                aria-label="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
