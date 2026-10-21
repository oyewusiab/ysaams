/**
 * Reliable Activity Code & Canonical Attendance Link Clipboard Utility
 * Abeokuta Nigeria Obantoko Stake — YSA AMS
 *
 * Implements strict separation between session codes and public links,
 * reliable cross-browser clipboard copying with fallbacks, and honest failure reporting.
 */

const STORAGE_KEY_ACTIVE_CODES = 'ysaams_active_session_codes'

/**
 * Attempts to copy text to clipboard using the Clipboard API with legacy fallback.
 * Never claims success if copying actually failed.
 */
export async function copyTextToClipboard(text: string): Promise<{ success: boolean; error?: string }> {
  if (!text) {
    return { success: false, error: 'No text provided to copy.' }
  }

  // 1. Try modern Clipboard API
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return { success: true }
    } catch {
      // Fall through to legacy fallback
    }
  }

  // 2. Legacy fallback via temporary DOM textarea
  if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.top = '0'
      textarea.style.left = '0'
      textarea.style.width = '2em'
      textarea.style.height = '2em'
      textarea.style.padding = '0'
      textarea.style.border = 'none'
      textarea.style.outline = 'none'
      textarea.style.boxShadow = 'none'
      textarea.style.background = 'transparent'
      textarea.style.opacity = '0'
      textarea.setAttribute('readonly', '')
      textarea.setAttribute('aria-hidden', 'true')
      document.body.appendChild(textarea)

      textarea.select()
      textarea.setSelectionRange(0, textarea.value.length)

      const successful = document.execCommand('copy')
      document.body.removeChild(textarea)

      if (successful) {
        return { success: true }
      }
    } catch {
      // Fall through to honest failure
    }
  }

  return {
    success: false,
    error: 'Clipboard copy failed. Please select and copy the text manually.'
  }
}

/**
 * Copies ONLY the exact 6-character activity code.
 */
export async function copyActivityCode(
  code: string
): Promise<{ success: boolean; message: string; value: string }> {
  const cleanCode = code.trim().toUpperCase()
  const result = await copyTextToClipboard(cleanCode)

  if (result.success) {
    return {
      success: true,
      message: 'Activity code copied',
      value: cleanCode
    }
  }

  return {
    success: false,
    message: 'Could not copy code automatically. Please copy manually: ' + cleanCode,
    value: cleanCode
  }
}

/**
 * Builds canonical attendance URL and copies it.
 * Canonical public check-in URL format: `${origin}/${code}`
 */
export function getCanonicalAttendanceUrl(origin: string, code: string): string {
  const cleanOrigin = origin.replace(/\/+$/, '')
  const cleanCode = code.trim().toUpperCase()
  return `${cleanOrigin}/${cleanCode}`
}

/**
 * Copies the canonical public attendance link.
 */
export async function copyAttendanceLink(
  origin: string,
  code: string
): Promise<{ success: boolean; message: string; value: string }> {
  const url = getCanonicalAttendanceUrl(origin, code)
  const result = await copyTextToClipboard(url)

  if (result.success) {
    return {
      success: true,
      message: 'Attendance link copied',
      value: url
    }
  }

  return {
    success: false,
    message: 'Could not copy link automatically. Please copy manually: ' + url,
    value: url
  }
}

/**
 * Persistent storage of active session codes in localStorage so they remain visible
 * and copyable across page refreshes and navigation between modules.
 */
export function saveActiveSessionCode(sessionId: string, code: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_ACTIVE_CODES)
    const codes: Record<string, string> = raw ? JSON.parse(raw) : {}
    codes[sessionId] = code.trim().toUpperCase()
    window.localStorage.setItem(STORAGE_KEY_ACTIVE_CODES, JSON.stringify(codes))
  } catch {
    // Non-blocking storage fallback
  }
}

export function getActiveSessionCode(sessionId: string): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_ACTIVE_CODES)
    if (!raw) return null
    const codes: Record<string, string> = JSON.parse(raw)
    return codes[sessionId] || null
  } catch {
    return null
  }
}

export function getAllActiveSessionCodes(): Record<string, string> {
  if (typeof window === 'undefined' || !window.localStorage) return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_ACTIVE_CODES)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function removeActiveSessionCode(sessionId: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_ACTIVE_CODES)
    if (!raw) return
    const codes: Record<string, string> = JSON.parse(raw)
    delete codes[sessionId]
    window.localStorage.setItem(STORAGE_KEY_ACTIVE_CODES, JSON.stringify(codes))
  } catch {
    // Non-blocking
  }
}

export function syncActiveSessionCodes(activeSessionIds: string[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_ACTIVE_CODES)
    if (!raw) return
    const codes: Record<string, string> = JSON.parse(raw)
    let modified = false
    const activeSet = new Set(activeSessionIds)
    for (const id of Object.keys(codes)) {
      if (!activeSet.has(id)) {
        delete codes[id]
        modified = true
      }
    }
    if (modified) {
      window.localStorage.setItem(STORAGE_KEY_ACTIVE_CODES, JSON.stringify(codes))
    }
  } catch {
    // Non-blocking
  }
}
