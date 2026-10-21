import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Filter,
  Download,
  Printer,
  Users,
  RefreshCw,
  Search,
  CheckSquare,
  Square,
  SlidersHorizontal,
  ChevronDown,
  Bookmark,
  Trash2,
  X,
  FileSpreadsheet,
  AlertCircle,
  FileText
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import {
  StakeUnit,
  ActivityDefinition,
  ActivitySession,
  MemberRecord
} from '../../types/database'
import {
  reportService,
  ReportFilterCriteria,
  ReportType,
  PeriodType,
  SortField,
  GroupByOption,
  ComprehensiveReportData,
  SavedReportPreset
} from '../../services/reportService'
import {
  exportToCsvAdvanced,
  exportToXlsxAdvanced,
  triggerPrintReport
} from '../../lib/exportUtils'
import { formatLagosDateDisplay, formatLagosTimestampDisplay, getLagosDate } from '../../lib/timezone'
import { humanizeErrorMessage } from '../../lib/errorUtils'
import { VisualAnalyticsView } from './VisualAnalyticsView'

interface ReportingWorkspaceProps {
  units: StakeUnit[]
  activities: ActivityDefinition[]
  sessions: ActivitySession[]
  members: MemberRecord[]
}

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  detailed_register: 'Detailed Attendance Register',
  monthly_register: 'Monthly Attendance Register',
  individual_history: 'Individual Attendance History',
  selected_person: 'Selected Person(s) Report',
  members_only: 'Member Attendance Report',
  visitors_only: 'Visitor & Guest Report',
  activity_session: 'Activity & Session Report',
  unit_level: 'Unit-Level Attendance Report',
  multi_unit_comparison: 'Multi-Unit Comparison Report',
  date_range: 'Date-Range Attendance Report',
  trend_analysis: 'Attendance Trend & Participation',
  stake_summary: 'Stake Executive Summary'
}

const INITIAL_CRITERIA: ReportFilterCriteria = {
  reportType: 'detailed_register',
  periodType: 'this_month',
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  selectedUnitIds: [],
  selectedActivityIds: [],
  selectedSessionIds: [],
  activityCategory: 'all',
  memberVisitorClassification: 'all',
  selectedMemberIds: [],
  nameQuery: '',
  sessionStatus: 'active_and_closed',
  sortBy: 'sessionDate',
  sortDirection: 'desc',
  groupBy: 'none'
}

