import { supabase } from '../lib/supabase'
import { UserProfile, AppRole, UserUnitAssignment } from '../types/database'

export interface AuthState {
  user: UserProfile | null
  roles: AppRole[]
  isLoading: boolean
  error: string | null
}

export const authService = {
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

      // Validate account_status
      const profile = await this.fetchUserProfile(data.user.id)
      if (profile && profile.accountStatus !== 'active') {
        await supabase.auth.signOut()
        return {
          success: false,
          error: `Your account status is "${profile.accountStatus}". Please contact a Stake System Administrator.`
        }
      }

      return { success: true }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication failed'
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
