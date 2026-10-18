import { supabase } from '../lib/supabase'
import { StakeUnit, UserProfile, AppRole, UserUnitAssignment, UnitAssignedRole } from '../types/database'

export interface ProvisionUserParams {
  userId: string
  fullName: string
  email: string
  roles: AppRole[]
  unitAssignments?: { unitId: string; role: UnitAssignedRole }[]
}

export const adminService = {
  // --- Stake Units ---
  async listUnits(): Promise<StakeUnit[]> {
    const { data, error } = await supabase
      .from('stake_units')
      .select('*')
      .order('unit_name', { ascending: true })

    if (error) throw new Error(error.message)
    return (data || []).map((u: any) => ({
      id: u.id,
      unitName: u.unit_name,
      unitType: u.unit_type,
      isActive: u.is_active,
      createdAt: u.created_at,
      updatedAt: u.updated_at
    }))
  },

  async createUnit(unitName: string, unitType: 'ward' | 'branch'): Promise<StakeUnit> {
    const { data, error } = await supabase
      .from('stake_units')
      .insert({
        unit_name: unitName.trim(),
        unit_type: unitType,
        is_active: true
      })
      .select()
      .single()

    if (error) throw new Error(error.message)
    return {
      id: data.id,
      unitName: data.unit_name,
      unitType: data.unit_type,
      isActive: data.is_active,
      createdAt: data.created_at
    }
  },

  async toggleUnitActive(unitId: string, isActive: boolean): Promise<void> {
    const { error } = await supabase
      .from('stake_units')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', unitId)

    if (error) throw new Error(error.message)
  },

  // --- User Profiles & Governance ---
  async listUsers(): Promise<UserProfile[]> {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*, user_roles(role_name), user_unit_assignments(id, unit_id, assigned_role, stake_units(unit_name))')
      .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)

    return (data || []).map((u: any) => {
      const roles = (u.user_roles || []).map((r: any) => r.role_name as AppRole)
      const unitAssignments: UserUnitAssignment[] = (u.user_unit_assignments || []).map((ua: any) => ({
        id: ua.id,
        userId: u.id,
        unitId: ua.unit_id,
        assignedRole: ua.assigned_role,
        unitName: ua.stake_units?.unit_name,
        createdAt: ua.created_at
      }))

      return {
        id: u.id,
        fullName: u.full_name,
        email: u.email,
        roles,
        unitAssignments,
        unitId: unitAssignments[0]?.unitId || null,
        accountStatus: u.account_status,
        createdAt: u.created_at,
        updatedAt: u.updated_at
      }
    })
  },

  async updateUserStatus(userId: string, newStatus: 'active' | 'deactivated' | 'pending'): Promise<void> {
    const { error } = await supabase
      .from('user_profiles')
      .update({ account_status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', userId)

    if (error) throw new Error(error.message)
  },

  async assignUserRole(userId: string, roleName: AppRole): Promise<void> {
    const { error } = await supabase
      .from('user_roles')
      .insert({ user_id: userId, role_name: roleName })

    if (error) throw new Error(error.message)
  },

  async removeUserRole(userId: string, roleName: AppRole): Promise<void> {
    const { error } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('role_name', roleName)

    if (error) throw new Error(error.message)
  },

  async assignUserUnit(
    userId: string,
    unitId: string,
    assignedRole: UnitAssignedRole
  ): Promise<void> {
    const { error } = await supabase
      .from('user_unit_assignments')
      .insert({
        user_id: userId,
        unit_id: unitId,
        assigned_role: assignedRole
      })

    if (error) throw new Error(error.message)
  },

  async removeUserUnitAssignment(assignmentId: string): Promise<void> {
    const { error } = await supabase
      .from('user_unit_assignments')
      .delete()
      .eq('id', assignmentId)

    if (error) throw new Error(error.message)
  },

  // --- Audit Logs ---
  async listAuditLogs(limit: number = 50): Promise<any[]> {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*, user_profiles(full_name, email)')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw new Error(error.message)
    return (data || []).map((a: any) => ({
      id: a.id,
      actorId: a.actor_id,
      actorName: a.user_profiles?.full_name || 'System / Kiosk',
      action: a.action,
      targetRecordId: a.target_record_id,
      targetTable: a.target_table,
      outcome: a.outcome,
      metadata: a.metadata || {},
      createdAt: a.created_at
    }))
  }
}
