import { supabase } from '../lib/supabase'
import { PRODUCTION_AUTH_REDIRECT_URL, PRODUCTION_SITE_URL } from '../lib/env'
import { UserProfile, AppRole, UserUnitAssignment } from '../types/database'

export { PRODUCTION_SITE_URL, PRODUCTION_AUTH_REDIRECT_URL }

export interface AuthState {
  user: UserProfile | null
  roles: AppRole[]
  isLoading: boolean
  error: string | null
}

export interface ParsedAuthCallback {
  hasAuthCallback: boolean
  isPasswordRecovery: boolean
  isInvite: boolean
  isEmailConfirmation: boolean
  callbackType: string | null
  tokenHash: string | null
  errorCode: string | null
  errorMessage: string | null
}

/**
 * Resolves the canonical `/la` redirect URL for password recovery, invitations,
 * and email confirmation callbacks.
 *
 * - Uses `${currentOrigin}/la` when running locally (`localhost`, `127.0.0.1`, `[::1]`).
 * - Explicitly returns `https://ysaams.vercel.app/la` in production (including Vercel preview/alias origins).
 */
export function resolveAuthRedirectUrl(currentOrigin?: string): string {
  const origin = (
    currentOrigin !== undefined
      ? currentOrigin
      : typeof window !== 'undefined'
      ? window.location.origin
      : ''
  ).trim().replace(/\/+$/, '')

  if (origin) {
    try {
      const parsed = new URL(origin)
      const host = parsed.hostname.toLowerCase()
      if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
        return `${parsed.origin}/la`
      }
    } catch {
      // Fall through to production redirect URL
    }
  }

  return PRODUCTION_AUTH_REDIRECT_URL
}

/**
 * Parses URL hash and query parameters produced by Supabase Auth redirects
 * (password recovery, user invitations, email confirmations, or expired/invalid links).
 */
export function parseAuthCallbackUrl(hash = '', search = ''): ParsedAuthCallback {
  const cleanHash = hash.startsWith('#') ? hash.slice(1) : hash
  const cleanSearch = search.startsWith('?') ? search.slice(1) : search

  const hashParams = new URLSearchParams(cleanHash)
  const searchParams = new URLSearchParams(cleanSearch)

  const getParam = (key: string): string | null =>
    hashParams.get(key) || searchParams.get(key)

  const callbackType = getParam('type')?.toLowerCase() || null
  const tokenHash = getParam('token_hash')
  const hasAccessToken = Boolean(getParam('access_token') || getParam('code') || tokenHash)
  const error = getParam('error')
  const errorCode = getParam('error_code')
  const rawErrorDesc = getParam('error_description')

  let errorMessage: string | null = null
  if (error || errorCode || rawErrorDesc) {
    const normalizedDesc = rawErrorDesc ? rawErrorDesc.replace(/\+/g, ' ').trim() : ''
    if (
      errorCode === 'otp_expired' ||
      normalizedDesc.toLowerCase().includes('expired') ||
      normalizedDesc.toLowerCase().includes('invalid')
    ) {
      errorMessage =
        'This password recovery or invitation link is invalid or has expired. Please request a fresh recovery link below.'
    } else if (normalizedDesc) {
      errorMessage = normalizedDesc
    } else {
      errorMessage =
        'Authentication link could not be verified. Please request a fresh recovery link below.'
    }
  }

  const isInvite = callbackType === 'invite' && !errorMessage
  const isPasswordRecovery =
    (callbackType === 'recovery' || callbackType === 'invite') && !errorMessage
  const isEmailConfirmation =
    (callbackType === 'signup' || callbackType === 'email' || callbackType === 'magiclink') &&
    !errorMessage

  const hasAuthCallback = Boolean(
    isPasswordRecovery ||
      isInvite ||
      isEmailConfirmation ||
      hasAccessToken ||
      errorMessage
  )

  return {
    hasAuthCallback,
    isPasswordRecovery,
    isInvite,
    isEmailConfirmation,
    callbackType,
    tokenHash,
    errorCode,
    errorMessage
  }
}

export function validateNewPassword(
  password: string,
  confirmPassword?: string
): { valid: boolean; error?: string } {
  if (!password || password.length < 8) {
    return {
      valid: false,
      error: 'New password must be at least 8 characters long.'
    }
  }
  if (confirmPassword !== undefined && password !== confirmPassword) {
    return {
      valid: false,
      error: 'New password and confirmation do not match.'
    }
  }
  return { valid: true }
}

