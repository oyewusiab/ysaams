import { describe, it, expect } from 'vitest'
import { generateSessionCode } from '../services/activityService'
import { calculateAttendancePercentage } from '../services/reportService'

describe('Domain Helper Engines', () => {
  describe('Session Code Generator', () => {
    it('generates a 6-character code using an unambiguous alphabet', () => {
      const code = generateSessionCode()
      expect(code).toHaveLength(6)
      // Must match uppercase alphanumeric excluding ambiguous chars 0, O, 1, I, L
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/)
      expect(code).not.toMatch(/[01OIL]/)
    })

    it('generates distinct codes with high entropy across multiple runs', () => {
      const set = new Set<string>()
      for (let i = 0; i < 50; i++) {
        set.add(generateSessionCode())
      }
      expect(set.size).toBe(50)
    })
  })

  describe('Attendance Percentage Reconciliation', () => {
    it('returns null (N/A) when eligible opportunities are 0', () => {
      expect(calculateAttendancePercentage(0, 0)).toBeNull()
      expect(calculateAttendancePercentage(5, 0)).toBeNull()
    })

    it('calculates correct attendance percentage rounded to one decimal place', () => {
      expect(calculateAttendancePercentage(15, 20)).toBe(75.0)
      expect(calculateAttendancePercentage(1, 3)).toBe(33.3)
      expect(calculateAttendancePercentage(10, 10)).toBe(100.0)
    })
  })
})
