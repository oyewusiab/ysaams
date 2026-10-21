/**
 * User-Facing Error Humanization & Safe Logging Utility
 * Abeokuta Nigeria Obantoko Stake — YSA AMS
 *
 * Replaces raw database errors, PostgREST errors, Supabase internals, and stack traces
 * with clear, actionable, and friendly messages for leaders and attendees.
 */

export type ErrorCategory =
  | 'auth_expired'
  | 'access_denied'
  | 'validation'
  | 'network'
  | 'duplicate'
  | 'not_found'
  | 'unexpected'

export interface CategorizedError {
  category: ErrorCategory
  userMessage: string
  originalMessage?: string
}

/**
 * Categorizes and humanizes any error into a warm, professional, actionable user-facing message.
 * Never leaks database schemas, SQL statements, RPC names, PostgREST internals, or tokens.
 */
export function categorizeAndHumanizeError(
  err: unknown,
  fallbackMessage = 'We could not complete your request. Please try again or contact your system administrator.'
): CategorizedError {
  if (!err) {
    return {
      category: 'unexpected',
      userMessage: fallbackMessage
    }
  }

  const raw =
    typeof err === 'string'
      ? err
      : err instanceof Error
      ? err.message
      : typeof (err as any)?.message === 'string'
      ? (err as any).message
      : typeof (err as any)?.error_description === 'string'
      ? (err as any).error_description
      : String(err)

  const lower = raw.toLowerCase()

  // 1. Authentication expiry & invalid tokens
  if (
    lower.includes('jwt expired') ||
    lower.includes('token expired') ||
    lower.includes('session expired') ||
    lower.includes('refresh_token_not_found') ||
    lower.includes('invalid refresh token') ||
    lower.includes('auth session missing') ||
    lower.includes('not logged in') ||
    lower.includes('unauthenticated') ||
    lower.includes('user not found')
  ) {
    return {
      category: 'auth_expired',
      userMessage: 'Your session has expired. Please sign in again.',
      originalMessage: raw
    }
  }

  // 2. Permission and authorization denial
  if (
    lower.includes('unauthorized') ||
    lower.includes('permission denied') ||
    lower.includes('not authorized') ||
    lower.includes('access denied') ||
    lower.includes('violates row-level security') ||
    lower.includes('rls') ||
    lower.includes('forbidden') ||
    lower.includes('403')
  ) {
    return {
      category: 'access_denied',
      userMessage: "This page or action isn't available to your account.",
      originalMessage: raw
    }
  }

  // 3. Network and connection failures
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('timeout') ||
    lower.includes('connection refused') ||
    lower.includes('abort') ||
    lower.includes('err_connection')
  ) {
    return {
      category: 'network',
      userMessage: 'We could not connect to the server. Please check your internet connection and try again.',
      originalMessage: raw
    }
  }

  // 4. Duplicate records
  if (
    lower.includes('duplicate') ||
    lower.includes('already exists') ||
    lower.includes('already recorded') ||
    lower.includes('23505') ||
    lower.includes('unique constraint')
  ) {
    return {
      category: 'duplicate',
      userMessage: 'This record already exists in the system.',
      originalMessage: raw
    }
  }

  // 5. Not found
  if (
    lower.includes('not found') ||
    lower.includes('pgrst116') ||
    lower.includes('0 rows') ||
    lower.includes('does not exist')
  ) {
    return {
      category: 'not_found',
      userMessage: 'The requested record could not be found.',
      originalMessage: raw
    }
  }

  // 6. Validation errors
  if (
    lower.includes('minimum') ||
    lower.includes('required') ||
    lower.includes('invalid format') ||
    lower.includes('invalid email') ||
    lower.includes('characters') ||
    lower.includes('must be between')
  ) {
    return {
      category: 'validation',
      userMessage: raw.length < 120 ? sanitizeTechnicalTerms(raw) : fallbackMessage,
      originalMessage: raw
    }
  }

  // 7. Generic fallback
  return {
    category: 'unexpected',
    userMessage: fallbackMessage,
    originalMessage: raw
  }
}

/**
 * Strips technical implementation tokens like table names, RPC prefixes, SQL phrases from messages.
 */
export function sanitizeTechnicalTerms(message: string): string {
  return message
    .replace(/\b(public\.)?[a-z_]+_rpcs?\b/gi, 'system operation')
    .replace(/\b(activity_sessions|attendance_records|user_profiles|user_roles|stake_units|members|audit_logs|session_visitors)\b/gi, 'records')
    .replace(/\b(supabase|postgrest|postgres|postgresql)\b/gi, 'system')
    .replace(/\b(p_[a-z_]+)\b/gi, 'parameter')
    .replace(/PGRST\d+/gi, '')
    .trim()
}

/**
 * Returns a humanized user-facing string for display in UI toasts, banners, or dialogs.
 */
export function humanizeErrorMessage(err: unknown, fallbackMessage?: string): string {
  const result = categorizeAndHumanizeError(err, fallbackMessage)
  return result.userMessage
}

/**
 * Safely logs detailed error information to developer console without leaking passwords,
 * tokens, service keys, or sensitive attendee personal data.
 */
export function safeDevLogError(context: string, err: unknown): void {
  if (typeof console === 'undefined' || !console.error) return

  let message = 'Unknown error'
  let details: any = null

  if (err instanceof Error) {
    message = err.message
    details = { name: err.name, stack: err.stack }
  } else if (typeof err === 'object' && err !== null) {
    // Redact sensitive keys
    const sanitized: Record<string, any> = {}
    for (const [key, value] of Object.entries(err)) {
      if (/password|token|secret|key|authorization/i.test(key)) {
        sanitized[key] = '[REDACTED]'
      } else {
        sanitized[key] = value
      }
    }
    details = sanitized
    message = (err as any).message || JSON.stringify(sanitized)
  } else {
    message = String(err)
  }

  console.error(`[YSA AMS DevLog] ${context}:`, message, details)
}
