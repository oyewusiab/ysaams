import React, { createContext, useContext, useState, useEffect } from 'react'
import { UserProfile, AppRole, UserUnitAssignment } from '../types/database'
import { authService, validateAuthorizedProfile } from '../services/authService'
import { supabase } from '../lib/supabase'

export interface DerivedLeadershipAccess {
  isSystemAdmin: boolean
  isStakeLeader: boolean
  isStakeClerk: boolean
  hasStakeWideReadAccess: boolean
  isClerkRoleOnly: boolean
  canManageActivities: boolean
  canManageMembers: boolean
  canRecordManualAttendance: boolean
  assignedUnitIds: string[]
  manageableUnitIds: string[]
  reportUnitFilter: string[] | null
}

/**
 * Pure helper to derive least-privilege permissions and unit scoping for any authenticated profile.
 * Exported for unit testing across all leadership and clerk roles.
 */
export function deriveLeadershipAccess(
  roles: AppRole[],
  unitAssignments: UserUnitAssignment[] = []
): DerivedLeadershipAccess {
  const isSystemAdmin = roles.includes('system_admin')
  // Strictly system_admin or stake_presidency (governs session reopening, user directory, and audit logs)
  const isStakeLeader = isSystemAdmin || roles.includes('stake_presidency')
  const isStakeClerk = roles.includes('stake_clerk')
  // Stake-wide read/reporting access (includes stake_clerk, or a ysa_leader assigned to all units via assignedUnitIds)
  const hasStakeWideReadAccess = isStakeLeader || isStakeClerk

  const canManageActivities = isStakeLeader || roles.includes('ysa_leader')

  // Only count unit assignments where the user also holds the matching role in user_roles
  const validAssignments = unitAssignments.filter(
    (ua) => ua.unitId && roles.includes(ua.assignedRole)
  )

  const assignedUnitIds = Array.from(new Set(validAssignments.map((ua) => ua.unitId)))

  const manageableUnitIds = Array.from(
    new Set(
      validAssignments
        .filter((ua) =>
          ['bishop', 'branch_president', 'ysa_leader'].includes(ua.assignedRole)
        )
        .map((ua) => ua.unitId)
    )
  )

  const canManageMembers = isStakeLeader || manageableUnitIds.length > 0
  const canRecordManualAttendance = isStakeLeader || manageableUnitIds.length > 0

  const nonClerkRoles: AppRole[] = [
    'system_admin',
    'stake_presidency',
    'ysa_leader',
    'bishop',
    'branch_president'
  ]
  const hasNonClerkRole = roles.some((r) => nonClerkRoles.includes(r))
  const hasClerkRole = roles.some((r) =>
    ['stake_clerk', 'ward_clerk', 'branch_clerk'].includes(r)
  )
  const isClerkRoleOnly = hasClerkRole && !hasNonClerkRole

  const reportUnitFilter: string[] | null = hasStakeWideReadAccess ? null : assignedUnitIds

  return {
    isSystemAdmin,
    isStakeLeader,
    isStakeClerk,
    hasStakeWideReadAccess,
    isClerkRoleOnly,
    canManageActivities,
    canManageMembers,
    canRecordManualAttendance,
    assignedUnitIds,
    manageableUnitIds,
    reportUnitFilter
  }
}

interface AuthContextType extends DerivedLeadershipAccess {
  user: UserProfile | null
  roles: AppRole[]
  isAuthenticated: boolean
  isLoading: boolean
  hasRole: (role: AppRole) => boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [roles, setRoles] = useState<AppRole[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    const applyValidatedProfile = async (profile: UserProfile | null) => {
      const validation = validateAuthorizedProfile(profile)
      if (!validation.authorized || !profile) {
        await authService.signOut().catch(() => {})
        if (mounted) {
          setUser(null)
          setRoles([])
        }
        return
      }
      if (mounted) {
        setUser(profile)
        setRoles(profile.roles)
      }
    }

    const initAuth = async () => {
      try {
        const { data } = await authService.getSession()
        if (data.session?.user && mounted) {
          const profile = await authService.fetchUserProfile(data.session.user.id)
          if (mounted) {
            await applyValidatedProfile(profile)
          }
        }
      } catch (err) {
        console.error('[Auth Init Error]', err)
      } finally {
        if (mounted) setIsLoading(false)
      }
    }

    initAuth()

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return
      if (session?.user) {
        const profile = await authService.fetchUserProfile(session.user.id)
        if (mounted) {
          await applyValidatedProfile(profile)
        }
      } else {
        setUser(null)
        setRoles([])
      }
      if (mounted) {
        setIsLoading(false)
      }
    })

    return () => {
      mounted = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  const hasRole = (role: AppRole): boolean => {
    if (roles.includes('system_admin')) return true
    return roles.includes(role)
  }

  const access = deriveLeadershipAccess(roles, user?.unitAssignments || [])

  const signOut = async () => {
    await authService.signOut()
    setUser(null)
    setRoles([])
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        roles,
        isAuthenticated: !!user && user.accountStatus === 'active' && roles.length > 0,
        isLoading,
        ...access,
        hasRole,
        signOut
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}


