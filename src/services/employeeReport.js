import { isActiveExpense, isWithdrawalExpense, normalizeExpense } from './expenseReporting.js'
import { businessDateOf, filterRowsByBusinessDate, isValidDateRange } from './periodReport.js'

const text = value => String(value ?? '').trim()
const normalizeText = value => text(value).replace(/[\u200f\u200e\u061c]/g, '').replace(/[\s\u00a0]+/g, ' ').toLocaleLowerCase('ar-IQ')
const normalizeIdentityText = value => normalizeText(value).replace(/[\u064B-\u065F\u0670\u0640]/g, '')
const amount = value => { const number = Number(value); return Number.isFinite(number) ? number : 0 }
const isVoided = row => row?.status === 'voided' || row?.voided === true
const isClosedSale = row => ['cancelled', 'canceled', 'voided', 'abandoned', 'draft', 'باطل', 'ملغي'].includes(text(row?.status).toLocaleLowerCase('ar-IQ'))
export const EMPLOYEE_SALARY_CATEGORY = 'راتب'
const isSalary = row => text(row?.category) === EMPLOYEE_SALARY_CATEGORY || text(row?.expenseCategory) === EMPLOYEE_SALARY_CATEGORY

const nestedShift = row => row?.shift && typeof row.shift === 'object' ? row.shift : {}
const identityFieldValues = (row, fields) => fields.flatMap(field => [row?.[field], nestedShift(row)?.[field]]).map(text).filter(Boolean)
export const employeeNameOf = row => text(row?.name || row?.employeeNameSnapshot || row?.cashierNameSnapshot || row?.cashierName || row?.seller || row?.sellerName || row?.person || nestedShift(row)?.cashierName || nestedShift(row)?.name)
export const employeeCodeOf = row => text(row?.code || row?.employeeCode || row?.staffCode || row?.cashierCode || row?.captainCode || row?.employeeCodeSnapshot || nestedShift(row)?.cashierCode || nestedShift(row)?.employeeCode)
export const employeeIdOf = row => text(row?.employeeId || row?.staffId || row?.cashierId || row?.captainId || row?.userId || row?.uid || row?.createdByUid || row?.createdBy || nestedShift(row)?.cashierId || nestedShift(row)?.employeeId)

const recordIdentity = record => ({
  ids: identityFieldValues(record, ['employeeId', 'staffId', 'cashierId', 'captainId', 'userId', 'uid', 'createdByUid', 'createdBy']),
  codes: identityFieldValues(record, ['employeeCode', 'staffCode', 'cashierCode', 'captainCode', 'code', 'employeeCodeSnapshot']).map(normalizeIdentityText),
  names: identityFieldValues(record, ['employeeNameSnapshot', 'cashierNameSnapshot', 'cashierName', 'seller', 'sellerName', 'captainName', 'employeeName', 'person', 'name', 'createdByName']).map(normalizeIdentityText),
})

const selectedIdentity = employee => ({
  ids: identityFieldValues(employee, ['id', 'employeeId', 'staffId', 'cashierId', 'captainId', 'userId', 'uid']),
  codes: identityFieldValues(employee, ['code', 'employeeCode', 'staffCode', 'cashierCode', 'captainCode']).map(normalizeIdentityText),
  names: identityFieldValues(employee, ['name', 'employeeName', 'cashierName', 'sellerName']).map(normalizeIdentityText),
})

// One report-only matcher for sales, expenses, withdrawals, and salaries.
// It reads source rows without mutating them and accepts any one reliable identity.
export const matchesEmployee = (record, selectedEmployee) => {
  if (!record || !selectedEmployee) return false
  const source = recordIdentity(record)
  const target = selectedIdentity(selectedEmployee)
  if (source.ids.some(value => target.ids.includes(value))) return true
  if (source.codes.some(value => target.codes.includes(value))) return true
  return source.names.some(value => target.names.includes(value))
}

const identityValues = record => ({
  ids: recordIdentity(record).ids,
  names: recordIdentity(record).names,
  codes: recordIdentity(record).codes,
})

// Exact identity matching only: a duplicated name is intentionally ambiguous.
export const matchEmployeeRecord = (record, staff = []) => {
  const people = Array.isArray(staff) ? staff : []
  const recordIdentity = identityValues(record)
  const byStableId = people.filter(person => {
    const personIds = selectedIdentity(person).ids
    return recordIdentity.ids.some(id => personIds.includes(id))
  })
  if (byStableId.length === 1) return byStableId[0]
  if (byStableId.length > 1) return null
  const byCode = people.filter(person => recordIdentity.codes.some(code => selectedIdentity(person).codes.includes(code)))
  if (byCode.length === 1) return byCode[0]
  if (byCode.length > 1) return null
  const byName = people.filter(person => recordIdentity.names.some(name => selectedIdentity(person).names.includes(name)))
  return byName.length === 1 ? byName[0] : null
}

const fallbackEmployee = record => {
  const name = employeeNameOf(record) || 'غير محدد'
  const id = employeeIdOf(record) || `legacy:${normalizeText(name) || 'unknown'}`
  return { id, code: employeeCodeOf(record), name, active: true, legacy: true }
}

