import { supabase } from '../lib/supabase'
import { AttendanceRecord, TerminalAuthorization, MemberRecord } from '../types/database'

export interface SubmitAttendanceParams {
  sessionId: string
  memberId?: string
  attendeeName: string
  isNonMember: boolean
  unitId?: string | null
  terminalToken?: string
  contactPhone?: string
}

export interface AuthorizeTerminalResult {
  success: boolean
  terminal?: TerminalAuthorization
  sessionId?: string
  sessionTitle?: string
  sessionDate?: string
  participatingUnits?: string[] | null
  error?: string
}

export interface AttendanceSubmissionResult {
  success: boolean
  record?: AttendanceRecord
  error?: string
}

export interface ManualAttendanceParams {
  sessionId: string
  memberId: string
  notes?: string
}

const STORAGE_KEY_TOKEN = 'ysaams_terminal_token'
const STORAGE_KEY_SESSION_ID = 'ysaams_terminal_session_id'
const STORAGE_KEY_TERMINAL_ID = 'ysaams_terminal_id'
const STORAGE_KEY_SESSION_TITLE = 'ysaams_terminal_session_title'
const STORAGE_KEY_SESSION_DATE = 'ysaams_terminal_session_date'
const STORAGE_KEY_PARTICIPATING_UNITS = 'ysaams_terminal_participating_units'

/**
 * Maps raw database/RPC/network error messages into warm, friendly, actionable text.
 * Never exposes raw SQL codes, RPC names, stack traces, or internal database schemas.
 */
export function humanizeTerminalError(error?: string | null): string {
  if (!error) return 'We could not complete your check-in. Please try again or ask a leader for assistance.'
  const err = error.toLowerCase()

  if (err.includes('duplicate') || err.includes('already recorded') || err.includes('already been marked present') || err.includes('23505')) {
    return 'It looks like your attendance has already been recorded for this activity today!'
  }
  if (err.includes('terminal limit reached')) {
    return 'This check-in station has reached its device connection limit. Please use an existing terminal or contact a YSA leader.'
  }
  if (err.includes('lease expired') || err.includes('token revoked') || err.includes('unauthorized terminal token') || err.includes('session authorization expired')) {
    return 'This check-in session has expired or was disconnected. Please enter the session code again or ask a YSA leader.'
  }
  if (err.includes('invalid attendance code') || err.includes('invalid session code') || err.includes('code has expired') || err.includes('session code')) {
    return 'Invalid or expired session code. Please double-check the 6-character code with your leader.'
  }
  if (err.includes('scheduled end time') || err.includes('grace period') || err.includes('effective lock time') || err.includes('has closed') || err.includes('writes are closed')) {
    return 'Attendance for this activity has concluded. The scheduled check-in window and grace period have ended.'
  }
  if (err.includes('cancelled') || err.includes('is cancelled')) {
    return 'This activity session has been cancelled. Please check with your YSA leader for updates.'
  }
  if (err.includes('not active') || err.includes('is not active') || err.includes('draft')) {
    return 'This activity check-in is not open yet. Please wait for a leader to start the session.'
  }

  if (err.includes('not participating') || err.includes('not an authorized participating unit')) {
    return 'The selected ward or branch is not participating in this specific session. Please choose an authorized unit.'
  }
  if (err.includes('visitor registration is disabled')) {
    return 'Visitor check-in is not enabled for this session. Please speak with an activity leader.'
  }
  if (err.includes('network') || err.includes('failed to fetch') || err.includes('timeout')) {
    return 'Unable to reach the server. Please check your internet connection and try again.'
  }

  // Graceful fallback without exposing internal details
  return 'We could not complete your check-in right now. Please try again.'
}


class AttendanceService {
  private heartbeatIntervalId: number | null = null

  /**
   * Retrieve active bearer token from volatile session storage.
   */
  getStoredTerminalToken(): string | null {
    if (typeof window === 'undefined') return null
    try {
      return sessionStorage.getItem(STORAGE_KEY_TOKEN)
    } catch {
      return null
    }
  }

