import { supabase } from '../lib/supabase'
import { UserProfile, AppRole } from '../types/database'

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

  async signOut() {
    return supabase.auth.signOut()
  },

  async fetchUserProfile(userId: string): Promise<UserProfile | null> {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, full_name, email, account_status, created_at')
      .eq('id', userId)
      .maybeSingle()

    if (error || !data) return null

    // Fetch user roles
    const { data: rolesData } = await supabase
      .from('user_roles')
      .select('role_name')
      .eq('user_id', userId)

    const roles = (rolesData || []).map((r: { role_name: AppRole }) => r.role_name)

    return {
      id: data.id,
      fullName: data.full_name,
      email: data.email,
      roles,
      accountStatus: data.account_status,
      createdAt: data.created_at
    }
  }
}
