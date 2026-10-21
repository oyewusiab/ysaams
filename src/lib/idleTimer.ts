/**
 * Automatic Inactivity Sign-Out & Cross-Tab Idle Tracking Engine
 * Abeokuta Nigeria Obantoko Stake — YSA AMS
 *
 * Implements:
 * - Configurable 30-minute idle timeout with 2-minute warning
 * - Meaningful user interaction tracking (throttled)
 * - Multi-tab synchronization via localStorage storage events
 * - Exclusion of background polling / network traffic
 * - Safe session termination via Supabase Auth
 *
 * Note: A client-side idle timeout enhances physical workstation security but
 * does not replace server-side Row-Level Security, RPC authorization, or JWT expiry.
 */

export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
export const DEFAULT_WARNING_THRESHOLD_MS = 2 * 60 * 1000 // 2 minutes (120 seconds)
export const ACTIVITY_THROTTLE_MS = 1000 // 1 second throttle

export const STORAGE_KEY_LAST_ACTIVITY = 'ysaams_leadership_last_activity'
export const STORAGE_KEY_SIGNOUT_BROADCAST = 'ysaams_leadership_signout_event'

export interface IdleState {
  remainingMs: number
  isWarning: boolean
  isExpired: boolean
  secondsRemaining: number
}

/**
 * Pure calculation of remaining idle time and warning/expired states.
 */
export function calculateIdleState(
  lastActivityTime: number,
  currentTime: number,
  timeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS,
  warningThresholdMs: number = DEFAULT_WARNING_THRESHOLD_MS
): IdleState {
  if (lastActivityTime <= 0 || isNaN(lastActivityTime)) {
    return {
      remainingMs: timeoutMs,
      isWarning: false,
      isExpired: false,
      secondsRemaining: Math.ceil(timeoutMs / 1000)
    }
  }

  const elapsedMs = Math.max(0, currentTime - lastActivityTime)
  const remainingMs = Math.max(0, timeoutMs - elapsedMs)
  const isExpired = remainingMs <= 0
  const isWarning = !isExpired && remainingMs <= warningThresholdMs

  return {
    remainingMs,
    isWarning,
    isExpired,
    secondsRemaining: Math.ceil(remainingMs / 1000)
  }
}

/**
 * Pure check to determine if an activity event should be throttled.
 */
export function shouldThrottleActivity(
  lastRecordedTime: number,
  currentTime: number,
  throttleIntervalMs: number = ACTIVITY_THROTTLE_MS
): boolean {
  return currentTime - lastRecordedTime < throttleIntervalMs
}

/**
 * Read the current authoritative last activity timestamp from localStorage.
 */
export function getStoredLastActivity(fallbackTime: number = Date.now()): number {
  if (typeof window === 'undefined' || !window.localStorage) return fallbackTime
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_LAST_ACTIVITY)
    const parsed = raw ? parseInt(raw, 10) : NaN
    return !isNaN(parsed) && parsed > 0 ? parsed : fallbackTime
  } catch {
    return fallbackTime
  }
}

/**
 * Update the authoritative last activity timestamp in localStorage.
 */
export function setStoredLastActivity(timestamp: number): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(STORAGE_KEY_LAST_ACTIVITY, String(timestamp))
  } catch {
    // Non-blocking
  }
}

/**
 * Broadcast an idle sign-out event to all other open tabs.
 */
export function broadcastSignOut(): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(STORAGE_KEY_SIGNOUT_BROADCAST, String(Date.now()))
  } catch {
    // Non-blocking
  }
}

/**
 * Clear leadership idle tracking state from storage upon sign-out.
 */
export function clearIdleStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.removeItem(STORAGE_KEY_LAST_ACTIVITY)
  } catch {
    // Non-blocking
  }
}
