import { isActiveExpense, isManagementExpense, isWithdrawalExpense, normalizeDateKey, normalizeExpense, resolveExpenseBusinessDate } from './expenseReporting.js'

const text = value => String(value ?? '').trim()
const amount = value => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
const normalized = value => text(value).toLocaleLowerCase('ar-IQ').replace(/[\u200f\u200e\u061c]/g, '').replace(/[\s_-]+/g, ' ')
const first = (...values) => values.find(value => value !== undefined && value !== null && value !== '')

const invalidStatuses = new Set(['deleted', 'voided', 'cancelled', 'canceled', 'abandoned', 'draft', 'باطل', 'ملغي'])
const isInvalid = row => invalidStatuses.has(normalized(row?.status)) || row?.deleted === true || row?.voided === true || row?.cancelled === true
const rowType = row => normalized(first(row?.type, row?.transactionType, row?.movementType, row?.recordType, row?.kind))
const rowCategory = row => normalized(first(row?.category, row?.expenseCategory))
const isSalaryMarker = row => {
  const marker = `${rowCategory(row)} ${normalized(row?.type)}`
  return marker.includes('راتب') || marker.includes('salary')
}
const idOf = row => text(first(row?.id, row?.expenseId, row?.transactionId, row?.sourceRefId))
const linkedExpenseIdOf = row => text(first(row?.linkedExpenseId, row?.sourceRefId, row?.expenseId))
const employeeIdOf = row => text(first(row?.employeeId, row?.staffId, row?.cashierId, row?.captainId, row?.userId, row?.uid, row?.createdByUid))
const employeeCodeOf = row => text(first(row?.employeeCode, row?.staffCode, row?.cashierCode, row?.captainCode, row?.code))
const employeeNameOf = row => text(first(row?.employeeNameSnapshot, row?.cashierNameSnapshot, row?.employeeName, row?.cashierName, row?.seller, row?.person, row?.name))
const shiftTypeOf = row => {
  const explicit = normalized(first(row?.shiftType, row?.shift_type))
  if (explicit.includes('morning') || explicit.includes('صباح')) return 'morning'
  if (explicit.includes('evening') || explicit.includes('مساء')) return 'evening'
  const marker = normalized(first(row?.shiftId, row?.shift_id, row?.shift, row?.shiftName, row?.shiftLabel))
  if (marker.includes('morning') || marker.includes('صباح')) return 'morning'
  if (marker.includes('evening') || marker.includes('مساء')) return 'evening'
  return explicit || marker
}

const cashboxImpactOf = row => {
  const rawValues = [row?.fundingSource, row?.paymentSource, row?.payment_source, row?.paidFrom, row?.paid_from, row?.sourceType].filter(value => value !== undefined && value !== null && text(value) !== '')
  if (!rawValues.length) return { cashboxImpact: 'drawer', warning: false, reason: 'legacy_cashbox_default' }
  const markers = rawValues.map(normalized)
  const admin = markers.some(marker => marker === 'management' || marker.includes('admin') || marker.includes('from admin') || marker.includes('من الإدارة') || marker.includes('من الادارة'))
  const drawer = markers.some(marker => marker === 'cashbox' || marker === 'cash drawer' || marker === 'drawer' || marker.includes('from cashbox') || marker.includes('from drawer') || marker.includes('الصندوق'))
  const unknown = markers.filter(marker => !admin && !drawer || (admin && !['management'].includes(marker) && !marker.includes('admin') && !marker.includes('من الإدارة') && !marker.includes('من الادارة')) || (drawer && !['cashbox', 'cash drawer', 'drawer'].includes(marker) && !marker.includes('from cashbox') && !marker.includes('from drawer') && !marker.includes('الصندوق')))
  if (admin && !drawer && unknown.length === 0) return { cashboxImpact: 'admin', warning: false, reason: 'management_source' }
  if (drawer && !admin && unknown.length === 0) return { cashboxImpact: 'drawer', warning: false, reason: 'drawer_source' }
  return { cashboxImpact: 'none', warning: true, reason: `unknown_or_conflicting_funding_source:${rawValues.map(text).join('|')}` }
}

const transactionBusinessDate = (row, operationalDayDates = {}) => {
  const explicit = normalizeDateKey(first(row?.businessDate, row?.business_date, row?.shiftBusinessDate, row?.dateKey))
  if (explicit) return explicit
  const dayId = text(first(row?.operationalDayId, row?.operational_day_id, row?.shiftId, row?.shift_id))
  const mapped = normalizeDateKey(operationalDayDates?.[dayId])
  if (mapped) return mapped
  return resolveExpenseBusinessDate(row, { operationalDayDates })
}

