const amount = value => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

export const normalizeBusinessDate = (value, fallback = '') => {
  const text = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback
}

export const resolveFinancialBusinessDate = (record, operationalDayDates = {}) => {
  const explicit = normalizeBusinessDate(record?.businessDate || record?.business_date || record?.shiftBusinessDate)
  if (explicit) return explicit
  const operationalDayId = String(record?.operationalDayId || record?.operational_day_id || record?.shiftId || '').trim()
  const mapped = normalizeBusinessDate(operationalDayDates[operationalDayId])
  if (mapped) return mapped
  const timestamp = Number(record?.createdAt || record?.created_at || record?.date || record?.timestamp)
  if (!Number.isFinite(timestamp)) return ''
  const date = new Date(timestamp)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}-${parts.find(part => part.type === 'day')?.value}`
}

const invalidStatuses = new Set(['voided', 'cancelled', 'canceled', 'abandoned', 'draft'])
const isVoided = row => invalidStatuses.has(String(row?.status || '').trim().toLowerCase()) || row?.voided === true
const saleAmount = sale => amount(sale?.total ?? sale?.subtotal)
const paymentMethod = sale => sale?.paymentMethod || sale?.payment?.method || ''

export const LEGACY_WITHDRAWAL_DEFAULT = 'cashbox'
export const normalizeFundingSource = value => value === 'management' ? 'management' : LEGACY_WITHDRAWAL_DEFAULT
export const isCashboxWithdrawal = row => row?.type === 'withdrawal' && normalizeFundingSource(row?.fundingSource) === 'cashbox'
export const isManagementWithdrawal = row => row?.type === 'withdrawal' && normalizeFundingSource(row?.fundingSource) === 'management'

export const calculateCashboxBalance = transactions => (Array.isArray(transactions) ? transactions : []).reduce((balance, transaction) => {
  if (isVoided(transaction)) return balance
  const value = amount(transaction?.amount)
  if (['deposit', 'return'].includes(transaction?.type)) return balance + value
  if (transaction?.type === 'withdrawal') return isCashboxWithdrawal(transaction) ? balance - value : balance
  if (transaction?.type === 'expense') return balance - value
  if (transaction?.type === 'adjustment') return balance + amount(transaction?.signedAmount ?? transaction?.amount)
  return balance
}, 0)

export const calculateSettlement = ({ sales = [], expenses = [], transactions = [] } = {}) => {
  const validSales = sales.filter(sale => !isVoided(sale))
  const cashSales = validSales.filter(sale => paymentMethod(sale) === 'cash').reduce((sum, sale) => sum + saleAmount(sale), 0)
  const electronicSales = validSales.filter(sale => paymentMethod(sale) === 'electronic').reduce((sum, sale) => sum + saleAmount(sale), 0)
  const expenseTotal = expenses.filter(expense => !isVoided(expense)).reduce((sum, expense) => sum + amount(expense?.amount), 0)
  const withdrawalRows = transactions.filter(row => row?.type === 'withdrawal' && !isVoided(row))
  const cashboxWithdrawals = withdrawalRows.filter(isCashboxWithdrawal).reduce((sum, row) => sum + amount(row.amount), 0)
  const managementWithdrawals = withdrawalRows.filter(isManagementWithdrawal).reduce((sum, row) => sum + amount(row.amount), 0)
  const withdrawals = cashboxWithdrawals + managementWithdrawals
  const deposits = transactions.filter(row => row?.type === 'deposit' && !isVoided(row)).reduce((sum, row) => sum + amount(row.amount), 0)
  const adjustments = transactions.filter(row => row?.type === 'adjustment' && !isVoided(row)).reduce((sum, row) => sum + amount(row.signedAmount ?? row.amount), 0)
  const expectedCash = cashSales - expenseTotal - cashboxWithdrawals + deposits + adjustments
  return { sales: validSales.reduce((sum, sale) => sum + saleAmount(sale), 0), cashSales, electronicSales, expenses: expenseTotal, withdrawals, cashboxWithdrawals, managementWithdrawals, deposits, adjustments, expectedCash, finalAfterAllSettlements: expectedCash, orderCount: validSales.length, averageOrder: validSales.length ? (cashSales + electronicSales) / validSales.length : 0 }
}

export const calculateFinancialReport = ({ sales = [], expenses = [], transactions = [], from, to } = {}) => {
  const inRange = row => { const date = resolveFinancialBusinessDate(row); return (!from || date >= from) && (!to || date <= to) }
  const filteredSales = sales.filter(inRange)
  const filteredExpenses = expenses.filter(inRange)
  const filteredTransactions = transactions.filter(inRange)
  const summary = calculateSettlement({ sales: filteredSales, expenses: filteredExpenses, transactions: filteredTransactions })
  const byDay = new Map()
  const ensure = date => { if (!byDay.has(date)) byDay.set(date, { businessDate: date, sales: 0, cash: 0, electronic: 0, expenses: 0, withdrawals: 0, deposits: 0, net: 0, orders: 0 }); return byDay.get(date) }
  filteredSales.forEach(sale => { const row = ensure(resolveFinancialBusinessDate(sale)); const value = saleAmount(sale); row.sales += value; row.orders += 1; if (paymentMethod(sale) === 'cash') row.cash += value; if (paymentMethod(sale) === 'electronic') row.electronic += value })
  filteredExpenses.forEach(expense => { ensure(resolveFinancialBusinessDate(expense)).expenses += amount(expense.amount) })
  filteredTransactions.forEach(transaction => { const row = ensure(resolveFinancialBusinessDate(transaction)); if (isCashboxWithdrawal(transaction)) row.withdrawals += amount(transaction.amount); if (transaction.type === 'deposit' || transaction.type === 'return') row.deposits += amount(transaction.amount) })
  for (const row of byDay.values()) row.net = row.cash - row.expenses - row.withdrawals + row.deposits
  return { ...summary, daily: [...byDay.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate)), filteredSales, filteredExpenses, filteredTransactions }
}

export const calculateEmployeeExpenseReport = (expenses = [], transactions = [], { from = '', to = '' } = {}) => {
  const inRange = row => { const date = resolveFinancialBusinessDate(row); return (!from || date >= from) && (!to || date <= to) }
  const linkedExpenseIds = new Set(transactions.map(row => row.linkedExpenseId).filter(Boolean))
  const rows = [...expenses.filter(row => !linkedExpenseIds.has(row.id)).map(row => ({ ...row, source: row.source || 'cashier expense', type: row.type || 'expense' })), ...transactions.filter(row => row.type === 'withdrawal' || row.type === 'expense').map(row => ({ ...row, source: row.source || `cashbox ${row.type}` }))].filter(inRange).filter(row => !isVoided(row))
  const unique = rows
  const grouped = new Map()
  unique.forEach(row => { const id = String(row.employeeId || row.cashierId || row.person || 'unknown'); const name = row.employeeNameSnapshot || row.person || row.cashierNameSnapshot || 'غير محدد'; const current = grouped.get(id) || { employeeId: id, name, total: 0, operations: 0, withdrawals: 0, cashierExpenses: 0, rows: [] }; const value = amount(row.amount); current.total += value; current.operations += 1; if (row.source === 'cashbox withdrawal') current.withdrawals += value; else current.cashierExpenses += value; current.rows.push(row); grouped.set(id, current) })
  return [...grouped.values()].sort((a, b) => b.total - a.total)
}

export const makeSettlementIdempotencyKey = operationalDayId => `settlement:${String(operationalDayId || '').trim()}`

export const settlementStatusForDifference = difference => difference === 0 ? 'matched' : difference > 0 ? 'over' : 'short'

export const calculateSettlementCorrection = ({ settlement, correctedActualCash } = {}) => {
  const expectedCash = amount(settlement?.expectedCash)
  const correctedActual = Number(correctedActualCash)
  if (!Number.isFinite(correctedActual) || correctedActual < 0) throw new Error('المبلغ الفعلي المصحح يجب أن يكون رقماً لا يقل عن صفر.')
  const correctedDifference = correctedActual - expectedCash
  return { correctedActualCash: correctedActual, correctedDifference, correctedStatus: settlementStatusForDifference(correctedDifference) }
}

export const latestActiveSettlementCorrection = (corrections = []) => corrections
  .filter(row => row?.status === 'active')
  .slice()
  .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0) || String(a.id || '').localeCompare(String(b.id || '')))
  .at(-1) || null

export const getEffectiveSettlement = (settlement, corrections = []) => {
  const correction = latestActiveSettlementCorrection(corrections)
  if (!correction) {
    const effectiveActualCash = amount(settlement?.actualCash)
    const effectiveDifference = effectiveActualCash - amount(settlement?.expectedCash)
    return { settlement, correction: null, effectiveActualCash, effectiveDifference, effectiveStatus: settlementStatusForDifference(effectiveDifference) }
  }
  const effectiveActualCash = amount(correction.correctedActualCash)
  const effectiveDifference = effectiveActualCash - amount(settlement?.expectedCash)
  return { settlement, correction, effectiveActualCash, effectiveDifference, effectiveStatus: settlementStatusForDifference(effectiveDifference) }
}
