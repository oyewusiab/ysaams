/**
 * Attendance calculation and reporting service.
 */

export function calculateAttendancePercentage(
  attended: number,
  eligibleOpportunities: number
): number | null {
  if (eligibleOpportunities <= 0) {
    return null // N/A: No activities held, avoid false 0% or division by zero
  }
  return Math.round((attended / eligibleOpportunities) * 1000) / 10
}

export const reportService = {
  calculateAttendancePercentage,

  async getMonthlyRegister(_year: number, _month: number) {
    return []
  },

  async getStakeSummary() {
    return []
  }
}
