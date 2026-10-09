import { isActiveExpense, isManagementExpense, normalizeExpense, normalizeTimestamp } from './expenseReporting.js'
import { resolveFinancialBusinessDate } from './financialCenter.js'

const amount = value => Number.isFinite(Number(value)) ? Number(value) : 0
const text = value => String(value ?? '').trim()
const voided = row => row?.status === 'voided' || row?.voided === true
const sourceOf = row => row?.fundingSource === 'management' ? 'management' : 'cashbox'
const dateOf = row => resolveFinancialBusinessDate(row) || text(row?.businessDate || row?.business_date)
const timeOf = row => normalizeTimestamp(row?.createdAt || row?.created_at || row?.timestamp || row?.date)

export const buildManagementPaymentsReport = ({ expenses = [], transactions = [], staff = [], from = '', to = '', employee = '', type = 'all' } = {}) => {
  const employeeMatches = row => !employee || String(row.employeeId || '') === String(employee) || text(row.employeeName) === text(employee)
  const inRange = row => (!from || row.businessDate >= from) && (!to || row.businessDate <= to) && employeeMatches(row)
  const rows = []
  for (const raw of expenses) {
    const expense = normalizeExpense(raw)
    if (!isActiveExpense(expense) || voided(expense) || !isManagementExpense(expense) || type === 'withdrawals') continue
    rows.push({ id: `expense:${expense.id}`, businessDate: dateOf(expense), createdAt: timeOf(expense), type: 'expense', typeLabel: 'مصروف من الإدارة', employeeId: text(expense.employeeId || expense.staffId || expense.cashierId), employeeName: text(expense.employeeNameSnapshot || expense.person || expense.cashierName || 'غير محدد'), category: text(expense.category || expense.expenseCategory || 'أخرى'), description: text(expense.description || expense.notes), amount: amount(expense.amount), operationalDay: text(expense.operationalDayId || expense.operational_day_id || expense.businessDate) })
  }
  for (const transaction of transactions) {
    if (voided(transaction) || transaction?.type !== 'withdrawal' || sourceOf(transaction) !== 'management' || type === 'expenses') continue
    rows.push({ id: `withdrawal:${transaction.id}`, businessDate: dateOf(transaction), createdAt: timeOf(transaction), type: 'withdrawal', typeLabel: 'سحب من الإدارة', employeeId: text(transaction.employeeId || transaction.staffId || transaction.cashierId), employeeName: text(transaction.employeeNameSnapshot || transaction.person || transaction.cashierName || 'غير محدد'), category: 'سحوبات', description: text(transaction.reason || transaction.description || transaction.notes), amount: amount(transaction.amount), operationalDay: text(transaction.operationalDayId || transaction.operational_day_id || transaction.businessDate) })
  }
  const filtered = rows.filter(inRange).sort((a, b) => Number(b.createdAt) - Number(a.createdAt) || String(b.businessDate).localeCompare(String(a.businessDate)) || String(b.id).localeCompare(String(a.id)))
  const managementExpenses = filtered.filter(row => row.type === 'expense').reduce((sum, row) => sum + row.amount, 0)
  const managementWithdrawals = filtered.filter(row => row.type === 'withdrawal').reduce((sum, row) => sum + row.amount, 0)
  return { rows: filtered, managementExpenses, managementWithdrawals, managementTotal: managementExpenses + managementWithdrawals }
}

export const managementPaymentTypeLabel = type => type === 'expense' ? 'مصاريف' : type === 'withdrawal' ? 'سحوبات' : 'الكل'
