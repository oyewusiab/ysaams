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
  } {
    if (typeof window === 'undefined') {
      return { token: null, sessionId: null, terminalId: null, sessionTitle: null, sessionDate: null }
    }
    try {
      return {
        token: sessionStorage.getItem(STORAGE_KEY_TOKEN),
        sessionId: sessionStorage.getItem(STORAGE_KEY_SESSION_ID),
        terminalId: sessionStorage.getItem(STORAGE_KEY_TERMINAL_ID),
        sessionTitle: sessionStorage.getItem(STORAGE_KEY_SESSION_TITLE),
        sessionDate: sessionStorage.getItem(STORAGE_KEY_SESSION_DATE)
      }
    } catch {
      return { token: null, sessionId: null, terminalId: null, sessionTitle: null, sessionDate: null }
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
        sessionDate: result.session_date
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
    } catch {
      // Storage unavailable
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
   */
  async recordAttendance(
    params: SubmitAttendanceParams
  ): Promise<AttendanceSubmissionResult> {
    try {
      const token = params.terminalToken || this.getStoredTerminalToken()
      if (!token) {
        return { success: false, error: 'Terminal bearer token not found. Please reconnect terminal.' }
      }

      if (params.isNonMember) {
        // Submit via record_visitor_attendance RPC
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
        // Member Check-in: requires memberId
        if (!params.memberId) {
          return { success: false, error: 'Member record identification required for Church members.' }
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