export const ReportingWorkspace: React.FC<ReportingWorkspaceProps> = ({
  units,
  activities,
  sessions: _sessions,
  members
}) => {
  const { hasStakeWideReadAccess, reportUnitFilter } = useAuth()

  // Filter & Control States
  const [criteria, setCriteria] = useState<ReportFilterCriteria>(INITIAL_CRITERIA)
  const [showFilterDrawer, setShowFilterDrawer] = useState(false)
  const [showPersonSelector, setShowPersonSelector] = useState(false)
  const [personSearchQuery, setPersonSearchQuery] = useState('')

  // Report Execution & Results
  const [reportData, setReportData] = useState<ComprehensiveReportData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Presets & Saved Configurations
  const [savedPresets, setSavedPresets] = useState<SavedReportPreset[]>([])
  const [newPresetName, setNewPresetName] = useState('')
  const [showSavePresetModal, setShowSavePresetModal] = useState(false)
  const [isPresetMenuOpen, setIsPresetMenuOpen] = useState(false)

  // Pagination
  const [pageSize, setPageSize] = useState<number>(25)
  const [currentPage, setCurrentPage] = useState<number>(1)

  // Scoped Units Available to current user
  const availableUnits = useMemo(() => {
    if (hasStakeWideReadAccess || !reportUnitFilter) {
      return units
    }
    return units.filter(u => reportUnitFilter.includes(u.id))
  }, [units, hasStakeWideReadAccess, reportUnitFilter])

  // Load Presets on Mount
  useEffect(() => {
    setSavedPresets(reportService.getSavedPresets())
  }, [])

  // Execute Report Request
  const runReport = useCallback(async (customCriteria?: ReportFilterCriteria) => {
    const targetCriteria = customCriteria || criteria
    setIsLoading(true)
    setErrorMessage(null)
    setCurrentPage(1)

    try {
      // Ensure unit selection strictly respects user scope
      let effectiveUnitIds = targetCriteria.selectedUnitIds
      if (!hasStakeWideReadAccess && reportUnitFilter) {
        effectiveUnitIds = effectiveUnitIds.filter(id => reportUnitFilter.includes(id))
      }

      const cleanCriteria: ReportFilterCriteria = {
        ...targetCriteria,
        selectedUnitIds: effectiveUnitIds
      }

      const data = await reportService.getComprehensiveReport(cleanCriteria, reportUnitFilter)
      setReportData(data)
    } catch (err: any) {
      setErrorMessage(humanizeErrorMessage(err, "We couldn't load the attendance report. Please try again."))
    } finally {
      setIsLoading(false)
    }
  }, [criteria, hasStakeWideReadAccess, reportUnitFilter])

  // Auto-run when report type or period changes if no report has been generated yet
  useEffect(() => {
    runReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle Preset Save
  const handleSavePreset = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPresetName.trim()) return
    reportService.savePreset(newPresetName.trim(), criteria)
    setSavedPresets(reportService.getSavedPresets())
    setNewPresetName('')
    setShowSavePresetModal(false)
  }

  // Handle Preset Load
  const handleLoadPreset = (preset: SavedReportPreset) => {
    setIsPresetMenuOpen(false)
    // Defense-in-depth: Reapply current user scope
    let loadedUnitIds = preset.criteria.selectedUnitIds || []
    if (!hasStakeWideReadAccess && reportUnitFilter) {
      loadedUnitIds = loadedUnitIds.filter(id => reportUnitFilter.includes(id))
    }

    const sanitizedCriteria: ReportFilterCriteria = {
      ...preset.criteria,
      selectedUnitIds: loadedUnitIds
    }

    setCriteria(sanitizedCriteria)
    runReport(sanitizedCriteria)
  }

  // Handle Preset Delete
  const handleDeletePreset = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    reportService.deletePreset(id)
    setSavedPresets(reportService.getSavedPresets())
  }

  // Handle Report Type Shortcut
  const handleSelectReportType = (rt: ReportType) => {
    let updated: ReportFilterCriteria = { ...criteria, reportType: rt }
    if (rt === 'members_only') {
      updated.memberVisitorClassification = 'members_only'
    } else if (rt === 'visitors_only') {
      updated.memberVisitorClassification = 'visitors_only'
    } else if (rt === 'monthly_register') {
      updated.periodType = 'selected_month'
    } else if (rt === 'individual_history') {
      setShowPersonSelector(true)
    }
    setCriteria(updated)
    runReport(updated)
  }

  // Toggle Unit Selection
  const toggleUnitSelection = (unitId: string) => {
    const isSelected = criteria.selectedUnitIds.includes(unitId)
    const updated = isSelected
      ? criteria.selectedUnitIds.filter(id => id !== unitId)
      : [...criteria.selectedUnitIds, unitId]
    setCriteria(prev => ({ ...prev, selectedUnitIds: updated }))
  }

  // Toggle Person Selection (by stable UUID!)
  const togglePersonSelection = (memberId: string) => {
    const isSelected = criteria.selectedMemberIds.includes(memberId)
    const updated = isSelected
      ? criteria.selectedMemberIds.filter(id => id !== memberId)
      : [...criteria.selectedMemberIds, memberId]
    setCriteria(prev => ({ ...prev, selectedMemberIds: updated }))
  }

  // Filtered members for Person Selector
  const searchedMembers = useMemo(() => {
    const q = personSearchQuery.toLowerCase().trim()
    let pool = members
    if (!hasStakeWideReadAccess && reportUnitFilter) {
      pool = pool.filter(m => reportUnitFilter.includes(m.homeUnitId))
    }
    if (!q) return pool.slice(0, 50)
    return pool
      .filter(m =>
        m.fullName.toLowerCase().includes(q) ||
        (m.memberNumber && m.memberNumber.toLowerCase().includes(q)) ||
        (m.homeUnitName && m.homeUnitName.toLowerCase().includes(q))
      )
      .slice(0, 50)
  }, [members, personSearchQuery, hasStakeWideReadAccess, reportUnitFilter])

  // Sorting Handler
  const handleSort = (field: SortField) => {
    setCriteria(prev => {
      const isSame = prev.sortBy === field
      const nextDir: 'asc' | 'desc' = isSame && prev.sortDirection === 'asc' ? 'desc' : 'asc'
      const updated: ReportFilterCriteria = { ...prev, sortBy: field, sortDirection: nextDir }
      runReport(updated)
      return updated
    })
  }

  // Export metadata generator
  const getExportMetadata = () => {
    const title = REPORT_TYPE_LABELS[criteria.reportType] || 'Attendance Report'
    const period = reportService.resolveEffectiveDateRange(criteria).periodLabel
    const scopeLabel = hasStakeWideReadAccess
      ? criteria.selectedUnitIds.length > 0
        ? `Selected Units (${criteria.selectedUnitIds.length})`
        : 'Stake-Wide (All Units)'
      : availableUnits.map(u => u.unitName).join(', ')

    return {
      title,
      subtitle: 'Abeokuta Nigeria Obantoko Stake — YSA AMS',
      generatedAt: `${getLagosDate()} (Africa/Lagos)`,
      periodLabel: period,
      scopeLabel,
      totalRecords: reportData?.metrics.totalRecords || 0,
      uniqueAttendees: reportData?.metrics.uniqueAttendees || 0,
      heldSessions: reportData?.metrics.heldSessionsCount,
      avgPerSession: reportData?.metrics.avgAttendancePerSession
    }
  }

  const exportColumns = [
    { key: 'attendeeName', label: 'Attendee Full Name' },
    { key: 'attendanceType', label: 'Attendee Classification' },
    { key: 'recordedUnitName', label: 'Attended Unit (Historical)' },
    { key: 'homeUnitName', label: 'Home Unit' },
    { key: 'activityTitle', label: 'Activity' },
    { key: 'activityCategory', label: 'Category' },
    { key: 'sessionTitle', label: 'Session' },
    { key: 'sessionDate', label: 'Session Date' },
    { key: 'checkInTime', label: 'Check-In Timestamp' },
    { key: 'contactPhone', label: 'Contact Phone' }
  ]

  // Export Handlers
  const handleExportCsv = () => {
    if (!reportData || reportData.records.length === 0) return
    const meta = getExportMetadata()
    const filename = `ysa_report_${criteria.reportType}_${getLagosDate()}`
    exportToCsvAdvanced(filename, meta, exportColumns, reportData.records)
  }

  const handleExportXlsx = async () => {
    if (!reportData || reportData.records.length === 0) return
    const meta = getExportMetadata()
    const filename = `ysa_report_${criteria.reportType}_${getLagosDate()}`
    await exportToXlsxAdvanced(filename, meta, exportColumns, reportData.records)
  }

  const handlePrint = () => {
    triggerPrintReport(REPORT_TYPE_LABELS[criteria.reportType])
  }

  // Active Filter Summary Chips
  const activeFilterChips = useMemo(() => {
    const chips: { label: string; onRemove: () => void }[] = []

    if (criteria.selectedUnitIds.length > 0) {
      const names = criteria.selectedUnitIds
        .map(id => units.find(u => u.id === id)?.unitName)
        .filter(Boolean)
        .join(', ')
      chips.push({
        label: `Units: ${names}`,
        onRemove: () => setCriteria(prev => ({ ...prev, selectedUnitIds: [] }))
      })
    }

    if (criteria.selectedActivityIds.length > 0) {
      chips.push({
        label: `Activities: ${criteria.selectedActivityIds.length} selected`,
        onRemove: () => setCriteria(prev => ({ ...prev, selectedActivityIds: [] }))
      })
    }

    if (criteria.activityCategory && criteria.activityCategory !== 'all') {
      chips.push({
        label: `Category: ${criteria.activityCategory}`,
        onRemove: () => setCriteria(prev => ({ ...prev, activityCategory: 'all' }))
      })
    }

    if (criteria.memberVisitorClassification !== 'all') {
      chips.push({
        label: criteria.memberVisitorClassification === 'members_only' ? 'Members Only' : 'Visitors Only',
        onRemove: () => setCriteria(prev => ({ ...prev, memberVisitorClassification: 'all' }))
      })
    }

    if (criteria.selectedMemberIds.length > 0) {
      chips.push({
        label: `People: ${criteria.selectedMemberIds.length} selected`,
        onRemove: () => setCriteria(prev => ({ ...prev, selectedMemberIds: [] }))
      })
    }

    if (criteria.nameQuery) {
      chips.push({
        label: `Search: "${criteria.nameQuery}"`,
        onRemove: () => setCriteria(prev => ({ ...prev, nameQuery: '' }))
      })
    }

    if (criteria.sessionStatus !== 'active_and_closed') {
      chips.push({
        label: `Status: ${criteria.sessionStatus}`,
        onRemove: () => setCriteria(prev => ({ ...prev, sessionStatus: 'active_and_closed' }))
      })
    }

    return chips
  }, [criteria, units])

  // Paginated records
  const paginatedRecords = useMemo(() => {
    if (!reportData) return []
    if (pageSize === 0) return reportData.records
    const start = (currentPage - 1) * pageSize
    return reportData.records.slice(start, start + pageSize)
  }, [reportData, currentPage, pageSize])

  const totalPages = reportData ? (pageSize === 0 ? 1 : Math.ceil(reportData.records.length / pageSize)) : 1

  return (
    <div className="space-y-6">
      {/* Printable Header - Visible only when printing */}
      <div className="hidden print:block mb-6 border-b-2 border-slate-900 pb-4">
        <h1 className="text-xl font-bold text-slate-900">Abeokuta Nigeria Obantoko Stake — YSA AMS</h1>
        <h2 className="text-base font-semibold text-slate-800">{REPORT_TYPE_LABELS[criteria.reportType]}</h2>
        <div className="text-xs text-slate-600 mt-2 flex flex-wrap gap-4">
          <span>Period: <strong>{reportService.resolveEffectiveDateRange(criteria).periodLabel}</strong></span>
          <span>Scope: <strong>{hasStakeWideReadAccess ? (criteria.selectedUnitIds.length > 0 ? `Selected Units (${criteria.selectedUnitIds.length})` : 'Stake-Wide (All Units)') : availableUnits.map(u => u.unitName).join(', ')}</strong></span>
          <span>Total Records: <strong>{reportData?.metrics.totalRecords || 0}</strong></span>
          <span>Unique Attendees: <strong>{reportData?.metrics.uniqueAttendees || 0}</strong></span>
          <span>Generated: <strong>{getLagosDate()} (Africa/Lagos)</strong></span>
        </div>
      </div>

      {/* 1. Top Header: Report Title, Presets, Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800 no-print">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-lg font-bold text-white">Central Reporting Workspace</h2>
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">
              Africa/Lagos
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Filterable, sortable, reconcilable attendance registers, analytical trends and multi-format exports.
          </p>
        </div>

        {/* Presets and Global Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Saved Presets Dropdown */}
          {savedPresets.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsPresetMenuOpen(!isPresetMenuOpen)}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg text-xs font-semibold text-slate-200 flex items-center space-x-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                aria-expanded={isPresetMenuOpen}
                aria-haspopup="true"
              >
                <Bookmark className="w-3.5 h-3.5 text-amber-400" />
                <span>Saved Presets ({savedPresets.length})</span>
                <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isPresetMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {isPresetMenuOpen && (
                <div className="absolute right-0 mt-1 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-xl py-1 z-30">
                  <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800 flex items-center justify-between">
                    <span>Select Preset to Load</span>
                    <button
                      type="button"
                      onClick={() => setIsPresetMenuOpen(false)}
                      className="text-slate-400 hover:text-white"
                      aria-label="Close presets menu"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {savedPresets.map(preset => (
                    <div
                      key={preset.id}
                      onClick={() => handleLoadPreset(preset)}
                      className="px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 cursor-pointer flex items-center justify-between group/item"
                    >
                      <span className="truncate pr-2 font-medium">{preset.name}</span>
                      <button
                        type="button"
                        title="Delete Preset"
                        onClick={(e) => handleDeletePreset(preset.id, e)}
                        className="text-slate-500 hover:text-rose-400 opacity-80 sm:opacity-0 sm:group-hover/item:opacity-100 transition-opacity p-1"
                        aria-label={`Delete preset ${preset.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Save Configuration Button */}
          <button
            type="button"
            onClick={() => setShowSavePresetModal(true)}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg text-xs font-semibold text-slate-200 flex items-center space-x-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <Bookmark className="w-3.5 h-3.5 text-emerald-400" />
            <span>Save Setup</span>
          </button>

          {/* Export CSV */}
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!reportData || reportData.records.length === 0}
            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>

          {/* Export XLSX */}
          <button
            type="button"
            onClick={handleExportXlsx}
            disabled={!reportData || reportData.records.length === 0}
            className="px-3 py-1.5 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>XLSX</span>
          </button>

          {/* Print / PDF */}
          <button
            type="button"
            onClick={handlePrint}
            disabled={!reportData || reportData.records.length === 0}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center space-x-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print / PDF</span>
          </button>
        </div>
      </div>

      {/* Save Preset Modal */}
      {showSavePresetModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSavePreset}
            className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-sm w-full space-y-4 shadow-2xl"
          >
            <h4 className="text-sm font-bold text-white">Save Current Report Configuration</h4>
            <p className="text-xs text-slate-400">
              Save your active filters, period, sorting and grouping for 1-click reuse.
            </p>
            <input
              type="text"
              required
              placeholder="e.g. Obantoko Ward Monthly Socials"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowSavePresetModal(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg"
              >
                Save Preset
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 2. Report Type Selector & Period Quick Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-4 no-print">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Report Type Selector */}
          <div>
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Report Family
            </label>
            <select
              aria-label="Select Report Family"
              value={criteria.reportType}
              onChange={(e) => handleSelectReportType(e.target.value as ReportType)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-medium text-white focus:outline-none focus:border-emerald-500"
            >
              {Object.entries(REPORT_TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Period Type Selector */}
          <div>
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Reporting Period
            </label>
            <select
              aria-label="Select Reporting Period"
              value={criteria.periodType}
              onChange={(e) => {
                const pt = e.target.value as PeriodType
                setCriteria(prev => ({ ...prev, periodType: pt }))
              }}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-medium text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="this_month">This Month (Current)</option>
              <option value="previous_month">Previous Month</option>
              <option value="today">Today</option>
              <option value="this_week">This Week (Mon–Sun)</option>
              <option value="selected_month">Selected Month & Year</option>
              <option value="specific_date">Specific Single Date</option>
              <option value="custom_range">Custom Date Range</option>
              <option value="all_time">All Recorded History</option>
            </select>
          </div>

          {/* Dynamic Period Inputs (Month/Year, Date or Range) */}
          <div className="flex items-end gap-2">
            {criteria.periodType === 'selected_month' && (
              <div className="flex gap-2 w-full">
                <select
                  aria-label="Year"
                  value={criteria.year || 2026}
                  onChange={(e) => setCriteria(prev => ({ ...prev, year: Number(e.target.value) }))}
                  className="w-1/2 px-2.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                >
                  {[2025, 2026, 2027].map(yr => (
                    <option key={yr} value={yr}>{yr}</option>
                  ))}
                </select>
                <select
                  aria-label="Month"
                  value={criteria.month || 1}
                  onChange={(e) => setCriteria(prev => ({ ...prev, month: Number(e.target.value) }))}
                  className="w-1/2 px-2.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                    <option key={m} value={m}>
                      {new Date(2026, m - 1, 1).toLocaleString('en-US', { month: 'short' })}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {criteria.periodType === 'specific_date' && (
              <input
                type="date"
                aria-label="Specific Date"
                value={criteria.startDate || getLagosDate()}
                onChange={(e) => setCriteria(prev => ({ ...prev, startDate: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
              />
            )}

            {criteria.periodType === 'custom_range' && (
              <div className="flex items-center gap-1.5 w-full">
                <input
                  type="date"
                  aria-label="Start Date"
                  value={criteria.startDate || ''}
                  onChange={(e) => setCriteria(prev => ({ ...prev, startDate: e.target.value }))}
                  className="w-1/2 px-2 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                />
                <span className="text-slate-500 text-xs">to</span>
                <input
                  type="date"
                  aria-label="End Date"
                  value={criteria.endDate || ''}
                  onChange={(e) => setCriteria(prev => ({ ...prev, endDate: e.target.value }))}
                  className="w-1/2 px-2 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                />
              </div>
            )}

            {/* Refresh / Apply Button */}
            <button
              type="button"
              onClick={() => runReport()}
              disabled={isLoading}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 h-[38px] shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Apply</span>
            </button>
          </div>
        </div>

        {/* Filter Toggle and Active Chips */}
        <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFilterDrawer(!showFilterDrawer)}
              className={`px-3 py-1.5 border rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors ${
                showFilterDrawer
                  ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                  : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{showFilterDrawer ? 'Hide Filters' : 'More Filters...'}</span>
              {activeFilterChips.length > 0 && (
                <span className="px-1.5 py-0.2 bg-emerald-600 text-white text-[10px] rounded-full">
                  {activeFilterChips.length}
                </span>
              )}
            </button>

            {/* Quick Person Selector Button */}
            <button
              type="button"
              onClick={() => setShowPersonSelector(true)}
              className={`px-3 py-1.5 border rounded-lg text-xs font-semibold flex items-center space-x-1.5 ${
                criteria.selectedMemberIds.length > 0
                  ? 'bg-teal-950 border-teal-700 text-teal-300'
                  : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Users className="w-3.5 h-3.5 text-teal-400" />
              <span>
                {criteria.selectedMemberIds.length > 0
                  ? `${criteria.selectedMemberIds.length} People Selected`
                  : 'Filter by Specific People...'}
              </span>
            </button>
          </div>

          {/* Clear Filters Button */}
          {activeFilterChips.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setCriteria({ ...INITIAL_CRITERIA, reportType: criteria.reportType })
                runReport({ ...INITIAL_CRITERIA, reportType: criteria.reportType })
              }}
              className="text-xs text-rose-400 hover:text-rose-300 font-medium"
            >
              Reset All Filters
            </button>
          )}
        </div>

        {/* Active Filter Chips */}
        {activeFilterChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {activeFilterChips.map((chip, idx) => (
              <span
                key={idx}
                className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md text-[11px] bg-slate-950 border border-slate-800 text-slate-300"
              >
                <span>{chip.label}</span>
                <button
                  type="button"
                  onClick={() => {
                    chip.onRemove()
                    runReport()
                  }}
                  className="text-slate-500 hover:text-rose-400"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 3. Expandable Advanced Filter Drawer */}
      {showFilterDrawer && (
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center space-x-2">
            <Filter className="w-4 h-4 text-emerald-400" />
            <span>Multi-Dimensional Filtering</span>
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            {/* Stake Unit Filter */}
            <div className="space-y-2">
              <label className="block font-bold text-slate-300">
                Stake Unit Scope ({availableUnits.length} available)
              </label>
              <p className="text-[11px] text-slate-400">
                {hasStakeWideReadAccess
                  ? 'Select one or more wards/branches to compare or filter.'
                  : 'Restricted strictly to your authorized unit assignment.'}
              </p>
              <div className="max-h-36 overflow-y-auto space-y-1 bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                {availableUnits.map(unit => {
                  const isChecked = criteria.selectedUnitIds.includes(unit.id)
                  return (
                    <label
                      key={unit.id}
                      className="flex items-center space-x-2 cursor-pointer hover:text-white"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleUnitSelection(unit.id)}
                        className="rounded border-slate-700 bg-slate-950 text-emerald-600 focus:ring-0"
                      />
                      <span>{unit.unitName}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            {/* Activity & Category Filter */}
            <div className="space-y-2">
              <label className="block font-bold text-slate-300">Activity Category & Lifecycle</label>
              <div className="space-y-2">
                <div>
                  <span className="text-[11px] text-slate-400">Activity Category:</span>
                  <select
                    value={criteria.activityCategory || 'all'}
                    onChange={(e) => setCriteria(prev => ({ ...prev, activityCategory: e.target.value }))}
                    className="w-full mt-1 px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                  >
                    <option value="all">All Categories</option>
                    <option value="spiritual">Spiritual</option>
                    <option value="social">Social</option>
                    <option value="service">Service</option>
                    <option value="sports">Sports</option>
                    <option value="temple">Temple</option>
                    <option value="educational">Educational</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400">Session Status:</span>
                  <select
                    value={criteria.sessionStatus}
                    onChange={(e) => setCriteria(prev => ({ ...prev, sessionStatus: e.target.value as any }))}
                    className="w-full mt-1 px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
                  >
                    <option value="active_and_closed">Held Sessions (Active & Closed)</option>
                    <option value="all">All Sessions (Include Cancelled)</option>
                    <option value="active_only">Active Only</option>
                    <option value="closed_only">Closed Only</option>
                    <option value="cancelled_only">Cancelled Only</option>
                  </select>
                </div>
                {activities.length > 0 && (
                  <div>
                    <span className="text-[11px] text-slate-400">Specific Activity:</span>
                    <div className="max-h-24 overflow-y-auto space-y-1 bg-slate-900/60 p-1.5 rounded-lg border border-slate-800 mt-1">
                      {activities.map(act => (
                        <label key={act.id} className="flex items-center space-x-1.5 cursor-pointer hover:text-white">
                          <input
                            type="checkbox"
                            checked={criteria.selectedActivityIds.includes(act.id)}
                            onChange={() => {
                              const isChecked = criteria.selectedActivityIds.includes(act.id)
                              const updated = isChecked
                                ? criteria.selectedActivityIds.filter(id => id !== act.id)
                                : [...criteria.selectedActivityIds, act.id]
                              setCriteria(prev => ({ ...prev, selectedActivityIds: updated }))
                            }}
                            className="rounded border-slate-700 bg-slate-950 text-emerald-600 focus:ring-0 text-[10px]"
                          />
                          <span className="truncate text-[11px]">{act.title}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Member vs Visitor Classification */}
            <div className="space-y-2">
              <label className="block font-bold text-slate-300">Cohort Classification</label>
              <p className="text-[11px] text-slate-400">Filter member check-ins vs visitors & guests.</p>
              <div className="space-y-1.5 pt-1">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="radio"
                    name="classification"
                    value="all"
                    checked={criteria.memberVisitorClassification === 'all'}
                    onChange={() => setCriteria(prev => ({ ...prev, memberVisitorClassification: 'all' }))}
                    className="text-emerald-600 focus:ring-0"
                  />
                  <span>All Attendance (Combined)</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="radio"
                    name="classification"
                    value="members_only"
                    checked={criteria.memberVisitorClassification === 'members_only'}
                    onChange={() => setCriteria(prev => ({ ...prev, memberVisitorClassification: 'members_only' }))}
                    className="text-emerald-600 focus:ring-0"
                  />
                  <span>Church Members Only</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="radio"
                    name="classification"
                    value="visitors_only"
                    checked={criteria.memberVisitorClassification === 'visitors_only'}
                    onChange={() => setCriteria(prev => ({ ...prev, memberVisitorClassification: 'visitors_only' }))}
                    className="text-emerald-600 focus:ring-0"
                  />
                  <span>Visitors & Friends Only</span>
                </label>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => runReport()}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold"
            >
              Apply Filter Selection
            </button>
          </div>
        </div>
      )}

      {/* 4. Multi-Person Disambiguated Selector Modal */}
      {showPersonSelector && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-lg w-full space-y-4 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div>
                <h4 className="text-sm font-bold text-white">Select Specific Attendees</h4>
                <p className="text-xs text-slate-400">
                  Select one or multiple individuals. People sharing identical names are disambiguated by unit and record ID.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPersonSelector(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search member name or number..."
                value={personSearchQuery}
                onChange={(e) => setPersonSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-500"
              />
            </div>

            {/* Selection List */}
            <div className="overflow-y-auto flex-1 space-y-1.5 border border-slate-800 rounded-lg p-2 bg-slate-950">
              {searchedMembers.map(member => {
                const isChecked = criteria.selectedMemberIds.includes(member.id)
                return (
                  <div
                    key={member.id}
                    onClick={() => togglePersonSelection(member.id)}
                    className={`p-2 rounded-lg cursor-pointer flex items-center justify-between text-xs transition-colors ${
                      isChecked
                        ? 'bg-teal-950/80 border border-teal-800 text-teal-200'
                        : 'hover:bg-slate-900 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      {isChecked ? (
                        <CheckSquare className="w-4 h-4 text-teal-400 shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-600 shrink-0" />
                      )}
                      <div>
                        <div className="font-semibold text-white">{member.fullName}</div>
                        <div className="text-[11px] text-slate-400">
                          {member.homeUnitName || 'Unit'}
                          {member.memberNumber && ` • #${member.memberNumber}`}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500">ID: {member.id.substring(0, 8)}</span>
                  </div>
                )
              })}
              {searchedMembers.length === 0 && (
                <div className="p-6 text-center text-xs text-slate-500">No matching members found.</div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <span className="text-xs text-slate-400">
                {criteria.selectedMemberIds.length} attendee{criteria.selectedMemberIds.length === 1 ? '' : 's'} selected
              </span>
              <div className="space-x-2">
                <button
                  type="button"
                  onClick={() => setCriteria(prev => ({ ...prev, selectedMemberIds: [] }))}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg"
                >
                  Clear Selection
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowPersonSelector(false)
                    runReport()
                  }}
                  className="px-4 py-1.5 bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold rounded-lg"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Notice */}
      {errorMessage && (
        <div className="p-4 bg-rose-950/80 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 5. Visual Analytics & KPI Cards */}
      {reportData && (
        <VisualAnalyticsView
          charts={reportData.charts}
          metrics={reportData.metrics}
          insights={reportData.insights}
          onSelectUnit={(unitId) => {
            setCriteria(prev => ({ ...prev, selectedUnitIds: [unitId] }))
            runReport({ ...criteria, selectedUnitIds: [unitId] })
          }}
          onSelectActivity={(actId) => {
            setCriteria(prev => ({ ...prev, selectedActivityIds: [actId] }))
            runReport({ ...criteria, selectedActivityIds: [actId] })
          }}
        />
      )}

      {/* 6. Monthly Register Table (If Monthly Register Selected) */}
      {criteria.reportType === 'monthly_register' && reportData?.unitMonthlyStats && (
        <div className="space-y-4 pt-4 border-t border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">Monthly Attendance Register</h3>
              <p className="text-xs text-slate-400">
                Calculates percentages against actual activity opportunities in period.
              </p>
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-xs text-left text-slate-300">
              <thead className="bg-slate-900 border-b border-slate-800 uppercase text-[10px] text-slate-400">
                <tr>
                  <th className="px-4 py-3">Stake Unit</th>
                  <th className="px-4 py-3">Active Census</th>
                  <th className="px-4 py-3">Total Check-Ins</th>
                  <th className="px-4 py-3">Eligible Opps</th>
                  <th className="px-4 py-3">Attendance %</th>
                </tr>
              </thead>
              <tbody>
                {reportData.unitMonthlyStats.map(stat => (
                  <tr key={stat.unitId} className="border-b border-slate-900 hover:bg-slate-900/50">
                    <td className="px-4 py-3 font-semibold text-white">{stat.unitName}</td>
                    <td className="px-4 py-3">{stat.totalMembers}</td>
                    <td className="px-4 py-3">{stat.totalAttended}</td>
                    <td className="px-4 py-3">{stat.totalOpportunities}</td>
                    <td className="px-4 py-3 font-bold text-emerald-400">
                      {stat.percentage !== null ? `${stat.percentage}%` : 'N/A (No events)'}
                    </td>
                  </tr>
                ))}
                {reportData.unitMonthlyStats.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                      No attendance data in selected period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 7. Detailed Attendance Records Table & Grouping View */}
      <div className="space-y-4 pt-4 border-t border-slate-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <FileText className="w-4 h-4 text-emerald-400" />
              <span>Detailed Attendance Records</span>
              {reportData && (
                <span className="text-xs font-normal text-slate-400">
                  ({reportData.records.length} matching event{reportData.records.length === 1 ? '' : 's'})
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-400">Individual attendance events with verified timestamps and unit attribution.</p>
          </div>

          {/* Grouping and Search Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Quick in-table search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
              <input
                type="text"
                placeholder="Search within report..."
                value={criteria.nameQuery}
                onChange={(e) => {
                  setCriteria(prev => ({ ...prev, nameQuery: e.target.value }))
                  runReport({ ...criteria, nameQuery: e.target.value })
                }}
                className="pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 w-44"
              />
            </div>

            {/* Group By Selector */}
            <select
              aria-label="Group Records By"
              value={criteria.groupBy}
              onChange={(e) => {
                const g = e.target.value as GroupByOption
                setCriteria(prev => ({ ...prev, groupBy: g }))
                runReport({ ...criteria, groupBy: g })
              }}
              className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
            >
              <option value="none">Grouping: None (Flat List)</option>
              <option value="by_person">Group by Attendee</option>
              <option value="by_activity">Group by Activity</option>
              <option value="by_unit">Group by Unit</option>
              <option value="by_month">Group by Month</option>
              <option value="by_type">Group by Member / Visitor</option>
            </select>

            {/* Page Size Selector */}
            <select
              aria-label="Records Per Page"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setCurrentPage(1)
              }}
              className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
            >
              <option value={10}>10 / page</option>
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
              <option value={0}>Show All</option>
            </select>
          </div>
        </div>

        {/* Flat Records Table (when groupBy === 'none') */}
        {criteria.groupBy === 'none' ? (
          <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left text-slate-300">
                <thead className="bg-slate-900 border-b border-slate-800 uppercase text-[10px] text-slate-400">
                  <tr>
                    <th
                      className="px-4 py-3 cursor-pointer hover:text-white"
                      onClick={() => handleSort('attendeeName')}
                    >
                      <div className="flex items-center space-x-1">
                        <span>Attendee Name</span>
                        {criteria.sortBy === 'attendeeName' && (
                          <span>{criteria.sortDirection === 'asc' ? '▲' : '▼'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 cursor-pointer hover:text-white"
                      onClick={() => handleSort('attendanceType')}
                    >
                      <div className="flex items-center space-x-1">
                        <span>Classification</span>
                        {criteria.sortBy === 'attendanceType' && (
                          <span>{criteria.sortDirection === 'asc' ? '▲' : '▼'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 cursor-pointer hover:text-white"
                      onClick={() => handleSort('recordedUnitName')}
                    >
                      <div className="flex items-center space-x-1">
                        <span>Attended Unit</span>
                        {criteria.sortBy === 'recordedUnitName' && (
                          <span>{criteria.sortDirection === 'asc' ? '▲' : '▼'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 cursor-pointer hover:text-white"
                      onClick={() => handleSort('activityTitle')}
                    >
                      <div className="flex items-center space-x-1">
                        <span>Activity</span>
                        {criteria.sortBy === 'activityTitle' && (
                          <span>{criteria.sortDirection === 'asc' ? '▲' : '▼'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 cursor-pointer hover:text-white"
                      onClick={() => handleSort('sessionDate')}
                    >
                      <div className="flex items-center space-x-1">
                        <span>Session Date</span>
                        {criteria.sortBy === 'sessionDate' && (
                          <span>{criteria.sortDirection === 'asc' ? '▲' : '▼'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 cursor-pointer hover:text-white"
                      onClick={() => handleSort('checkInTime')}
                    >
                      <div className="flex items-center space-x-1">
                        <span>Check-In Time</span>
                        {criteria.sortBy === 'checkInTime' && (
                          <span>{criteria.sortDirection === 'asc' ? '▲' : '▼'}</span>
                        )}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRecords.map(record => (
                    <tr key={record.id} className="border-b border-slate-900 hover:bg-slate-900/50">
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-white">{record.attendeeName}</div>
                        {record.memberNumber && (
                          <div className="text-[10px] text-slate-500">#{record.memberNumber}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {record.attendanceType === 'member' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-950 text-indigo-300 border border-indigo-800">
                            Member
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-teal-950 text-teal-300 border border-teal-800">
                            Visitor
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-slate-200">{record.recordedUnitName}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-white">{record.activityTitle}</div>
                        <div className="text-[10px] text-slate-400 capitalize">{record.activityCategory}</div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-300">{formatLagosDateDisplay(record.sessionDate)}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-slate-400">
                        {formatLagosTimestampDisplay(record.checkInTime)}
                      </td>
                    </tr>
                  ))}
                  {paginatedRecords.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        {isLoading ? 'Loading records...' : 'No attendance records matching the current filter criteria.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="px-4 py-3 bg-slate-900/50 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 no-print">
                <div>
                  Showing {Math.min(1, reportData?.records.length || 0)} - {Math.min(currentPage * pageSize, reportData?.records.length || 0)} of {reportData?.records.length} records
                </div>
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white rounded"
                  >
                    Previous
                  </button>
                  <span className="px-2 text-slate-300">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white rounded"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Grouped Results Display */
          <div className="space-y-4">
            {reportData?.groupedRecords.map(group => (
              <div key={group.groupKey} className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-white text-sm">{group.groupTitle}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="px-2.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-semibold text-[11px]">
                      {group.recordsCount} check-in{group.recordsCount === 1 ? '' : 's'}
                    </span>
                    <span className="px-2.5 py-0.5 rounded bg-teal-950 text-teal-400 border border-teal-800 font-semibold text-[11px]">
                      {group.uniqueAttendeesCount} unique attendee{group.uniqueAttendeesCount === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>

                <table className="w-full text-xs text-left text-slate-300">
                  <thead className="bg-slate-900/40 uppercase text-[10px] text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="px-4 py-2.5">Attendee</th>
                      <th className="px-4 py-2.5">Type</th>
                      <th className="px-4 py-2.5">Unit</th>
                      <th className="px-4 py-2.5">Activity / Session</th>
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-4 py-2.5">Check-In Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.records.map(r => (
                      <tr key={r.id} className="border-b border-slate-900 hover:bg-slate-900/40">
                        <td className="px-4 py-2 font-medium text-white">{r.attendeeName}</td>
                        <td className="px-4 py-2">
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] ${
                              r.attendanceType === 'member'
                                ? 'bg-indigo-950 text-indigo-300'
                                : 'bg-teal-950 text-teal-300'
                            }`}
                          >
                            {r.attendanceType}
                          </span>
                        </td>
                        <td className="px-4 py-2">{r.recordedUnitName}</td>
                        <td className="px-4 py-2">{r.activityTitle}</td>
                        <td className="px-4 py-2">{formatLagosDateDisplay(r.sessionDate)}</td>
                        <td className="px-4 py-2 font-mono text-[11px]">
                          {formatLagosTimestampDisplay(r.checkInTime)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {reportData?.groupedRecords.length === 0 && (
              <div className="p-8 text-center text-xs text-slate-500 bg-slate-950 border border-slate-800 rounded-xl">
                No matching records for grouping.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