  /**
   * Retrieve stored session metadata for active kiosk restoration across page reloads.
   */
  getStoredSessionMetadata(): {
    token: string | null
    sessionId: string | null
    terminalId: string | null
    sessionTitle: string | null
    sessionDate: string | null
    participatingUnits: string[] | null
  } {
    if (typeof window === 'undefined') {
      return { token: null, sessionId: null, terminalId: null, sessionTitle: null, sessionDate: null, participatingUnits: null }
    }
    try {
      let participatingUnits: string[] | null = null
      const rawUnits = sessionStorage.getItem(STORAGE_KEY_PARTICIPATING_UNITS)
      if (rawUnits) {
        try {
          participatingUnits = JSON.parse(rawUnits)
        } catch {}
      }
      return {
        token: sessionStorage.getItem(STORAGE_KEY_TOKEN),
        sessionId: sessionStorage.getItem(STORAGE_KEY_SESSION_ID),
        terminalId: sessionStorage.getItem(STORAGE_KEY_TERMINAL_ID),
        sessionTitle: sessionStorage.getItem(STORAGE_KEY_SESSION_TITLE),
        sessionDate: sessionStorage.getItem(STORAGE_KEY_SESSION_DATE),
        participatingUnits
      }
    } catch {
      return { token: null, sessionId: null, terminalId: null, sessionTitle: null, sessionDate: null, participatingUnits: null }
    }
  }

  /**
   * Authorize a terminal kiosk with session code, label, and optional existing token.
   * On success, stores token in sessionStorage and initiates the 4-minute heartbeat lease loop.
   */
  async authorizeTerminal(
    sessionCode: string,
    terminalLabel: string = 'Attendance Terminal'
  ): Promise<AuthorizeTerminalResult> {
    try {
      const cleanCode = sessionCode.trim().toUpperCase()
      const existingToken = this.getStoredTerminalToken() || null

      const { data, error } = await supabase.rpc('authorize_terminal', {
        p_session_code: cleanCode,
        p_terminal_label: terminalLabel.trim() || 'Attendance Terminal',
        p_existing_terminal_token: existingToken
      })

      if (error) {
        return { success: false, error: error.message }
      }

      const result = data as {
        success: boolean
        session_id: string
        session_title: string
        session_date: string
        participating_units?: string[] | null
        terminal_id: string
        terminal_token: string
        reconnected: boolean
        error?: string
      }

      if (!result || !result.success) {
        return { success: false, error: result?.error || 'Failed to authorize terminal' }
      }

      // Persist bearer token and session metadata in volatile sessionStorage (wiped when tab closes)
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(STORAGE_KEY_TOKEN, result.terminal_token)
        sessionStorage.setItem(STORAGE_KEY_SESSION_ID, result.session_id)
        sessionStorage.setItem(STORAGE_KEY_TERMINAL_ID, result.terminal_id)
        if (result.session_title) {
          sessionStorage.setItem(STORAGE_KEY_SESSION_TITLE, result.session_title)
        }
        if (result.session_date) {
          sessionStorage.setItem(STORAGE_KEY_SESSION_DATE, result.session_date)
        }
        if (result.participating_units) {
          sessionStorage.setItem(STORAGE_KEY_PARTICIPATING_UNITS, JSON.stringify(result.participating_units))
        } else {
          sessionStorage.removeItem(STORAGE_KEY_PARTICIPATING_UNITS)
        }
      }

      // Start the heartbeat timer (every 4 minutes, since lease expires in 10 minutes)
      this.startHeartbeatLoop(result.terminal_token)

      const terminal: TerminalAuthorization = {
        id: result.terminal_id,
        sessionId: result.session_id,
        terminalToken: result.terminal_token,
        terminalLabel: terminalLabel,
        leaseExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        isRevoked: false
      }

      return {
        success: true,
        terminal,
        sessionId: result.session_id,
        sessionTitle: result.session_title,
        sessionDate: result.session_date,
        participatingUnits: result.participating_units || null
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unexpected authorization error'
      return { success: false, error: message }
    }
  }

  /**
   * Heartbeat to extend active 10-minute terminal lease.
   */
  async heartbeatLease(token?: string): Promise<boolean> {
    try {
      const bearerToken = token || this.getStoredTerminalToken()
      if (!bearerToken) return false

      const { data, error } = await supabase.rpc('heartbeat_terminal_lease', {
        p_terminal_token: bearerToken
      })

      if (error) {
        console.warn('[Terminal Heartbeat Warning]', error.message)
        return false
      }

      const res = data as { success: boolean }
      if (!res?.success) {
        // Lease revoked or session closed
        this.stopHeartbeatLoop()
        this.clearStoredSession()
        return false
      }

      return true
    } catch (err) {
      console.warn('[Terminal Heartbeat Error]', err)
      return false
    }
  }

