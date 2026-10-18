import { supabase } from '../lib/supabase'
import { ActivityDefinition, ActivitySession } from '../types/database'

/**
 * Generates an unambiguous 6-character alphanumeric session code.
 * Excludes easily confusable characters: 0, O, 1, I, L.
 */
export function generateSessionCode(): string {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
  const length = 6
  let code = ''
  
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    for (let i = 0; i < length; i++) {
      code += alphabet[bytes[i] % alphabet.length]
    }
  } else {
    for (let i = 0; i < length; i++) {
      code += alphabet.charAt(Math.floor(Math.random() * alphabet.length))
    }
  }

  return code
}

export interface CreateActivityParams {
  title: string
  description?: string
  category: 'spiritual' | 'social' | 'service' | 'sports' | 'temple' | 'educational' | 'other'
  defaultParticipatingUnits?: string[] | null
}

export interface CreateSessionParams {
  activityId: string
  sessionTitle: string
  sessionDate: string
  startTime: string
  scheduledEndTime?: string
  maxTerminals: number
  participatingUnits?: string[] | null
  visitorRegistrationEnabled?: boolean
}

export const activityService = {
  generateCode: generateSessionCode,

  async listActivities(): Promise<ActivityDefinition[]> {
    const { data, error } = await supabase
      .from('activities')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)
    return (data || []).map((a: any) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      category: a.category,
      defaultParticipatingUnits: a.default_participating_units,
      createdBy: a.created_by,
      createdAt: a.created_at,
      updatedAt: a.updated_at
    }))
  },

  async createActivity(params: CreateActivityParams, userId: string): Promise<ActivityDefinition> {
    const { data, error } = await supabase
      .from('activities')
      .insert({
        title: params.title.trim(),
        description: params.description?.trim() || null,
        category: params.category,
        default_participating_units: params.defaultParticipatingUnits || null,
        created_by: userId
      })
      .select()
      .single()

    if (error) throw new Error(error.message)
    return {
      id: data.id,
      title: data.title,
      description: data.description,
      category: data.category,
      defaultParticipatingUnits: data.default_participating_units,
      createdBy: data.created_by,
      createdAt: data.created_at
    }
  },

  async listSessions(): Promise<ActivitySession[]> {
    const { data, error } = await supabase
      .from('activity_sessions')
      .select('*')
      .order('session_date', { ascending: false })

    if (error) throw new Error(error.message)
    return (data || []).map((s: any) => ({
      id: s.id,
      activityId: s.activity_id,
      sessionTitle: s.session_title,
      sessionDate: s.session_date,
      startTime: s.start_time,
      scheduledEndTime: s.scheduled_end_time,
      timezone: s.timezone,
      status: s.status,
      maxTerminals: s.max_terminals,
      codeHash: s.code_hash,
      codeExpiresAt: s.code_expires_at,
      visitorRegistrationEnabled: s.visitor_registration_enabled,
      participatingUnits: s.participating_units,
      initiatedBy: s.initiated_by,
      initiatedAt: s.initiated_at,
      closedAt: s.closed_at,
      closedBy: s.closed_by,
      createdAt: s.created_at,
      updatedAt: s.updated_at
    }))
  },

  async createSession(params: CreateSessionParams): Promise<ActivitySession> {
    const { data, error } = await supabase
      .from('activity_sessions')
      .insert({
        activity_id: params.activityId,
        session_title: params.sessionTitle.trim(),
        session_date: params.sessionDate,
        start_time: params.startTime,
        scheduled_end_time: params.scheduledEndTime || null,
        max_terminals: params.maxTerminals,
        participating_units: params.participatingUnits || null,
        visitor_registration_enabled: params.visitorRegistrationEnabled ?? true,
        status: 'draft',
        timezone: 'Africa/Lagos'
      })
      .select()
      .single()

    if (error) throw new Error(error.message)
    return {
      id: data.id,
      activityId: data.activity_id,
      sessionTitle: data.session_title,
      sessionDate: data.session_date,
      startTime: data.start_time,
      scheduledEndTime: data.scheduled_end_time,
      timezone: data.timezone,
      status: data.status,
      maxTerminals: data.max_terminals,
      visitorRegistrationEnabled: data.visitor_registration_enabled,
      participatingUnits: data.participating_units,
      createdAt: data.created_at
    }
  },

  async initiateSession(sessionId: string, code: string, maxTerminals: number, expiryMinutes: number = 240): Promise<{ success: boolean; error?: string }> {
    const { data, error } = await supabase.rpc('initiate_attendance_session', {
      p_session_id: sessionId,
      p_code: code.trim().toUpperCase(),
      p_max_terminals: maxTerminals,
      p_expiry_minutes: expiryMinutes
    })

    if (error) return { success: false, error: error.message }
    return { success: (data as any)?.success ?? true }
  },

  async closeSession(sessionId: string): Promise<{ success: boolean; error?: string }> {
    const { data, error } = await supabase.rpc('close_attendance_session', {
      p_session_id: sessionId
    })

    if (error) return { success: false, error: error.message }
    return { success: (data as any)?.success ?? true }
  },

  async reopenSession(sessionId: string, reason: string, durationMinutes: number = 60): Promise<{ success: boolean; error?: string }> {
    const { data, error } = await supabase.rpc('reopen_attendance_session', {
      p_session_id: sessionId,
      p_reason: reason.trim(),
      p_duration_minutes: durationMinutes
    })

    if (error) return { success: false, error: error.message }
    return { success: (data as any)?.success ?? true }
  }
}
