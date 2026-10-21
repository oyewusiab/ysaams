import { supabase } from '../lib/supabase'
import { ActivityDefinition, ActivitySession, STANDARD_ACTIVITY_CATEGORIES, StandardActivityCategory } from '../types/database'

export { STANDARD_ACTIVITY_CATEGORIES }
export type { StandardActivityCategory }

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
  category: string
  defaultParticipatingUnits?: string[] | null
}

export interface ParsedActivityRow {
  rowNumber: number
  title: string
  category: string
  description?: string
}

export interface ActivityCsvError {
  row: number
  error: string
  raw?: Record<string, string>
}

export interface ActivityImportResult {
  totalRows: number
  successCount: number
  errorCount: number
  errors: ActivityCsvError[]
  importedActivities: ActivityDefinition[]
}

export interface CreateSessionParams {
  activityId: string
  sessionTitle: string
  sessionDate: string
  startTime: string
  scheduledEndTime?: string
  gracePeriodMinutes?: number
  maxTerminals: number
  participatingUnits?: string[] | null
  visitorRegistrationEnabled?: boolean
}

/**
 * Pure helper to calculate the effective lock time in Africa/Lagos (WAT, UTC+1).
 * Returns ISO string or null if no scheduled end time is set.
 */
export function calculateEffectiveLockTime(
  sessionDate: string,
  scheduledEndTime?: string | null,
  gracePeriodMinutes = 0,
  _timezone = 'Africa/Lagos'
): string | null {
  if (!scheduledEndTime || !scheduledEndTime.trim()) return null
  try {
    const [year, month, day] = sessionDate.split('-').map(Number)
    const [hours, minutes] = scheduledEndTime.split(':').map(Number)
    if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hours) || isNaN(minutes)) {
      return null
    }
    // Africa/Lagos is West Africa Time (UTC+1, no DST)
    const baseUtcMs = Date.UTC(year, month - 1, day, hours - 1, minutes)
    const effectiveMs = baseUtcMs + Math.max(0, gracePeriodMinutes || 0) * 60 * 1000
    return new Date(effectiveMs).toISOString()
  } catch {
    return null
  }
}


/**
 * Robust RFC-4180 CSV parser supporting quotes, commas, escaped quotes, and CRLF/LF.
 */
export function parseCsvRows(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '') // Strip UTF-8 BOM
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false
  let i = 0

  while (i < clean.length) {
    const char = clean[i]

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < clean.length && clean[i + 1] === '"') {
          currentField += '"'
          i += 2
          continue
        } else {
          inQuotes = false
          i++
          continue
        }
      } else {
        currentField += char
        i++
        continue
      }
    } else {
      if (char === '"') {
        inQuotes = true
        i++
        continue
      } else if (char === ',') {
        currentRow.push(currentField)
        currentField = ''
        i++
        continue
      } else if (char === '\r') {
        if (i + 1 < clean.length && clean[i + 1] === '\n') {
          i++
        }
        currentRow.push(currentField)
        currentField = ''
        rows.push(currentRow)
        currentRow = []
        i++
        continue
      } else if (char === '\n') {
        currentRow.push(currentField)
        currentField = ''
        rows.push(currentRow)
        currentRow = []
        i++
        continue
      } else {
        currentField += char
        i++
        continue
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField)
    rows.push(currentRow)
  }

  return rows
}

/**
 * Parses and validates an activity CSV dataset.
 * Supports standard headers: title, category, description.
 */