  /**
   * Starts periodic heartbeat every 4 minutes (240,000 ms).
   */
  startHeartbeatLoop(token?: string, onLeaseRevoked?: () => void): void {
    this.stopHeartbeatLoop()
    if (typeof window === 'undefined') return
    const activeToken = token || this.getStoredTerminalToken()
    if (!activeToken) return

    this.heartbeatIntervalId = window.setInterval(async () => {
      const alive = await this.heartbeatLease(activeToken)
      if (!alive) {
        this.stopHeartbeatLoop()
        if (onLeaseRevoked) {
          onLeaseRevoked()
        }
      }
    }, 4 * 60 * 1000)
  }

  /**
   * Stops active heartbeat timer.
   */
  stopHeartbeatLoop(): void {
    if (this.heartbeatIntervalId !== null && typeof window !== 'undefined') {
      window.clearInterval(this.heartbeatIntervalId)
      this.heartbeatIntervalId = null
    }
  }

  /**
   * Cleanly releases terminal lease and clears storage.
   */
  async releaseTerminal(): Promise<boolean> {
    try {
      this.stopHeartbeatLoop()
      const token = this.getStoredTerminalToken()
      if (token) {
        await supabase.rpc('release_terminal', {
          p_terminal_token: token
        })
      }
      this.clearStoredSession()
      return true
    } catch {
      this.clearStoredSession()
      return false
    }
  }

  /**
   * Clears volatile terminal session keys from browser storage.
   */
  clearStoredSession(): void {
    if (typeof window === 'undefined') return
    try {
      sessionStorage.removeItem(STORAGE_KEY_TOKEN)
      sessionStorage.removeItem(STORAGE_KEY_SESSION_ID)
      sessionStorage.removeItem(STORAGE_KEY_TERMINAL_ID)
      sessionStorage.removeItem(STORAGE_KEY_SESSION_TITLE)
      sessionStorage.removeItem(STORAGE_KEY_SESSION_DATE)
      sessionStorage.removeItem(STORAGE_KEY_PARTICIPATING_UNITS)
    } catch {
      // Storage unavailable
    }
  }

  /**
   * Token-validated suggestions lookup for authorized kiosks.
   * Returns suggestions from previously recorded attendance and active census records.
   */
  async searchTerminalSuggestions(
    sessionId: string,
    unitId?: string | null,
    searchQuery?: string
  ): Promise<MemberRecord[]> {
    try {
      const token = this.getStoredTerminalToken()
      if (!token || !sessionId) return []

      const { data, error } = await supabase.rpc('search_terminal_suggestions', {
        p_session_id: sessionId,
        p_terminal_token: token,
        p_unit_id: unitId || null,
        p_search_query: (searchQuery || '').trim()
      })

      if (!error && Array.isArray(data)) {
        return data.map((m: any) => ({
          id: m.id,
          fullName: m.full_name,
          homeUnitId: m.home_unit_id,
          homeUnitName: m.home_unit_name,
          isActive: true,
          createdAt: ''
        }))
      }

      // Fallback to legacy search_terminal_members
      return this.searchTerminalMembers(sessionId, unitId, searchQuery)
    } catch {
      return this.searchTerminalMembers(sessionId, unitId, searchQuery)
    }
  }

  /**
   * Token-validated member lookup for authorized kiosks.
   */
  async searchTerminalMembers(
    sessionId: string,
    unitId?: string | null,
    searchQuery?: string
  ): Promise<MemberRecord[]> {
    try {
      const token = this.getStoredTerminalToken()
      if (!token || !sessionId) return []

      const { data, error } = await supabase.rpc('search_terminal_members', {
        p_session_id: sessionId,
        p_terminal_token: token,
        p_unit_id: unitId || null,
        p_search_query: (searchQuery || '').trim()
      })

      if (error || !Array.isArray(data)) {
        return []
      }

      return data.map((m: any) => ({
        id: m.id,
        fullName: m.full_name,
        preferredName: m.preferred_name,
        homeUnitId: m.home_unit_id,
        homeUnitName: m.home_unit_name,
        isActive: true,
        createdAt: m.created_at || ''
      }))
    } catch {
      return []
    }
  }

