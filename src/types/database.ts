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

export type UnitType = 'ward' | 'branch'

export interface StakeUnit {
  id: string
  unitName: string
  unitType: UnitType
  isActive: boolean
  createdAt: string
}

export interface UserProfile {
  id: string
  fullName: string
  email: string
  roles: AppRole[]
  unitId?: string | null
  accountStatus: 'active' | 'deactivated' | 'pending'
  createdAt: string
}

export interface ActivityDefinition {
  id: string
  title: string
  description?: string
  category: 'spiritual' | 'social' | 'service' | 'sports' | 'temple' | 'educational' | 'other'
  createdBy: string
  createdAt: string
}

export interface ActivitySession {
  id: string
  activityId: string
  sessionTitle: string
  sessionDate: string
  startTime: string
  timezone: string
  status: 'draft' | 'active' | 'closed'
  maxTerminals: number
  codeHash?: string
  codeExpiresAt?: string
  visitorRegistrationEnabled: boolean
  participatingUnits?: string[] | null
  closedAt?: string
  closedBy?: string
}

export interface TerminalAuthorization {
  id: string
  sessionId: string
  terminalToken: string
  terminalLabel: string
  leaseExpiresAt: string
  isRevoked: boolean
}

export interface AttendanceRecord {
  id: string
  sessionId: string
  memberId?: string
  attendeeName: string
  isNonMember: boolean
  unitId?: string | null
  checkInTime: string
  recordedByTerminalId?: string
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
