const BAGHDAD_TIME_ZONE = 'Asia/Baghdad'
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

const firstValue = (...values) => values.find(value => value !== undefined && value !== null && value !== '')

export const LEGACY_EXPENSE_DEFAULT = 'cashbox'
export const normalizeFundingSource = value => value === 'management' ? 'management' : LEGACY_EXPENSE_DEFAULT
export const fundingSourceLabel = value => normalizeFundingSource(value) === 'management' ? 'من الإدارة' : 'من الصندوق'
export const isCashboxExpense = expense => normalizeFundingSource(expense?.fundingSource ?? expense?.paymentSource) === 'cashbox'
export const isManagementExpense = expense => normalizeFundingSource(expense?.fundingSource ?? expense?.paymentSource) === 'management'
export const isDeletedExpense = expense => ['deleted', 'voided'].includes(String(expense?.status || '').toLowerCase()) || expense?.deleted === true || expense?.voided === true
export const isActiveExpense = expense => !isDeletedExpense(expense)

const normalizeDigits = value => String(value ?? '').replace(/[٠-٩۰-۹]/g, digit => {
  const digits = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'
  const index = digits.indexOf(digit)
  return index >= 10 ? String(index - 10) : String(index)
})

const dateKeyFromInstant = instant => {
  if (!Number.isFinite(instant)) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BAGHDAD_TIME_ZONE, numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(instant)).reduce((result, part) => {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') result[part.type] = part.value
    return result
  }, {})
  return parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : ''
}

export const normalizeDateKey = value => {
  const normalized = normalizeDigits(String(value ?? '').trim())
  const isoLike = normalized.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/)
  const dayFirst = normalized.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/)
  const match = isoLike ? [isoLike[0], isoLike[1], isoLike[2], isoLike[3]] : dayFirst ? [dayFirst[0], dayFirst[3], dayFirst[2], dayFirst[1]] : null
  if (!match) return ''
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  const check = new Date(Date.UTC(year, month - 1, day))
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : ''
}

export const normalizeTimestamp = value => {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number' || /^\s*[٠-٩۰-۹\d]+\s*$/.test(String(value))) {
    const numeric = Number(normalizeDigits(value))
    if (!Number.isFinite(numeric) || numeric <= 0) return 0
    return numeric < 1e12 ? numeric * 1000 : numeric
  }
  const normalized = normalizeDigits(value).trim()
  const dateKey = normalizeDateKey(normalized)
  if (dateKey && /^(?:\d{4}[-\/]\d{1,2}[-\/]\d{1,2}|\d{1,2}[-\/]\d{1,2}[-\/]\d{4})$/.test(normalized)) return Date.parse(`${dateKey}T12:00:00+03:00`)
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

export const safeCreatedAtForBusinessDate = businessDate => {
  const normalized = normalizeDateKey(businessDate)
  const timestamp = normalized ? Date.parse(`${normalized}T12:00:00+03:00`) : 0
  return Number.isFinite(timestamp) ? timestamp : 0
}

export const getLocalDateKey = value => normalizeDateKey(value) || dateKeyFromInstant(normalizeTimestamp(value))

export const resolveExpenseBusinessDate = (expense, { operationalDayDates = {} } = {}) => {
  const explicitBusinessDate = normalizeDateKey(firstValue(expense?.businessDate, expense?.business_date, expense?.shiftBusinessDate))
  if (explicitBusinessDate) return explicitBusinessDate

  const operationalDayId = String(firstValue(expense?.operationalDayId, expense?.operational_day_id, expense?.shiftId, expense?.shift_id) || '').trim()
  const operationalDate = normalizeDateKey(operationalDayDates?.[operationalDayId])
  if (operationalDate) return operationalDate

  const explicitSavedDateKey = normalizeDateKey(firstValue(expense?.savedDate, expense?.localDate, expense?.dateKey, expense?.reportDate))
  if (explicitSavedDateKey) return explicitSavedDateKey

  return getLocalDateKey(firstValue(expense?.date, expense?.createdAt, expense?.created_at, expense?.timestamp))
}

