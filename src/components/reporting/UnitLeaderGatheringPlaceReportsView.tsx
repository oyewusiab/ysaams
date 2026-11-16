import React, { useState, useEffect } from 'react'
import {
  Download,
  Printer,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Eye
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import {
  StakeUnit,
  GatheringPlaceMonthlyReport,
  GatheringPlaceReportItem
} from '../../types/database'
import { gatheringPlaceReportService } from '../../services/gatheringPlaceReportService'
import { GatheringPlaceReportDocument } from './GatheringPlaceReportDocument'
import { exportToCsvAdvanced, exportToXlsxAdvanced, triggerPrintReport } from '../../lib/exportUtils'

interface UnitLeaderGatheringPlaceReportsViewProps {
  units: StakeUnit[]
}

export const UnitLeaderGatheringPlaceReportsView: React.FC<
  UnitLeaderGatheringPlaceReportsViewProps
> = ({ units }) => {
  const { user } = useAuth()
  const [reports, setReports] = useState<GatheringPlaceMonthlyReport[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedReport, setSelectedReport] =
    useState<GatheringPlaceMonthlyReport | null>(null)
  const [selectedItems, setSelectedItems] = useState<GatheringPlaceReportItem[]>([])
  const [error, setError] = useState<string | null>(null)

  // Assigned unit IDs for the unit leader
  const assignedUnitIds = (user?.unitAssignments || []).map((ua) => ua.unitId)
  const assignedUnits = units.filter((u) => assignedUnitIds.includes(u.id))
  const primaryUnit = assignedUnits[0]

  useEffect(() => {
    const loadApprovedReports = async () => {
      if (!user) return
      setIsLoading(true)
      setError(null)
      try {
        const list = await gatheringPlaceReportService.listReports(user)
        // Strictly filter to approved reports
        setReports(list.filter((r) => r.status === 'approved'))
      } catch (err: any) {
        setError(err.message || 'Failed to load approved Gathering Place reports.')
      } finally {
        setIsLoading(false)
      }
    }

    loadApprovedReports()
  }, [user])

  const handleSelectReport = async (rep: GatheringPlaceMonthlyReport) => {
    if (!user) return
    setError(null)
    try {
      // Backend/service securely strips any data from other units
      const fullReport = await gatheringPlaceReportService.getReportById(
        rep.id,
        user
      )
      if (fullReport) {
        setSelectedReport(fullReport)
        setSelectedItems(fullReport.items || [])
      }
    } catch (err: any) {
      setError(err.message || 'Unable to open unit report.')
    }
  }

  const handlePrint = () => {
    if (!selectedReport) return
    triggerPrintReport(
      `${primaryUnit?.unitName || 'Unit'} — ${selectedReport.monthName} ${selectedReport.reportingYear} Gathering Place Report`
    )
  }

  const handleExport = (format: 'xlsx' | 'csv') => {
    if (!selectedReport || !primaryUnit) return
    const filename = `${primaryUnit.unitName.replace(/\s+/g, '_')}_${selectedReport.monthName}_${selectedReport.reportingYear}_GP_Report`
    const columns = [
      { key: 'serialNumber', label: 'S/N' },
      { key: 'attendeeName', label: 'Member Name' },
      { key: 'unitName', label: 'Ward/Branch' },
      { key: 'classGroupDisplay', label: 'Class/Group' },
      { key: 'totalVisits', label: 'Total Visits' }
    ]
    const metadata = {
      title: `${primaryUnit.unitName} — Gathering Place Monthly Report`,
      subtitle: `EXPECTED VISIT FOR THE MONTH FOR EACH YA IS ${selectedReport.expectedVisitsPerYa}`,
      generatedAt: selectedReport.generatedAt,
      periodLabel: `${selectedReport.monthName} ${selectedReport.reportingYear}`,
      scopeLabel: primaryUnit.unitName,
      totalRecords: selectedItems.length,
      uniqueAttendees: selectedItems.length
    }

    if (format === 'xlsx') {
      exportToXlsxAdvanced(filename, metadata, columns, selectedItems as any)
    } else {
      exportToCsvAdvanced(filename, metadata, columns, selectedItems as any)
    }
  }

  return (
    <div className="space-y-6">
      {/* Unit Leader Reports Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Official Distribution
              </span>
              <span className="text-xs text-slate-400">
                Unit Leader Authorized Reports
              </span>
            </div>
            <h2 className="text-lg font-black text-white tracking-wide mt-1">
              Gathering Place Monthly Reports
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Authorized unit reports for{' '}
              <strong className="text-white">
                {assignedUnits.map((u) => u.unitName).join(', ') || 'Your Assigned Unit'}
              </strong>
              . Approved reports are available for viewing, official printing, and download.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-950/60 border border-red-800 text-red-200 rounded-xl text-xs flex items-center space-x-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Reports Table View */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center space-x-2 border-b border-slate-800 pb-3">
          <Calendar className="w-4 h-4 text-emerald-400" />
          <span>Available Approved Monthly Reports</span>
        </h3>

        {isLoading ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            Loading approved unit reports...
          </div>
        ) : reports.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs italic">
            No approved Gathering Place monthly reports are currently available for your unit.
            Reports will appear here once approved by the Stake President.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left text-slate-300">
              <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="p-3">Reporting Month</th>
                  <th className="p-3">Unit</th>
                  <th className="p-3">Approval Status</th>
                  <th className="p-3">Date Approved</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {reports.map((rep) => (
                  <tr
                    key={rep.id}
                    className="hover:bg-slate-800/50 transition text-slate-200"
                  >
                    <td className="p-3 font-semibold text-white">
                      {rep.monthName} {rep.reportingYear}
                    </td>
                    <td className="p-3 text-slate-300">
                      {primaryUnit?.unitName || 'Assigned Unit'}
                    </td>
                    <td className="p-3">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 border border-emerald-600 text-emerald-300 flex items-center space-x-1 w-max">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        <span>Approved</span>
                      </span>
                    </td>
                    <td className="p-3 text-slate-400">
                      {rep.approvedAt
                        ? new Date(rep.approvedAt).toLocaleDateString()
                        : 'Approved'}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSelectReport(rep)}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5 ml-auto shadow-sm"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>View & Download</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Selected Unit Report Document & Export Actions */}
      {selectedReport && primaryUnit && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-center gap-3 shadow-lg">
            <div>
              <h4 className="text-sm font-bold text-white">
                {primaryUnit.unitName} — {selectedReport.monthName} {selectedReport.reportingYear} Report
              </h4>
              <p className="text-xs text-slate-400">
                Authorized unit copy • {selectedItems.length} participants with valid attendance
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={handlePrint}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer flex items-center space-x-2 shadow-sm"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print / Save PDF</span>
              </button>
              <button
                type="button"
                onClick={() => handleExport('xlsx')}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition cursor-pointer flex items-center space-x-2 shadow-md"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Excel</span>
              </button>
            </div>
          </div>

          {/* Unit-Specific Rendered Document */}
          <div className="overflow-x-auto pb-4">
            <GatheringPlaceReportDocument
              report={selectedReport}
              items={selectedItems}
              unitFilter={primaryUnit.unitName}
            />
          </div>
        </div>
      )}
    </div>
  )
}
