import { isWithdrawalExpense, normalizeExpense } from './expenseReporting.js'
import { businessDateOf, filterRowsByBusinessDate, isValidDateRange } from './periodReport.js'
import { sellerEligibleStaff } from './staffEligibility.js'
import { matchesEmployee } from './employeeReport.js'
import { buildMoneyOutLedger, classifyMoneyOutRecord } from './moneyOutClassifier.js'

const text = value => String(value ?? '').trim()
const canonical = value => text(value).replace(/[\u200f\u200e\u061c]/g, '').replace(/[\s\u00a0]+/g, ' ').toLocaleLowerCase('ar-IQ')
const amount = value => { const number = Number(value); return Number.isFinite(number) ? number : 0 }
const isVoided = row => row?.status === 'voided' || row?.voided === true
const isClosedSale = row => ['cancelled', 'canceled', 'voided', 'abandoned', 'draft', 'باطل', 'ملغي'].includes(text(row?.status).toLocaleLowerCase('ar-IQ'))
const salaryCategory = 'راتب'
const isSalaryRecord = row => text(row?.category || row?.expenseCategory) === salaryCategory

// Compatibility wrapper retained for callers that need the old kind shape.
// The shared money-out classifier is the source of truth for the decision.
export const classifyExpenseRecord = (row, { source = 'expense', salaryExpenseIds = new Set() } = {}) => {
  const classified = classifyMoneyOutRecord(row, { source })
  const normalized = source === 'expense' ? normalizeExpense(row) : (row || {})
  const withdrawal = classified.reportBucket === 'withdrawal' || (source === 'transaction' && text(normalized.type || normalized.transactionType).toLocaleLowerCase('ar-IQ') === 'withdrawal') || (source === 'expense' && isWithdrawalExpense(normalized))
  const salary = !withdrawal && (classified.reportBucket === 'salary' || isSalaryRecord(normalized) || salaryExpenseIds.has(text(normalized.linkedExpenseId)))
  return { row: normalized, kind: withdrawal ? 'withdrawal' : salary ? 'salary' : 'expense', amount: amount(normalized.amount) }
}

export const captainNameOf = row => text(row?.name || row?.employeeNameSnapshot || row?.cashierNameSnapshot || row?.seller || row?.person)
export const captainCodeOf = row => text(row?.code || row?.employeeCode || row?.staffCode)

export const matchCaptainRecord = (record, captain, staff = []) => matchesEmployee(record, captain)

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
  const moneyOutRows = valid
    ? buildMoneyOutLedger({ expenses, transactions }).filter(row => row.includeInReports && row.reportBucket !== 'ignored' && row.businessDate >= from && row.businessDate <= to && matchCaptainRecord(row.original, captain, staff))
    : []
  const rowsForBucket = bucket => moneyOutRows.filter(row => row.reportBucket === bucket).map(row => row.original)
  const matchedExpenses = rowsForBucket('business_expense')
  const matchedSalaries = rowsForBucket('salary')
  const matchedWithdrawals = rowsForBucket('withdrawal')
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
