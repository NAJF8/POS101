const BAGHDAD_TIME_ZONE = 'Asia/Baghdad'
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

const firstValue = (...values) => values.find(value => value !== undefined && value !== null && value !== '')

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
  const match = DATE_KEY.exec(normalized)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : ''
}

export const normalizeTimestamp = value => {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number' || /^\s*[٠-٩۰-۹\d]+\s*$/.test(String(value))) {
    const numeric = Number(normalizeDigits(value))
    if (!Number.isFinite(numeric) || numeric <= 0) return 0
    return numeric < 1e12 ? numeric * 1000 : numeric
  }
  const normalized = normalizeDigits(value).trim()
  if (DATE_KEY.test(normalized)) {
    const [year, month, day] = normalized.split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : 0
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
    amount: Number.isFinite(Number(raw.amount)) ? Number(raw.amount) : 0,
    description: firstValue(raw.description, raw.notes, '') || '',
    notes: firstValue(raw.notes, raw.description, '') || '',
    createdAt: timestamp,
    timestamp,
    businessDate: resolveExpenseBusinessDate(raw, options),
    shift: firstValue(raw.shift, raw.shiftName, raw.shift_id, raw.shiftId, ''),
    shiftId: firstValue(raw.shiftId, raw.shift_id, ''),
  }
}

export const getExpensesForBusinessDate = (expenses = [], dateKey, options = {}) => {
  const selectedDateKey = normalizeDateKey(dateKey)
  if (!selectedDateKey) return []
  return (Array.isArray(expenses) ? expenses : [])
    .map(expense => normalizeExpense(expense, options))
    .filter(expense => expense.businessDate === selectedDateKey)
}

export const sumExpenses = (expenses = []) => (Array.isArray(expenses) ? expenses : [])
  .reduce((sum, expense) => {
    const amount = Number(expense?.amount)
    return sum + (Number.isFinite(amount) ? amount : 0)
  }, 0)

export const filterExpensesByOperationalDay = (expenses = [], operationalDayId) =>
  (Array.isArray(expenses) ? expenses : [])
    .map(expense => normalizeExpense(expense))
    .filter(expense => String(expense.operationalDayId || '') === String(operationalDayId || ''))
