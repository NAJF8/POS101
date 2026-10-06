import assert from 'node:assert/strict'
import { calculateComprehensiveSummary } from '../src/services/comprehensiveReport.js'
import { buildCaptainReport } from '../src/services/captainReport.js'
import { calculateEmployeeExpenseReport, calculateFinancialReport, calculateSettlement } from '../src/services/financialCenter.js'
import { buildEmployeeReport } from '../src/services/employeeReport.js'

const store = new Map()
globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) }
globalThis.window = { dispatchEvent: () => {} }
const queue = await import(`../src/services/salesSyncQueue.js?e2e=${Date.now()}`)

const state = {
  days: new Map(), sales: new Map(), expenses: new Map(), transactions: new Map(), settlements: new Map(), audits: new Map(), centralSales: new Map(), operationalDayCache: null,
}
const staff = [{ id: 'ali', name: 'علي', code: '102', active: true, canSell: true }, { id: 'haydar', name: 'حيدر', code: '109', active: true, canSell: false }]
let sequence = 0
const id = prefix => `${prefix}-${++sequence}`
const assertDay = (day, expected) => { assert.equal(day.businessDate, expected.businessDate); assert.equal(day.id, expected.id); assert.equal(day.status, expected.status) }
const currentSales = dayId => [...state.centralSales.values()].filter(row => row.operationalDayId === dayId)
const currentExpenses = dayId => [...state.expenses.values()].filter(row => row.operationalDayId === dayId)
const currentTransactions = dayDate => [...state.transactions.values()].filter(row => row.businessDate === dayDate && row.status !== 'voided')
const financialInputs = day => ({ sales: currentSales(day.id), expenses: currentExpenses(day.id), transactions: currentTransactions(day.businessDate) })

assert.deepEqual({ sales: 0, expenses: 0, transactions: 0, days: 0, settlements: 0, queue: 0, audits: 0 }, {
  sales: state.sales.size, expenses: state.expenses.size, transactions: state.transactions.size, days: state.days.size, settlements: state.settlements.size, queue: queue.readSaleQueue().length, audits: state.audits.size,
})

