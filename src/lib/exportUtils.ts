/**
 * Export utilities for YSA Attendance Management System.
 * Abeokuta Nigeria Obantoko Stake
 * Supports CSV (with formula injection defense), XLSX (real Excel workbook), and Print/PDF.
 */

import writeXlsxFile, { SheetData, Row } from 'write-excel-file/browser'

export interface ReportExportMetadata {
  title: string
  subtitle?: string
  generatedAt: string
  periodLabel: string
  scopeLabel: string
  totalRecords: number
  uniqueAttendees: number
  heldSessions?: number
  avgPerSession?: number | null
}

export interface ExportColumn {
  key: string
  label: string
}

/**
 * Sanitizes input to prevent spreadsheet formula injection.
 * If a value begins with =, +, -, @, tab, or carriage return, prepend a single quote.
 */
export function sanitizeForSpreadsheet(val: any): string {
  if (val === null || val === undefined) return ''
  const str = String(val)
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`
  }
  return str
}

/**
 * Exports data to CSV with defensive formula injection escaping and a metadata header.
 */
export function exportToCsvAdvanced(
  filename: string,
  metadata: ReportExportMetadata,
  columns: ExportColumn[],
  records: Record<string, any>[]
) {
  const metaRows: string[] = [
    `"YSA Attendance Management System - Abeokuta Nigeria Obantoko Stake"`,
    `"Report Title:","${sanitizeForSpreadsheet(metadata.title).replace(/"/g, '""')}"`,
    `"Generation Date:","${sanitizeForSpreadsheet(metadata.generatedAt).replace(/"/g, '""')}"`,
    `"Reporting Period:","${sanitizeForSpreadsheet(metadata.periodLabel).replace(/"/g, '""')}"`,
    `"Authorized Scope:","${sanitizeForSpreadsheet(metadata.scopeLabel).replace(/"/g, '""')}"`,
    `"Total Attendance Records:",${metadata.totalRecords}`,
    `"Unique Attendees:",${metadata.uniqueAttendees}`,
    metadata.heldSessions !== undefined ? `"Sessions Held:",${metadata.heldSessions}` : '',
    metadata.avgPerSession !== undefined && metadata.avgPerSession !== null
      ? `"Avg Attendance / Session:",${metadata.avgPerSession}`
      : '',
    `""` // Empty spacer line
  ].filter(line => line.length > 0)

  const headerRow = columns.map(c => `"${c.label.replace(/"/g, '""')}"`).join(',')

  const dataRows = records.map(record =>
    columns
      .map(col => {
        const raw = record[col.key]
        const clean = sanitizeForSpreadsheet(raw)
        return `"${clean.replace(/"/g, '""')}"`
      })
      .join(',')
  )

  const csvContent = '\uFEFF' + [...metaRows, headerRow, ...dataRows].join('\r\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', `${filename.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  if (typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url)
  }
}

/**
 * Generates and downloads a real .xlsx workbook with a Summary metadata section and Records table.
 */
export async function exportToXlsxAdvanced(
  filename: string,
  metadata: ReportExportMetadata,
  columns: ExportColumn[],
  records: Record<string, any>[]
): Promise<void> {
  const rows: SheetData = []

  // Title
  rows.push([
    {
      value: 'YSA AMS — Attendance Report',
      fontWeight: 'bold',
      fontSize: 14,
      textColor: '#064e3b'
    }
  ])
  rows.push([
    {
      value: 'Abeokuta Nigeria Obantoko Stake',
      fontSize: 10,
      textColor: '#475569'
    }
  ])
  rows.push([]) // empty row

  // Metadata block
  const addMetaRow = (label: string, val: string | number) => {
    rows.push([
      { value: label, fontWeight: 'bold', textColor: '#1e293b' },
      { value: typeof val === 'number' ? val : sanitizeForSpreadsheet(val) }
    ])
  }

  addMetaRow('Report Title:', metadata.title)
  addMetaRow('Generated Date:', metadata.generatedAt)
  addMetaRow('Reporting Period:', metadata.periodLabel)
  addMetaRow('Authorized Scope:', metadata.scopeLabel)
  addMetaRow('Total Attendance Records:', metadata.totalRecords)
  addMetaRow('Unique Attendees:', metadata.uniqueAttendees)
  if (metadata.heldSessions !== undefined) {
    addMetaRow('Sessions Held:', metadata.heldSessions)
  }
  if (metadata.avgPerSession !== undefined && metadata.avgPerSession !== null) {
    addMetaRow('Avg Attendance / Session:', metadata.avgPerSession)
  }

  rows.push([]) // spacer
  rows.push([]) // spacer

  // Table header
  const headerRow: Row = columns.map(c => ({
    value: c.label,
    fontWeight: 'bold',
    backgroundColor: '#0f766e',
    textColor: '#ffffff'
  }))
  rows.push(headerRow)

  // Table data rows
  for (const record of records) {
    const row: Row = columns.map(col => {
      const raw = record[col.key]
      if (typeof raw === 'number') {
        return { value: raw }
      }
      return { value: sanitizeForSpreadsheet(raw) }
    })
    rows.push(row)
  }

  const result = writeXlsxFile(rows)
  await result.toFile(`${filename.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`)
}

/**
 * Prints a specific report element in an isolated hidden iframe.
 * Completely isolates the printed document from the leadership workspace UI,
 * enforces strict landscape @page orientation (8mm 10mm margins),
 * and eliminates trailing blank pages.
 */
export function printIsolatedReport(
  elementId: string = 'gathering-place-report-document',
  title: string = 'Gathering Place Report'
) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  const targetEl = document.getElementById(elementId)
  if (!targetEl) {
    // Fallback to standard window.print if target element not found
    const originalTitle = document.title
    document.title = `${title} — YSA AMS`
    window.print()
    document.title = originalTitle
    return
  }

  // Create isolated hidden iframe
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.setAttribute('aria-hidden', 'true')
  document.body.appendChild(iframe)

  const iframeDoc = iframe.contentWindow?.document
  if (!iframeDoc) {
    const originalTitle = document.title
    document.title = `${title} — YSA AMS`
    window.print()
    document.title = originalTitle
    if (document.body.contains(iframe)) {
      document.body.removeChild(iframe)
    }
    return
  }

  // Collect stylesheet tags from host document
  const headStyles = Array.from(
    document.querySelectorAll('style, link[rel="stylesheet"]')
  )
    .map((el) => el.outerHTML)
    .join('\n')

  iframeDoc.open()
  iframeDoc.write(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${title} — YSA AMS</title>
        ${headStyles}
        <style>
          @page {
            size: landscape;
            margin: 8mm 10mm;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background-color: #ffffff !important;
            color: #0f172a !important;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .gathering-place-report-paper {
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 auto !important;
            padding: 0 !important;
            border: none !important;
            box-shadow: none !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
        </style>
      </head>
      <body>
        ${targetEl.outerHTML}
      </body>
    </html>
  `)
  iframeDoc.close()

  // Small delay to allow images / fonts in iframe to settle
  setTimeout(() => {
    try {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    } finally {
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe)
        }
      }, 1000)
    }
  }, 300)
}

/**
 * Triggers native print preview styled for printable reports / PDF save.
 * If elementId exists, routes through printIsolatedReport.
 */
export function triggerPrintReport(
  title: string,
  elementId: string = 'gathering-place-report-document'
) {
  if (typeof document !== 'undefined' && document.getElementById(elementId)) {
    printIsolatedReport(elementId, title)
  } else {
    const originalTitle = document.title
    document.title = `${title} — YSA AMS`
    window.print()
    document.title = originalTitle
  }
}
