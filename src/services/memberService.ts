import { supabase } from '../lib/supabase'
import { MemberRecord, StakeUnit } from '../types/database'

export type CanonicalMemberGender = 'male' | 'female'

export interface CreateMemberParams {
  id?: string
  fullName: string
  preferredName?: string
  gender?: CanonicalMemberGender | string | null
  phoneNumber?: string
  email?: string
  homeUnitId: string
  memberNumber?: string
  isActive?: boolean
}

export interface GenderNormalizationResult {
  valid: boolean
  value: CanonicalMemberGender | null
  wasNormalized: boolean
  raw: string
  error?: string
}

/**
 * Normalizes CSV and form gender representations to the canonical values
 * permitted by `public.members` constraint `members_gender_check` (`'male'`, `'female'`, or `null`).
 *
 * Mapping rules:
 * - 'M', 'm', 'Male', 'MALE' -> 'male' (wasNormalized = true)
 * - 'male' -> 'male' (wasNormalized = false)
 * - 'F', 'f', 'Female', 'FEMALE' -> 'female' (wasNormalized = true)
 * - 'female' -> 'female' (wasNormalized = false)
 * - '' / null / undefined -> null (nullable in public.members)
 * - Any other value -> invalid with clear error message
 */
export function normalizeMemberGender(raw?: string | null): GenderNormalizationResult {
  const original = raw == null ? '' : String(raw)
  const trimmed = original.trim()

  if (!trimmed) {
    return {
      valid: true,
      value: null,
      wasNormalized: false,
      raw: original
    }
  }

  const lower = trimmed.toLowerCase()

  if (lower === 'male' || lower === 'm') {
    return {
      valid: true,
      value: 'male',
      wasNormalized: trimmed !== 'male',
      raw: original
    }
  }

  if (lower === 'female' || lower === 'f') {
    return {
      valid: true,
      value: 'female',
      wasNormalized: trimmed !== 'female',
      raw: original
    }
  }

  return {
    valid: false,
    value: null,
    wasNormalized: false,
    raw: original,
    error: `Invalid gender value "${trimmed}". Allowed values are Male (M, male) or Female (F, female), or empty.`
  }
}

export interface MemberCsvFieldError {
  /** 1-based data row number (excluding header row) */
  rowNumber: number
  /** 1-based line number in the CSV file (including header row) */
  csvLineNumber: number
  column: string
  category:
    | 'missing_required'
    | 'gender_mapping'
    | 'invalid_uuid'
    | 'invalid_unit'
    | 'invalid_format'
    | 'duplicate_or_conflict'
  message: string
  rawValue?: string
}

export interface NormalizedMemberCsvRow {
  rowNumber: number
  csvLineNumber: number
  id?: string
  memberNumber: string | null
  fullName: string
  preferredName: string | null
  gender: CanonicalMemberGender | null
  rawGender: string
  genderWasNormalized: boolean
  phoneNumber: string | null
  email: string | null
  homeUnitId: string
  homeUnitName?: string
  isActive: boolean
}

export interface MemberCsvValidationSummary {
  totalRows: number
  validRows: number
  invalidRows: number
  genderMappingIssues: number
  genderNormalizedCount: number
  missingRequiredFields: number
  invalidUnitOrUuidReferences: number
  duplicateOrConflictingRecords: number
  formatIssues: number
}

export interface MemberCsvValidationResult {
  isValid: boolean
  summary: MemberCsvValidationSummary
  validRecords: NormalizedMemberCsvRow[]
  errors: MemberCsvFieldError[]
  rowErrorsByRow: Record<number, MemberCsvFieldError[]>
}

export interface ValidateMembersCsvOptions {
  units: Pick<StakeUnit, 'id' | 'unitName' | 'isActive'>[]
  existingMembers?: Pick<
    MemberRecord,
    'id' | 'memberNumber' | 'fullName' | 'homeUnitId'
  >[]
  allowedUnitIds?: string[] | null
}

export interface MemberCsvImportResult {
  success: boolean
  insertedCount: number
  validation: MemberCsvValidationResult
  error?: string
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value.trim())
}

/**
 * RFC 4180 compliant CSV row splitter supporting quoted fields with commas and escaped quotes.
 */
