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
    // Fetch profiles, roles, and unit assignments in parallel to avoid ambiguous
    // PostgREST embedding errors caused by multiple foreign keys (user_id and assigned_by).
    const [profilesRes, rolesRes, assignmentsRes] = await Promise.all([
      supabase
        .from('user_profiles')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase
        .from('user_roles')
        .select('user_id, role_name'),
      supabase
        .from('user_unit_assignments')
        .select('id, user_id, unit_id, assigned_role, created_at, stake_units(unit_name)')
    ])

    if (profilesRes.error) throw new Error(profilesRes.error.message)
    if (rolesRes.error) throw new Error(rolesRes.error.message)
    if (assignmentsRes.error) throw new Error(assignmentsRes.error.message)

    const rolesByUser: Record<string, AppRole[]> = {}
    for (const r of rolesRes.data || []) {
      if (!rolesByUser[r.user_id]) {
        rolesByUser[r.user_id] = []
      }
      rolesByUser[r.user_id].push(r.role_name as AppRole)
    }

    const assignmentsByUser: Record<string, UserUnitAssignment[]> = {}
    for (const ua of assignmentsRes.data || []) {
      if (!assignmentsByUser[ua.user_id]) {
        assignmentsByUser[ua.user_id] = []
      }
      assignmentsByUser[ua.user_id].push({
        id: ua.id,
        userId: ua.user_id,
        unitId: ua.unit_id,
        assignedRole: ua.assigned_role,
        unitName: (ua as any).stake_units?.unit_name,
        createdAt: ua.created_at
      })
    }

    return (profilesRes.data || []).map((u: any) => {
      const roles = rolesByUser[u.id] || []
      const unitAssignments = assignmentsByUser[u.id] || []

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

  async updateUserFullName(userId: string, fullName: string): Promise<void> {
    const cleanName = fullName.trim()
    if (!cleanName) {
      throw new Error('Full name cannot be empty.')
    }
    const { error } = await supabase
      .from('user_profiles')
      .update({ full_name: cleanName, updated_at: new Date().toISOString() })
      .eq('id', userId)

    if (error) throw new Error(error.message)
  },

  async assignUserRole(userId: string, roleName: AppRole): Promise<void> {
    const { error } = await supabase
      .from('user_roles')
      .upsert(
        { user_id: userId, role_name: roleName },
        { onConflict: 'user_id,role_name', ignoreDuplicates: true }
      )

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
      .upsert(
        {
          user_id: userId,
          unit_id: unitId,
          assigned_role: assignedRole
        },
        { onConflict: 'user_id,unit_id,assigned_role', ignoreDuplicates: true }
      )

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
