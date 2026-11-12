import React, { useState, useEffect, useMemo } from 'react'
import {
  Building2,
  Compass,
  Download,
  ExternalLink,
  Copy,
  Check,
  AlertCircle,
  CheckCircle2,
  Search,
  Sparkles,
  Users,
  RefreshCw,
  SlidersHorizontal,
  FileSpreadsheet,
  FileText,
  BarChart3,
  MessageSquare,
  Lock,
  Unlock,
  HeartHandshake
} from 'lucide-react'
import { gatheringPlaceService } from '../../services/gatheringPlaceService'
import {
  GatheringPlaceAssessment,
  GatheringPlaceResponse,
  GatheringPlaceAnalytics,
  AssessmentStatus,
  WARD_BRANCH_OPTIONS,
  CURRENT_STATUS_OPTIONS,
  EDUCATION_LEVEL_OPTIONS
} from '../../types/gatheringPlace'

interface GatheringPlaceLeadershipViewProps {
  onNavigateSubpath?: (subpath: any) => void
}

type ActiveTab = 'overview' | 'analytics' | 'responses' | 'feedback'

export const GatheringPlaceLeadershipView: React.FC<GatheringPlaceLeadershipViewProps> = () => {

  const [assessment, setAssessment] = useState<GatheringPlaceAssessment | null>(null)
  const [allResponses, setAllResponses] = useState<GatheringPlaceResponse[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Sub-Navigation Tabs
  const [activeTab, setActiveTab] = useState<ActiveTab>('analytics')

  // Copy Link State
  const [copiedLink, setCopiedLink] = useState(false)

  // Filters State
  const [wardFilter, setWardFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [educationFilter, setEducationFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')

  // Hard Skills Ranking View Mode: Overall vs Choice-by-Choice
  const [hardSkillRankMode, setHardSkillRankMode] = useState<'overall' | 'choices'>('overall')

  // Status Change Confirmation Modal
  const [statusModalOpen, setStatusModalOpen] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<AssessmentStatus | null>(null)
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false)

  const loadData = async () => {
    setIsLoading(true)
    setErrorMsg(null)
    try {
      const active = await gatheringPlaceService.getActiveAssessment()
      setAssessment(active)

      if (active) {
        const responses = await gatheringPlaceService.getResponses(active.id)
        setAllResponses(responses)
      }
    } catch (err: any) {
      console.error('Failed to load Gathering Place assessment data', err)
      setErrorMsg(err.message || 'Unable to retrieve assessment records.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Filtered Responses
  const filteredResponses = useMemo(() => {
    return allResponses.filter((r) => {
      if (wardFilter !== 'all' && r.wardBranch !== wardFilter) return false
      if (statusFilter !== 'all') {
        if (statusFilter === 'Other') {
          if (!r.currentStatus.startsWith('Other')) return false
        } else if (r.currentStatus !== statusFilter) {
          return false
        }
      }
      if (educationFilter !== 'all') {
        if (educationFilter === 'Other') {
          if (!r.educationLevel.startsWith('Other')) return false
        } else if (r.educationLevel !== educationFilter) {
          return false
        }
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matches =
          r.wardBranch.toLowerCase().includes(q) ||
          r.currentStatus.toLowerCase().includes(q) ||
          r.educationLevel.toLowerCase().includes(q) ||
          r.hardSkillFirstChoice.toLowerCase().includes(q) ||
          r.hardSkillSecondChoice.toLowerCase().includes(q) ||
          r.hardSkillThirdChoice.toLowerCase().includes(q) ||
          (r.softSkills || []).some((s) => s.toLowerCase().includes(q)) ||
          (r.desiredOutcomes || []).some((g) => g.toLowerCase().includes(q)) ||
          (r.desired56MonthOutcome && r.desired56MonthOutcome.toLowerCase().includes(q)) ||
          (r.additionalSkillsSuggestions && r.additionalSkillsSuggestions.toLowerCase().includes(q)) ||
          (r.gatheringPlaceSuggestions && r.gatheringPlaceSuggestions.toLowerCase().includes(q))
        if (!matches) return false
      }
      return true
    })
  }, [allResponses, wardFilter, statusFilter, educationFilter, searchQuery])

  // Computed Analytics from Filtered Responses
  const analytics: GatheringPlaceAnalytics = useMemo(() => {
    return gatheringPlaceService.computeAnalytics(filteredResponses)
  }, [filteredResponses])

  // Public Survey Link
  const publicSurveyUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/gathering-place/survey`
    : '/gathering-place/survey'

  const copyPublicLink = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(publicSurveyUrl)
      }
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2500)
    } catch (err) {
      console.error('Failed to copy', err)
    }
  }

  const handleStatusChange = async (newStatus: AssessmentStatus) => {
    if (!assessment) return
    setIsUpdatingStatus(true)
    setErrorMsg(null)
    try {
      await gatheringPlaceService.updateAssessmentStatus(assessment.id, newStatus)
      setAssessment((prev) => (prev ? { ...prev, status: newStatus } : null))
      setSuccessMsg(`Assessment status successfully updated to "${newStatus}".`)
      setStatusModalOpen(false)
      setTimeout(() => setSuccessMsg(null), 4000)
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update assessment status.')
    } finally {
      setIsUpdatingStatus(false)
    }
  }

  const handleExportCsv = () => {
    try {
      gatheringPlaceService.exportToCsv(
        filteredResponses,
        `ysa_gathering_place_assessment_${assessment?.assessmentYear || 2027}`
      )
      setSuccessMsg('CSV spreadsheet exported successfully.')
      setTimeout(() => setSuccessMsg(null), 3000)
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to export CSV.')
    }
  }

  const handleExportXlsx = async () => {
    try {
      await gatheringPlaceService.exportToXlsx(
        filteredResponses,
        `ysa_gathering_place_assessment_${assessment?.assessmentYear || 2027}`
      )
      setSuccessMsg('Excel workbook exported successfully.')
      setTimeout(() => setSuccessMsg(null), 3000)
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to export Excel file.')
    }
  }

  const lastSubmission = allResponses.length > 0 ? allResponses[0].submittedAt : null

  return (
    <div className="space-y-6">
      {/* Top Banner / Assessment Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center space-x-2 text-xs font-mono uppercase tracking-wider text-emerald-400 font-semibold mb-1">
              <Compass className="w-4 h-4" />
              <span>Abeokuta Nigeria Obantoko Stake • 2027 Planning</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
              YSA Gathering Place Needs Assessment
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Skills Acquisition • Self-Reliance • Personal Development
            </p>
          </div>

          {/* Quick Actions & Status */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Status Badge */}
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold font-mono uppercase tracking-wider border ${
                assessment?.status === 'active'
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700'
                  : assessment?.status === 'closed'
                  ? 'bg-amber-950/80 text-amber-300 border-amber-700'
                  : 'bg-slate-800 text-slate-300 border-slate-700'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full mr-2 ${
                  assessment?.status === 'active'
                    ? 'bg-emerald-400 animate-pulse'
                    : assessment?.status === 'closed'
                    ? 'bg-amber-400'
                    : 'bg-slate-400'
                }`}
              />
              {assessment?.status || 'Active'}
            </span>

            {/* Status Change Toggle */}
            <button
              onClick={() => {
                setPendingStatus(assessment?.status === 'active' ? 'closed' : 'active')
                setStatusModalOpen(true)
              }}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5"
            >
              {assessment?.status === 'active' ? (
                <>
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  <span>Close Survey</span>
                </>
              ) : (
                <>
                  <Unlock className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Reopen Survey</span>
                </>
              )}
            </button>

            {/* Copy Public Survey Link */}
            <button
              onClick={copyPublicLink}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5 shadow-sm"
              title="Copy shareable public survey link"
            >
              {copiedLink ? (
                <>
                  <Check className="w-3.5 h-3.5 text-white" />
                  <span>Link Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Survey Link</span>
                </>
              )}
            </button>

            {/* Open Survey in New Tab */}
            <a
              href="/gathering-place/survey"
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 rounded-xl transition cursor-pointer"
              title="Open public survey in new tab"
            >
              <ExternalLink className="w-4 h-4" />
            </a>

            {/* Refresh */}
            <button
              onClick={loadData}
              disabled={isLoading}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 rounded-xl transition cursor-pointer disabled:opacity-50"
              title="Refresh response records"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Feedback Messages */}
        {errorMsg && (
          <div className="mt-4 p-3.5 rounded-xl bg-red-950/70 border border-red-800/80 text-red-200 text-xs flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-200 font-bold ml-2">
              ✕
            </button>
          </div>
        )}

        {successMsg && (
          <div className="mt-4 p-3.5 rounded-xl bg-emerald-950/70 border border-emerald-800/80 text-emerald-200 text-xs flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
            <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-emerald-200 font-bold ml-2">
              ✕
            </button>
          </div>
        )}

        {/* Overview Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5">
            <span className="text-[11px] uppercase tracking-wider text-slate-400 block font-medium">
              Total Submissions
            </span>
            <div className="flex items-baseline space-x-2 mt-1">
              <span className="text-2xl font-extrabold text-white">{allResponses.length}</span>
              <span className="text-xs text-slate-400">responses</span>
            </div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5">
            <span className="text-[11px] uppercase tracking-wider text-slate-400 block font-medium">
              Wards / Branches
            </span>
            <div className="flex items-baseline space-x-2 mt-1">
              <span className="text-2xl font-extrabold text-emerald-400">
                {analytics.participatingUnitsCount}
              </span>
              <span className="text-xs text-slate-400">/ 8 units</span>
            </div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5">
            <span className="text-[11px] uppercase tracking-wider text-slate-400 block font-medium">
              Assessment Year
            </span>
            <div className="flex items-baseline space-x-2 mt-1">
              <span className="text-2xl font-extrabold text-white">2027</span>
              <span className="text-xs text-slate-400">Launch Target</span>
            </div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5">
            <span className="text-[11px] uppercase tracking-wider text-slate-400 block font-medium">
              Last Response
            </span>
            <div className="text-xs text-slate-300 font-medium mt-1 truncate">
              {lastSubmission ? new Date(lastSubmission).toLocaleDateString() : 'None yet'}
            </div>
            <span className="text-[10px] text-slate-500">
              {lastSubmission ? new Date(lastSubmission).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Awaiting data'}
            </span>
          </div>
        </div>

        {/* Tab Controls & Export Bar */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mt-6 pt-6 border-t border-slate-800">
          <div className="flex items-center space-x-2 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
            <button
              onClick={() => setActiveTab('analytics')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center space-x-2 whitespace-nowrap ${
                activeTab === 'analytics'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-750'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Analytics Dashboard</span>
            </button>

            <button
              onClick={() => setActiveTab('responses')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center space-x-2 whitespace-nowrap ${
                activeTab === 'responses'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-750'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Responses ({filteredResponses.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('feedback')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center space-x-2 whitespace-nowrap ${
                activeTab === 'feedback'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-750'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Open-Ended Feedback</span>
            </button>

            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center space-x-2 whitespace-nowrap ${
                activeTab === 'overview'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-750'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Needs Assessment Overview</span>
            </button>
          </div>

          {/* Export Dropdown / Buttons */}
          <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
            <button
              onClick={handleExportCsv}
              disabled={filteredResponses.length === 0}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5"
              title="Export filtered records to CSV"
            >
              <FileText className="w-3.5 h-3.5 text-emerald-400" />
              <span>Export CSV</span>
            </button>

            <button
              onClick={handleExportXlsx}
              disabled={filteredResponses.length === 0}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5"
              title="Export filtered records to Excel .xlsx workbook"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-teal-400" />
              <span>Export Excel</span>
            </button>
          </div>
        </div>

        {/* Global Filter Bar (Affects Analytics, Responses, and Feedback) */}
        <div className="mt-6 pt-6 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Ward / Branch Filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Filter by Ward / Branch
            </label>
            <select
              value={wardFilter}
              onChange={(e) => setWardFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All Wards & Branches (Stake Wide)</option>
              {WARD_BRANCH_OPTIONS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>

          {/* Current Status Filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Filter by Current Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All Statuses</option>
              {CURRENT_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Education Filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Filter by Education
            </label>
            <select
              value={educationFilter}
              onChange={(e) => setEducationFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All Education Levels</option>
              {EDUCATION_LEVEL_OPTIONS.map((edu) => (
                <option key={edu} value={edu}>
                  {edu}
                </option>
              ))}
            </select>
          </div>

          {/* Search Query */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Search Feedback / Skills
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search keywords..."
                className="w-full pl-8 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            </div>
          </div>
        </div>
      </div>

      {/* TAB 1: COMPREHENSIVE ANALYTICS DASHBOARD */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          {/* 9.1 KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 sm:gap-4">
            {/* Total */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Total</span>
              <div className="my-1">
                <span className="text-2xl font-extrabold text-white">{analytics.totalResponses}</span>
              </div>
              <span className="text-[10px] text-slate-500">survey responses</span>
            </div>

            {/* Units */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Units</span>
              <div className="my-1">
                <span className="text-2xl font-extrabold text-emerald-400">
                  {analytics.participatingUnitsCount}
                </span>
                <span className="text-xs text-slate-500 ml-1">/ 8</span>
              </div>
              <span className="text-[10px] text-slate-500">participating</span>
            </div>

            {/* Top Hard Skill */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between col-span-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400 flex items-center">
                <Sparkles className="w-3 h-3 text-emerald-400 mr-1" />
                #1 Preferred Hard Skill
              </span>
              <div className="my-1">
                <span className="text-sm sm:text-base font-bold text-white line-clamp-1" title={analytics.mostPreferredHardSkill}>
                  {analytics.mostPreferredHardSkill}
                </span>
              </div>
              <span className="text-[10px] text-emerald-400 font-mono">Top ranked demand</span>
            </div>

            {/* Top Soft Skill */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between col-span-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400 flex items-center">
                <HeartHandshake className="w-3 h-3 text-teal-400 mr-1" />
                #1 Soft Skill
              </span>
              <div className="my-1">
                <span className="text-sm sm:text-base font-bold text-white line-clamp-1" title={analytics.mostPreferredSoftSkill}>
                  {analytics.mostPreferredSoftSkill}
                </span>
              </div>
              <span className="text-[10px] text-teal-400 font-mono">Most requested</span>
            </div>

            {/* Top Day */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Best Day</span>
              <div className="my-1">
                <span className="text-base font-bold text-indigo-400">{analytics.mostPreferredDay}</span>
              </div>
              <span className="text-[10px] text-slate-500">{analytics.mostPreferredTimePeriod}</span>
            </div>
          </div>

          {/* 9.2 Hard Skills Analytics */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-4 mb-6 border-b border-slate-800 gap-3">
              <div>
                <span className="text-xs font-mono font-semibold text-emerald-400 uppercase tracking-wider">
                  Curriculum Demand Analysis
                </span>
                <h3 className="text-lg font-bold text-white mt-0.5">
                  Hard Skills Demand & Ranked Preferences
                </h3>
                <p className="text-xs text-slate-400">
                  Each respondent selected 3 distinct skills in priority order (1st, 2nd, and 3rd choices).
                </p>
              </div>

              <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                <button
                  onClick={() => setHardSkillRankMode('overall')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                    hardSkillRankMode === 'overall'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Overall Demand
                </button>
                <button
                  onClick={() => setHardSkillRankMode('choices')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                    hardSkillRankMode === 'choices'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  1st / 2nd / 3rd Breakdown
                </button>
              </div>
            </div>

            {analytics.hardSkillsRanked.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">No skill response data available yet.</p>
            ) : (
              <div className="space-y-3.5">
                {analytics.hardSkillsRanked.slice(0, 12).map((item, idx) => {
                  const maxCount = Math.max(1, analytics.hardSkillsRanked[0]?.overallCount || 1)
                  const barWidth = Math.round((item.overallCount / maxCount) * 100)

                  return (
                    <div key={item.skill} className="space-y-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-slate-200 flex items-center space-x-2">
                          <span className="w-5 font-mono text-slate-500">#{idx + 1}</span>
                          <span>{item.skill}</span>
                        </span>
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-bold text-emerald-400">
                            {item.overallCount} ({item.overallPercentage}%)
                          </span>
                          {hardSkillRankMode === 'choices' && (
                            <span className="text-[10px] text-slate-500 font-mono">
                              [1st: {item.firstChoiceCount} | 2nd: {item.secondChoiceCount} | 3rd: {item.thirdChoiceCount}]
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Bar Visualization */}
                      <div className="w-full bg-slate-950 h-3 rounded-full overflow-hidden flex border border-slate-800/80">
                        {hardSkillRankMode === 'overall' ? (
                          <div
                            className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${barWidth}%` }}
                          />
                        ) : (
                          <>
                            {/* Segment 1: First Choice */}
                            <div
                              className="bg-emerald-500 h-full transition-all duration-500"
                              style={{
                                width: `${(item.firstChoiceCount / maxCount) * 100}%`
                              }}
                              title={`First Choice: ${item.firstChoiceCount}`}
                            />
                            {/* Segment 2: Second Choice */}
                            <div
                              className="bg-teal-500 h-full transition-all duration-500"
                              style={{
                                width: `${(item.secondChoiceCount / maxCount) * 100}%`
                              }}
                              title={`Second Choice: ${item.secondChoiceCount}`}
                            />
                            {/* Segment 3: Third Choice */}
                            <div
                              className="bg-indigo-500 h-full transition-all duration-500"
                              style={{
                                width: `${(item.thirdChoiceCount / maxCount) * 100}%`
                              }}
                              title={`Third Choice: ${item.thirdChoiceCount}`}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 9.3 Soft Skills & 9.4 Self-Reliance Classes (2 Columns) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Soft Skills */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <div className="pb-4 mb-4 border-b border-slate-800">
                <span className="text-xs font-mono font-semibold text-teal-400 uppercase tracking-wider">
                  Personal Development
                </span>
                <h3 className="text-base font-bold text-white mt-0.5">Most Requested Soft Skills</h3>
                <p className="text-xs text-slate-400">Up to 3 selections per respondent.</p>
              </div>

              <div className="space-y-3">
                {analytics.softSkillsRanked.map((s) => {
                  const maxSoft = Math.max(1, analytics.softSkillsRanked[0]?.count || 1)
                  const w = Math.round((s.count / maxSoft) * 100)
                  return (
                    <div key={s.label} className="space-y-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-300 font-medium">{s.label}</span>
                        <span className="font-mono text-teal-300 font-semibold">
                          {s.count} ({s.percentage}%)
                        </span>
                      </div>
                      <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden border border-slate-800/80">
                        <div
                          className="bg-teal-500 h-full rounded-full transition-all duration-500"
                          style={{ width: `${w}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Self-Reliance Classes */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <div className="pb-4 mb-4 border-b border-slate-800">
                <span className="text-xs font-mono font-semibold text-indigo-400 uppercase tracking-wider">
                  Church Self-Reliance Services
                </span>
                <h3 className="text-base font-bold text-white mt-0.5">Self-Reliance Class Interest</h3>
                <p className="text-xs text-slate-400">Preferred Church Self-Reliance course.</p>
              </div>

              <div className="space-y-3.5">
                {analytics.selfRelianceClassesRanked.map((c) => {
                  const maxClass = Math.max(1, analytics.selfRelianceClassesRanked[0]?.count || 1)
                  const w = Math.round((c.count / maxClass) * 100)
                  return (
                    <div key={c.label} className="space-y-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-300 font-medium">{c.label}</span>
                        <span className="font-mono text-indigo-300 font-semibold">
                          {c.count} ({c.percentage}%)
                        </span>
                      </div>
                      <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden border border-slate-800/80">
                        <div
                          className="bg-indigo-500 h-full rounded-full transition-all duration-500"
                          style={{ width: `${w}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* 9.5 Goals & Expectations */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8">
            <div className="pb-4 mb-6 border-b border-slate-800">
              <span className="text-xs font-mono font-semibold text-emerald-400 uppercase tracking-wider">
                Outcomes & Aspirations
              </span>
              <h3 className="text-lg font-bold text-white mt-0.5">
                What YSA Hope to Achieve at the Gathering Place
              </h3>
              <p className="text-xs text-slate-400">Top goals and expected impact.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {analytics.desiredOutcomesRanked.map((g) => {
                const maxG = Math.max(1, analytics.desiredOutcomesRanked[0]?.count || 1)
                const w = Math.round((g.count / maxG) * 100)
                return (
                  <div key={g.label} className="bg-slate-950/60 border border-slate-800/80 p-3.5 rounded-xl space-y-2">
                    <div className="flex justify-between items-start text-xs">
                      <span className="font-semibold text-slate-200">{g.label}</span>
                      <span className="font-mono font-bold text-emerald-400 ml-2 whitespace-nowrap">
                        {g.count} ({g.percentage}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                        style={{ width: `${w}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 9.6 Availability Analytics & Heatmap */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="pb-4 border-b border-slate-800">
              <span className="text-xs font-mono font-semibold text-indigo-400 uppercase tracking-wider">
                Class Scheduling Intelligence
              </span>
              <h3 className="text-lg font-bold text-white mt-0.5">
                Respondent Availability Heatmap & Recommended Schedule
              </h3>
              <p className="text-xs text-slate-400">
                Frequency distribution across days of the week and daily time periods.
              </p>
            </div>

            {/* Heatmap Grid */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider">Time Slot</th>
                    {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => (
                      <th key={d} className="py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider text-center">
                        {d}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {['Morning (8 AM – 12 PM)', 'Afternoon (12 PM – 4 PM)', 'Evening (4 PM – 7 PM)'].map((t) => (
                    <tr key={t} className="hover:bg-slate-800/30">
                      <td className="py-3 px-3 font-medium text-slate-300 whitespace-nowrap">{t}</td>
                      {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => {
                        const cell = analytics.dayTimeMatrix.find((c) => c.day === d && c.timePeriod === t)
                        const count = cell ? cell.count : 0
                        const total = analytics.totalResponses
                        const pct = total > 0 ? Math.round((count / total) * 100) : 0

                        // Heatmap color intensity
                        let bgClass = 'bg-slate-950 text-slate-500 border border-slate-800/60'
                        if (pct >= 50) bgClass = 'bg-emerald-600 text-white font-bold'
                        else if (pct >= 30) bgClass = 'bg-emerald-800 text-emerald-100 font-semibold'
                        else if (pct >= 15) bgClass = 'bg-emerald-950 text-emerald-300 font-medium border border-emerald-800'
                        else if (count > 0) bgClass = 'bg-slate-900 text-slate-300 border border-slate-800'

                        return (
                          <td key={d} className="py-2 px-2 text-center">
                            <div className={`py-2 px-1.5 rounded-lg text-xs transition ${bgClass}`}>
                              <div>{count}</div>
                              <div className="text-[10px] opacity-75">{pct}%</div>
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Recommended Schedule Cards */}
            <div className="pt-4 border-t border-slate-800">
              <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400 mb-3 flex items-center">
                <Sparkles className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />
                Data-Driven Schedule Recommendations
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {analytics.recommendedSchedule.length === 0 ? (
                  <p className="text-xs text-slate-500 col-span-3">No schedule recommendations available yet.</p>
                ) : (
                  analytics.recommendedSchedule.map((slot, i) => (
                    <div
                      key={`${slot.day}-${slot.timePeriod}`}
                      className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-1.5"
                    >
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-white">Priority #{i + 1} Slot</span>
                        <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-300 font-mono font-semibold border border-emerald-800">
                          {slot.score} votes
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-emerald-400">
                        {slot.day} • {slot.timePeriod}
                      </p>
                      <p className="text-xs text-slate-400 leading-relaxed">{slot.rationale}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* 9.7 Ward/Branch Unit Analysis */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <div className="pb-4 border-b border-slate-800">
              <span className="text-xs font-mono font-semibold text-emerald-400 uppercase tracking-wider">
                Unit Census & Geographic Breakdown
              </span>
              <h3 className="text-lg font-bold text-white mt-0.5">
                Ward & Branch Participation & Unit Preferences
              </h3>
              <p className="text-xs text-slate-400">
                Shows response counts and top demanded skills across all 8 Stake units.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider">Ward / Branch</th>
                    <th className="py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider text-center">
                      Responses
                    </th>
                    <th className="py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider text-center">Share</th>
                    <th className="py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider">Top Hard Skill</th>
                    <th className="py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider">Top Soft Skill</th>
                    <th className="py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider">Best Day/Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {analytics.wardBreakdown.map((wb) => (
                    <tr key={wb.unitName} className="hover:bg-slate-800/30">
                      <td className="py-3 px-3 font-semibold text-white">{wb.unitName}</td>
                      <td className="py-3 px-3 text-center font-mono font-bold text-emerald-400">{wb.responseCount}</td>
                      <td className="py-3 px-3 text-center font-mono text-slate-400">{wb.percentage}%</td>
                      <td className="py-3 px-3 text-slate-300">{wb.topHardSkill}</td>
                      <td className="py-3 px-3 text-slate-300">{wb.topSoftSkill}</td>
                      <td className="py-3 px-3 text-slate-400">
                        {wb.topDay !== 'N/A' ? `${wb.topDay} (${wb.topTimePeriod})` : 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 9.8 Status & Education Demographics */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Status Breakdown */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <div className="pb-4 mb-4 border-b border-slate-800">
                <span className="text-xs font-mono font-semibold text-emerald-400 uppercase tracking-wider">
                  Demographic Profile
                </span>
                <h3 className="text-base font-bold text-white mt-0.5">Current Status Distribution</h3>
              </div>
              <div className="space-y-3">
                {analytics.statusDistribution.map((st) => (
                  <div key={st.label} className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-300 font-medium">{st.label}</span>
                      <span className="font-mono text-emerald-400 font-semibold">
                        {st.count} ({st.percentage}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800/80">
                      <div
                        className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                        style={{ width: `${st.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Education Breakdown */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <div className="pb-4 mb-4 border-b border-slate-800">
                <span className="text-xs font-mono font-semibold text-emerald-400 uppercase tracking-wider">
                  Educational Background
                </span>
                <h3 className="text-base font-bold text-white mt-0.5">Highest Level of Education</h3>
              </div>
              <div className="space-y-3">
                {analytics.educationDistribution.map((ed) => (
                  <div key={ed.label} className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-300 font-medium">{ed.label}</span>
                      <span className="font-mono text-teal-400 font-semibold">
                        {ed.count} ({ed.percentage}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800/80">
                      <div
                        className="bg-teal-500 h-full rounded-full transition-all duration-500"
                        style={{ width: `${ed.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: DETAILED RESPONSE TABLE & EXPORT */}
      {activeTab === 'responses' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-4 border-b border-slate-800 gap-3">
            <div>
              <span className="text-xs font-mono font-semibold text-emerald-400 uppercase tracking-wider">
                Submitted Records
              </span>
              <h3 className="text-lg font-bold text-white mt-0.5">Individual Assessment Responses</h3>
              <p className="text-xs text-slate-400">
                Displaying {filteredResponses.length} response{filteredResponses.length !== 1 ? 's' : ''} matching current filters.
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={handleExportCsv}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span>Download CSV</span>
              </button>
            </div>
          </div>

          {filteredResponses.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-xs">
              No survey response records match the active filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider">Date</th>
                    <th className="py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider">Ward / Branch</th>
                    <th className="py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider">Status</th>
                    <th className="py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider">Education</th>
                    <th className="py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider">1st Hard Skill</th>
                    <th className="py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider">2nd Hard Skill</th>
                    <th className="py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider">3rd Hard Skill</th>
                    <th className="py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider">Self-Reliance</th>
                    <th className="py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider">Days Available</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredResponses.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/30">
                      <td className="py-3 px-3 text-slate-400 whitespace-nowrap">
                        {new Date(r.submittedAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-3 font-semibold text-white whitespace-nowrap">{r.wardBranch}</td>
                      <td className="py-3 px-3 text-slate-300">{r.currentStatus}</td>
                      <td className="py-3 px-3 text-slate-400">{r.educationLevel}</td>
                      <td className="py-3 px-3 font-semibold text-emerald-400">{r.hardSkillFirstChoice}</td>
                      <td className="py-3 px-3 text-slate-300">{r.hardSkillSecondChoice}</td>
                      <td className="py-3 px-3 text-slate-400">{r.hardSkillThirdChoice}</td>
                      <td className="py-3 px-3 text-indigo-300">{r.selfRelianceClassInterest}</td>
                      <td className="py-3 px-3 text-slate-400 whitespace-nowrap">
                        {(r.preferredDays || []).join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: OPEN-ENDED FEEDBACK */}
      {activeTab === 'feedback' && (
        <div className="space-y-6">
          {/* 5-6 Month Target Outcomes */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8">
            <div className="pb-4 mb-4 border-b border-slate-800">
              <span className="text-xs font-mono font-semibold text-emerald-400 uppercase tracking-wider">
                Question 10 • Qualitative Goals
              </span>
              <h3 className="text-base font-bold text-white mt-0.5">
                Target Outcomes Within 5–6 Months ({analytics.openEndedFeedback.outcomes.length})
              </h3>
            </div>
            {analytics.openEndedFeedback.outcomes.length === 0 ? (
              <p className="text-xs text-slate-500 py-4">No text responses submitted for this question.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {analytics.openEndedFeedback.outcomes.map((o) => (
                  <div key={o.id} className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                    <div className="flex justify-between items-center text-[10px] text-slate-400">
                      <span className="font-semibold text-emerald-400">{o.ward}</span>
                      <span>{new Date(o.date).toLocaleDateString()}</span>
                    </div>
                    <p className="text-xs text-slate-200 leading-relaxed italic">"{o.text}"</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Additional Skills Requested */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8">
            <div className="pb-4 mb-4 border-b border-slate-800">
              <span className="text-xs font-mono font-semibold text-teal-400 uppercase tracking-wider">
                Question 11 • Additional Suggestions
              </span>
              <h3 className="text-base font-bold text-white mt-0.5">
                Other Requested Skills, Classes & Activities ({analytics.openEndedFeedback.additionalSkills.length})
              </h3>
            </div>
            {analytics.openEndedFeedback.additionalSkills.length === 0 ? (
              <p className="text-xs text-slate-500 py-4">No suggestions submitted for this question.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {analytics.openEndedFeedback.additionalSkills.map((s) => (
                  <div key={s.id} className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                    <div className="flex justify-between items-center text-[10px] text-slate-400">
                      <span className="font-semibold text-teal-400">{s.ward}</span>
                      <span>{new Date(s.date).toLocaleDateString()}</span>
                    </div>
                    <p className="text-xs text-slate-200 leading-relaxed italic">"{s.text}"</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Suggestions for Gathering Place */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8">
            <div className="pb-4 mb-4 border-b border-slate-800">
              <span className="text-xs font-mono font-semibold text-indigo-400 uppercase tracking-wider">
                Question 12 • Stake Suggestions
              </span>
              <h3 className="text-base font-bold text-white mt-0.5">
                Ideas to Make the Gathering Place Successful ({analytics.openEndedFeedback.suggestions.length})
              </h3>
            </div>
            {analytics.openEndedFeedback.suggestions.length === 0 ? (
              <p className="text-xs text-slate-500 py-4">No suggestions submitted for this question.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {analytics.openEndedFeedback.suggestions.map((sg) => (
                  <div key={sg.id} className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                    <div className="flex justify-between items-center text-[10px] text-slate-400">
                      <span className="font-semibold text-indigo-400">{sg.ward}</span>
                      <span>{new Date(sg.date).toLocaleDateString()}</span>
                    </div>
                    <p className="text-xs text-slate-200 leading-relaxed italic">"{sg.text}"</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: NEEDS ASSESSMENT OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
          <div>
            <span className="text-xs font-mono font-semibold text-emerald-400 uppercase tracking-wider">
              Governance & Configuration
            </span>
            <h3 className="text-lg font-bold text-white mt-0.5">Needs Assessment Overview & Lifecycle</h3>
            <p className="text-xs text-slate-400">
              Manage the 2027 Gathering Place planning cycle for Abeokuta Nigeria Obantoko Stake.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
              <span className="font-bold text-white block">Assessment Title:</span>
              <p className="text-slate-300">{assessment?.title}</p>
            </div>

            <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
              <span className="font-bold text-white block">Target Launch Year:</span>
              <p className="text-slate-300">{assessment?.assessmentYear}</p>
            </div>

            <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
              <span className="font-bold text-white block">Public Slug & Identifier:</span>
              <p className="text-slate-300 font-mono">{assessment?.publicSlug}</p>
            </div>

            <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
              <span className="font-bold text-white block">Shareable Public URL:</span>
              <div className="flex items-center space-x-2">
                <code className="text-emerald-400 font-mono text-[11px] truncate flex-1">{publicSurveyUrl}</code>
                <button
                  onClick={copyPublicLink}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded text-[11px] font-semibold"
                >
                  Copy
                </button>
              </div>
            </div>
          </div>

          {/* Status Controls */}
          <div className="p-5 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Assessment Status Management</h4>
            <p className="text-xs text-slate-400">
              Current state: <strong className="text-white capitalize">{assessment?.status}</strong>. When marked as closed, the public survey will refuse new responses and display a closed message, while preserving all submitted data.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              {(['active', 'closed', 'draft', 'archived'] as AssessmentStatus[]).map((st) => (
                <button
                  key={st}
                  disabled={assessment?.status === st || isUpdatingStatus}
                  onClick={() => {
                    setPendingStatus(st)
                    setStatusModalOpen(true)
                  }}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold capitalize transition cursor-pointer disabled:opacity-40 ${
                    assessment?.status === st
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  Set as {st}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Status Change */}
      {statusModalOpen && pendingStatus && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="w-12 h-12 bg-slate-800 rounded-xl flex items-center justify-center text-emerald-400">
              <SlidersHorizontal className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Confirm Assessment Status Change</h3>
              <p className="text-xs text-slate-400 mt-1">
                Are you sure you want to change the assessment status to <strong className="text-emerald-400 capitalize">{pendingStatus}</strong>?
                {pendingStatus === 'closed' && ' Public respondents will no longer be able to submit responses.'}
              </p>
            </div>
            <div className="flex justify-end gap-3 pt-3">
              <button
                type="button"
                disabled={isUpdatingStatus}
                onClick={() => setStatusModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isUpdatingStatus}
                onClick={() => handleStatusChange(pendingStatus)}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition"
              >
                {isUpdatingStatus ? 'Updating...' : 'Confirm Update'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
