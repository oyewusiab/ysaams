import React, { createContext, useContext, useState, useEffect } from 'react'
import { UserProfile, AppRole } from '../types/database'
import { authService } from '../services/authService'
import { supabase } from '../lib/supabase'

interface AuthContextType {
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

    const initAuth = async () => {
      try {
        const { data } = await authService.getSession()
        if (data.session?.user && mounted) {
          const profile = await authService.fetchUserProfile(data.session.user.id)
          if (mounted && profile) {
            setUser(profile)
            setRoles(profile.roles)
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
        if (mounted && profile) {
          setUser(profile)
          setRoles(profile.roles)
        }
      } else {
        setUser(null)
        setRoles([])
      }
      setIsLoading(false)
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
        isAuthenticated: !!user,
        isLoading,
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
