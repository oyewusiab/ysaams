import { describe, it, expect, vi, beforeEach } from 'vitest'
import { attendanceService, humanizeTerminalError } from '../services/attendanceService'
import { formatAttendeeFirstName, getActivityWelcomeMessage } from '../lib/terminalPersonalization'
import { supabase } from '../lib/supabase'

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn()
  }
}))

describe('Phase 3 Acceptance: Public Attendance Terminal & Welcoming Experience', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
  })

  // ---------------------------------------------------------------------------
  // 1. Session Access & Direct Link Handling
  // ---------------------------------------------------------------------------
  describe('Session Access & Code Redemption', () => {
    it('1. Authorizes valid 6-character session code entered by user', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          success: true,
          session_id: 'sess-001',
          session_title: 'Obantoko Stake FHE',
          session_date: '2026-10-25',
          terminal_id: 'term-001',
          terminal_token: 'bearer-token-32byte',
          participating_units: ['ward-1', 'ward-2'],
          reconnected: false
        },
        error: null
      } as any)

      const res = await attendanceService.authorizeTerminal('5BV21F', 'Public Terminal Kiosk')

      expect(supabase.rpc).toHaveBeenCalledWith('authorize_terminal', {
        p_session_code: '5BV21F',
        p_terminal_label: 'Public Terminal Kiosk',
        p_existing_terminal_token: null
      })

      expect(res.success).toBe(true)
      expect(res.sessionId).toBe('sess-001')
      expect(res.sessionTitle).toBe('Obantoko Stake FHE')
      expect(res.participatingUnits).toEqual(['ward-1', 'ward-2'])

      // Verifies storage in volatile sessionStorage
      const meta = attendanceService.getStoredSessionMetadata()
      expect(meta.token).toBe('bearer-token-32byte')
      expect(meta.sessionId).toBe('sess-001')
      expect(meta.sessionTitle).toBe('Obantoko Stake FHE')
    })

    it('2. Authorizes direct session link with code normalization', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          success: true,
          session_id: 'sess-002',
          session_title: 'Stake Institute Night',
          session_date: '2026-10-26',
          terminal_id: 'term-002',
          terminal_token: 'direct-token-abc',
          reconnected: false
        },
        error: null
      } as any)

      // Lowercase code passed in direct link (e.g. /7km9pq) is normalized to uppercase
      const res = await attendanceService.authorizeTerminal('7km9pq')
      expect(supabase.rpc).toHaveBeenCalledWith('authorize_terminal', expect.objectContaining({
        p_session_code: '7KM9PQ'
      }))
      expect(res.success).toBe(true)
    })

    it('3. Handles invalid session code with actionable, friendly message without backend leaks', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: null,
        error: {
          message: 'Invalid attendance code or session is not active.',
          code: 'P0001'
        }
      } as any)

      const res = await attendanceService.authorizeTerminal('WRONG1')
      expect(res.success).toBe(false)
      const friendly = humanizeTerminalError(res.error)
      expect(friendly).toMatch(/invalid or expired session code/i)
      expect(friendly).not.toContain('P0001')
      expect(friendly).not.toContain('authorize_terminal')
    })

    it('4. Handles cancelled, closed, and postponed sessions with clear recovery guidance', () => {
      expect(humanizeTerminalError('Attendance session is cancelled.')).toMatch(/has been cancelled/i)
      expect(humanizeTerminalError('Attendance session has closed (effective lock time reached).')).toMatch(/scheduled check-in window and grace period have ended/i)
      expect(humanizeTerminalError('Attendance session is not active.')).toMatch(/not open yet/i)
    })
  })

  // ---------------------------------------------------------------------------
  // 2. Attendee Identity, Name Suggestions & Registration Without Prior Signup
  // ---------------------------------------------------------------------------
  describe('Attendee Identity & Name Suggestions', () => {
    it('5. Allows first-time attendees to submit attendance without prior registration or census enrollment', async () => {
      sessionStorage.setItem('ysaams_terminal_token', 'term-valid-token')
      sessionStorage.setItem('ysaams_terminal_session_id', 'sess-001')

      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          success: true,
          attendance_id: 'att-first-timer',
          member_id: 'mem-auto-created-1',
          attendee_name: 'Damilola Ogunleye',
          is_non_member: false,
          check_in_time: '2026-10-25T18:15:00Z'
        },
        error: null
      } as any)

      const res = await attendanceService.recordAttendance({
        sessionId: 'sess-001',
        attendeeName: 'Damilola Ogunleye',
        memberId: undefined, // No prior census record
        isNonMember: false,
        unitId: 'ward-obantoko-1'
      })

      expect(supabase.rpc).toHaveBeenCalledWith('record_terminal_checkin', {
        p_session_id: 'sess-001',
        p_terminal_token: 'term-valid-token',
        p_attendee_name: 'Damilola Ogunleye',
        p_unit_id: 'ward-obantoko-1',
        p_is_non_member: false,
        p_member_id: null,
        p_contact_phone: null
      })

      expect(res.success).toBe(true)
      expect(res.record?.attendeeName).toBe('Damilola Ogunleye')
      expect(res.record?.memberId).toBe('mem-auto-created-1')
    })

    it('6. Retrieves suggestions without leaking telephone numbers or private data', async () => {
      sessionStorage.setItem('ysaams_terminal_token', 'term-valid-token')

      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: [
          {
            id: 'mem-101',
            full_name: 'Adeoye Saheed',
            home_unit_id: 'ward-1',
            home_unit_name: 'Obantoko 1st Ward'
          }
        ],
        error: null
      } as any)

      const suggestions = await attendanceService.searchTerminalSuggestions('sess-001', 'ward-1', 'Ade')
      expect(suggestions).toHaveLength(1)
      expect(suggestions[0].fullName).toBe('Adeoye Saheed')
      expect(suggestions[0].homeUnitName).toBe('Obantoko 1st Ward')

      // Invariant: suggestions must not expose contact phone numbers or member numbers
      expect((suggestions[0] as any).phoneNumber).toBeUndefined()
      expect((suggestions[0] as any).contactPhone).toBeUndefined()
      expect((suggestions[0] as any).memberNumber).toBeUndefined()
    })

    it('7. Accepts raw new name input when no suggestion matches', async () => {
      sessionStorage.setItem('ysaams_terminal_token', 'term-valid-token')

      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          success: true,
          attendance_id: 'att-new-name',
          member_id: 'mem-brand-new',
          attendee_name: 'Chukwuemeka Nwachukwu',
          is_non_member: false
        },
        error: null
      } as any)

      const res = await attendanceService.recordAttendance({
        sessionId: 'sess-001',
        attendeeName: 'Chukwuemeka Nwachukwu',
        isNonMember: false,
        unitId: 'ward-1'
      })

      expect(res.success).toBe(true)
      expect(res.record?.attendeeName).toBe('Chukwuemeka Nwachukwu')
    })

    it('8. Supports two different attendees who share identical names without merging', async () => {
      sessionStorage.setItem('ysaams_terminal_token', 'term-valid-token')

      // Person 1 (Ward 1)
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          success: true,
          attendance_id: 'att-person-1',
          member_id: 'mem-id-001',
          attendee_name: 'Samuel Adebayo'
        },
        error: null
      } as any)

      const person1 = await attendanceService.recordAttendance({
        sessionId: 'sess-001',
        attendeeName: 'Samuel Adebayo',
        isNonMember: false,
        unitId: 'ward-1'
      })

      // Person 2 (Ward 2 - different individual with same name)
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          success: true,
          attendance_id: 'att-person-2',
          member_id: 'mem-id-002',
          attendee_name: 'Samuel Adebayo'
        },
        error: null
      } as any)

      const person2 = await attendanceService.recordAttendance({
        sessionId: 'sess-001',
        attendeeName: 'Samuel Adebayo',
        isNonMember: false,
        unitId: 'ward-2'
      })

      expect(person1.success).toBe(true)
      expect(person2.success).toBe(true)
      expect(person1.record?.id).not.toBe(person2.record?.id)
      expect(person1.record?.memberId).not.toBe(person2.record?.memberId)
    })

    it('9. Prevents duplicate check-in for the same attendee in the same session', async () => {
      sessionStorage.setItem('ysaams_terminal_token', 'term-valid-token')

      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: null,
        error: {
          message: 'Duplicate check-in: Adeoye Saheed has already been marked present for this session.',
          code: '23505'
        }
      } as any)

      const res = await attendanceService.recordAttendance({
        sessionId: 'sess-001',
        attendeeName: 'Adeoye Saheed',
        memberId: 'mem-id-001',
        isNonMember: false,
        unitId: 'ward-1'
      })

      expect(res.success).toBe(false)
      const friendly = humanizeTerminalError(res.error)
      expect(friendly).toContain('already been recorded')
      expect(friendly).not.toContain('23505')
    })


  })

  // ---------------------------------------------------------------------------
  // 3. Unit Selection & Non-Member / Visitor Support
  // ---------------------------------------------------------------------------
  describe('Unit Selection & Visitor Support', () => {
    it('10. Allows visitor/non-member check-in without requiring church ward', async () => {
      sessionStorage.setItem('ysaams_terminal_token', 'term-valid-token')

      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          success: true,
          attendance_id: 'visitor-att-1',
          attendee_name: 'Femi Otedola',
          is_non_member: true,
          check_in_time: '2026-10-25T18:20:00Z'
        },
        error: null
      } as any)

      const res = await attendanceService.recordAttendance({
        sessionId: 'sess-001',
        attendeeName: 'Femi Otedola',
        isNonMember: true,
        unitId: null, // Visitors can omit unit or choose inviting unit
        contactPhone: '08012345678'
      })

      expect(res.success).toBe(true)
      expect(res.record?.isNonMember).toBe(true)
      expect(res.record?.attendeeName).toBe('Femi Otedola')
    })

    it('11. Rejects member check-in for unauthorized non-participating unit on server', async () => {
      sessionStorage.setItem('ysaams_terminal_token', 'term-valid-token')

      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: null,
        error: {
          message: 'Unit "Inactive Ward" is not an authorized participating unit for this session.',
          code: 'P0001'
        }
      } as any)

      const res = await attendanceService.recordAttendance({
        sessionId: 'sess-001',
        attendeeName: 'Adeola Johnson',
        isNonMember: false,
        unitId: 'ward-unauthorized'
      })

      expect(res.success).toBe(false)
      expect(humanizeTerminalError(res.error)).toMatch(/not participating in this specific session/i)
    })
  })

  // ---------------------------------------------------------------------------
  // 4. Device Limits, Concurrent Sessions, and Authorization Lifecycle
  // ---------------------------------------------------------------------------
  describe('Device Limits, Concurrency, and Leases', () => {
    it('12. Rejects authorization when session device limit is reached', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: null,
        error: {
          message: 'Terminal limit reached (3 of 3 active). Please contact the session administrator.',
          code: 'P0001'
        }
      } as any)

      const res = await attendanceService.authorizeTerminal('5BV21F', 'Device 4')
      expect(res.success).toBe(false)
      expect(humanizeTerminalError(res.error)).toMatch(/reached its device connection limit/i)
    })

    it('13. Rejects attendance when terminal bearer token is expired or revoked', async () => {
      sessionStorage.setItem('ysaams_terminal_token', 'expired-token')

      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: null,
        error: {
          message: 'Unauthorized terminal token, terminal revoked, or terminal lease expired.',
          code: 'P0001'
        }
      } as any)

      const res = await attendanceService.recordAttendance({
        sessionId: 'sess-001',
        attendeeName: 'Taiwo Hassan',
        isNonMember: false,
        unitId: 'ward-1'
      })

      expect(res.success).toBe(false)
      expect(humanizeTerminalError(res.error)).toMatch(/session has expired or was disconnected/i)
    })

    it('14. Properly cleans up stored session upon releaseTerminal', async () => {
      sessionStorage.setItem('ysaams_terminal_token', 'tok-abc')
      sessionStorage.setItem('ysaams_terminal_session_id', 'sess-001')
      sessionStorage.setItem('ysaams_terminal_id', 'term-001')
      sessionStorage.setItem('ysaams_terminal_session_title', 'Activity Title')

      vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { success: true }, error: null } as any)

      const released = await attendanceService.releaseTerminal()
      expect(released).toBe(true)

      const meta = attendanceService.getStoredSessionMetadata()
      expect(meta.token).toBeNull()
      expect(meta.sessionId).toBeNull()
      expect(meta.terminalId).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // 5. Welcoming, Warm, and Personalized Terminal Experience
  // ---------------------------------------------------------------------------
  describe('Welcoming & Personalization Experience', () => {
    it('15. Derives attendee first name accurately for warm greetings', () => {
      expect(formatAttendeeFirstName('ADEOYE SAHEED')).toBe('Adeoye')
      expect(formatAttendeeFirstName('oluwaseun adeleke')).toBe('Oluwaseun')
      expect(formatAttendeeFirstName('  Babatunde  ')).toBe('Babatunde')
      expect(formatAttendeeFirstName('SingleName')).toBe('Singlename')
      expect(formatAttendeeFirstName('')).toBe('friend')
    })

    it('16. Generates activity-specific confirmation messages tailored to category', () => {
      // Service activity
      const serviceWelcome = getActivityWelcomeMessage('Community Cleanup Service Project', false, 'Adeoye')
      expect(serviceWelcome.heading).toBe('Thank you, Adeoye!')
      expect(serviceWelcome.message).toContain('service activity')

      // Sports activity
      const sportsWelcome = getActivityWelcomeMessage('Obantoko Stake Football Match', false, 'Saheed')
      expect(sportsWelcome.heading).toBe('Ready to go, Saheed!')
      expect(sportsWelcome.message).toContain('roster')

      // Spiritual activity
      const spiritualWelcome = getActivityWelcomeMessage('Stake YSA Devotional', false, 'Mary')
      expect(spiritualWelcome.heading).toBe('Welcome, Mary!')
      expect(spiritualWelcome.submessage).toContain('faith')

      // Social activity
      const socialWelcome = getActivityWelcomeMessage('YSA Game Night & Social', false, 'John')
      expect(socialWelcome.heading).toBe('Welcome, John!')
      expect(socialWelcome.submessage).toContain('connecting with friends')

      // Guest / Non-member visitor
      const visitorWelcome = getActivityWelcomeMessage('Stake YSA Social', true, 'Tunde')
      expect(visitorWelcome.heading).toBe('Welcome, Tunde!')
      expect(visitorWelcome.message).toContain('our guest')
    })

    it('17. Handles network or server error without falsely indicating success', async () => {
      sessionStorage.setItem('ysaams_terminal_token', 'valid-token')

      vi.mocked(supabase.rpc).mockRejectedValueOnce(new Error('Failed to fetch'))

      const res = await attendanceService.recordAttendance({
        sessionId: 'sess-001',
        attendeeName: 'Adeola',
        isNonMember: false,
        unitId: 'ward-1'
      })

      expect(res.success).toBe(false)
      expect(humanizeTerminalError(res.error)).toMatch(/unable to reach the server/i)
    })
  })
})