const employeeForRecord = (record, staff) => {
  const matched = matchEmployeeRecord(record, staff)
  if (matched) return matched
  const name = normalizeText(employeeNameOf(record))
  const duplicateCanonicalNames = (Array.isArray(staff) ? staff : []).filter(person => normalizeText(person?.name) === name).length > 1
  return duplicateCanonicalNames && !employeeIdOf(record) ? null : fallbackEmployee(record)
}
const saleAmount = row => amount(row?.total ?? row?.subtotal)
const paymentMethod = row => row?.paymentMethod || row?.payment?.method || ''
const recordDate = row => businessDateOf(row)
const inRange = (row, from, to) => isValidDateRange(from, to) && recordDate(row) >= from && recordDate(row) <= to

const addSummary = (map, person) => {
  const key = text(person?.id) || `legacy:${normalizeText(person?.name)}`
  if (!map.has(key)) map.set(key, { employee: person, salesTotal: 0, cashSales: 0, electronicSales: 0, ordersCount: 0, sales: [], expensesTotal: 0, salaryTotal: 0, withdrawalsTotal: 0, expenses: [], salary: [], withdrawals: [] })
  return map.get(key)
}

export const buildEmployeeReport = ({ staff = [], sales = [], expenses = [], transactions = [], from = '', to = '' } = {}) => {
  const people = (Array.isArray(staff) ? staff : []).filter(row => row?.id && row?.name)
  const rows = new Map(people.map(person => [String(person.id), { employee: person, salesTotal: 0, cashSales: 0, electronicSales: 0, ordersCount: 0, sales: [], expensesTotal: 0, salaryTotal: 0, withdrawalsTotal: 0, expenses: [], salary: [], withdrawals: [] }]))
  const add = (record, kind, value) => {
    if (isVoided(record) || (kind === 'expense' && !isActiveExpense(record)) || !inRange(record, from, to)) return
    const person = employeeForRecord(record, people)
    if (!person) return
    const summary = addSummary(rows, person)
    if (kind === 'salary') { summary.salaryTotal += value; summary.salary.push(record) }
    else if (kind === 'expense') { summary.expensesTotal += value; summary.expenses.push(record) }
    else { summary.withdrawalsTotal += value; summary.withdrawals.push(record) }
  }
  filterRowsByBusinessDate(sales, from, to).forEach(record => {
    if (isVoided(record) || isClosedSale(record)) return
    const person = employeeForRecord(record, people)
    if (!person) return
    const summary = addSummary(rows, person)
    const value = saleAmount(record)
    summary.salesTotal += value
    summary.ordersCount += 1
    summary.sales.push(record)
    if (paymentMethod(record) === 'electronic') summary.electronicSales += value
    else summary.cashSales += value
  })
  const linkedExpenseIds = new Set((Array.isArray(transactions) ? transactions : []).map(row => text(row.linkedExpenseId || row.sourceRefId)).filter(Boolean))
  const salaryExpenseIds = new Set((Array.isArray(expenses) ? expenses : []).filter(isSalary).map(row => text(row.id)).filter(Boolean))
  filterRowsByBusinessDate(expenses, from, to).forEach(row => {
    const normalized = normalizeExpense(row)
    if (!linkedExpenseIds.has(text(row.id))) add(normalized, isWithdrawalExpense(normalized) ? 'withdrawal' : (isSalary(normalized) ? 'salary' : 'expense'), amount(normalized.amount))
  })
  filterRowsByBusinessDate(transactions, from, to).filter(row => row?.type === 'expense').forEach(row => add(row, isSalary(row) || salaryExpenseIds.has(text(row.linkedExpenseId)) ? 'salary' : 'expense', amount(row.amount)))
  filterRowsByBusinessDate(transactions, from, to).filter(row => row?.type === 'withdrawal').forEach(row => add(row, 'withdrawal', amount(row.amount)))
  const summaries = [...rows.values()].map(summary => ({ ...summary, employeeTotal: summary.expensesTotal + summary.salaryTotal + summary.withdrawalsTotal })).sort((a, b) => b.salesTotal - a.salesTotal || b.employeeTotal - a.employeeTotal || text(a.employee.name).localeCompare(text(b.employee.name), 'ar'))
  return { summaries, total: summaries.reduce((result, row) => ({ salesTotal: result.salesTotal + row.salesTotal, cashSales: result.cashSales + row.cashSales, electronicSales: result.electronicSales + row.electronicSales, ordersCount: result.ordersCount + row.ordersCount, expensesTotal: result.expensesTotal + row.expensesTotal, salaryTotal: result.salaryTotal + row.salaryTotal, withdrawalsTotal: result.withdrawalsTotal + row.withdrawalsTotal, employeeTotal: result.employeeTotal + row.employeeTotal }), { salesTotal: 0, cashSales: 0, electronicSales: 0, ordersCount: 0, expensesTotal: 0, salaryTotal: 0, withdrawalsTotal: 0, employeeTotal: 0 }) }
}

export const filterEmployeeSummaries = (summaries, query = '') => {
  const needle = normalizeText(query)
  if (!needle) return summaries
  return summaries.filter(row => [row.employee?.name, row.employee?.code, row.employee?.id].some(value => normalizeText(value).includes(needle)))
}