  /**
   * Submits attendance via active terminal kiosk.
   * Supports attendance without prior registration (Requirement A).
   */
  async recordAttendance(
    params: SubmitAttendanceParams
  ): Promise<AttendanceSubmissionResult> {
    try {
      const token = params.terminalToken || this.getStoredTerminalToken()
      if (!token) {
        return { success: false, error: 'Terminal bearer token not found. Please reconnect terminal.' }
      }

      // 1. Try unified record_terminal_checkin RPC (supports un-enrolled members and visitors)
      const { data: checkinData, error: checkinErr } = await supabase.rpc('record_terminal_checkin', {
        p_session_id: params.sessionId,
        p_terminal_token: token,
        p_attendee_name: params.attendeeName.trim(),
        p_unit_id: params.unitId || null,
        p_is_non_member: params.isNonMember,
        p_member_id: params.memberId || null,
        p_contact_phone: params.contactPhone?.trim() || null
      })

      if (!checkinErr) {
        const res = checkinData as {
          success: boolean
          attendance_id?: string
          member_id?: string
          attendee_name?: string
          is_non_member?: boolean
          check_in_time?: string
          error?: string
        }
        if (res && res.success) {
          return {
            success: true,
            record: {
              id: res.attendance_id || 'unknown',
              sessionId: params.sessionId,
              memberId: res.member_id,
              attendeeName: res.attendee_name || params.attendeeName,
              isNonMember: res.is_non_member ?? params.isNonMember,
              unitId: params.unitId,
              checkInTime: res.check_in_time || new Date().toISOString()
            }
          }
        } else if (res && res.error) {
          return { success: false, error: res.error }
        }
      } else {
        // If checkinErr is a known business error (duplicate, lock expired, not participating, invalid token), return directly
        const errMsg = checkinErr.message || ''
        const errCode = (checkinErr as any).code || ''
        if (
          errCode === '23505' ||
          errCode === 'P0001' ||
          /already recorded|scheduled end time|not participating|expired|unauthorized/i.test(errMsg)
        ) {
          return { success: false, error: errMsg }
        }
      }

      // 2. Fallback to specialized RPCs if record_terminal_checkin is not yet deployed (e.g. 404 or function not found)
      if (params.isNonMember) {
        const { data, error } = await supabase.rpc('record_visitor_attendance', {
          p_session_id: params.sessionId,
          p_full_name: params.attendeeName.trim(),
          p_contact_phone: params.contactPhone?.trim() || '',
          p_is_church_member: false,
          p_inviting_unit_id: params.unitId || null,
          p_terminal_token: token
        })

        if (error) {
          return { success: false, error: error.message }
        }

        const res = data as { success: boolean; visitor_id?: string; error?: string }
        if (!res?.success) {
          return { success: false, error: res?.error || 'Failed to record visitor attendance' }
        }

        return {
          success: true,
          record: {
            id: res.visitor_id || 'unknown',
            sessionId: params.sessionId,
            attendeeName: params.attendeeName,
            isNonMember: true,
            unitId: params.unitId,
            checkInTime: new Date().toISOString()
          }
        }
      } else {
        if (!params.memberId) {
          return {
            success: false,
            error: checkinErr?.message || 'Member record identification required for Church members.'
          }
        }

        const { data, error } = await supabase.rpc('record_attendance', {
          p_session_id: params.sessionId,
          p_member_id: params.memberId,
          p_terminal_token: token
        })

        if (error) {
          return { success: false, error: error.message }
        }

        const res = data as { success: boolean; attendance_id?: string; error?: string }
        if (!res?.success) {
          return { success: false, error: res?.error || 'Failed to record member attendance' }
        }

        return {
          success: true,
          record: {
            id: res.attendance_id || 'unknown',
            sessionId: params.sessionId,
            memberId: params.memberId,
            attendeeName: params.attendeeName,
            isNonMember: false,
            unitId: params.unitId,
            checkInTime: new Date().toISOString()
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unexpected attendance error'
      return { success: false, error: message }
    }
  }

  /**
   * Manual attendance check-in executed directly by authorized leaders in /la/attendance.
   */
  async recordManualAttendance(
    params: ManualAttendanceParams
  ): Promise<AttendanceSubmissionResult> {
    try {
      const { data, error } = await supabase.rpc('record_manual_attendance', {
        p_session_id: params.sessionId,
        p_member_id: params.memberId,
        p_notes: params.notes?.trim() || null
      })

      if (error) {
        return { success: false, error: error.message }
      }

      const res = data as {
        success: boolean
        attendance_id?: string
        member_name?: string
        check_in_time?: string
        error?: string
      }

      if (!res?.success) {
        return { success: false, error: res?.error || 'Failed to record manual attendance' }
      }

      return {
        success: true,
        record: {
          id: res.attendance_id || 'unknown',
          sessionId: params.sessionId,
          memberId: params.memberId,
          attendeeName: res.member_name || 'Member',
          isNonMember: false,
          checkInTime: res.check_in_time || new Date().toISOString()
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unexpected manual attendance error'
      return { success: false, error: message }
    }
  }
}

export const attendanceService = new AttendanceService()