export function validateAuthorizedProfile(
  profile: UserProfile | null
): { authorized: boolean; error?: string } {
  if (!profile) {
    return {
      authorized: false,
      error: 'No leadership profile found for this account. Please contact a Stake System Administrator.'
    }
  }

  if (profile.accountStatus !== 'active') {
    return {
      authorized: false,
      error: `Your account status is "${profile.accountStatus}". Please contact a Stake System Administrator.`
    }
  }

  if (!profile.roles || profile.roles.length === 0) {
    return {
      authorized: false,
      error: 'No active leadership roles are assigned to this account. Please contact a Stake System Administrator.'
    }
  }

  return { authorized: true }
}

export const authService = {
  validateAuthorizedProfile,
  resolveAuthRedirectUrl,
  parseAuthCallbackUrl,
  validateNewPassword,

  async getSession() {
    return supabase.auth.getSession()
  },

  async signInWithPassword(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      })

      if (error) {
        return { success: false, error: error.message }
      }

      if (!data.user) {
        return { success: false, error: 'Sign in succeeded but user is missing.' }
      }

      // Validate profile existence, active account_status, and assigned leadership roles
      const profile = await this.fetchUserProfile(data.user.id)
      const validation = this.validateAuthorizedProfile(profile)
      if (!validation.authorized) {
        await supabase.auth.signOut()
        return {
          success: false,
          error: validation.error
        }
      }

      return { success: true }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication failed'
      return { success: false, error: msg }
    }
  },

  async resetPasswordForEmail(email: string): Promise<{ success: boolean; error?: string }> {
    try {
      const cleanEmail = email.trim()
      if (!cleanEmail) {
        return { success: false, error: 'Please enter your leadership email address.' }
      }
      const redirectTo = resolveAuthRedirectUrl(
        typeof window !== 'undefined' ? window.location.origin : undefined
      )
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo })
      if (error) {
        return { success: false, error: error.message }
      }
      return { success: true }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send password reset email'
      return { success: false, error: msg }
    }
  },

  async updatePassword(
    newPassword: string,
    confirmPassword?: string
  ): Promise<{ success: boolean; error?: string }> {
    const check = validateNewPassword(newPassword, confirmPassword)
    if (!check.valid) {
      return { success: false, error: check.error }
    }
    try {
      const { data, error } = await supabase.auth.updateUser({
        password: newPassword
      })
      if (error) {
        const lower = error.message.toLowerCase()
        if (lower.includes('session') || lower.includes('expired') || lower.includes('missing')) {
          return {
            success: false,
            error:
              'Your password recovery session has expired. Please request a fresh recovery link.'
          }
        }
        return { success: false, error: error.message }
      }
      if (!data.user) {
        return {
          success: false,
          error:
            'Unable to verify recovery session. Please request a fresh recovery link.'
        }
      }
      return { success: true }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update password'
      return { success: false, error: msg }
    }
  },

  async signOut() {
    return supabase.auth.signOut()
  },

  async fetchUserProfile(userId: string): Promise<UserProfile | null> {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, full_name, email, account_status, created_at, updated_at')
        .eq('id', userId)
        .maybeSingle()

      if (error || !data) return null

      // Fetch user roles
      const { data: rolesData } = await supabase
        .from('user_roles')
        .select('role_name')
        .eq('user_id', userId)

      const roles = (rolesData || []).map((r: { role_name: AppRole }) => r.role_name)

      // Fetch unit assignments
      const { data: unitData } = await supabase
        .from('user_unit_assignments')
        .select('id, user_id, unit_id, assigned_role, created_at, stake_units(unit_name)')
        .eq('user_id', userId)

      const unitAssignments: UserUnitAssignment[] = (unitData || []).map((u: any) => ({
        id: u.id,
        userId: u.user_id,
        unitId: u.unit_id,
        assignedRole: u.assigned_role,
        createdAt: u.created_at,
        unitName: u.stake_units?.unit_name
      }))

      return {
        id: data.id,
        fullName: data.full_name,
        email: data.email,
        roles,
        unitAssignments,
        unitId: unitAssignments[0]?.unitId || null,
        accountStatus: data.account_status,
        createdAt: data.created_at,
        updatedAt: data.updated_at
      }
    } catch {
      return null
    }
  }
}
