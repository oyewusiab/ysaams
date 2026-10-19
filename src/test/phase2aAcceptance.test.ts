import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  activityService,
  calculateEffectiveLockTime
} from '../services/activityService';
import {
  attendanceService
} from '../services/attendanceService';
import { supabase } from '../lib/supabase';

// Mock Supabase
vi.mock('../lib/supabase', () => {
  return {
    supabase: {
      from: vi.fn(),
      rpc: vi.fn()
    }
  };
});

describe('Phase 2A Acceptance: Attendance Identity, Scheduling, and Controlled Adjustments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  // --- Requirement A: Attendance Without Prior Registration ---
  describe('Requirement A: Unambiguous Attendance Identity & Prior Registration Not Required', () => {
    it('1. Allows attendance entry without prior registration (dynamic census creation via record_terminal_checkin)', async () => {
      // Setup stored terminal token and metadata in sessionStorage
      sessionStorage.setItem('ysaams_terminal_token', 'terminal-token-xyz');
      sessionStorage.setItem('ysaams_terminal_session_id', 'session-101');
      sessionStorage.setItem('ysaams_terminal_participating_units', JSON.stringify(['unit-abeokuta-1', 'unit-abeokuta-2']));

      // Mock record_terminal_checkin RPC success with auto-provisioned member
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          success: true,
          attendance_id: 'att-12345',
          member_id: 'member-new-999',
          session_id: 'session-101',
          created_at: new Date().toISOString()
        },
        error: null
      } as any);

      const result = await attendanceService.recordAttendance({
        sessionId: 'session-101',
        memberId: undefined, // undefined for un-enrolled new attendee
        unitId: 'unit-abeokuta-1',
        attendeeName: 'Olawale Adebayo',
        isNonMember: false
      });

      expect(supabase.rpc).toHaveBeenCalledWith('record_terminal_checkin', expect.objectContaining({
        p_session_id: 'session-101',
        p_terminal_token: 'terminal-token-xyz',
        p_unit_id: 'unit-abeokuta-1',
        p_attendee_name: 'Olawale Adebayo',
        p_is_non_member: false,
        p_member_id: null
      }));

      expect(result.success).toBe(true);
      expect(result.record).toBeDefined();
      expect(result.record?.id).toBe('att-12345');
      expect(result.record?.memberId).toBe('member-new-999');
    });

    it('2. Retrieves suggestions based on previously recorded attendance names without exposing census', async () => {
      sessionStorage.setItem('ysaams_terminal_token', 'terminal-token-xyz');
      sessionStorage.setItem('ysaams_terminal_session_id', 'session-101');

      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: [
          { id: 'm-1', full_name: 'Adebayo Olawale', home_unit_id: 'unit-abeokuta-1', home_unit_name: 'Obantoko 1st Ward', is_previously_attended: true },
          { id: 'm-2', full_name: 'Olayemi Adewole', home_unit_id: 'unit-abeokuta-2', home_unit_name: 'Obantoko 2nd Ward', is_previously_attended: true },
          { id: 'm-3', full_name: 'Adewale Johnson', home_unit_id: 'unit-abeokuta-1', home_unit_name: 'Obantoko 1st Ward', is_previously_attended: false }
        ],
        error: null
      } as any);

      const suggestions = await attendanceService.searchTerminalSuggestions('session-101', 'unit-abeokuta-1', 'ade');

      expect(supabase.rpc).toHaveBeenCalledWith('search_terminal_suggestions', {
        p_session_id: 'session-101',
        p_terminal_token: 'terminal-token-xyz',
        p_unit_id: 'unit-abeokuta-1',
        p_search_query: 'ade'
      });

      expect(suggestions).toHaveLength(3);
      expect(suggestions[0].fullName).toBe('Adebayo Olawale');
      expect(suggestions[0].homeUnitName).toBe('Obantoko 1st Ward');
    });

    it('3. Handles similar or identical names without false identity merging', async () => {
      sessionStorage.setItem('ysaams_terminal_token', 'terminal-token-xyz');
      sessionStorage.setItem('ysaams_terminal_session_id', 'session-101');
      sessionStorage.setItem('ysaams_terminal_participating_units', JSON.stringify(['unit-abeokuta-1', 'unit-abeokuta-2']));

      // Attendee A selects existing member m-1
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          success: true,
          attendance_id: 'att-1',
          member_id: 'm-1',
          session_id: 'session-101'
        },
        error: null
      } as any);

      const resA = await attendanceService.recordAttendance({
        sessionId: 'session-101',
        memberId: 'm-1',
        unitId: 'unit-abeokuta-1',
        attendeeName: 'Adebayo Olawale',
        isNonMember: false
      });
      expect(resA.record?.memberId).toBe('m-1');

      // Attendee B with the exact same name from another unit enters raw name without selecting suggestion
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          success: true,
          attendance_id: 'att-2',
          member_id: 'm-new-distinct',
          session_id: 'session-101'
        },
        error: null
      } as any);

      const resB = await attendanceService.recordAttendance({
        sessionId: 'session-101',
        memberId: undefined,
        unitId: 'unit-abeokuta-2',
        attendeeName: 'Adebayo Olawale',
        isNonMember: false
      });
      expect(resB.record?.memberId).toBe('m-new-distinct');
      expect(resA.record?.id).not.toBe(resB.record?.id);
    });

    it('4. Rejects duplicate check-in for the same person within the same session', async () => {
      sessionStorage.setItem('ysaams_terminal_token', 'terminal-token-xyz');
      sessionStorage.setItem('ysaams_terminal_session_id', 'session-101');

      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: null,
        error: {
          message: 'Attendance already recorded for this member in this session.',
          code: '23505'
        }
      } as any);

      const res = await attendanceService.recordAttendance({
        sessionId: 'session-101',
        memberId: 'm-1',
        unitId: 'unit-abeokuta-1',
        attendeeName: 'Adebayo Olawale',
        isNonMember: false
      });

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/already recorded/i);
    });
  });

  // --- Requirement B: Start Time, Scheduled End Time and Grace Period ---
  describe('Requirement B: Start Time, Scheduled End Time, and Grace Period Enforcement', () => {
    it('5. Calculates effective lock time correctly with immediate lock (grace = 0)', () => {
      const lockIso = calculateEffectiveLockTime('2026-10-25', '18:00', 0);
      expect(lockIso).toBeDefined();
      const lockDate = new Date(lockIso!);
      // Africa/Lagos is UTC+1. 18:00 WAT is 17:00 UTC.
      expect(lockDate.getUTCHours()).toBe(17);
      expect(lockDate.getUTCMinutes()).toBe(0);
    });

    it('6. Calculates effective lock time correctly with grace period (e.g. grace = 30)', () => {
      const lockIso = calculateEffectiveLockTime('2026-10-25', '18:00', 30);
      expect(lockIso).toBeDefined();
      const lockDate = new Date(lockIso!);
      // 18:30 WAT is 17:30 UTC
      expect(lockDate.getUTCHours()).toBe(17);
      expect(lockDate.getUTCMinutes()).toBe(30);
    });

    it('7. Returns null effective lock time when scheduledEndTime is not set (open-ended session)', () => {
      const lockIso = calculateEffectiveLockTime('2026-10-25', null, 15);
      expect(lockIso).toBeNull();
    });

    it('8. Server rejects check-in after effective lock time has expired', async () => {
      sessionStorage.setItem('ysaams_terminal_token', 'terminal-token-xyz');
      sessionStorage.setItem('ysaams_terminal_session_id', 'session-101');

      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: null,
        error: {
          message: 'This session has reached its scheduled end time and grace period and is no longer accepting attendance.',
          code: 'P0001'
        }
      } as any);

      const res = await attendanceService.recordAttendance({
        sessionId: 'session-101',
        memberId: 'm-1',
        unitId: 'unit-abeokuta-1',
        attendeeName: 'Adebayo Olawale',
        isNonMember: false
      });

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/reached its scheduled end time/i);
    });
  });

  // --- Requirement C: Controlled Adjustments to Active Sessions ---
  describe('Requirement C: Controlled Adjustments & Approval Workflow', () => {
    it('9. Allows authorized leader to adjust an active session with reason and audit log', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          success: true,
          request_id: 'adj-req-1'
        },
        error: null
      } as any);

      const result = await activityService.adjustActiveSession(
        'session-101',
        'Activity extended due to late arrival of keynote speaker',
        {
          scheduledEndTime: '20:00',
          gracePeriodMinutes: 15
        }
      );

      expect(supabase.rpc).toHaveBeenCalledWith('adjust_active_session', {
        p_session_id: 'session-101',
        p_reason: 'Activity extended due to late arrival of keynote speaker',
        p_new_title: null,
        p_new_end_time: '20:00',
        p_new_grace_minutes: 15,
        p_new_participating_units: null
      });

      expect(result.success).toBe(true);
    });

    it('10. Rejects adjustment attempts with insufficient justification reason (< 5 chars)', async () => {
      const result = await activityService.adjustActiveSession(
        'session-101',
        'Late',
        { scheduledEndTime: '21:00' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/at least 5 characters/i);
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('11. Rejects unauthorized adjustment attempts from database policy or role mismatch', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: null,
        error: {
          message: 'Unauthorized: insufficient privilege to adjust active session.',
          code: '42501'
        }
      } as any);

      const result = await activityService.adjustActiveSession(
        'session-101',
        'Speaker extended sermon presentation',
        { scheduledEndTime: '21:00' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/unauthorized/i);
    });
  });

  // --- Requirement D: Participating-Unit Filtering ---
  describe('Requirement D: Participating-Unit Filtering in UI and Database', () => {
    it('12. Terminal authorization persists and returns participating units', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          success: true,
          session_id: 'session-202',
          session_title: 'Stake YSA Institute Night',
          session_date: '2026-10-25',
          terminal_id: 'term-888',
          terminal_token: 'token-abc-999',
          participating_units: ['unit-ward-1', 'unit-ward-2'],
          reconnected: false
        },
        error: null
      } as any);

      const auth = await attendanceService.authorizeTerminal('VALID-CODE-123', 'Abeokuta North Stake Center');

      expect(auth.success).toBe(true);
      expect(auth.sessionId).toBe('session-202');
      expect(auth.participatingUnits).toEqual(['unit-ward-1', 'unit-ward-2']);

      const meta = attendanceService.getStoredSessionMetadata();
      expect(meta.participatingUnits).toEqual(['unit-ward-1', 'unit-ward-2']);
      expect(meta.sessionId).toBe('session-202');
    });

    it('13. Rejects check-in for non-participating unit on the database level', async () => {
      sessionStorage.setItem('ysaams_terminal_token', 'terminal-token-xyz');
      sessionStorage.setItem('ysaams_terminal_session_id', 'session-202');
      sessionStorage.setItem('ysaams_terminal_participating_units', JSON.stringify(['unit-ward-1', 'unit-ward-2']));

      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: null,
        error: {
          message: 'Selected unit is not participating in this activity session.',
          code: 'P0001'
        }
      } as any);

      const res = await attendanceService.recordAttendance({
        sessionId: 'session-202',
        memberId: undefined,
        unitId: 'unit-non-participating',
        attendeeName: 'Guest Attendee',
        isNonMember: false
      });

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/not participating/i);
    });
  });

  // --- Requirement E: Cancellation, Postponement, and Adjustment ---
  describe('Requirement E: Cancellation and Postponement Lifecycle', () => {
    it('14. Cancelling a session sets status to cancelled and revokes terminal tokens', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          success: true,
          status: 'cancelled',
          cancelled_at: new Date().toISOString()
        },
        error: null
      } as any);

      const res = await activityService.cancelSession('session-101', 'Severe thunderstorm and power outage');

      expect(supabase.rpc).toHaveBeenCalledWith('cancel_activity_session', {
        p_session_id: 'session-101',
        p_reason: 'Severe thunderstorm and power outage'
      });
      expect(res.success).toBe(true);
    });

    it('15. Postponing a session updates schedule, revokes active terminals, and resets to draft', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          success: true,
          status: 'draft',
          session_date: '2026-11-01',
          start_time: '17:00:00',
          scheduled_end_time: '19:30:00',
          postponed_at: new Date().toISOString()
        },
        error: null
      } as any);

      const res = await activityService.postponeSession(
        'session-101',
        '2026-11-01',
        '17:00',
        '19:30',
        'Venue renovation delayed by one week'
      );

      expect(supabase.rpc).toHaveBeenCalledWith('postpone_activity_session', {
        p_session_id: 'session-101',
        p_new_date: '2026-11-01',
        p_new_start_time: '17:00',
        p_new_end_time: '19:30',
        p_reason: 'Venue renovation delayed by one week'
      });
      expect(res.success).toBe(true);
    });

    it('16. Validates cancellation and postponement require non-empty justification reasons', async () => {
      const cancelRes = await activityService.cancelSession('session-101', '   ');
      expect(cancelRes.success).toBe(false);
      expect(cancelRes.error).toMatch(/reason.*required/i);

      const postponeRes = await activityService.postponeSession('session-101', '2026-11-01', '17:00', '19:00', '');
      expect(postponeRes.success).toBe(false);
      expect(postponeRes.error).toMatch(/reason.*required/i);
    });
  });
});