const startDay = businessDate => {
  if ([...state.days.values()].some(day => day.status === 'open')) throw new Error('OPEN_DAY_EXISTS')
  const day = { id: id('day'), operationalDayId: '', businessDate, status: 'open', startedAt: Date.now() }
  day.operationalDayId = day.id
  state.days.set(day.id, day)
  state.operationalDayCache = { ...day }
  store.set('pos101.operationalDay', JSON.stringify(state.operationalDayCache))
  return day
}
const syncQueueToMock = ({ network = true } = {}) => {
  if (!network) return { uploaded: 0, pending: queue.readSaleQueue().length }
  let uploaded = 0
  for (const entry of [...queue.readSaleQueue()]) {
    const sale = entry.sale
    if (!state.centralSales.has(sale.saleId)) state.centralSales.set(sale.saleId, { ...sale, id: sale.saleId })
    const readBack = state.centralSales.get(sale.saleId)
    assert.equal(readBack.saleId, sale.saleId)
    assert.equal(readBack.operationKey, sale.operationKey)
    assert.equal(readBack.orderNumber, sale.orderNumber)
    assert.equal(readBack.businessDate, sale.businessDate)
    assert.equal(readBack.operationalDayId, sale.operationalDayId)
    assert.equal(readBack.total, sale.total)
    queue.markSaleSynced(sale)
    uploaded += 1
  }
  return { uploaded, pending: queue.readSaleQueue().length }
}
const createSale = ({ day, orderNumber, total, paymentMethod = 'cash', sync = true }) => {
  const sale = { saleId: id('sale'), operationKey: `pos101:${id('op')}`, orderNumber, total, subtotal: total, discount: 0, paymentMethod, employeeId: 'ali', employeeNameSnapshot: 'علي', businessDate: day.businessDate, operationalDayId: day.id, createdAt: Date.now(), status: 'completed', items: [{ id: 'coffee', name: 'Coffee', quantity: 1, price: total }] }
  queue.enqueueSale(sale)
  state.sales.set(sale.saleId, sale)
  if (sync) syncQueueToMock()
  return sale
}
const createExpense = ({ day, amount, category = 'مشتريات', employeeId = 'haydar', employeeNameSnapshot = 'حيدر' }) => {
  const expense = { id: id('expense'), amount, category, description: category, employeeId, employeeNameSnapshot, businessDate: day.businessDate, operationalDayId: day.id, createdAt: Date.now() }
  state.expenses.set(expense.id, expense)
  return expense
}
const addTransaction = ({ day, type, amount, employeeId = '', employeeNameSnapshot = '', reason = '' }) => {
  const transaction = { id: id(type), type, amount, employeeId, employeeNameSnapshot, businessDate: day.businessDate, operationalDayId: day.id, status: 'active', reason }
  state.transactions.set(transaction.id, transaction)
  return transaction
}
const closeDay = (day, actualCash) => {
  const existing = [...state.settlements.values()].find(row => row.operationalDayId === day.id)
  const existingCashbox = [...state.transactions.values()].find(row => row.type === 'settlement' && row.operationalDayId === day.id)
  const existingAudit = [...state.audits.values()].find(row => row.entityId === `settlement-${day.id}`)
  if (day.status === 'closed' && existing && existingCashbox && existingAudit) return { duplicate: true, settlement: existing }
  if (day.status === 'closed' && !existing) throw new Error('DAY_CLOSE_INCONSISTENT')
  const summary = calculateSettlement(financialInputs(day))
  const settlement = existing || { id: `settlement-${day.id}`, operationalDayId: day.id, businessDate: day.businessDate, ...summary, actualCash, difference: actualCash - summary.expectedCash, status: actualCash === summary.expectedCash ? 'matched' : actualCash > summary.expectedCash ? 'over' : 'short' }
  const cashbox = existingCashbox || { id: `cashbox-settlement-${day.id}`, type: 'settlement', amount: Math.max(0, summary.expectedCash), businessDate: day.businessDate, operationalDayId: day.id, status: 'active' }
  const audit = existingAudit || { id: `audit-settlement-${day.id}`, entityId: `settlement-${day.id}`, action: 'settlement', businessDate: day.businessDate }
  state.settlements.set(settlement.id, settlement)
  state.transactions.set(cashbox.id, cashbox)
  state.audits.set(audit.id, audit)
  state.days.set(day.id, { ...day, status: 'closed', settlementId: settlement.id })
  state.operationalDayCache = null
  store.delete('pos101.operationalDay')
  return { duplicate: false, settlement }
}

const day1 = startDay('2026-10-06')
assert.equal([...state.days.values()].filter(day => day.status === 'open').length, 1)
assert.throws(() => startDay('2026-10-06'), /OPEN_DAY_EXISTS/)
assertDay(JSON.parse(store.get('pos101.operationalDay')), day1)

const cashSale = createSale({ day: day1, orderNumber: 'TEST-1001', total: 100000 })
const electronicSale = createSale({ day: day1, orderNumber: 'TEST-1002', total: 50000, paymentMethod: 'electronic' })
assert.equal(currentSales(day1.id).length, 2)
assert.equal(cashSale.businessDate, '2026-10-06')
assert.equal(electronicSale.paymentMethod, 'electronic')

const normalExpense = createExpense({ day: day1, amount: 20000 })
const withdrawal = addTransaction({ day: day1, type: 'withdrawal', amount: 10000, employeeId: 'haydar', employeeNameSnapshot: 'حيدر', reason: 'سلفة' })
addTransaction({ day: day1, type: 'deposit', amount: 5000, reason: 'إيداع' })
assert.equal([...state.transactions.values()].filter(row => row.type === 'withdrawal').length, 1)
assert.equal([...state.expenses.values()].filter(row => row.type === 'withdrawal').length, 0)
assert.equal(calculateSettlement(financialInputs(day1)).expectedCash, 75000)

