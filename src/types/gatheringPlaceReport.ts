/**
-- ============================================================================
-- YSA Attendance Management System (YSA AMS)
-- Module: Gathering Place Monthly Report, Stake Approval & Unit Distribution
-- Stake: Abeokuta Nigeria Obantoko Stake
-- ============================================================================
*/

export type GatheringPlaceReportStatus =
  | 'draft'
  | 'generated_pending_approval'
  | 'correction_requested'
  | 'approved'
  | 'disapproved'
  | 'archived'

export interface StakeLeaderSignature {
  id: string
  userId: string
  fullName: string
  phoneNumber: string
  signatureDataUrl: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface GatheringPlaceReportLeaderSnapshot {
  userId: string
  fullName: string
  phoneNumber: string
  signatureDataUrl: string
  role?: string | null
  signedAt?: string | null
}

export interface GatheringPlaceReportItem {
  id?: string
  reportId?: string
  serialNumber: number
  memberId?: string | null
  attendeeName: string
  unitId: string
  unitName: string
  classGroupDisplay: string
  totalVisits: number
  attendedSessionIds?: string[]
}

export interface GatheringPlaceReportFilterCriteria {
  year: number
  month: number // 1-12
  monthName: string
  selectedUnitIds: string[]
  isAllUnits: boolean
  selectedActivityIds: string[]
  selectedClassesByActivity: Record<string, string[]>
  specificPeriod?: 'full_month' | 'specific_dates' | 'selected_occurrences'
  startDate?: string
  endDate?: string
  selectedSessionIds?: string[]
  memberClassification: 'all' | 'members_only' | 'visitors_only'
  minimumVisitThreshold: number
  selectedMemberIds?: string[]
  searchQuery?: string
  selectedLeaderId: string
}

export interface GatheringPlaceReportSummaryMetrics {
  totalParticipants: number
  totalVisits: number
  unitsCount: number
  unitBreakdown?: Record<string, number>
  averageVisitsPerParticipant?: number
}

export interface GatheringPlaceMonthlyReport {
  id: string
  reportTitle: string
  reportingYear: number
  reportingMonth: number
  monthName: string
  status: GatheringPlaceReportStatus
  version: number
  expectedVisitsPerYa: number
  totalEligibleOccurrences: number
  minimumVisitThreshold: number
  filterCriteria: GatheringPlaceReportFilterCriteria
  leaderSnapshot: GatheringPlaceReportLeaderSnapshot
  summaryMetrics: GatheringPlaceReportSummaryMetrics
  unitIds: string[]
  generatedBy: string
  generatedByName?: string
  generatedAt: string
  approvedBy?: string | null
  approvedByName?: string | null
  approvedAt?: string | null
  approvalNote?: string | null
  disapprovedBy?: string | null
  disapprovedByName?: string | null
  disapprovedAt?: string | null
  disapprovalReason?: string | null
  hasPendingRevision?: boolean
  revisionTriggerReason?: string | null
  signatoryRole?: string | null
  signedAt?: string | null
  correctionRequestedBy?: string | null
  correctionRequestedByName?: string | null
  correctionRequestedAt?: string | null
  correctionComment?: string | null
  createdAt: string
  updatedAt: string
  items?: GatheringPlaceReportItem[]
}

export interface GatheringPlaceReportHistory {
  id: string
  reportId: string
  action: string
  actorId: string
  actorRole?: string | null
  actorName?: string | null
  comment?: string | null
  version: number
  snapshotSummary?: Record<string, any>
  createdAt: string
}