const identity = row => ({
  employeeId: employeeIdOf(row),
  employeeCode: employeeCodeOf(row),
  employeeName: employeeNameOf(row),
  employee: { id: employeeIdOf(row), code: employeeCodeOf(row), name: employeeNameOf(row) },
})

const baseResult = (record, source, businessDate, bucket, includeInReports, cashboxImpact, reason, extra = {}) => ({
  includeInReports,
  reportBucket: bucket,
  cashboxImpact,
  businessDate,
  shiftType: shiftTypeOf(record),
  ...identity(record),
  amount: amount(record?.amount),
  source,
  recordId: idOf(record),
  original: record,
  reason,
  ...extra,
})

export const classifyMoneyOutRecord = (record, { source = 'expense', linkedExpense = null, operationalDayDates = {} } = {}) => {
  const raw = record || {}
  const businessDate = source === 'expense'
    ? resolveExpenseBusinessDate(raw, { operationalDayDates })
    : transactionBusinessDate(raw, operationalDayDates)
  if (isInvalid(raw)) return baseResult(raw, source, businessDate, 'ignored', false, 'none', 'inactive_or_voided')

  const type = rowType(raw)
  if (source === 'transaction' && ['settlement', 'deposit', 'return', 'sale', 'income', 'cash sale', 'electronic sale'].includes(type)) {
    return baseResult(raw, source, businessDate, 'ignored', false, 'none', 'non_money_out_transaction')
  }
  if (source === 'transaction' && linkedExpense) {
    return baseResult(raw, source, businessDate, 'ignored', false, 'none', 'linked_expense_mirror', { linkedExpenseId: idOf(linkedExpense), linkedExpenseBucket: classifyMoneyOutRecord(linkedExpense, { source: 'expense', operationalDayDates }).reportBucket })
  }

  const normalizedExpense = source === 'expense' ? normalizeExpense(raw, { operationalDayDates }) : null
  const classificationRow = normalizedExpense || raw
  const bucket = isSalaryMarker(classificationRow)
    ? 'salary'
    : (source === 'transaction' && (type === 'withdrawal' || type.includes('withdrawal') || type.includes('سحب')))
      || isWithdrawalExpense(classificationRow)
      ? 'withdrawal'
      : 'business_expense'
  // Preserve the explicit source from the stored row. normalizeExpense has a
  // legacy cashbox default, which must not turn an explicit electronic/admin
  // source into a drawer outflow.
  const impact = cashboxImpactOf(raw)
  const reason = impact.warning ? `${impact.reason};classified_without_cashbox_impact` : (bucket === 'withdrawal' ? 'withdrawal_marker' : bucket === 'salary' ? 'salary_marker' : 'business_expense_marker')
  return baseResult(raw, source, businessDate, bucket, true, impact.cashboxImpact, reason, {
    linkedExpenseId: linkedExpenseIdOf(raw),
    warning: impact.warning,
  })
}

export const buildMoneyOutLedger = ({ expenses = [], transactions = [], operationalDayDates = {} } = {}) => {
  const sourceExpenses = Array.isArray(expenses) ? expenses : []
  const normalizedExpenses = sourceExpenses.map(row => normalizeExpense(row, { operationalDayDates }))
  const expenseById = new Map(normalizedExpenses.filter(row => idOf(row)).map(row => [idOf(row), row]))
  const expenseRows = sourceExpenses.map(row => classifyMoneyOutRecord(row, { source: 'expense', operationalDayDates }))
  const transactionRows = (Array.isArray(transactions) ? transactions : []).map(row => classifyMoneyOutRecord(row, { source: 'transaction', linkedExpense: expenseById.get(linkedExpenseIdOf(row)) || null, operationalDayDates }))
  return [...expenseRows, ...transactionRows]
}

export const includedMoneyOutRows = (ledger = []) => (Array.isArray(ledger) ? ledger : []).filter(row => row.includeInReports && row.reportBucket !== 'ignored')
export const moneyOutWarnings = (ledger = []) => (Array.isArray(ledger) ? ledger : []).filter(row => row.warning)

export const moneyOutRecordIsActive = record => isActiveExpense(record)
export const moneyOutRecordIsManagement = record => isManagementExpense(record)