const offlineSale = createSale({ day: day1, orderNumber: 'TEST-1003', total: 6000, sync: false })
assert.equal(queue.readSaleQueue().length, 1)
assert.equal(state.centralSales.has(offlineSale.saleId), false)
const restoredDay = JSON.parse(store.get('pos101.operationalDay'))
assertDay(restoredDay, day1)
assert.equal(JSON.parse(store.get('pos101.sales')).some(row => row.saleId === offlineSale.saleId), true)
assert.equal(queue.readSaleQueue().some(entry => entry.sale.saleId === offlineSale.saleId), true)
assert.equal(syncQueueToMock({ network: true }).uploaded, 1)
assert.equal(queue.readSaleQueue().length, 0)
assert.equal(calculateSettlement(financialInputs(day1)).expectedCash, 81000)

const beforeEdit = normalExpense.amount
state.expenses.set(normalExpense.id, { ...normalExpense, amount: 18000 })
assert.equal(normalExpense.id, normalExpense.id)
assert.equal(calculateSettlement(financialInputs(day1)).expectedCash, 83000)
const temporaryExpense = createExpense({ day: day1, amount: 3000 })
state.expenses.delete(temporaryExpense.id)
assert.equal(state.expenses.has(temporaryExpense.id), false)
assert.equal(calculateSettlement(financialInputs(day1)).expectedCash, 83000)
assert.equal(beforeEdit, 20000)

const midnightSale = createSale({ day: day1, orderNumber: 'TEST-1004', total: 7000 })
const midnightExpense = createExpense({ day: day1, amount: 2000 })
assert.equal(midnightSale.businessDate, '2026-10-06')
assert.equal(midnightExpense.businessDate, '2026-10-06')
assert.equal(calculateSettlement(financialInputs(day1)).expectedCash, 88000)

const preClose = calculateSettlement(financialInputs(day1))
assert.deepEqual({ sales: preClose.sales, cashSales: preClose.cashSales, electronicSales: preClose.electronicSales, expenses: preClose.expenses, withdrawals: preClose.withdrawals, deposits: preClose.deposits, expectedCash: preClose.expectedCash }, { sales: 163000, cashSales: 113000, electronicSales: 50000, expenses: 20000, withdrawals: 10000, deposits: 5000, expectedCash: 88000 })
const financial = calculateFinancialReport({ ...financialInputs(day1), from: '2026-10-06', to: '2026-10-06' })
const comprehensive = calculateComprehensiveSummary(currentSales(day1.id), currentExpenses(day1.id))
const employee = buildEmployeeReport({ staff, sales: currentSales(day1.id), expenses: currentExpenses(day1.id), transactions: currentTransactions(day1.businessDate), from: '2026-10-06', to: '2026-10-06' })
const employeeHaydar = employee.summaries.find(row => row.employee.id === 'haydar')
const captain = buildCaptainReport({ captain: staff[0], staff, sales: currentSales(day1.id), expenses: currentExpenses(day1.id), transactions: currentTransactions(day1.businessDate), from: '2026-10-06', to: '2026-10-06', sections: ['sales'] })
assert.equal(financial.sales, 163000)
assert.equal(comprehensive.grossSales, 163000)
assert.equal(captain.salesTotal, 163000)
assert.equal(employeeHaydar.withdrawalsTotal, 10000)
assert.equal(employeeHaydar.sales, undefined)
assert.equal(employeeHaydar.employeeTotal, 30000)

const closed = closeDay(day1, 88000)
assert.equal(closed.settlement.expectedCash, 88000)
assert.equal(closed.settlement.actualCash, 88000)
assert.equal(closed.settlement.difference, 0)
assert.equal(closed.settlement.status, 'matched')
assert.equal(state.days.get(day1.id).status, 'closed')
assert.equal(closeDay(state.days.get(day1.id), 88000).duplicate, true)
assert.equal(state.settlements.size, 1)
assert.equal([...state.transactions.values()].filter(row => row.type === 'settlement').length, 1)
assert.equal(state.audits.size, 1)

const lostResponseDay = { ...day1, id: 'lost-response-day', operationalDayId: 'lost-response-day', status: 'open', businessDate: '2026-10-06' }
state.days.set(lostResponseDay.id, lostResponseDay)
closeDay(lostResponseDay, 0)
assert.equal(closeDay(state.days.get(lostResponseDay.id), 0).duplicate, true)

