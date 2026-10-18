/**
 * Core type definitions for the YSA Attendance Management System.
 * Abeokuta Nigeria Obantoko Stake
 */

export type AppRole =
  | 'system_admin'
  | 'ysa_leader'
  | 'stake_presidency'
  | 'bishop'
  | 'branch_president'
  | 'stake_clerk'
  | 'ward_clerk'
  | 'branch_clerk'

export type UnitAssignedRole =
  | 'bishop'
  | 'branch_president'
  | 'ysa_leader'
  | 'ward_clerk'
  | 'branch_clerk'

export type UnitType = 'ward' | 'branch'

export interface StakeUnit {
  id: string
  unitName: string
  unitType: UnitType
  isActive: boolean
  createdAt: string
  updatedAt?: string
}

export interface UserUnitAssignment {
  id: string
  userId: string
  unitId: string
  assignedRole: UnitAssignedRole
  assignedBy?: string | null
  createdAt: string
  unitName?: string
}

export interface UserProfile {
  id: string
  fullName: string
  email: string
  roles: AppRole[]
  unitAssignments?: UserUnitAssignment[]
  unitId?: string | null
  accountStatus: 'active' | 'deactivated' | 'pending'
  createdAt: string
  updatedAt?: string
}

export interface MemberRecord {
  id: string
  memberNumber?: string | null
  fullName: string
  preferredName?: string | null
  gender?: 'male' | 'female' | null
  phoneNumber?: string | null
  email?: string | null
  homeUnitId: string
  homeUnitName?: string
  isActive: boolean
  createdAt: string
  updatedAt?: string
}

export interface ActivityDefinition {
  id: string
  title: string
  description?: string | null
  category: 'spiritual' | 'social' | 'service' | 'sports' | 'temple' | 'educational' | 'other'
  defaultParticipatingUnits?: string[] | null
  createdBy: string
  createdAt: string
  updatedAt?: string
}

export interface ActivitySession {
  id: string
  activityId: string
  sessionTitle: string
  sessionDate: string
  startTime: string
  scheduledEndTime?: string | null
  timezone: string
  status: 'draft' | 'active' | 'closed'
  maxTerminals: number
  codeHash?: string | null
  codeExpiresAt?: string | null
  visitorRegistrationEnabled: boolean
  participatingUnits?: string[] | null
  initiatedBy?: string | null
  initiatedAt?: string | null
  closedAt?: string | null
  closedBy?: string | null
  createdAt: string
  updatedAt?: string
}

export interface TerminalAuthorization {
  id: string
  sessionId: string
  terminalToken: string
  terminalLabel: string
  leaseExpiresAt: string
  isRevoked: boolean
  lastSeenAt?: string
}

export interface AttendanceRecord {
  id: string
  sessionId: string
  memberId?: string | null
  attendeeName: string
  isNonMember: boolean
  unitId?: string | null
  unitName?: string | null
  checkInTime: string
  recordedByTerminalId?: string | null
  isManual?: boolean
}

export interface SessionVisitor {
  id: string
  sessionId: string
  fullName: string
  contactPhone?: string | null
  isChurchMember: boolean
  invitingUnitId?: string | null
  invitingUnitName?: string | null
  recordedByTerminalId?: string | null
  createdAt: string
}

export interface AuditLogEntry {
  id: string
  actorId?: string | null
  actorName?: string | null
  action: string
  targetRecordId?: string | null
  targetTable?: string | null
  outcome: 'success' | 'failure'
  metadata: Record<string, unknown>
  createdAt: string
}

export type LeadershipRoute =
  | 'dashboard'
  | 'activities'
  | 'attendance'
  | 'members'
  | 'reports'
  | 'units'
  | 'users'
  | 'settings'
  | 'audit-logs'
