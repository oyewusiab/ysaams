import React, { createContext, useContext, useState, useEffect, useRef } from 'react'
import { UserProfile, AppRole, UserUnitAssignment } from '../types/database'
import {
  authService,
  validateAuthorizedProfile,
  parseAuthCallbackUrl
} from '../services/authService'
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
  isPasswordRecovery: boolean
  recoveryEmail: string | null
  authCallbackError: string | null
  authCallbackNotice: string | null
  completePasswordRecovery: () => Promise<{ authorized: boolean; message?: string }>
  cancelPasswordRecovery: () => Promise<void>
  clearAuthCallbackFeedback: () => void
  hasRole: (role: AppRole) => boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initialCallback =
    typeof window !== 'undefined'
      ? parseAuthCallbackUrl(window.location.hash, window.location.search)
      : parseAuthCallbackUrl('', '')

  const [user, setUser] = useState<UserProfile | null>(null)
  const [roles, setRoles] = useState<AppRole[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(
    initialCallback.isPasswordRecovery
  )
  const [recoveryEmail, setRecoveryEmail] = useState<string | null>(null)
  const [authCallbackError, setAuthCallbackError] = useState<string | null>(
    initialCallback.errorMessage
  )
  const [authCallbackNotice, setAuthCallbackNotice] = useState<string | null>(
    initialCallback.isEmailConfirmation
      ? 'Your email address has been verified. You may now sign in to the Leadership Portal.'
      : null
  )
  const recoveryRef = useRef<boolean>(initialCallback.isPasswordRecovery)

  const setRecoveryMode = (active: boolean) => {
    recoveryRef.current = active
    setIsPasswordRecovery(active)
  }

  useEffect(() => {
    let mounted = true

    const scrubAuthParamsFromUrl = () => {
      if (typeof window === 'undefined') return
      const parsed = parseAuthCallbackUrl(window.location.hash, window.location.search)
      if (!parsed.hasAuthCallback) return
      const targetPath = window.location.pathname.startsWith('/la')
        ? window.location.pathname
        : '/la'
      window.history.replaceState({}, '', targetPath)
    }

    const applyValidatedProfile = async (
      profile: UserProfile | null,
      preserveRecoverySession = false
    ): Promise<{ authorized: boolean; error?: string }> => {
      const validation = validateAuthorizedProfile(profile)
      if (!validation.authorized || !profile) {
        if (!preserveRecoverySession && !recoveryRef.current) {
          await authService.signOut().catch(() => {})
        }
        if (mounted) {
          setUser(null)
          setRoles([])
        }
        return { authorized: false, error: validation.error }
      }
      if (mounted) {
        setUser(profile)
        setRoles(profile.roles)
      }
      return { authorized: true }
    }

    const initAuth = async () => {
      try {
        // Verify PKCE / token_hash OTP if provided in query parameters
        if (
          initialCallback.tokenHash &&
          initialCallback.callbackType &&
          !initialCallback.errorMessage
        ) {
          const otpType = initialCallback.callbackType as
            | 'recovery'
            | 'invite'
            | 'signup'
            | 'email'
            | 'magiclink'
          const { error: otpError } = await supabase.auth.verifyOtp({
            token_hash: initialCallback.tokenHash,
            type: otpType
          })
          if (otpError && mounted) {
            setRecoveryMode(false)
            setAuthCallbackError(
              'This password recovery or invitation link is invalid or has expired. Please request a fresh recovery link below.'
            )
          }
        }

        const { data } = await authService.getSession()
        if (data.session?.user && mounted) {
          setRecoveryEmail(data.session.user.email || null)
          const profile = await authService.fetchUserProfile(data.session.user.id)
          if (mounted) {
            await applyValidatedProfile(profile, recoveryRef.current)
          }
        } else if (recoveryRef.current && mounted) {
          // URL had #type=recovery or #type=invite, but Supabase session failed or expired
          setRecoveryMode(false)
          setAuthCallbackError(
            'This password recovery or invitation link is invalid or has expired. Please request a fresh recovery link below.'
          )
        }
      } catch (err) {
        console.error('[Auth Init Error]', err)
      } finally {
        scrubAuthParamsFromUrl()
        if (mounted) setIsLoading(false)
      }
    }

    initAuth()

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return

      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true)
        setAuthCallbackError(null)
        setRecoveryEmail(session?.user?.email || null)
        scrubAuthParamsFromUrl()
      }

      if (session?.user) {
        setRecoveryEmail(session.user.email || null)
        const profile = await authService.fetchUserProfile(session.user.id)
        if (mounted) {
          await applyValidatedProfile(
            profile,
            event === 'PASSWORD_RECOVERY' || recoveryRef.current
          )
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

  const completePasswordRecovery = async (): Promise<{
    authorized: boolean
    message?: string
  }> => {
    setRecoveryMode(false)
    setAuthCallbackError(null)
    const { data } = await authService.getSession()
    if (!data.session?.user) {
      setUser(null)
      setRoles([])
      return {
        authorized: false,
        message: 'Your password has been updated. Please sign in with your new password.'
      }
    }
    const profile = await authService.fetchUserProfile(data.session.user.id)
    const validation = validateAuthorizedProfile(profile)
    if (!validation.authorized || !profile) {
      await authService.signOut().catch(() => {})
      setUser(null)
      setRoles([])
      return {
        authorized: false,
        message:
          'Your password has been saved. Complete sign-in once a Stake System Administrator activates your leadership role assignment.'
      }
    }
    setUser(profile)
    setRoles(profile.roles)
    return {
      authorized: true,
      message: 'Your leadership password has been updated.'
    }
  }

  const cancelPasswordRecovery = async () => {
    setRecoveryMode(false)
    await authService.signOut().catch(() => {})
    setUser(null)
    setRoles([])
  }

  const clearAuthCallbackFeedback = () => {
    setAuthCallbackError(null)
    setAuthCallbackNotice(null)
  }

  const hasRole = (role: AppRole): boolean => {
    if (roles.includes('system_admin')) return true
    return roles.includes(role)
  }

  const access = deriveLeadershipAccess(roles, user?.unitAssignments || [])

  const signOut = async () => {
    setRecoveryMode(false)
    await authService.signOut()
    setUser(null)
    setRoles([])
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        roles,
        isAuthenticated:
          !isPasswordRecovery &&
          !!user &&
          user.accountStatus === 'active' &&
          roles.length > 0,
        isLoading,
        isPasswordRecovery,
        recoveryEmail,
        authCallbackError,
        authCallbackNotice,
        completePasswordRecovery,
        cancelPasswordRecovery,
        clearAuthCallbackFeedback,
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


