import { businessDateOf, filterRowsByBusinessDate, isValidDateRange } from './periodReport.js'

const text = value => String(value ?? '').trim()
const normalizeText = value => text(value).replace(/[\u200f\u200e\u061c]/g, '').replace(/[\s\u00a0]+/g, ' ').toLocaleLowerCase('ar-IQ')
const amount = value => { const number = Number(value); return Number.isFinite(number) ? number : 0 }
const isVoided = row => row?.status === 'voided' || row?.voided === true

export const employeeNameOf = row => text(row?.name || row?.employeeNameSnapshot || row?.cashierNameSnapshot || row?.cashierName || row?.seller || row?.person)
export const employeeCodeOf = row => text(row?.code || row?.employeeCode || row?.staffCode)
export const employeeIdOf = row => text(row?.employeeId || row?.staffId || row?.cashierId)

const identityValues = record => ({
  ids: [record?.employeeId, record?.staffId, record?.cashierId, record?.uid, record?.createdByUid, record?.createdBy].map(text).filter(Boolean),
  names: [record?.employeeNameSnapshot, record?.cashierNameSnapshot, record?.cashierName, record?.seller, record?.person, record?.name].map(normalizeText).filter(Boolean),
  codes: [record?.employeeCode, record?.staffCode, record?.cashierCode].map(normalizeText).filter(Boolean),
})

// Exact identity matching only: a duplicated name is intentionally ambiguous.
export const matchEmployeeRecord = (record, staff = []) => {
  const people = Array.isArray(staff) ? staff : []
  const recordIdentity = identityValues(record)
  const byStableId = people.filter(person => {
    const personIds = [person?.id, person?.staffId, person?.uid, person?.userId].map(text).filter(Boolean)
    return recordIdentity.ids.some(id => personIds.includes(id))
  })
  if (byStableId.length === 1) return byStableId[0]
  if (byStableId.length > 1) return null
  const byCode = people.filter(person => recordIdentity.codes.includes(normalizeText(person?.code)))
  if (byCode.length === 1) return byCode[0]
  if (byCode.length > 1) return null
  const byName = people.filter(person => recordIdentity.names.includes(normalizeText(person?.name)))
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
  if (!map.has(key)) map.set(key, { employee: person, ordersCount: 0, salesTotal: 0, cashSales: 0, electronicSales: 0, expensesTotal: 0, withdrawalsTotal: 0, sales: [], expenses: [], withdrawals: [] })
  return map.get(key)
}

export const buildEmployeeReport = ({ staff = [], sales = [], expenses = [], transactions = [], from = '', to = '' } = {}) => {
  const people = (Array.isArray(staff) ? staff : []).filter(row => row?.id && row?.name)
  const rows = new Map(people.map(person => [String(person.id), { employee: person, ordersCount: 0, salesTotal: 0, cashSales: 0, electronicSales: 0, expensesTotal: 0, withdrawalsTotal: 0, sales: [], expenses: [], withdrawals: [] }]))
  const add = (record, kind, value) => {
    if (isVoided(record) || !inRange(record, from, to)) return
    const person = employeeForRecord(record, people)
    if (!person) return
    const summary = addSummary(rows, person)
    if (kind === 'sale') {
      summary.ordersCount += 1; summary.salesTotal += value
      if (paymentMethod(record) === 'cash') summary.cashSales += value
      if (paymentMethod(record) === 'electronic') summary.electronicSales += value
      summary.sales.push(record)
    } else if (kind === 'expense') { summary.expensesTotal += value; summary.expenses.push(record) }
    else { summary.withdrawalsTotal += value; summary.withdrawals.push(record) }
  }
  filterRowsByBusinessDate(sales, from, to).forEach(row => add(row, 'sale', saleAmount(row)))
  const linkedExpenseIds = new Set((Array.isArray(transactions) ? transactions : []).filter(row => row?.type === 'expense').map(row => text(row.linkedExpenseId)).filter(Boolean))
  filterRowsByBusinessDate(expenses, from, to).forEach(row => { if (!linkedExpenseIds.has(text(row.id))) add(row, 'expense', amount(row.amount)) })
  filterRowsByBusinessDate(transactions, from, to).filter(row => row?.type === 'expense').forEach(row => add(row, 'expense', amount(row.amount)))
  filterRowsByBusinessDate(transactions, from, to).filter(row => row?.type === 'withdrawal').forEach(row => add(row, 'withdrawal', amount(row.amount)))
  const summaries = [...rows.values()].map(summary => ({ ...summary, netTotal: summary.salesTotal - summary.expensesTotal - summary.withdrawalsTotal })).sort((a, b) => b.salesTotal - a.salesTotal || text(a.employee.name).localeCompare(text(b.employee.name), 'ar'))
  return { summaries, total: summaries.reduce((result, row) => ({ ordersCount: result.ordersCount + row.ordersCount, salesTotal: result.salesTotal + row.salesTotal, cashSales: result.cashSales + row.cashSales, electronicSales: result.electronicSales + row.electronicSales, expensesTotal: result.expensesTotal + row.expensesTotal, withdrawalsTotal: result.withdrawalsTotal + row.withdrawalsTotal, netTotal: result.netTotal + row.netTotal }), { ordersCount: 0, salesTotal: 0, cashSales: 0, electronicSales: 0, expensesTotal: 0, withdrawalsTotal: 0, netTotal: 0 }) }
}

export const filterEmployeeSummaries = (summaries, query = '') => {
  const needle = normalizeText(query)
  if (!needle) return summaries
  return summaries.filter(row => [row.employee?.name, row.employee?.code, row.employee?.id].some(value => normalizeText(value).includes(needle)))
}
