import { isActiveExpense } from './expenseReporting.js'
import { businessDateOf, filterRowsByBusinessDate, isValidDateRange } from './periodReport.js'
import { sellerEligibleStaff } from './staffEligibility.js'

const text = value => String(value ?? '').trim()
const canonical = value => text(value).replace(/[\u200f\u200e\u061c]/g, '').replace(/[\s\u00a0]+/g, ' ').toLocaleLowerCase('ar-IQ')
const amount = value => { const number = Number(value); return Number.isFinite(number) ? number : 0 }
const isVoided = row => row?.status === 'voided' || row?.voided === true
const salaryCategory = 'راتب'

const idsOf = row => [row?.employeeId, row?.staffId, row?.cashierId, row?.uid, row?.createdByUid, row?.createdBy].map(text).filter(Boolean)
const namesOf = row => [row?.employeeNameSnapshot, row?.cashierNameSnapshot, row?.seller, row?.person, row?.employeeName, row?.cashierName, row?.name].map(canonical).filter(Boolean)
const captainIds = captain => [captain?.id, captain?.staffId, captain?.uid, captain?.userId].map(text).filter(Boolean)
const captainNames = captain => [captain?.name].map(canonical).filter(Boolean)

export const captainNameOf = row => text(row?.name || row?.employeeNameSnapshot || row?.cashierNameSnapshot || row?.seller || row?.person)
export const captainCodeOf = row => text(row?.code || row?.employeeCode || row?.staffCode)

// Match stable identifiers first, then exact normalized names. Similar names
// remain ambiguous and are intentionally excluded from a captain report.
export const matchCaptainRecord = (record, captain, staff = []) => {
  if (!captain || !record) return false
  const recordIds = idsOf(record)
  const selectedIds = captainIds(captain)
  if (recordIds.some(id => selectedIds.includes(id))) return true
  const cashierId = text(record?.cashierId)
  if (cashierId) {
    const cashier = (Array.isArray(staff) ? staff : []).find(person => captainIds(person).includes(cashierId))
    if (cashier && captainIds(cashier).some(id => selectedIds.includes(id))) return true
  }
  const recordNames = namesOf(record)
  const selectedNames = captainNames(captain)
  const sameNameCount = (Array.isArray(staff) ? staff : []).filter(person => captainNames(person).includes(selectedNames[0])).length
  return recordNames.length > 0 && selectedNames.length === 1 && sameNameCount === 1 && recordNames.includes(selectedNames[0])
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
  const captainSales = filterRowsByBusinessDate(sales, from, to).filter(inRange)
  const captainExpenses = filterRowsByBusinessDate(expenses, from, to).filter(row => isActiveExpense(row) && inRange(row))
  const captainTransactions = filterRowsByBusinessDate(transactions, from, to).filter(inRange)
  const salesRows = selected.has('sales') ? captainSales : []
  const expenseRows = selected.has('expenses') ? captainExpenses.filter(row => canonical(row.category) !== canonical(salaryCategory)) : []
  const salaryRows = selected.has('salary') ? captainExpenses.filter(row => text(row.category) === salaryCategory) : []
  const withdrawalRows = selected.has('withdrawals') ? captainTransactions.filter(row => row?.type === 'withdrawal') : []
  const salesTotal = salesRows.reduce((sum, row) => sum + amount(row.total ?? row.subtotal), 0)
  const cashSales = salesRows.filter(row => (row.paymentMethod || row.payment?.method) === 'cash').reduce((sum, row) => sum + amount(row.total ?? row.subtotal), 0)
  const electronicSales = salesRows.filter(row => (row.paymentMethod || row.payment?.method) === 'electronic').reduce((sum, row) => sum + amount(row.total ?? row.subtotal), 0)
  const expensesTotal = expenseRows.reduce((sum, row) => sum + amount(row.amount), 0)
  const salaryTotal = salaryRows.reduce((sum, row) => sum + amount(row.amount), 0)
  const withdrawalsTotal = withdrawalRows.reduce((sum, row) => sum + amount(row.amount), 0)
  return { valid, captain, from, to, sections: [...selected], sales: salesRows, expenses: expenseRows, salary: salaryRows, withdrawals: withdrawalRows, salesTotal, cashSales, electronicSales, expensesTotal, salaryTotal, withdrawalsTotal, netTotal: salesTotal - expensesTotal - salaryTotal - withdrawalsTotal }
}

export const CAPTAIN_SALARY_CATEGORY = salaryCategory
