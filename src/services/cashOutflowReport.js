import { fundingSourceLabel } from './expenseReporting.js'
import { employeeCodeOf, employeeNameOf, matchEmployeeRecord } from './employeeReport.js'
import { buildMoneyOutLedger } from './moneyOutClassifier.js'

const text = value => String(value ?? '').trim()
const amount = value => { const number = Number(value); return Number.isFinite(number) ? number : 0 }
const descriptionOf = row => text(row?.description || row?.notes || row?.reason || row?.note || row?.details)

export const normalizeCashOutflowReport = ({ expenses = [], transactions = [], staff = [], operationalDayDates = {} } = {}) => {
  const rows = buildMoneyOutLedger({ expenses, transactions, operationalDayDates })
    .filter(row => row.includeInReports && row.reportBucket !== 'ignored' && ['drawer', 'admin'].includes(row.cashboxImpact) && amount(row.amount) > 0)
    .map(row => {
      const sourceRow = row.original || {}
      const person = matchEmployeeRecord(sourceRow, staff)
      const salary = row.reportBucket === 'salary'
      const withdrawal = row.reportBucket === 'withdrawal'
      const fundingSource = row.cashboxImpact === 'admin' ? 'management' : row.cashboxImpact === 'drawer' ? 'cashbox' : ''
      return { id: text(sourceRow.id || sourceRow.transactionId) || `${row.source}:${row.recordId}`, source: withdrawal ? 'withdrawal' : 'expense', sourceType: text(sourceRow.type || sourceRow.transactionType) || row.reportBucket, sourceLabel: fundingSource ? fundingSourceLabel(fundingSource) : '', fundingSource, typeLabel: withdrawal ? 'سحوبات' : (salary ? 'راتب' : text(sourceRow.category || sourceRow.expenseCategory) || 'أخرى'), amount: amount(row.amount), employeeId: text(person?.id || row.employeeId), employeeName: text(person?.name || row.employeeName || employeeNameOf(sourceRow) || 'غير محدد'), employeeCode: text(person?.code || row.employeeCode || employeeCodeOf(sourceRow)), description: descriptionOf(sourceRow), notes: text(sourceRow.notes || sourceRow.description), businessDate: row.businessDate, createdAt: sourceRow.createdAt || sourceRow.created_at || sourceRow.timestamp || sourceRow.date || 0, operationalDayId: text(sourceRow.operationalDayId || sourceRow.operational_day_id || sourceRow.shiftId), shiftType: text(sourceRow.shiftType || sourceRow.shift_type), shiftLabel: text(sourceRow.shiftLabel), original: sourceRow }
    })
  return rows.sort((left, right) => `${left.businessDate}|${left.createdAt}|${left.id}`.localeCompare(`${right.businessDate}|${right.createdAt}|${right.id}`))
}

export const filterCashOutflowReport = (rows, from, to, type = 'all') => (Array.isArray(rows) ? rows : []).filter(row => {
  if (from && row.businessDate < from) return false
  if (to && row.businessDate > to) return false
  if (type === 'expenses') return row.source === 'expense' && row.typeLabel !== 'راتب' && !String(row.typeLabel || '').startsWith('سحوبات')
  if (type === 'salary') return row.typeLabel === 'راتب'
  if (type === 'withdrawals') return String(row.typeLabel || '').startsWith('سحوبات')
  if (type === 'other') return row.typeLabel === 'أخرى'
  return true
})
export const sumCashOutflowReport = rows => (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + amount(row.amount), 0)
export const splitCashOutflowReport = rows => {
  const list = Array.isArray(rows) ? rows : []
  return {
    expenses: list.filter(row => !String(row.typeLabel || '').startsWith('سحوبات')),
    withdrawals: list.filter(row => String(row.typeLabel || '').startsWith('سحوبات')),
  }
}
export const summarizeCashOutflowReport = rows => {
  const split = splitCashOutflowReport(rows)
  const normalBusinessExpensesTotal = sumCashOutflowReport(split.expenses)
  const withdrawalsTotal = sumCashOutflowReport(split.withdrawals)
  return { ...split, normalBusinessExpensesTotal, withdrawalsTotal, cashOutTotal: normalBusinessExpensesTotal + withdrawalsTotal }
}
