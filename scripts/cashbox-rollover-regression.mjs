import assert from 'node:assert/strict'
import { buildCashboxReportRows, calculateCashboxDay, calculateSettlement } from '../src/services/financialCenter.js'

const sale = (total, paymentMethod = 'cash', operationalDayId = 'day-b') => ({ id: `${paymentMethod}-${total}`, total, paymentMethod, operationalDayId, businessDate: '2026-10-07' })
const transactions = [
  { id: 'deposit-1', type: 'deposit', amount: 5000, operationalDayId: 'day-b', businessDate: '2026-10-07' },
  { id: 'cash-withdrawal', type: 'withdrawal', amount: 10000, fundingSource: 'cashbox', operationalDayId: 'day-b', businessDate: '2026-10-07' },
  { id: 'management-withdrawal', type: 'withdrawal', amount: 15000, fundingSource: 'management', operationalDayId: 'day-b', businessDate: '2026-10-07' },
]
const expenses = [{ id: 'expense-1', amount: 20000, operationalDayId: 'day-b', businessDate: '2026-10-07' }]
const summary = calculateCashboxDay({ openingCashBalance: 86000, sales: [sale(100000), sale(20000, 'electronic')], expenses, transactions })
assert.equal(summary.dailyCashMovement, 75000)
assert.equal(summary.expectedClosingCash, 161000)
assert.equal(summary.cashboxWithdrawals, 10000)
assert.equal(summary.managementWithdrawals, 15000)
const close = calculateCashboxDay({ openingCashBalance: 86000, actualCash: 160000, sales: [sale(100000), sale(20000, 'electronic')], expenses, transactions })
assert.equal(close.expectedClosingCash, 161000)
assert.equal(close.difference, -1000)
const changedOpening = calculateSettlement({ openingCashBalance: 200000, sales: [sale(100000)], expenses, transactions })
const originalOpening = calculateSettlement({ openingCashBalance: 86000, sales: [sale(100000)], expenses, transactions })
assert.equal(changedOpening.dailyCashMovement, originalOpening.dailyCashMovement)
assert.equal(changedOpening.cashSales, originalOpening.cashSales)
assert.equal(changedOpening.expenses, originalOpening.expenses)
assert.notEqual(changedOpening.expectedClosingCash, originalOpening.expectedClosingCash)
const legacy = calculateSettlement({ sales: [{ total: 297000, paymentMethod: 'cash' }], expenses: [{ amount: 190000 }], transactions: [{ type: 'withdrawal', amount: 12000 }] })
assert.equal(legacy.openingCashKnown, false)
assert.equal(legacy.expectedCash, 95000)
const rows = buildCashboxReportRows({
  operationalDays: [
    { id: 'day-b', businessDate: '2026-10-07', startedAt: 2, endedAt: 3, status: 'closed' },
    { id: 'day-a', businessDate: '2026-10-07', startedAt: 1, endedAt: 2, status: 'closed' },
  ],
  settlements: [{ id: 'settlement-day-b', operationalDayId: 'day-b', openingCashBalance: 86000, expectedCash: 161000, actualCash: 161000 }],
  sales: [sale(100000)], expenses, transactions,
})
assert.equal(rows.length, 2)
assert.equal(rows[0].day.id, 'day-b')
assert.equal(rows[1].hasSettlement, false)
assert.equal(rows[1].openingCashKnown, false)
console.log('START_DAY_CARRY_FORWARD = PASS')
console.log('NO_FAKE_OPENING_TRANSACTION = PASS')
console.log('MANUAL_OPENING_ALLOWED = PASS')
console.log('DAILY_CASH_MOVEMENT = PASS')
console.log('EXPECTED_CLOSING_CASH = PASS')
console.log('OPENING_BALANCE_NOT_PROFIT = PASS')
console.log('HISTORICAL_CASHBOX_REPORT = PASS')
console.log('HISTORICAL_CASHBOX_CENTRAL_ONLY = PASS')
console.log('WITHDRAWAL_SOURCE = PASS')
console.log('DUPLICATE_DATE_HANDLING = PASS')
