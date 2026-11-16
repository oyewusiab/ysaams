/**
 * Attendance Adjustment Workflow Types
 * Abeokuta Nigeria Obantoko Stake
 */

export type AdjustmentType = 'add_attendance' | 'remove_attendance'

export type AdjustmentStatus = 'pending_approval' | 'approved' | 'rejected' | 'applied'

export interface AttendanceAdjustment {
  id: string
  sessionId: string
  sessionTitle?: string
  sessionDate?: string
  memberId: string
  memberName?: string
  unitId?: string
  unitName?: string
  adjustmentType: AdjustmentType
  className?: string | null
  status: AdjustmentStatus
  requestedBy: string
  requestedByName?: string
  requestedAt: string
  reviewedBy?: string | null
  reviewedByName?: string | null
  reviewedAt?: string | null
  appliedBy?: string | null
  appliedByName?: string | null
  appliedAt?: string | null
  reason: string
  reviewComment?: string | null
  batchId?: string | null
  affectedRecordId?: string | null
  metadata?: Record<string, any>
  createdAt: string
  updatedAt: string
}

export interface AdjustmentPreviewItem {
  memberId: string
  memberName: string
  unitId: string
  unitName: string
  sessionId: string
  sessionTitle: string
  sessionDate: string
  adjustmentType: AdjustmentType
  className?: string | null
  currentVisitsThisMonth: number
  resultingVisitsThisMonth: number
  crossesThreshold: boolean
  isConflict: boolean
  conflictReason?: string
}

export interface AdjustmentBatchPreview {
  items: AdjustmentPreviewItem[]
  totalNetVisitChange: number
  thresholdCrossingCount: number
  hasConflicts: boolean
}

export interface SubmitAdjustmentPayload {
  sessionId: string
  memberIds: string[]
  adjustmentType: AdjustmentType
  className?: string | null
  reason: string
  directApply?: boolean
}
