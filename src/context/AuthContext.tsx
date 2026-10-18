import React, { createContext, useContext, useState, useEffect } from 'react'
import { UserProfile, AppRole } from '../types/database'
import { authService, validateAuthorizedProfile } from '../services/authService'
import { supabase } from '../lib/supabase'

interface AuthContextType {
  user: UserProfile | null
  roles: AppRole[]
  isAuthenticated: boolean
  isLoading: boolean
  isSystemAdmin: boolean
  isStakeLeader: boolean
  canManageActivities: boolean
  assignedUnitIds: string[]
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

  const isSystemAdmin = roles.includes('system_admin')
  const isStakeLeader = isSystemAdmin || roles.includes('stake_presidency')
  const canManageActivities = isStakeLeader || roles.includes('ysa_leader')
  const assignedUnitIds = Array.from(
    new Set((user?.unitAssignments || []).map((ua) => ua.unitId).filter(Boolean))
  )

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
        isSystemAdmin,
        isStakeLeader,
        canManageActivities,
        assignedUnitIds,
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