function parseCsvRows(csvContent: string): string[][] {
  const rows: string[][] = []
  const normalized = csvContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  let currentField = ''
  let currentRow: string[] = []
  let inQuotes = false

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < normalized.length && normalized[i + 1] === '"') {
          currentField += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        currentField += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        currentRow.push(currentField)
        currentField = ''
      } else if (ch === '\n') {
        currentRow.push(currentField)
        rows.push(currentRow)
        currentRow = []
        currentField = ''
      } else {
        currentField += ch
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField)
    rows.push(currentRow)
  }

  // Filter out trailing completely blank lines
  return rows.filter((row) => row.some((cell) => cell.trim().length > 0))
}

function normalizeHeaderName(rawHeader: string): string {
  return rawHeader
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

/**
 * Validates an entire Member CSV prior to insertion.
 * Enforces:
 * - Required fields (`full_name`, and `home_unit_id` or `unit_name`)
 * - Canonical gender mapping (`M`/`Male` -> `'male'`, `F`/`Female` -> `'female'`, blank -> `null`, unknown -> error)
 * - UUID format validation (`id`, `home_unit_id`)
 * - Unit existence against `stake_units` (and optional unit scope restrictions)
 * - Phone & email sanity validation
 * - Intra-CSV and existing database duplicate/conflict detection (by `id`, `member_number`, or `full_name + home_unit_id`)
 */
export function validateMembersCsv(
  csvContent: string,
  options: ValidateMembersCsvOptions
): MemberCsvValidationResult {
  const allRows = parseCsvRows(csvContent)
  const emptySummary: MemberCsvValidationSummary = {
    totalRows: 0,
    validRows: 0,
    invalidRows: 0,
    genderMappingIssues: 0,
    genderNormalizedCount: 0,
    missingRequiredFields: 0,
    invalidUnitOrUuidReferences: 0,
    duplicateOrConflictingRecords: 0,
    formatIssues: 0
  }

  if (allRows.length === 0) {
    return {
      isValid: false,
      summary: emptySummary,
      validRecords: [],
      errors: [
        {
          rowNumber: 0,
          csvLineNumber: 1,
          column: 'csv',
          category: 'missing_required',
          message: 'CSV file is empty.'
        }
      ],
      rowErrorsByRow: {}
    }
  }

  const rawHeaders = allRows[0].map(normalizeHeaderName)
  const hasRecognizedHeader = rawHeaders.some((h) =>
    [
      'id',
      'full_name',
      'fullname',
      'name',
      'gender',
      'sex',
      'home_unit_id',
      'unit_id',
      'unit_name',
      'home_unit_name',
      'ward',
      'branch',
      'member_number',
      'phone_number',
      'phone',
      'email'
    ].includes(h)
  )

  if (!hasRecognizedHeader) {
    return {
      isValid: false,
      summary: emptySummary,
      validRecords: [],
      errors: [
        {
          rowNumber: 0,
          csvLineNumber: 1,
          column: 'header',
          category: 'missing_required',
          message:
            'CSV header row is missing required column names (expected full_name and home_unit_id or unit_name).'
        }
      ],
      rowErrorsByRow: {}
    }
  }

  const colIndex = (candidates: string[]): { idx: number; header: string } => {
    for (const candidate of candidates) {
      const idx = rawHeaders.indexOf(candidate)
      if (idx !== -1) {
        return { idx, header: candidate }
      }
    }
    return { idx: -1, header: candidates[0] }
  }

  const idCol = colIndex(['id', 'member_id'])
  const memberNumberCol = colIndex(['member_number', 'record_number', 'mrn'])
  const fullNameCol = colIndex(['full_name', 'fullname', 'name'])
  const preferredNameCol = colIndex(['preferred_name', 'preferredname', 'nickname'])
  const genderCol = colIndex(['gender', 'sex'])
  const phoneCol = colIndex(['phone_number', 'phone', 'mobile', 'contact_phone'])
  const emailCol = colIndex(['email', 'email_address'])
  const homeUnitIdCol = colIndex(['home_unit_id', 'unit_id'])
  const unitNameCol = colIndex(['unit_name', 'home_unit_name', 'ward', 'branch', 'unit'])
  const isActiveCol = colIndex(['is_active', 'active', 'status'])

  // Build unit lookup maps
  const unitsById = new Map<string, Pick<StakeUnit, 'id' | 'unitName' | 'isActive'>>()
  const unitsByNameLower = new Map<string, Pick<StakeUnit, 'id' | 'unitName' | 'isActive'>>()
  for (const u of options.units || []) {
    unitsById.set(u.id.toLowerCase(), u)
    unitsByNameLower.set(u.unitName.trim().toLowerCase(), u)
  }

  const allowedUnitSet =
    options.allowedUnitIds && options.allowedUnitIds.length > 0
      ? new Set(options.allowedUnitIds.map((id) => id.toLowerCase()))
      : null

  // Build existing member identity sets
  const existingById = new Map<string, { fullName: string; homeUnitId: string }>()
  const existingByMemberNumber = new Map<string, { id: string; fullName: string }>()
  const existingByNameAndUnit = new Map<string, { id: string; fullName: string }>()

  for (const m of options.existingMembers || []) {
    if (m.id) {
      existingById.set(m.id.toLowerCase(), {
        fullName: m.fullName,
        homeUnitId: m.homeUnitId
      })
    }
    if (m.memberNumber && m.memberNumber.trim()) {
      existingByMemberNumber.set(m.memberNumber.trim().toLowerCase(), {
        id: m.id,
        fullName: m.fullName
      })
    }
    if (m.fullName && m.homeUnitId) {
      const key = `${m.fullName.trim().toLowerCase()}::${m.homeUnitId.toLowerCase()}`
      existingByNameAndUnit.set(key, { id: m.id, fullName: m.fullName })
    }
  }

  // Intra-CSV duplicate tracking
  const seenCsvIds = new Map<string, number>()
  const seenCsvMemberNumbers = new Map<string, number>()
  const seenCsvNameAndUnit = new Map<string, number>()

  const dataRows = allRows.slice(1)
  const errors: MemberCsvFieldError[] = []
  const rowErrorsByRow: Record<number, MemberCsvFieldError[]> = {}
  const validRecords: NormalizedMemberCsvRow[] = []

  let genderMappingIssues = 0
  let genderNormalizedCount = 0
  let missingRequiredFields = 0
  let invalidUnitOrUuidReferences = 0
  let duplicateOrConflictingRecords = 0
  let formatIssues = 0

  const addError = (err: MemberCsvFieldError) => {
    errors.push(err)
    if (!rowErrorsByRow[err.rowNumber]) {
      rowErrorsByRow[err.rowNumber] = []
    }
    rowErrorsByRow[err.rowNumber].push(err)
  }

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]
    const rowNumber = i + 1
    const csvLineNumber = i + 2

    let rowHasMissingRequired = false
    let rowHasGenderIssue = false
    let rowHasUnitOrUuidIssue = false
    let rowHasDuplicateIssue = false
    let rowHasFormatIssue = false

    const getCell = (col: { idx: number }) =>
      col.idx >= 0 && col.idx < row.length ? row[col.idx].trim() : ''

    const rawId = getCell(idCol)
    const rawMemberNumber = getCell(memberNumberCol)
    const rawFullName = getCell(fullNameCol)
    const rawPreferredName = getCell(preferredNameCol)
    const rawGender = getCell(genderCol)
    const rawPhone = getCell(phoneCol)
    const rawEmail = getCell(emailCol)
    const rawHomeUnitId = getCell(homeUnitIdCol)
    const rawUnitName = getCell(unitNameCol)
    const rawIsActive = getCell(isActiveCol)

    // 1. Validate required full_name
    if (!rawFullName) {
      rowHasMissingRequired = true
      addError({
        rowNumber,
        csvLineNumber,
        column: fullNameCol.header,
        category: 'missing_required',
        message: 'Missing required field "full_name".',
        rawValue: rawFullName
      })
    }

    // 2. Validate optional UUID `id`
    let resolvedId: string | undefined = undefined
    if (rawId) {
      if (!isValidUuid(rawId)) {
        rowHasUnitOrUuidIssue = true
        addError({
          rowNumber,
          csvLineNumber,
          column: idCol.header,
          category: 'invalid_uuid',
          message: `Invalid UUID format for "${idCol.header}": "${rawId}".`,
          rawValue: rawId
        })
      } else {
        resolvedId = rawId.toLowerCase()
      }
    }

    // 3. Validate required unit reference (`home_unit_id` or `unit_name`)
    let resolvedUnitId = ''
    let resolvedUnitName: string | undefined = undefined

    if (!rawHomeUnitId && !rawUnitName) {
      rowHasMissingRequired = true
      addError({
        rowNumber,
        csvLineNumber,
        column: homeUnitIdCol.idx >= 0 ? homeUnitIdCol.header : unitNameCol.header,
        category: 'missing_required',
        message: 'Missing required unit reference ("home_unit_id" or "unit_name").',
        rawValue: ''
      })
    } else if (rawHomeUnitId) {
      if (!isValidUuid(rawHomeUnitId)) {
        // Check if user put a unit name inside home_unit_id column
        const fallbackByName = unitsByNameLower.get(rawHomeUnitId.toLowerCase())
        if (fallbackByName) {
          resolvedUnitId = fallbackByName.id
          resolvedUnitName = fallbackByName.unitName
        } else {
          rowHasUnitOrUuidIssue = true
          addError({
            rowNumber,
            csvLineNumber,
            column: homeUnitIdCol.header,
            category: 'invalid_uuid',
            message: `Invalid UUID format for "${homeUnitIdCol.header}": "${rawHomeUnitId}".`,
            rawValue: rawHomeUnitId
          })
        }
      } else {
        const matchedUnit = unitsById.get(rawHomeUnitId.toLowerCase())
        if (!matchedUnit) {
          rowHasUnitOrUuidIssue = true
          addError({
            rowNumber,
            csvLineNumber,
            column: homeUnitIdCol.header,
            category: 'invalid_unit',
            message: `Unit ID "${rawHomeUnitId}" does not exist in stake_units.`,
            rawValue: rawHomeUnitId
          })
        } else {
          resolvedUnitId = matchedUnit.id
          resolvedUnitName = matchedUnit.unitName
        }
      }
    } else if (rawUnitName) {
      const matchedUnit = unitsByNameLower.get(rawUnitName.toLowerCase())
      if (!matchedUnit) {
        rowHasUnitOrUuidIssue = true
        addError({
          rowNumber,
          csvLineNumber,
          column: unitNameCol.header,
          category: 'invalid_unit',
          message: `Unit "${rawUnitName}" does not exist in stake_units.`,
          rawValue: rawUnitName
        })
      } else {
        resolvedUnitId = matchedUnit.id
        resolvedUnitName = matchedUnit.unitName
      }
    }

    if (
      resolvedUnitId &&
      allowedUnitSet &&
      !allowedUnitSet.has(resolvedUnitId.toLowerCase())
    ) {
      rowHasUnitOrUuidIssue = true
      addError({
        rowNumber,
        csvLineNumber,
        column: rawHomeUnitId ? homeUnitIdCol.header : unitNameCol.header,
        category: 'invalid_unit',
        message: `Unauthorized unit reference "${resolvedUnitName || resolvedUnitId}". You can only import members into your assigned unit(s).`,
        rawValue: rawHomeUnitId || rawUnitName
      })
    }

    // 4. Validate and normalize gender
    const genderCheck = normalizeMemberGender(rawGender)
    if (!genderCheck.valid) {
      rowHasGenderIssue = true
      addError({
        rowNumber,
        csvLineNumber,
        column: genderCol.header,
        category: 'gender_mapping',
        message:
          genderCheck.error ||
          `Invalid gender value "${rawGender}" in column "${genderCol.header}".`,
        rawValue: rawGender
      })
    } else if (genderCheck.wasNormalized) {
      genderNormalizedCount++
    }

    // 5. Validate optional email & phone format
    if (rawEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      rowHasFormatIssue = true
      addError({
        rowNumber,
        csvLineNumber,
        column: emailCol.header,
        category: 'invalid_format',
        message: `Invalid email address format "${rawEmail}".`,
        rawValue: rawEmail
      })
    }

    if (rawPhone && rawPhone.length > 30) {
      rowHasFormatIssue = true
      addError({
        rowNumber,
        csvLineNumber,
        column: phoneCol.header,
        category: 'invalid_format',
        message: `Phone number "${rawPhone}" exceeds maximum length (30 characters).`,
        rawValue: rawPhone
      })
    }

    // 6. Validate optional boolean `is_active`
    let resolvedIsActive = true
    if (rawIsActive) {
      const lowerActive = rawIsActive.toLowerCase()
      if (['true', '1', 'yes', 'y', 'active'].includes(lowerActive)) {
        resolvedIsActive = true
      } else if (['false', '0', 'no', 'n', 'archived', 'inactive'].includes(lowerActive)) {
        resolvedIsActive = false
      } else {
        rowHasFormatIssue = true
        addError({
          rowNumber,
          csvLineNumber,
          column: isActiveCol.header,
          category: 'invalid_format',
          message: `Invalid boolean/status value "${rawIsActive}" for "${isActiveCol.header}".`,
          rawValue: rawIsActive
        })
      }
    }

    // 7. Duplicate & conflict detection (CSV internal + existing DB records)
    if (resolvedId) {
      const prevRow = seenCsvIds.get(resolvedId)
      if (prevRow !== undefined) {
        rowHasDuplicateIssue = true
        addError({
          rowNumber,
          csvLineNumber,
          column: idCol.header,
          category: 'duplicate_or_conflict',
          message: `Duplicate member UUID "${rawId}" (already appears on CSV row ${prevRow}).`,
          rawValue: rawId
        })
      } else {
        seenCsvIds.set(resolvedId, rowNumber)
      }

      const existingIdMatch = existingById.get(resolvedId)
      if (existingIdMatch) {
        rowHasDuplicateIssue = true
        addError({
          rowNumber,
          csvLineNumber,
          column: idCol.header,
          category: 'duplicate_or_conflict',
          message: `Member UUID "${rawId}" already exists in the database (${existingIdMatch.fullName}).`,
          rawValue: rawId
        })
      }
    }

    if (rawMemberNumber) {
      const normNum = rawMemberNumber.toLowerCase()
      const prevRow = seenCsvMemberNumbers.get(normNum)
      if (prevRow !== undefined) {
        rowHasDuplicateIssue = true
        addError({
          rowNumber,
          csvLineNumber,
          column: memberNumberCol.header,
          category: 'duplicate_or_conflict',
          message: `Duplicate member_number "${rawMemberNumber}" (already appears on CSV row ${prevRow}).`,
          rawValue: rawMemberNumber
        })
      } else {
        seenCsvMemberNumbers.set(normNum, rowNumber)
      }

      const existingNumMatch = existingByMemberNumber.get(normNum)
      if (existingNumMatch) {
        rowHasDuplicateIssue = true
        addError({
          rowNumber,
          csvLineNumber,
          column: memberNumberCol.header,
          category: 'duplicate_or_conflict',
          message: `member_number "${rawMemberNumber}" already exists in the database (${existingNumMatch.fullName}).`,
          rawValue: rawMemberNumber
        })
      }
    }

    if (rawFullName && resolvedUnitId) {
      const nameUnitKey = `${rawFullName.toLowerCase()}::${resolvedUnitId.toLowerCase()}`
      const prevRow = seenCsvNameAndUnit.get(nameUnitKey)
      if (prevRow !== undefined) {
        rowHasDuplicateIssue = true
        addError({
          rowNumber,
          csvLineNumber,
          column: fullNameCol.header,
          category: 'duplicate_or_conflict',
          message: `Duplicate member "${rawFullName}" in unit "${resolvedUnitName || resolvedUnitId}" (already appears on CSV row ${prevRow}).`,
          rawValue: rawFullName
        })
      } else {
        seenCsvNameAndUnit.set(nameUnitKey, rowNumber)
      }

      const existingNameUnitMatch = existingByNameAndUnit.get(nameUnitKey)
      if (existingNameUnitMatch) {
        rowHasDuplicateIssue = true
        addError({
          rowNumber,
          csvLineNumber,
          column: fullNameCol.header,
          category: 'duplicate_or_conflict',
          message: `Member "${rawFullName}" already exists in unit "${resolvedUnitName || resolvedUnitId}".`,
          rawValue: rawFullName
        })
      }
    }

    if (rowHasMissingRequired) missingRequiredFields++
    if (rowHasGenderIssue) genderMappingIssues++
    if (rowHasUnitOrUuidIssue) invalidUnitOrUuidReferences++
    if (rowHasDuplicateIssue) duplicateOrConflictingRecords++
    if (rowHasFormatIssue) formatIssues++

    const currentRowErrors = rowErrorsByRow[rowNumber] || []
    if (currentRowErrors.length === 0) {
      validRecords.push({
        rowNumber,
        csvLineNumber,
        id: resolvedId,
        memberNumber: rawMemberNumber || null,
        fullName: rawFullName,
        preferredName: rawPreferredName || null,
        gender: genderCheck.value,
        rawGender,
        genderWasNormalized: genderCheck.wasNormalized,
        phoneNumber: rawPhone || null,
        email: rawEmail || null,
        homeUnitId: resolvedUnitId,
        homeUnitName: resolvedUnitName,
        isActive: resolvedIsActive
      })
    }
  }

  const totalRows = dataRows.length
  const validRows = validRecords.length
  const invalidRows = totalRows - validRows

  return {
    isValid: totalRows > 0 && invalidRows === 0,
    summary: {
      totalRows,
      validRows,
      invalidRows,
      genderMappingIssues,
      genderNormalizedCount,
      missingRequiredFields,
      invalidUnitOrUuidReferences,
      duplicateOrConflictingRecords,
      formatIssues
    },
    validRecords,
    errors,
    rowErrorsByRow
  }
}

