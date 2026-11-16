import React from 'react'
import {
  GatheringPlaceMonthlyReport,
  GatheringPlaceReportItem
} from '../../types/database'

interface GatheringPlaceReportDocumentProps {
  report: GatheringPlaceMonthlyReport
  items?: GatheringPlaceReportItem[]
  unitFilter?: string | null // If specified, filters to this unit only (e.g. for unit leader or unit view)
  isPrintOnly?: boolean
}

export const GatheringPlaceReportDocument: React.FC<GatheringPlaceReportDocumentProps> = ({
  report,
  items: overrideItems,
  unitFilter = null,
  isPrintOnly = false
}) => {
  const allItems = overrideItems || report.items || []

  // Filter items if a specific unit is selected for viewing
  const displayItems = unitFilter
    ? allItems.filter(
        (i) =>
          i.unitId === unitFilter ||
          i.unitName.toLowerCase().trim() === unitFilter.toLowerCase().trim()
      )
    : allItems

  // Determine display unit header name
  const unitHeading = unitFilter
    ? (displayItems[0]?.unitName || unitFilter).toUpperCase()
    : report.unitIds.length === 1 && displayItems[0]?.unitName
    ? displayItems[0].unitName.toUpperCase()
    : 'ALL STAKE UNITS'

  return (
    <div
      className={`gathering-place-report-paper bg-white text-slate-950 font-sans mx-auto w-full max-w-[1100px] print:max-w-none print:w-full print:p-0 ${
        isPrintOnly ? 'hidden print:block' : 'p-6 sm:p-8 rounded-xl shadow-2xl border border-amber-900/30 my-4'
      }`}
      style={{
        pageBreakAfter: 'always',
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact'
      }}
    >
      {/* 1. Official Area & Stake Header */}
      <div className="text-center mb-3">
        <h1 className="text-base sm:text-lg font-black tracking-wider text-slate-950 uppercase leading-snug">
          AFRICA WEST AREA GATHERING PLACE DAILY ATTENDANCE REGISTER
        </h1>
        <h2 className="text-sm sm:text-base font-extrabold tracking-wide text-blue-900 uppercase mt-0.5">
          CONSOLIDATED MONTHLY REPORT
        </h2>
      </div>

      {/* 2. Unit and Date Subheader */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end border-b-2 border-slate-900 pb-1.5 mb-2 text-xs sm:text-sm font-semibold">
        <div className="text-slate-950">
          <span className="font-bold">Unit: </span>
          <span className="font-extrabold underline tracking-wide">
            {unitHeading} (Abeokuta Nigeria Stake)
          </span>
        </div>
        <div className="text-slate-950 mt-1 sm:mt-0 font-bold">
          <span>Date: </span>
          <span className="font-extrabold text-slate-950">
            {report.monthName} {report.reportingYear}
          </span>
        </div>
      </div>

      {/* 3. High-Fidelity Data Table */}
      <div className="overflow-x-auto w-full">
        <table className="w-full border-collapse border border-amber-900/60 text-xs text-left">
          {/* Table Banner Title */}
          <thead>
            <tr>
              <th
                colSpan={5}
                className="bg-[#fef3c7] text-slate-950 font-extrabold text-center py-1.5 px-3 uppercase tracking-wider border border-amber-900/60 text-xs sm:text-sm"
                style={{ backgroundColor: '#fef3c7' }}
              >
                PARTICIPANTS LIST
              </th>
            </tr>
            <tr className="bg-slate-100 text-slate-900 font-bold text-xs uppercase border-b border-amber-900/60">
              <th className="border border-amber-900/60 p-1.5 text-center w-12">
                S/N
              </th>
              <th className="border border-amber-900/60 p-1.5 min-w-[180px]">
                Member Name
              </th>
              <th className="border border-amber-900/60 p-1.5 min-w-[130px] text-center">
                Ward/Branch
              </th>
              <th className="border border-amber-900/60 p-1.5 min-w-[240px]">
                Class/Group
              </th>
              <th className="border border-amber-900/60 p-1.5 text-center w-20">
                Total Visits
              </th>
            </tr>
          </thead>
          <tbody>
            {displayItems.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="border border-amber-900/60 p-6 text-center text-slate-500 italic"
                >
                  No participants met the selected reporting and attendance criteria for this unit.
                </td>
              </tr>
            ) : (
              displayItems.map((item, idx) => (
                <tr
                  key={item.id || `${item.attendeeName}-${idx}`}
                  className="hover:bg-amber-50/40 print:hover:bg-transparent text-slate-900 border-b border-amber-900/40"
                  style={{ pageBreakInside: 'avoid' }}
                >
                  <td className="border border-amber-900/60 p-1.5 text-center font-medium">
                    {item.serialNumber || idx + 1}
                  </td>
                  <td className="border border-amber-900/60 p-1.5 font-bold text-slate-950">
                    {item.attendeeName}
                  </td>
                  <td className="border border-amber-900/60 p-1.5 text-center">
                    {item.unitName}
                  </td>
                  <td className="border border-amber-900/60 p-1.5 leading-snug text-slate-900 font-medium">
                    {item.classGroupDisplay}
                  </td>
                  <td className="border border-amber-900/60 p-1.5 text-center font-black text-slate-950 text-sm">
                    {item.totalVisits}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 4. Expected Visits Statement */}
      <div className="mt-4 pt-2 text-xs sm:text-sm font-black uppercase tracking-wide text-slate-950">
        <span>EXPECTED VISIT FOR THE MONTH FOR EACH YA IS </span>
        <span className="underline decoration-2 font-black text-sm sm:text-base">
          {report.expectedVisitsPerYa}
        </span>
      </div>

      {/* 5. Stake YSA Leader Sign-Off & Verification Footer */}
      <div className="mt-6 pt-4 border-t border-slate-300 grid grid-cols-1 sm:grid-cols-3 gap-4 items-center text-xs sm:text-sm">
        {/* Leader Name */}
        <div>
          <span className="font-semibold text-slate-700">Stake YSA Leaders: </span>
          <span className="font-black text-slate-950 uppercase ml-1">
            {report.leaderSnapshot?.fullName || 'Stake YSA Leadership'}
          </span>
        </div>

        {/* E-Signature */}
        <div className="flex items-center space-x-2">
          <span className="font-semibold text-slate-700">E-Signature: </span>
          <div className="inline-block min-w-[120px] max-w-[180px] h-10 border-b border-slate-400 flex items-center justify-center">
            {report.leaderSnapshot?.signatureDataUrl ? (
              <img
                src={report.leaderSnapshot.signatureDataUrl}
                alt="Stake Leader E-Signature"
                className="max-h-9 max-w-full object-contain"
              />
            ) : (
              <span className="text-[11px] font-mono text-slate-400 italic">
                Signature on File
              </span>
            )}
          </div>
        </div>

        {/* Contact Phone */}
        <div className="sm:text-right">
          <span className="font-semibold text-slate-700">Contact: </span>
          <span className="font-mono font-bold text-slate-950 text-sm ml-1">
            {report.leaderSnapshot?.phoneNumber || 'N/A'}
          </span>
        </div>
      </div>

      {/* 6. Document Footer and Page Identifier */}
      <div className="mt-6 pt-2 border-t border-slate-200 flex justify-between items-center text-[10px] sm:text-xs text-slate-500 font-mono">
        <div>Gathering Place Attendance System</div>
        <div className="font-sans">
          Page 1{displayItems.length > 25 ? ' of ' + Math.ceil(displayItems.length / 25) : ''}
        </div>
      </div>
    </div>
  )
}
