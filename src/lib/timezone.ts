/**
 * Timezone utilities for YSA Attendance Management System.
 * Abeokuta Nigeria Obantoko Stake
 * Strict adherence to 'Africa/Lagos' (UTC+1, WAT - West Africa Time).
 */

export const LAGOS_TIMEZONE = 'Africa/Lagos'

/**
 * Returns the current date in YYYY-MM-DD format in Africa/Lagos timezone.
 */
export function getLagosDate(date: Date | string | number = new Date()): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: LAGOS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  return formatter.format(d)
}

/**
 * Returns breakdown of year, month (1-12), day, hour, minute for a date in Africa/Lagos.
 */
export function getLagosParts(date: Date | string | number = new Date()): {
  year: number
  month: number
  day: number
  dayOfWeek: number // 0 = Sun, 1 = Mon, ..., 6 = Sat
} {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: LAGOS_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short'
  })
  const parts = formatter.formatToParts(d)
  let year = 2026
  let month = 1
  let day = 1
  let weekdayStr = 'Sun'

  for (const part of parts) {
    if (part.type === 'year') year = parseInt(part.value, 10)
    if (part.type === 'month') month = parseInt(part.value, 10)
    if (part.type === 'day') day = parseInt(part.value, 10)
    if (part.type === 'weekday') weekdayStr = part.value
  }

  const daysMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  }
  const dayOfWeek = daysMap[weekdayStr] ?? 0

  return { year, month, day, dayOfWeek }
}

/**
 * Returns { startDate, endDate } for today in Lagos.
 */
export function getTodayRangeLagos(): { startDate: string; endDate: string } {
  const today = getLagosDate()
  return { startDate: today, endDate: today }
}

/**
 * Returns { startDate, endDate } for the current calendar week (Monday through Sunday) in Lagos.
 */
export function getThisWeekRangeLagos(referenceDate: Date = new Date()): { startDate: string; endDate: string } {
  const { year, month, day, dayOfWeek } = getLagosParts(referenceDate)
  // Distance from Monday (if dayOfWeek is 0 (Sun), distance is 6. If Mon (1), distance is 0)
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  
  // Construct date at UTC noon to avoid boundary shifting
  const targetDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  const mondayDate = new Date(targetDate)
  mondayDate.setUTCDate(mondayDate.getUTCDate() - diffToMonday)

  const sundayDate = new Date(mondayDate)
  sundayDate.setUTCDate(sundayDate.getUTCDate() + 6)

  return {
    startDate: getLagosDate(mondayDate),
    endDate: getLagosDate(sundayDate)
  }
}

/**
 * Returns { startDate, endDate } for this month in Lagos.
 */
export function getThisMonthRangeLagos(referenceDate: Date = new Date()): { startDate: string; endDate: string } {
  const { year, month } = getLagosParts(referenceDate)
  return getSelectedMonthRangeLagos(year, month)
}

/**
 * Returns { startDate, endDate } for the previous month in Lagos.
 */
export function getPreviousMonthRangeLagos(referenceDate: Date = new Date()): { startDate: string; endDate: string } {
  const { year, month } = getLagosParts(referenceDate)
  let prevYear = year
  let prevMonth = month - 1
  if (prevMonth < 1) {
    prevMonth = 12
    prevYear -= 1
  }
  return getSelectedMonthRangeLagos(prevYear, prevMonth)
}

/**
 * Returns { startDate, endDate } for a specific year and month (1-12) in Lagos.
 */
export function getSelectedMonthRangeLagos(year: number, month: number): { startDate: string; endDate: string } {
  const safeMonth = Math.min(Math.max(1, Math.floor(month)), 12)
  const lastDay = new Date(year, safeMonth, 0).getDate()
  const monthStr = String(safeMonth).padStart(2, '0')
  return {
    startDate: `${year}-${monthStr}-01`,
    endDate: `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`
  }
}

/**
 * Computes an equal-duration previous comparable period for trend calculation.
 * If current period is Jan 1 - Jan 31 (31 days), previous period is Dec 1 - Dec 31 (31 days).
 */
export function getComparablePreviousPeriod(startDate: string, endDate: string): { startDate: string; endDate: string } {
  const start = new Date(`${startDate}T12:00:00Z`)
  const end = new Date(`${endDate}T12:00:00Z`)
  const durationMs = end.getTime() - start.getTime()
  const durationDays = Math.max(1, Math.round(durationMs / (1000 * 60 * 60 * 24)) + 1)

  const prevEnd = new Date(start)
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1)

  const prevStart = new Date(prevEnd)
  prevStart.setUTCDate(prevStart.getUTCDate() - (durationDays - 1))

  return {
    startDate: getLagosDate(prevStart),
    endDate: getLagosDate(prevEnd)
  }
}

/**
 * Human-readable display format in Lagos timezone.
 */
export function formatLagosDateDisplay(dateStr: string): string {
  if (!dateStr) return ''
  const parts = dateStr.split('-')
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10)
    const m = parseInt(parts[1], 10)
    const d = parseInt(parts[2], 10)
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: LAGOS_TIMEZONE,
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }).format(dt)
  }
  return dateStr
}

/**
 * Format timestamp into 12-hour local Lagos time (e.g., "4:15 PM").
 */
export function formatLagosTimestampDisplay(isoString: string): string {
  if (!isoString) return ''
  const d = new Date(isoString)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: LAGOS_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(d)
}