export function parseActivitiesCsv(csvContent: string): {
  valid: ParsedActivityRow[]
  errors: ActivityCsvError[]
  totalRows: number
} {
  const rows = parseCsvRows(csvContent)
  const valid: ParsedActivityRow[] = []
  const errors: ActivityCsvError[] = []

  if (rows.length === 0) {
    return { valid, errors: [{ row: 0, error: 'CSV file is empty.' }], totalRows: 0 }
  }

  // Find header indices
  const headerRow = rows[0].map(h => h.trim().toLowerCase())
  const titleIdx = headerRow.findIndex(h => h === 'title' || h === 'activity title' || h === 'activity_title' || h === 'activity')
  const categoryIdx = headerRow.findIndex(h => h === 'category' || h === 'activity category' || h === 'activity_category')
  const descIdx = headerRow.findIndex(h => h === 'description' || h === 'desc' || h === 'notes')

  if (titleIdx === -1 || categoryIdx === -1) {
    const missing: string[] = []
    if (titleIdx === -1) missing.push('title')
    if (categoryIdx === -1) missing.push('category')
    return {
      valid,
      errors: [{ row: 1, error: `Missing required CSV header(s): ${missing.join(', ')}.` }],
      totalRows: 0
    }
  }

  let dataRowCount = 0
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    // Skip completely empty lines
    if (row.length === 0 || (row.length === 1 && !row[0].trim())) {
      continue
    }

    dataRowCount++
    const rowNum = r + 1 // 1-based index matching human line numbering
    const title = (row[titleIdx] || '').trim()
    const category = (row[categoryIdx] || '').trim()
    const description = descIdx !== -1 && row[descIdx] ? row[descIdx].trim() : undefined

    if (!title && !category) {
      // Entirely blank data row
      continue
    }

    if (!title) {
      errors.push({ row: rowNum, error: 'Activity title is required and cannot be blank.' })
      continue
    }

    if (!category) {
      errors.push({ row: rowNum, error: 'Activity category is required and cannot be blank.' })
      continue
    }

    valid.push({
      rowNumber: rowNum,
      title,
      category,
      description: description || undefined
    })
  }

  return { valid, errors, totalRows: dataRowCount }
}

