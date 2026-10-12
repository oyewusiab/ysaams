import { AttendanceRecord, TerminalAuthorization } from '../types/database'

export interface SubmitAttendanceParams {
  sessionId: string
  attendeeName: string
  isNonMember: boolean
  unitId?: string | null
  terminalToken?: string
}

export const attendanceService = {
  async authorizeTerminal(
    _sessionCode: string,
    _terminalLabel: string
  ): Promise<{ success: boolean; terminal?: TerminalAuthorization; error?: string }> {
    // Stub for Phase 1 - implementation will connect to Supabase RPC in subsequent phases
    return { success: false, error: 'Not implemented in Phase 1' }
  },

  async recordAttendance(
    _params: SubmitAttendanceParams
  ): Promise<{ success: boolean; record?: AttendanceRecord; error?: string }> {
    // Stub for Phase 1 - implementation will connect to Supabase RPC in subsequent phases
    return { success: false, error: 'Not implemented in Phase 1' }
  }
}
