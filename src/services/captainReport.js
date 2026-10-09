import { isActiveExpense, isWithdrawalExpense, normalizeExpense } from './expenseReporting.js'
import { businessDateOf, filterRowsByBusinessDate, isValidDateRange } from './periodReport.js'
import { sellerEligibleStaff } from './staffEligibility.js'
import { matchesEmployee } from './employeeReport.js'

const text = value => String(value ?? '').trim()
const canonical = value => text(value).replace(/[\u200f\u200e\u061c]/g, '').replace(/[\s\u00a0]+/g, ' ').toLocaleLowerCase('ar-IQ')
const amount = value => { const number = Number(value); return Number.isFinite(number) ? number : 0 }
const isVoided = row => row?.status === 'voided' || row?.voided === true
const isClosedSale = row => ['cancelled', 'canceled', 'voided', 'abandoned', 'draft', 'باطل', 'ملغي'].includes(text(row?.status).toLocaleLowerCase('ar-IQ'))
const salaryCategory = 'راتب'
const isSalaryRecord = row => text(row?.category || row?.expenseCategory) === salaryCategory
const isInactiveTransaction = row => row?.status === 'voided' || row?.voided === true

// One report-only classifier for expense rows and cashbox transactions. It
// never writes or mutates the source records.
export const classifyExpenseRecord = (row, { source = 'expense', salaryExpenseIds = new Set() } = {}) => {
  const normalized = source === 'expense' ? normalizeExpense(row) : (row || {})
  const withdrawal = source === 'transaction'
    ? text(normalized.type || normalized.transactionType).toLocaleLowerCase('ar-IQ') === 'withdrawal' || isWithdrawalExpense(normalized)
    : isWithdrawalExpense(normalized)
  const salary = !withdrawal && (isSalaryRecord(normalized) || salaryExpenseIds.has(text(normalized.linkedExpenseId)))
  return { row: normalized, kind: withdrawal ? 'withdrawal' : salary ? 'salary' : 'expense', amount: amount(normalized.amount) }
}

export const captainNameOf = row => text(row?.name || row?.employeeNameSnapshot || row?.cashierNameSnapshot || row?.seller || row?.person)
export const captainCodeOf = row => text(row?.code || row?.employeeCode || row?.staffCode)

// Match stable identifiers first, then exact normalized names. Similar names
// remain ambiguous and are intentionally excluded from a captain report.
export const matchCaptainRecord = (record, captain, staff = []) => {
  return matchesEmployee(record, captain)
}

export const filterCaptainCandidates = (staff = [], query = '') => {
  const needle = canonical(query)
  const people = sellerEligibleStaff(staff).filter(person => person?.id && person?.name)
  if (!needle) return people
  return people.filter(person => [person.name, person.code, person.id].some(value => canonical(value).includes(needle)))
}

export const buildCaptainReport = ({ captain = null, staff = [], sales = [], expenses = [], transactions = [], from = '', to = '', sections = ['sales', 'expenses', 'withdrawals', 'salary'] } = {}) => {
  const selected = new Set(Array.isArray(sections) ? sections : [])
  const valid = Boolean(captain) && isValidDateRange(from, to)
  const inRange = row => !isVoided(row) && valid && businessDateOf(row) >= from && businessDateOf(row) <= to && matchCaptainRecord(row, captain, staff)
  const matchedSales = filterRowsByBusinessDate(sales, from, to).filter(row => !isClosedSale(row) && inRange(row))
  const normalizedExpenses = filterRowsByBusinessDate(expenses, from, to).filter(row => isActiveExpense(row) && inRange(row)).map(row => classifyExpenseRecord(row))
  const matchedTransactions = filterRowsByBusinessDate(transactions, from, to).filter(row => !isInactiveTransaction(row) && inRange(row))
  const linkedExpenseIds = new Set(matchedTransactions.map(row => text(row.linkedExpenseId || row.sourceRefId)).filter(Boolean))
  const salaryExpenseIds = new Set(normalizedExpenses.filter(item => item.kind === 'salary').map(item => text(item.row.id)).filter(Boolean))
  const classifiedTransactions = matchedTransactions.map(row => classifyExpenseRecord(row, { source: 'transaction', salaryExpenseIds }))
  const matchedExpenses = [
    ...normalizedExpenses.filter(item => item.kind === 'expense' && !linkedExpenseIds.has(text(item.row.id))).map(item => item.row),
    ...classifiedTransactions.filter(item => item.kind === 'expense').map(item => item.row),
  ]
  const matchedSalaries = [
    ...normalizedExpenses.filter(item => item.kind === 'salary' && !linkedExpenseIds.has(text(item.row.id))).map(item => item.row),
    ...classifiedTransactions.filter(item => item.kind === 'salary').map(item => item.row),
  ]
  const matchedWithdrawals = [
    ...normalizedExpenses.filter(item => item.kind === 'withdrawal' && !linkedExpenseIds.has(text(item.row.id))).map(item => item.row),
    ...classifiedTransactions.filter(item => item.kind === 'withdrawal').map(item => item.row),
  ]
  const totalOf = rows => rows.reduce((sum, row) => sum + amount(row.amount ?? row.total ?? row.subtotal), 0)
  const totalSales = matchedSales.reduce((sum, row) => sum + amount(row.total ?? row.subtotal), 0)
  const cashSales = matchedSales.filter(row => (row.paymentMethod || row.payment?.method) === 'cash').reduce((sum, row) => sum + amount(row.total ?? row.subtotal), 0)
  const electronicSales = matchedSales.filter(row => (row.paymentMethod || row.payment?.method) === 'electronic').reduce((sum, row) => sum + amount(row.total ?? row.subtotal), 0)
  const totals = { totalSales, cashSales, electronicSales, ordersCount: matchedSales.length, businessExpensesTotal: totalOf(matchedExpenses), withdrawalsTotal: totalOf(matchedWithdrawals), salariesTotal: totalOf(matchedSalaries) }
  totals.net = totals.cashSales + totals.electronicSales - totals.businessExpensesTotal - totals.withdrawalsTotal - totals.salariesTotal
  const salesRows = selected.has('sales') ? matchedSales : []
  const expenseRows = selected.has('expenses') ? matchedExpenses : []
  const salaryRows = selected.has('salary') ? matchedSalaries : []
  const withdrawalRows = selected.has('withdrawals') ? matchedWithdrawals : []
  return { valid, captain, from, to, sections: [...selected], matchedSales, matchedExpenses, matchedWithdrawals, matchedSalaries, totals, sales: salesRows, expenses: expenseRows, salary: salaryRows, withdrawals: withdrawalRows, salesTotal: totalOf(salesRows.map(row => ({ amount: row.total ?? row.subtotal }))), cashSales: salesRows.filter(row => (row.paymentMethod || row.payment?.method) === 'cash').reduce((sum, row) => sum + amount(row.total ?? row.subtotal), 0), electronicSales: salesRows.filter(row => (row.paymentMethod || row.payment?.method) === 'electronic').reduce((sum, row) => sum + amount(row.total ?? row.subtotal), 0), expensesTotal: totalOf(expenseRows), salaryTotal: totalOf(salaryRows), withdrawalsTotal: totalOf(withdrawalRows), netTotal: totalOf(salesRows.map(row => ({ amount: row.total ?? row.subtotal }))) - totalOf(expenseRows) - totalOf(salaryRows) - totalOf(withdrawalRows) }
}

export const CAPTAIN_SALARY_CATEGORY = salaryCategory
