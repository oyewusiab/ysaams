import React, { useState } from 'react'
import {
  TrendingUp,
  TrendingDown,
  BarChart2,
  Table as TableIcon,
  Users,
  Award,
  Calendar,
  Building2,
  Sparkles
} from 'lucide-react'
import { ChartDataset, ReportSummaryMetrics } from '../../services/reportService'

interface VisualAnalyticsViewProps {
  charts: ChartDataset
  metrics: ReportSummaryMetrics
  insights: string[]
  onSelectUnit?: (unitId: string) => void
  onSelectActivity?: (activityId: string) => void
}

export const VisualAnalyticsView: React.FC<VisualAnalyticsViewProps> = ({
  charts,
  metrics,
  insights,
  onSelectUnit,
  onSelectActivity
}) => {
  const [viewMode, setViewMode] = useState<'charts' | 'table'>('charts')

  const maxTimelineCount = Math.max(1, ...charts.trendTimeline.map(t => t.recordsCount))
  const maxUnitCount = Math.max(1, ...charts.unitBreakdown.map(u => u.recordsCount))
  const maxActivityCount = Math.max(1, ...charts.activityBreakdown.map(a => a.recordsCount))

  return (
    <div className="space-y-6">
      {/* 1. Summary Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {/* Total Attendance Records */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-medium tracking-wide uppercase">Total Attendance</span>
            <Users className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-white">{metrics.totalRecords}</span>
            <span className="text-xs text-slate-400">check-ins</span>
          </div>
          {metrics.periodTrendPercentage !== null && (
            <div className="mt-2 flex items-center text-xs">
              {metrics.periodTrendPercentage >= 0 ? (
                <span className="text-emerald-400 flex items-center font-medium">
                  <TrendingUp className="w-3.5 h-3.5 mr-1" />
                  +{metrics.periodTrendPercentage}%
                </span>
              ) : (
                <span className="text-rose-400 flex items-center font-medium">
                  <TrendingDown className="w-3.5 h-3.5 mr-1" />
                  {metrics.periodTrendPercentage}%
                </span>
              )}
              <span className="text-slate-500 ml-1.5 text-[11px]">vs prior period</span>
            </div>
          )}
        </div>

        {/* Unique Attendees */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-medium tracking-wide uppercase">Unique Attendees</span>
            <Award className="w-4 h-4 text-teal-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-white">{metrics.uniqueAttendees}</span>
            <span className="text-xs text-slate-400">distinct profiles</span>
          </div>
          <p className="mt-2 text-[11px] text-slate-400 truncate">
            {metrics.totalRecords > 0
              ? `${Math.round((metrics.uniqueAttendees / metrics.totalRecords) * 100)}% unique ratio`
              : 'No records'}
          </p>
        </div>

        {/* Member vs Visitor Split */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-medium tracking-wide uppercase">Members & Visitors</span>
            <Users className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-lg sm:text-xl font-bold text-white">{metrics.memberRecords}</span>
            <span className="text-xs text-slate-400">members</span>
            <span className="text-slate-600">/</span>
            <span className="text-lg sm:text-xl font-bold text-teal-300">{metrics.visitorRecords}</span>
            <span className="text-xs text-slate-400">visitors</span>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden flex">
            <div
              className="bg-indigo-500 h-full transition-all duration-300"
              style={{ width: `${charts.typeBreakdown.memberPct}%` }}
              title={`Members: ${charts.typeBreakdown.memberPct}%`}
            />
            <div
              className="bg-teal-400 h-full transition-all duration-300"
              style={{ width: `${charts.typeBreakdown.visitorPct}%` }}
              title={`Visitors: ${charts.typeBreakdown.visitorPct}%`}
            />
          </div>
        </div>

        {/* Sessions & Average Attendance */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-medium tracking-wide uppercase">Sessions & Averages</span>
            <Calendar className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-white">
              {metrics.avgAttendancePerSession !== null ? metrics.avgAttendancePerSession : '0'}
            </span>
            <span className="text-xs text-slate-400">avg / session</span>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Across {metrics.heldSessionsCount} held session{metrics.heldSessionsCount === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/* 2. Factual Dynamic Insights Box */}
      {insights.length > 0 && (
        <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center space-x-2 text-xs font-semibold text-emerald-400 mb-2">
            <Sparkles className="w-4 h-4" />
            <span>Key Leadership Observations</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-300">
            {insights.map((insight, idx) => (
              <div key={idx} className="flex items-start space-x-2">
                <span className="text-emerald-500 font-bold">•</span>
                <span>{insight}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. View Mode Toggle (Visual Charts vs Accessible Tables) */}
      <div className="flex items-center justify-between pt-2 no-print">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center space-x-2">
          <BarChart2 className="w-4 h-4 text-emerald-400" />
          <span>Visual Distribution & Comparisons</span>
        </h4>
        <div className="inline-flex rounded-lg bg-slate-950 border border-slate-800 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setViewMode('charts')}
            className={`px-3 py-1 rounded-md font-medium transition-colors flex items-center space-x-1.5 ${
              viewMode === 'charts'
                ? 'bg-emerald-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5" />
            <span>Charts</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={`px-3 py-1 rounded-md font-medium transition-colors flex items-center space-x-1.5 ${
              viewMode === 'table'
                ? 'bg-emerald-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <TableIcon className="w-3.5 h-3.5" />
            <span>Accessible Tables</span>
          </button>
        </div>
      </div>

      {viewMode === 'charts' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Chart 1: Attendance Timeline / Trend */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
            <div className="mb-4">
              <h5 className="text-xs font-bold text-white flex items-center space-x-2">
                <Calendar className="w-3.5 h-3.5 text-teal-400" />
                <span>Attendance Timeline & Trend</span>
              </h5>
              <p className="text-[11px] text-slate-400">Total check-ins by activity date</p>
            </div>

            {charts.trendTimeline.length > 0 ? (
              <div className="space-y-2.5">
                {charts.trendTimeline.map((item, idx) => {
                  return (
                    <div key={idx} className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-300 font-medium">{item.periodLabel}</span>
                        <div className="space-x-2 text-slate-400 font-mono">
                          <span className="text-indigo-400">{item.membersCount} mem</span>
                          <span className="text-teal-400">{item.visitorsCount} vis</span>
                          <span className="font-bold text-white">({item.recordsCount})</span>
                        </div>
                      </div>
                      <div className="w-full bg-slate-900 rounded-full h-3 overflow-hidden flex">
                        <div
                          className="bg-indigo-500 h-full transition-all duration-300"
                          style={{ width: `${(item.membersCount / maxTimelineCount) * 100}%` }}
                          title={`Members: ${item.membersCount}`}
                        />
                        <div
                          className="bg-teal-400 h-full transition-all duration-300"
                          style={{ width: `${(item.visitorsCount / maxTimelineCount) * 100}%` }}
                          title={`Visitors: ${item.visitorsCount}`}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-500">No attendance timeline data in scope.</div>
            )}
          </div>

          {/* Chart 2: Stake Unit Breakdown & Comparison */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
            <div className="mb-4">
              <h5 className="text-xs font-bold text-white flex items-center space-x-2">
                <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Attendance by Stake Unit</span>
              </h5>
              <p className="text-[11px] text-slate-400">Historical unit attribution at attendance time</p>
            </div>

            {charts.unitBreakdown.length > 0 ? (
              <div className="space-y-2.5">
                {charts.unitBreakdown.map((item, idx) => {
                  const widthPct = Math.round((item.recordsCount / maxUnitCount) * 100)
                  return (
                    <div
                      key={idx}
                      onClick={() => onSelectUnit && onSelectUnit(item.unitId)}
                      className={`space-y-1 ${onSelectUnit ? 'cursor-pointer hover:opacity-80' : ''}`}
                    >
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-300 font-medium">{item.unitName}</span>
                        <div className="space-x-1 font-mono">
                          <span className="text-emerald-400 font-bold">{item.recordsCount}</span>
                          <span className="text-slate-500">({item.percentage}%)</span>
                        </div>
                      </div>
                      <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${Math.max(2, widthPct)}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-500">No unit breakdown data in scope.</div>
            )}
          </div>

          {/* Chart 3: Top Activities Breakdown */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
            <div className="mb-4">
              <h5 className="text-xs font-bold text-white flex items-center space-x-2">
                <Award className="w-3.5 h-3.5 text-amber-400" />
                <span>Attendance by Activity</span>
              </h5>
              <p className="text-[11px] text-slate-400">Check-ins across activity definitions</p>
            </div>

            {charts.activityBreakdown.length > 0 ? (
              <div className="space-y-2.5">
                {charts.activityBreakdown.map((item, idx) => {
                  const widthPct = Math.round((item.recordsCount / maxActivityCount) * 100)
                  return (
                    <div
                      key={idx}
                      onClick={() => onSelectActivity && onSelectActivity(item.activityId)}
                      className={`space-y-1 ${onSelectActivity ? 'cursor-pointer hover:opacity-80' : ''}`}
                    >
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-300 font-medium truncate max-w-[200px]">{item.activityTitle}</span>
                        <span className="text-amber-400 font-bold font-mono">{item.recordsCount}</span>
                      </div>
                      <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="bg-amber-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${Math.max(2, widthPct)}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-500">No activity breakdown data in scope.</div>
            )}
          </div>

          {/* Chart 4: Member vs Visitor Composition */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
            <div className="mb-4">
              <h5 className="text-xs font-bold text-white flex items-center space-x-2">
                <Users className="w-3.5 h-3.5 text-indigo-400" />
                <span>Member vs Visitor Composition</span>
              </h5>
              <p className="text-[11px] text-slate-400">Total cohort distribution</p>
            </div>

            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900/60 border border-slate-800">
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 rounded-full bg-indigo-500" />
                  <div>
                    <div className="text-xs font-semibold text-white">Church Members</div>
                    <div className="text-[11px] text-slate-400">{charts.typeBreakdown.members} recorded check-ins</div>
                  </div>
                </div>
                <div className="text-sm font-bold text-indigo-400 font-mono">
                  {charts.typeBreakdown.memberPct}%
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900/60 border border-slate-800">
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 rounded-full bg-teal-400" />
                  <div>
                    <div className="text-xs font-semibold text-white">Visitors & Friends</div>
                    <div className="text-[11px] text-slate-400">{charts.typeBreakdown.visitors} recorded check-ins</div>
                  </div>
                </div>
                <div className="text-sm font-bold text-teal-400 font-mono">
                  {charts.typeBreakdown.visitorPct}%
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Accessible Data Tables Alternative */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Unit Comparison Table */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 text-xs font-bold text-white">
              Unit Comparison Table
            </div>
            <table className="w-full text-xs text-left text-slate-300">
              <thead className="bg-slate-900/50 uppercase text-[10px] text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-4 py-2.5">Stake Unit</th>
                  <th className="px-4 py-2.5 text-right">Attendance</th>
                  <th className="px-4 py-2.5 text-right">Share (%)</th>
                </tr>
              </thead>
              <tbody>
                {charts.unitBreakdown.map((u, i) => (
                  <tr key={i} className="border-b border-slate-900 hover:bg-slate-900/50">
                    <td className="px-4 py-2.5 font-medium text-white">{u.unitName}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{u.recordsCount}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-emerald-400">{u.percentage}%</td>
                  </tr>
                ))}
                {charts.unitBreakdown.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-4 text-center text-slate-500">No unit data.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Activity Comparison Table */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 text-xs font-bold text-white">
              Activity Comparison Table
            </div>
            <table className="w-full text-xs text-left text-slate-300">
              <thead className="bg-slate-900/50 uppercase text-[10px] text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-4 py-2.5">Activity Title</th>
                  <th className="px-4 py-2.5 text-right">Attendance Count</th>
                </tr>
              </thead>
              <tbody>
                {charts.activityBreakdown.map((a, i) => (
                  <tr key={i} className="border-b border-slate-900 hover:bg-slate-900/50">
                    <td className="px-4 py-2.5 font-medium text-white">{a.activityTitle}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-amber-400">{a.recordsCount}</td>
                  </tr>
                ))}
                {charts.activityBreakdown.length === 0 && (
                  <tr>
                    <td colSpan={2} className="px-4 py-4 text-center text-slate-500">No activity data.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