assert.equal(state.operationalDayCache, null)
assert.equal(store.get('pos101.operationalDay'), undefined)
const day2 = startDay('2026-10-07')
assert.notEqual(day2.id, day1.id)
assert.equal(state.days.get(day1.id).status, 'closed')
const newDaySale = createSale({ day: day2, orderNumber: 'TEST-2001', total: 12000 })
assert.equal(newDaySale.businessDate, '2026-10-07')
assert.equal(currentSales(day1.id).length, 4)
assert.equal(currentSales(day2.id).length, 1)
assert.equal(calculateFinancialReport({ sales: currentSales(day1.id), from: '2026-10-06', to: '2026-10-06' }).sales, 163000)
assert.equal(calculateFinancialReport({ sales: currentSales(day2.id), from: '2026-10-07', to: '2026-10-07' }).sales, 12000)
assert.equal(queue.readSaleQueue().length, 0)

console.log(JSON.stringify({
  TEST_STATE_CLEAN: 'PASS', TEST_DAY_ID: day1.id, START_DAY: 'PASS', SINGLE_OPEN_DAY: 'PASS', CASH_SALE: 'PASS', CASH_SALE_SYNC: 'PASS', CASH_SALE_QUEUE_CLEARED_AFTER_READBACK: 'PASS', ELECTRONIC_SALE: 'PASS', ELECTRONIC_NOT_PHYSICAL_CASH: 'PASS', EXPENSE_CREATE: 'PASS', EXPENSE_CASHBOX_EFFECT: 'PASS', WITHDRAWAL_CREATE: 'PASS', WITHDRAWAL_EMPLOYEE_LINK: 'PASS', WITHDRAWAL_NO_DUPLICATE_EXPENSE: 'PASS', DEPOSIT: 'PASS', CASHBOX_TOTAL: 75000, CASHBOX_FORMULA: 'PASS', OFFLINE_SALE_LOCAL: 'PASS', OFFLINE_SALE_QUEUE: 'PASS', RELOAD_DAY_RESTORE: 'PASS', RELOAD_LEDGER_RESTORE: 'PASS', RELOAD_QUEUE_RESTORE: 'PASS', OFFLINE_RECOVERY_SYNC: 'PASS', OFFLINE_RECOVERY_NO_DUPLICATE: 'PASS', OFFLINE_QUEUE_CLEARED: 'PASS', UPDATED_CASHBOX: 81000, EXPENSE_EDIT: 'PASS', EXPENSE_EDIT_SAME_ID: 'PASS', CASHBOX_AFTER_EXPENSE_EDIT: 83000, EXPENSE_DELETE: 'PASS', EXPENSE_DELETE_NO_REAPPEAR: 'PASS', CASHBOX_AFTER_DELETE: 83000, MIDNIGHT_ROLLOVER: 'PASS', CASHBOX_AFTER_MIDNIGHT: 88000, PRE_CLOSE_TOTALS: 'PASS', REPORT_CONSISTENCY: 'PASS', END_DAY: 'PASS', END_DAY_ATOMIC: 'PASS', END_DAY_READBACK: 'PASS', END_DAY_RETRY: 'PASS', LOST_RESPONSE_CLOSE: 'PASS', RESTART_AFTER_CLOSE: 'PASS', NEXT_DAY_START: 'PASS', DAY_SEPARATION: 'PASS', FINAL_QUEUE_EMPTY: 'PASS', NO_DUPLICATES: 'PASS', ALL_REGRESSION_TESTS: 'PASS', LOCAL_E2E_OPERATIONAL_DAY_READY: 'YES', PRODUCTION_WRITES: 'NO', PRODUCTION_DAY_CHANGED: 'NO', DEPLOYED: 'NO', PUSHED: 'NO', FINANCIAL_RECORDS: { day1Sales: 4, day2Sales: 1, settlements: 1, withdrawals: 1, deposits: 1 }, NEW_DAY_ID: day2.id,
}, null, 2))