export const memberService = {
  async listMembers(unitIdFilter?: string | string[] | null): Promise<MemberRecord[]> {
    if (Array.isArray(unitIdFilter) && unitIdFilter.length === 0) {
      return []
    }

    let query = supabase
      .from('members')
      .select('*, stake_units(unit_name)')
      .order('full_name', { ascending: true })

    if (Array.isArray(unitIdFilter)) {
      query = query.in('home_unit_id', unitIdFilter)
    } else if (unitIdFilter) {
      query = query.eq('home_unit_id', unitIdFilter)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    return (data || []).map((m: any) => ({
      id: m.id,
      memberNumber: m.member_number,
      fullName: m.full_name,
      preferredName: m.preferred_name,
      gender: m.gender,
      phoneNumber: m.phone_number,
      email: m.email,
      homeUnitId: m.home_unit_id,
      homeUnitName: m.stake_units?.unit_name,
      isActive: m.is_active,
      createdAt: m.created_at,
      updatedAt: m.updated_at
    }))
  },

  async createMember(params: CreateMemberParams): Promise<MemberRecord> {
    const genderCheck = normalizeMemberGender(params.gender ?? null)
    if (!genderCheck.valid) {
      throw new Error(genderCheck.error || 'Invalid member gender value.')
    }

    const insertPayload: Record<string, any> = {
      full_name: params.fullName.trim(),
      preferred_name: params.preferredName?.trim() || null,
      gender: genderCheck.value,
      phone_number: params.phoneNumber?.trim() || null,
      email: params.email?.trim() || null,
      home_unit_id: params.homeUnitId,
      member_number: params.memberNumber?.trim() || null,
      is_active: params.isActive ?? true
    }

    if (params.id && isValidUuid(params.id)) {
      insertPayload.id = params.id.trim().toLowerCase()
    }

    const { data, error } = await supabase
      .from('members')
      .insert(insertPayload)
      .select('*, stake_units(unit_name)')
      .single()

    if (error) throw new Error(error.message)
    return {
      id: data.id,
      memberNumber: data.member_number,
      fullName: data.full_name,
      preferredName: data.preferred_name,
      gender: data.gender,
      phoneNumber: data.phone_number,
      email: data.email,
      homeUnitId: data.home_unit_id,
      homeUnitName: data.stake_units?.unit_name,
      isActive: data.is_active,
      createdAt: data.created_at
    }
  },

  /**
   * Validates the entire CSV and executes an atomic batch insert only when
   * every row passes validation (`invalidRows === 0`).
   * Prevents partial imports, preserves explicit UUIDs and unit relationships,
   * and never overwrites existing member records.
   */
  async importMembersFromCsv(
    csvContent: string,
    options: ValidateMembersCsvOptions
  ): Promise<MemberCsvImportResult> {
    const validation = validateMembersCsv(csvContent, options)

    if (!validation.isValid || validation.summary.invalidRows > 0) {
      return {
        success: false,
        insertedCount: 0,
        validation,
        error:
          validation.summary.totalRows === 0
            ? 'No member rows found in CSV.'
            : `Import blocked: ${validation.summary.invalidRows} of ${validation.summary.totalRows} row(s) failed pre-import validation. Fix the reported rows and retry.`
      }
    }

    const insertRows = validation.validRecords.map((row) => {
      const payload: Record<string, any> = {
        full_name: row.fullName,
        preferred_name: row.preferredName,
        gender: row.gender,
        phone_number: row.phoneNumber,
        email: row.email,
        home_unit_id: row.homeUnitId,
        member_number: row.memberNumber,
        is_active: row.isActive
      }
      if (row.id) {
        payload.id = row.id
      }
      return payload
    })

    // Single multi-row INSERT statement in PostgREST is executed atomically within a single PostgreSQL transaction.
    const { data, error } = await supabase
      .from('members')
      .insert(insertRows)
      .select('id')

    if (error) {
      return {
        success: false,
        insertedCount: 0,
        validation,
        error: error.message
      }
    }

    return {
      success: true,
      insertedCount: Array.isArray(data) ? data.length : insertRows.length,
      validation
    }
  },

  async toggleMemberStatus(memberId: string, isActive: boolean): Promise<void> {
    const { error } = await supabase
      .from('members')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', memberId)

    if (error) throw new Error(error.message)
  }
}