export const normalizeExpense = (expense, options = {}) => {
  const raw = expense || {}
  const timestamp = normalizeTimestamp(firstValue(raw.createdAt, raw.created_at, raw.timestamp, raw.date))
  return {
    ...raw,
    id: String(firstValue(raw.id, raw.expenseId) || ''),
    amount: Number.isFinite(Number(normalizeDigits(raw.amount))) ? Number(normalizeDigits(raw.amount)) : 0,
    description: firstValue(raw.description, raw.notes, '') || '',
    notes: firstValue(raw.notes, raw.description, '') || '',
    createdAt: timestamp,
    timestamp,
    businessDate: resolveExpenseBusinessDate(raw, options),
    fundingSource: normalizeFundingSource(firstValue(raw.fundingSource, raw.paymentSource)),
    paymentSource: normalizeFundingSource(firstValue(raw.paymentSource, raw.fundingSource)),
    shift: firstValue(raw.shift, raw.shiftName, raw.shift_id, raw.shiftId, ''),
    shiftId: firstValue(raw.shiftId, raw.shift_id, ''),
  }
}

// Stable comparison key used only for the one-time local-cache migration.
// It deliberately excludes the random local id so the same legacy row cannot
// be uploaded twice when migration is retried on another device.
export const expenseFingerprint = expense => {
  const normalized = normalizeExpense(expense)
  return [
    normalized.amount,
    normalized.description.trim(),
    normalized.businessDate,
    normalized.createdAt,
    String(normalized.cashierId || ''),
  ].join('|')
}

const expensePerson = expense => {
  const value = String(firstValue(expense?.cashierId, expense?.person, expense?.cashierName, expense?.cashierNameSnapshot, '') || '').trim()
  return ['غير محدد', '—', '-'].includes(value) ? '' : value
}

export const areExpenseDuplicates = (left, right, toleranceMs = 2 * 60 * 1000) => {
  const a = normalizeExpense(left)
  const b = normalizeExpense(right)
  if (a.id && b.id && a.id === b.id) return true
  if (a.amount <= 0 || b.amount <= 0 || a.amount !== b.amount) return false
  if (a.description.trim() !== b.description.trim() || a.businessDate !== b.businessDate) return false
  if (!a.createdAt || !b.createdAt || Math.abs(a.createdAt - b.createdAt) > toleranceMs) return false
  const personA = expensePerson(a)
  const personB = expensePerson(b)
  return (!personA && !personB) || (Boolean(personA && personB) && personA === personB)
}

export const mergeExpensesConservatively = (localExpenses = [], remoteExpenses = []) => {
  const local = Array.isArray(localExpenses) ? localExpenses.map(normalizeExpense) : []
  const remote = Array.isArray(remoteExpenses) ? remoteExpenses.map(normalizeExpense) : []
  const merged = [...remote]
  for (const localRow of local) {
    const index = merged.findIndex(remoteRow => areExpenseDuplicates(localRow, remoteRow))
    if (index >= 0) merged[index] = { ...localRow, ...merged[index], syncStatus: 'synced' }
    else merged.push(localRow)
  }
  return merged
}

export const getExpensesForBusinessDate = (expenses = [], dateKey, options = {}) => {
  const selectedDateKey = normalizeDateKey(dateKey)
  if (!selectedDateKey) return []
  return (Array.isArray(expenses) ? expenses : [])
    .map(expense => normalizeExpense(expense, options))
    .filter(expense => expense.businessDate === selectedDateKey && isActiveExpense(expense))
}

export const sumExpenses = (expenses = []) => (Array.isArray(expenses) ? expenses : [])
  .reduce((sum, expense) => {
    const amount = Number(expense?.amount)
    return sum + (Number.isFinite(amount) ? amount : 0)
  }, 0)

export const filterExpensesByOperationalDay = (expenses = [], operationalDayId) =>
  (Array.isArray(expenses) ? expenses : [])
    .map(expense => normalizeExpense(expense))
    .filter(expense => String(expense.operationalDayId || '') === String(operationalDayId || '') && isActiveExpense(expense))

// Historical entry must only inherit an operational day when the business
// date identifies exactly one day. Empty and duplicate matches are deliberate
// safe outcomes: neither may be attached to today's open day.
export const matchOperationalDayByBusinessDate = (days = [], businessDate) => {
  const selected = normalizeDateKey(businessDate)
  const matches = (Array.isArray(days) ? days : []).filter(day => normalizeDateKey(day?.businessDate) === selected && day?.id)
  return {
    matches,
    operationalDayId: matches.length === 1 ? String(matches[0].id) : '',
    ambiguous: matches.length > 1,
  }
}
