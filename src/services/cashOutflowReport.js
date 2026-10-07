import { isManagementExpense, normalizeExpense, fundingSourceLabel } from './expenseReporting.js'
import { resolveFinancialBusinessDate } from './financialCenter.js'
import { employeeCodeOf, employeeNameOf, matchEmployeeRecord } from './employeeReport.js'

const text = value => String(value ?? '').trim()
const amount = value => { const number = Number(value); return Number.isFinite(number) ? number : 0 }
const isVoided = row => row?.status === 'voided' || row?.voided === true
const keyText = value => text(value).toLocaleLowerCase('ar-IQ').replace(/[\u200f\u200e\u061c]/g, '').replace(/[\s_\-]+/g, ' ')
const NON_CASH_MARKERS = new Set(['electronic', 'card', 'bank', 'transfer', 'non-cash', 'noncash', 'آجل', 'اجل', 'إلكتروني', 'الكتروني', 'بطاقة', 'تحويل'])
const CASH_OUTFLOW_TYPES = new Set(['withdrawal', 'expense', 'cash out', 'cashout', 'manual cash out', 'manual_cash_out', 'employee withdrawal', 'employee_withdrawal', 'cashbox paid expense', 'cashbox-paid expense', 'cashbox_paid_expense', 'paid expense', 'paid_expense'])
const NON_OUTFLOW_TYPES = new Set(['deposit', 'return', 'sale', 'cash sale', 'cash_sale', 'electronic sale', 'electronic_sale', 'settlement', 'cash count', 'cash_count', 'count', 'income', 'transfer in', 'transfer_in'])
const markerOf = row => keyText(row?.paymentSource || row?.payment_source || row?.paymentMethod || row?.payment_method || row?.paidFrom || row?.paid_from || row?.sourceType)
const isCashExpense = row => {
  if (isManagementExpense(row)) return false
  if (row?.isCash === false || row?.cash === false || row?.cashPaid === false) return false
  const marker = markerOf(row)
  if (NON_CASH_MARKERS.has(marker)) return false
  return !(['historical', 'historical expense', 'non cash historical'].includes(marker) && row?.isCash !== true && row?.cash !== true)
}
const refsOf = row => [row?.id, row?.expenseId, row?.transactionId, row?.sourceRefId, row?.linkedExpenseId, row?.linkedTransactionId, row?.source_key, row?.sourceKey].map(text).filter(Boolean)
const dateOf = (row, operationalDayDates) => resolveFinancialBusinessDate(row, operationalDayDates) || text(row?.businessDate || row?.business_date)
const personKey = row => keyText(row?.employeeId || row?.staffId || row?.cashierId || row?.employeeCode || row?.staffCode || row?.cashierCode || row?.employeeNameSnapshot || row?.cashierNameSnapshot || row?.person || row?.cashierName)
const descriptionOf = row => text(row?.description || row?.notes || row?.reason || row?.note || row?.details)
const mirrorKeyOf = row => `${amount(row?.amount)}|${dateOf(row, {})}|${personKey(row)}|${keyText(descriptionOf(row))}`
const typeOf = row => keyText(row?.type || row?.transactionType || row?.movementType || row?.kind)
const isCashOutflowTransaction = row => {
  if (!row || isVoided(row) || amount(row.amount) <= 0) return false
  const type = typeOf(row)
  if (NON_OUTFLOW_TYPES.has(type)) return false
  if (type === 'adjustment') return amount(row.signedAmount ?? row.amount) < 0 || row?.direction === 'out' || row?.direction === 'outflow'
  return CASH_OUTFLOW_TYPES.has(type) || type.includes('withdrawal') || type.includes('cash out') || type.includes('paid expense')
}