export const activityService = {
  generateCode: generateSessionCode,
  calculateEffectiveLockTime,

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
    const cleanTitle = (params.title || '').trim()
    const cleanCategory = (params.category || '').trim()

    if (!cleanTitle) {
      throw new Error('Activity title is required.')
    }
    if (!cleanCategory) {
      throw new Error('Activity category is required and cannot be blank.')
    }

    const { data, error } = await supabase
      .from('activities')
      .insert({
        title: cleanTitle,
        description: params.description?.trim() || null,
        category: cleanCategory,
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

  async importActivitiesFromCsv(csvContent: string, userId: string): Promise<ActivityImportResult> {
    const { valid, errors, totalRows } = parseActivitiesCsv(csvContent)

    if (valid.length === 0) {
      return {
        totalRows,
        successCount: 0,
        errorCount: errors.length,
        errors,
        importedActivities: []
      }
    }

    // Insert records in batches or individually to isolate errors
    const insertPayload = valid.map(v => ({
      title: v.title,
      category: v.category,
      description: v.description || null,
      created_by: userId
    }))

    const { data, error } = await supabase
      .from('activities')
      .insert(insertPayload)
      .select()

    if (error) {
      // If batch insert fails, record error for all valid rows
      errors.push({
        row: 0,
        error: `Database insert failed: ${error.message}`
      })
      return {
        totalRows,
        successCount: 0,
        errorCount: errors.length,
        errors,
        importedActivities: []
      }
    }

    const createdList: ActivityDefinition[] = (data || []).map((d: any) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      category: d.category,
      defaultParticipatingUnits: d.default_participating_units,
      createdBy: d.created_by,
      createdAt: d.created_at
    }))

    return {
      totalRows,
      successCount: createdList.length,
      errorCount: errors.length,
      errors,
      importedActivities: createdList
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
      gracePeriodMinutes: s.grace_period_minutes || 0,
      effectiveLockAt: calculateEffectiveLockTime(s.session_date, s.scheduled_end_time, s.grace_period_minutes, s.timezone),
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
      cancelledAt: s.cancelled_at,
      cancelledBy: s.cancelled_by,
      cancellationReason: s.cancellation_reason,
      postponedAt: s.postponed_at,
      postponedBy: s.postponed_by,
      postponementReason: s.postponement_reason,
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
        grace_period_minutes: Math.max(0, Number(params.gracePeriodMinutes) || 0),
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
      gracePeriodMinutes: data.grace_period_minutes || 0,
      effectiveLockAt: calculateEffectiveLockTime(data.session_date, data.scheduled_end_time, data.grace_period_minutes, data.timezone),
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
    const res = data as { success?: boolean; error?: string } | null
    if (res && res.success === false) {
      return { success: false, error: res.error || 'Failed to initiate session' }
    }
    return { success: true }
  },

  async closeSession(sessionId: string): Promise<{ success: boolean; error?: string }> {
    const { data, error } = await supabase.rpc('close_attendance_session', {
      p_session_id: sessionId
    })

    if (error) return { success: false, error: error.message }
    const res = data as { success?: boolean; error?: string } | null
    if (res && res.success === false) {
      return { success: false, error: res.error || 'Failed to close session' }
    }
    return { success: true }
  },

  async reopenSession(sessionId: string, reason: string, durationMinutes: number = 60): Promise<{ success: boolean; error?: string }> {
    const { data, error } = await supabase.rpc('reopen_attendance_session', {
      p_session_id: sessionId,
      p_reason: reason.trim(),
      p_duration_minutes: durationMinutes
    })

    if (error) return { success: false, error: error.message }
    const res = data as { success?: boolean; error?: string } | null
    if (res && res.success === false) {
      return { success: false, error: res.error || 'Failed to reopen session' }
    }
    return { success: true }
  },

  async cancelSession(sessionId: string, reason: string): Promise<{ success: boolean; error?: string }> {
    const cleanReason = reason.trim()
    if (cleanReason.length < 5) {
      return { success: false, error: 'A cancellation reason of at least 5 characters is required.' }
    }

    const { data, error } = await supabase.rpc('cancel_activity_session', {
      p_session_id: sessionId,
      p_reason: cleanReason
    })

    if (error) return { success: false, error: error.message }
    const res = data as { success?: boolean; error?: string } | null
    if (res && res.success === false) {
      return { success: false, error: res.error || 'Failed to cancel session' }
    }
    return { success: true }
  },

  async postponeSession(
    sessionId: string,
    newDate: string,
    newStartTime: string,
    newEndTime?: string,
    reason: string = ''
  ): Promise<{ success: boolean; error?: string }> {
    const cleanReason = reason.trim()
    if (cleanReason.length < 5) {
      return { success: false, error: 'A postponement reason of at least 5 characters is required.' }
    }

    const { data, error } = await supabase.rpc('postpone_activity_session', {
      p_session_id: sessionId,
      p_new_date: newDate,
      p_new_start_time: newStartTime,
      p_new_end_time: newEndTime || null,
      p_reason: cleanReason
    })

    if (error) return { success: false, error: error.message }
    const res = data as { success?: boolean; error?: string } | null
    if (res && res.success === false) {
      return { success: false, error: res.error || 'Failed to postpone session' }
    }
    return { success: true }
  },

  async adjustActiveSession(
    sessionId: string,
    reason: string,
    changes: {
      title?: string
      scheduledEndTime?: string | null
      gracePeriodMinutes?: number
      participatingUnits?: string[] | null
    }
  ): Promise<{ success: boolean; error?: string }> {
    const cleanReason = reason.trim()
    if (cleanReason.length < 5) {
      return { success: false, error: 'A mandatory justification reason (at least 5 characters) is required for adjustments.' }
    }

    const { data, error } = await supabase.rpc('adjust_active_session', {
      p_session_id: sessionId,
      p_reason: cleanReason,
      p_new_title: changes.title?.trim() || null,
      p_new_end_time: changes.scheduledEndTime || null,
      p_new_grace_minutes: changes.gracePeriodMinutes !== undefined ? changes.gracePeriodMinutes : null,
      p_new_participating_units: changes.participatingUnits !== undefined ? changes.participatingUnits : null
    })

    if (error) return { success: false, error: error.message }
    const res = data as { success?: boolean; error?: string } | null
    if (res && res.success === false) {
      return { success: false, error: res.error || 'Failed to adjust active session' }
    }
    return { success: true }
  }
}

