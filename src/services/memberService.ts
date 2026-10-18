import { supabase } from '../lib/supabase'
import { MemberRecord } from '../types/database'

export interface CreateMemberParams {
  fullName: string
  preferredName?: string
  gender?: 'male' | 'female'
  phoneNumber?: string
  email?: string
  homeUnitId: string
  memberNumber?: string
}

export const memberService = {
  async listMembers(unitIdFilter?: string | null): Promise<MemberRecord[]> {
    let query = supabase
      .from('members')
      .select('*, stake_units(unit_name)')
      .order('full_name', { ascending: true })

    if (unitIdFilter) {
      query = query.eq('home_unit_id', unitIdFilter)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    return (data || []).map((m: any) => ({
      id: m.id,
      memberNumber: m.member_number,
      fullName: m.full_name,
      preferredName: m.preferred_name,
      gender: m.gender,
      phoneNumber: m.phone_number,
      email: m.email,
      homeUnitId: m.home_unit_id,
      homeUnitName: m.stake_units?.unit_name,
      isActive: m.is_active,
      createdAt: m.created_at,
      updatedAt: m.updated_at
    }))
  },

  async createMember(params: CreateMemberParams): Promise<MemberRecord> {
    const { data, error } = await supabase
      .from('members')
      .insert({
        full_name: params.fullName.trim(),
        preferred_name: params.preferredName?.trim() || null,
        gender: params.gender || null,
        phone_number: params.phoneNumber?.trim() || null,
        email: params.email?.trim() || null,
        home_unit_id: params.homeUnitId,
        member_number: params.memberNumber?.trim() || null,
        is_active: true
      })
      .select('*, stake_units(unit_name)')
      .single()

    if (error) throw new Error(error.message)
    return {
      id: data.id,
      memberNumber: data.member_number,
      fullName: data.full_name,
      preferredName: data.preferred_name,
      gender: data.gender,
      phoneNumber: data.phone_number,
      email: data.email,
      homeUnitId: data.home_unit_id,
      homeUnitName: data.stake_units?.unit_name,
      isActive: data.is_active,
      createdAt: data.created_at
    }
  },

  async toggleMemberStatus(memberId: string, isActive: boolean): Promise<void> {
    const { error } = await supabase
      .from('members')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', memberId)

    if (error) throw new Error(error.message)
  }
}