export const normalizeCashOutflowReport = ({ expenses = [], transactions = [], staff = [], operationalDayDates = {} } = {}) => {
  const normalizedExpenses = (Array.isArray(expenses) ? expenses : []).map(row => normalizeExpense(row, { operationalDayDates })).filter(row => !isVoided(row) && amount(row.amount) > 0)
  const expenseRows = normalizedExpenses.filter(row => isCashExpense(row) || isManagementExpense(row))
  const expenseRefs = new Set(expenseRows.flatMap(refsOf))
  const expenseMirrorKeys = new Set(expenseRows.map(mirrorKeyOf))
  const rows = expenseRows.map(row => {
    const person = matchEmployeeRecord(row, staff)
    const salary = text(row.category || row.expenseCategory) === 'راتب'
    return { id: text(row.id) || `expense:${mirrorKeyOf(row)}`, source: 'expense', sourceType: 'expense', sourceLabel: fundingSourceLabel(row.fundingSource), fundingSource: row.fundingSource, typeLabel: salary ? 'راتب' : text(row.category) || 'أخرى', amount: amount(row.amount), employeeId: text(person?.id || row.employeeId || row.staffId), employeeName: text(person?.name || employeeNameOf(row) || 'غير محدد'), employeeCode: text(person?.code || employeeCodeOf(row)), description: descriptionOf(row), notes: text(row.notes || row.description), businessDate: dateOf(row, operationalDayDates), createdAt: row.createdAt || row.created_at || row.timestamp || row.date || 0, operationalDayId: text(row.operationalDayId || row.operational_day_id || row.shiftId), original: row }
  })
  for (const transaction of (Array.isArray(transactions) ? transactions : []).filter(isCashOutflowTransaction)) {
    const refs = refsOf(transaction)
    const linked = refs.some(ref => expenseRefs.has(ref))
    const mirroredExpense = typeOf(transaction) !== 'withdrawal' && expenseMirrorKeys.has(mirrorKeyOf(transaction))
    if (linked || mirroredExpense) continue
    const person = matchEmployeeRecord(transaction, staff)
    const type = typeOf(transaction)
    const withdrawal = type === 'withdrawal' || type.includes('withdrawal')
    rows.push({ id: text(transaction.id || transaction.transactionId) || `cashbox:${mirrorKeyOf(transaction)}`, source: withdrawal && transaction.fundingSource === 'management' ? 'الإدارة' : 'الصندوق', sourceLabel: withdrawal && transaction.fundingSource === 'management' ? 'من الإدارة' : (withdrawal ? 'من الصندوق' : ''), sourceType: text(transaction.type || transaction.transactionType) || 'cash_out', typeLabel: withdrawal ? 'سحوبات' : 'أخرى', fundingSource: withdrawal && transaction.fundingSource === 'management' ? 'management' : (withdrawal ? 'cashbox' : ''), amount: amount(transaction.amount), employeeId: text(person?.id || transaction.employeeId || transaction.staffId || transaction.cashierId), employeeName: text(person?.name || employeeNameOf(transaction) || 'غير محدد'), employeeCode: text(person?.code || employeeCodeOf(transaction)), description: descriptionOf(transaction), notes: text(transaction.notes || transaction.reason || transaction.note), businessDate: dateOf(transaction, operationalDayDates), createdAt: transaction.createdAt || transaction.created_at || transaction.timestamp || transaction.date || 0, operationalDayId: text(transaction.operationalDayId || transaction.operational_day_id || transaction.shiftId), original: transaction })
  }
  return rows.sort((left, right) => `${left.businessDate}|${left.createdAt}|${left.id}`.localeCompare(`${right.businessDate}|${right.createdAt}|${right.id}`))
}

export const filterCashOutflowReport = (rows, from, to, type = 'all') => (Array.isArray(rows) ? rows : []).filter(row => {
  if (from && row.businessDate < from) return false
  if (to && row.businessDate > to) return false
  if (type === 'expenses') return row.source === 'expense' && row.typeLabel !== 'راتب'
  if (type === 'salary') return row.typeLabel === 'راتب'
  if (type === 'withdrawals') return String(row.typeLabel || '').startsWith('سحوبات')
  if (type === 'other') return row.typeLabel === 'أخرى'
  return true
})
export const sumCashOutflowReport = rows => (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + amount(row.amount), 0)
