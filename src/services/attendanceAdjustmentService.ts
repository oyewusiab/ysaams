/**
 * Attendance Adjustment Service
 * Abeokuta Nigeria Obantoko Stake
 * Non-destructive manual attendance adjustments with multi-role audit trail.
 */

import { supabase } from '../lib/supabase'
import {
  ActivitySession,
  AttendanceRecord,
  MemberRecord,
  UserProfile,
  AttendanceAdjustment,
  AdjustmentStatus,
  AdjustmentType,
  AdjustmentPreviewItem,
  AdjustmentBatchPreview,
  SubmitAdjustmentPayload
} from '../types/database'
import { getLagosParts } from '../lib/timezone'

export interface SessionEligibilityResult {
  eligible: boolean
  reason?: string
}

export const attendanceAdjustmentService = {
  /**
   * Validates whether an activity session actually occurred and is eligible for adjustments.
   * Excludes cancelled, postponed, draft, or future sessions.
   * Requires evidence of occurrence (initiated, closed, or active attendance records).
   */
  validateSessionEligibility(
    session: ActivitySession,
    existingAttendanceCount = 0
  ): SessionEligibilityResult {
    const lagosNow = getLagosParts(new Date())
    const todayStr = `${lagosNow.year}-${String(lagosNow.month).padStart(2, '0')}-${String(
      lagosNow.day
    ).padStart(2, '0')}`

    if (session.status === 'cancelled' || session.cancelledAt) {
      return { eligible: false, reason: 'Session was cancelled and did not occur.' }
    }

    if (session.postponedAt) {
      return { eligible: false, reason: 'Session was postponed.' }
    }

    if (session.status === 'draft') {
      return { eligible: false, reason: 'Session is in draft status.' }
    }

    if (session.sessionDate > todayStr) {
      return {
        eligible: false,
        reason: `Session date (${session.sessionDate}) is in the future.`
      }
    }

    const hasOccurred =
      Boolean(session.initiatedAt) ||
      session.status === 'closed' ||
      existingAttendanceCount > 0

    if (!hasOccurred) {
      return {
        eligible: false,
        reason: 'Session has no record of occurrence (not initiated, closed, or attended).'
      }
    }

    return { eligible: true }
  },

  /**
   * Generates a comprehensive pre-flight preview of proposed adjustments for all target members.
   * Calculates current vs resulting monthly totals, threshold impact (>= 5), and conflict detection.
   */
  calculateBatchPreview(params: {
    session: ActivitySession
    members: MemberRecord[]
    adjustmentType: AdjustmentType
    className?: string | null
    allMonthAttendance: AttendanceRecord[]
    minimumVisitThreshold?: number
  }): AdjustmentBatchPreview {
    const {
      session,
      members,
      adjustmentType,
      className,
      allMonthAttendance,
      minimumVisitThreshold = 5
    } = params

    // Filter active (non-voided) records for this month
    const activeRecords = allMonthAttendance.filter((a) => !a.isVoided)

    // Map member attendance counts for the month
    const visitsByMember = new Map<string, number>()
    activeRecords.forEach((rec) => {
      if (rec.memberId) {
        visitsByMember.set(rec.memberId, (visitsByMember.get(rec.memberId) || 0) + 1)
      }
    })

    // Check existing attendance for this specific session
    const attendedInSession = new Set(
      activeRecords.filter((a) => a.sessionId === session.id).map((a) => a.memberId)
    )

    let totalNetChange = 0
    let thresholdCrossingCount = 0
    let hasConflicts = false

    const items: AdjustmentPreviewItem[] = members.map((member) => {
      const currentVisits = visitsByMember.get(member.id) || 0
      const isCurrentlyPresentInSession = attendedInSession.has(member.id)

      let isConflict = false
      let conflictReason: string | undefined
      let resultingVisits = currentVisits

      if (adjustmentType === 'add_attendance') {
        if (isCurrentlyPresentInSession) {
          isConflict = true
          conflictReason = 'Already marked present in this session.'
          hasConflicts = true
        } else {
          resultingVisits = currentVisits + 1
          totalNetChange += 1
        }
      } else if (adjustmentType === 'remove_attendance') {
        if (!isCurrentlyPresentInSession) {
          isConflict = true
          conflictReason = 'Not marked present in this session to remove.'
          hasConflicts = true
        } else {
          resultingVisits = Math.max(0, currentVisits - 1)
          totalNetChange -= 1
        }
      }

      // Check if threshold boundary is crossed
      const wasAtOrAbove = currentVisits >= minimumVisitThreshold
      const willBeAtOrAbove = resultingVisits >= minimumVisitThreshold
      const crossesThreshold = wasAtOrAbove !== willBeAtOrAbove

      if (crossesThreshold) {
        thresholdCrossingCount += 1
      }

      return {
        memberId: member.id,
        memberName: member.fullName,
        unitId: member.homeUnitId,
        unitName: member.homeUnitName || 'Unit',
        sessionId: session.id,
        sessionTitle: session.sessionTitle,
        sessionDate: session.sessionDate,
        adjustmentType,
        className: className || null,
        currentVisitsThisMonth: currentVisits,
        resultingVisitsThisMonth: resultingVisits,
        crossesThreshold,
        isConflict,
        conflictReason
      }
    })

    return {
      items,
      totalNetVisitChange: totalNetChange,
      thresholdCrossingCount,
      hasConflicts
    }
  },

  /**
   * Submits single, multi-attendee, or bulk attendance adjustments.
   * If caller is System Admin or Stake Presidency and directApply is requested, applies immediately.
   * If caller is Stake Clerk, submission enters pending_approval queue.
   */
  async submitAdjustment(
    payload: SubmitAdjustmentPayload,
    caller: UserProfile
  ): Promise<{ success: boolean; batchId: string; count: number; status: AdjustmentStatus }> {
    const isClerk = caller.roles.includes('stake_clerk')
    const canApprove =
      caller.roles.includes('system_admin') || caller.roles.includes('stake_presidency')

    if (!caller.roles.includes('system_admin') && !caller.roles.includes('stake_presidency') && !isClerk) {
      throw new Error('Permission denied. You are not authorized to initiate attendance adjustments.')
    }

    if (isClerk && payload.directApply) {
      throw new Error('Stake Clerks cannot directly apply adjustments. Submissions must enter pending approval queue.')
    }

    if (!payload.reason || payload.reason.trim().length < 5) {
      throw new Error('A valid adjustment reason (minimum 5 characters) is required.')
    }

    if (payload.memberIds.length === 0) {
      throw new Error('No attendees selected for adjustment.')
    }

    const adjustmentPayload = payload.memberIds.map((mId) => ({
      session_id: payload.sessionId,
      member_id: mId,
      adjustment_type: payload.adjustmentType,
      class_name: payload.className || null
    }))

    const shouldDirectApply = Boolean(payload.directApply && canApprove)

    try {
      const { data, error } = await supabase.rpc('rpc_submit_attendance_adjustment', {
        p_adjustments: adjustmentPayload,
        p_direct_apply: shouldDirectApply,
        p_batch_reason: payload.reason.trim()
      })

      if (error) {
        throw new Error(`Failed to submit attendance adjustment: ${error.message}`)
      }

      return {
        success: true,
        batchId: data?.batch_id || `batch-${Date.now()}`,
        count: data?.count || payload.memberIds.length,
        status: (data?.status as AdjustmentStatus) || (shouldDirectApply ? 'applied' : 'pending_approval')
      }
    } catch (err: any) {
      if (err instanceof Error) {
        throw err
      }
      throw new Error('Unexpected network or database error while submitting adjustment.')
    }
  },

  /**
   * Reviews pending attendance adjustments (Approve or Reject).
   * Prohibits self-approval.
   */
  async reviewAdjustments(
    adjustmentIds: string[],
    action: 'approve' | 'reject',
    comment: string,
    caller: UserProfile
  ): Promise<{ success: boolean; count: number; action: string }> {
    const canApprove =
      caller.roles.includes('system_admin') || caller.roles.includes('stake_presidency')

    if (!canApprove) {
      throw new Error('Permission denied. Only System Administrator or Stake Presidency can review adjustments.')
    }

    if (action === 'reject' && (!comment || comment.trim().length < 3)) {
      throw new Error('A comment explaining the rejection is required.')
    }

    try {
      const { data, error } = await supabase.rpc('rpc_review_attendance_adjustment', {
        p_adjustment_ids: adjustmentIds,
        p_action: action,
        p_comment: comment.trim()
      })

      if (error) {
        throw new Error(`Failed to review attendance adjustments: ${error.message}`)
      }

      return {
        success: true,
        count: data?.count || adjustmentIds.length,
        action
      }
    } catch (err: any) {
      if (err instanceof Error) {
        throw err
      }
      throw new Error('Unexpected error while reviewing adjustments.')
    }
  },

  /**
   * Fetches adjustments list with optional status filtering.
   */
  async listAdjustments(params?: {
    status?: AdjustmentStatus
    sessionId?: string
  }): Promise<AttendanceAdjustment[]> {
    try {
      let query = supabase
        .from('attendance_adjustments')
        .select(`
          id,
          session_id,
          member_id,
          adjustment_type,
          class_name,
          status,
          requested_by,
          requested_at,
          reviewed_by,
          reviewed_at,
          applied_by,
          applied_at,
          reason,
          review_comment,
          batch_id,
          affected_record_id,
          metadata,
          created_at,
          updated_at
        `)
        .order('created_at', { ascending: false })

      if (params?.status) {
        query = query.eq('status', params.status)
      }
      if (params?.sessionId) {
        query = query.eq('session_id', params.sessionId)
      }

      const { data, error } = await query

      if (error) {
        console.warn('Could not fetch attendance adjustments from database:', error.message)
        return []
      }

      return (data || []).map((row: any) => ({
        id: row.id,
        sessionId: row.session_id,
        memberId: row.member_id,
        adjustmentType: row.adjustment_type,
        className: row.class_name,
        status: row.status,
        requestedBy: row.requested_by,
        requestedAt: row.requested_at,
        reviewedBy: row.reviewed_by,
        reviewedAt: row.reviewed_at,
        appliedBy: row.applied_by,
        appliedAt: row.applied_at,
        reason: row.reason,
        reviewComment: row.review_comment,
        batchId: row.batch_id,
        affectedRecordId: row.affected_record_id,
        metadata: row.metadata || {},
        sessionTitle: row.metadata?.session_title,
        sessionDate: row.metadata?.session_date,
        memberName: row.metadata?.member_name,
        unitId: row.metadata?.home_unit_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    } catch {
      return []
    }
  }
}
