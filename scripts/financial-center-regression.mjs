import assert from 'node:assert/strict'
import { calculateEmployeeExpenseReport, calculateFinancialReport, calculateSettlement, makeSettlementIdempotencyKey } from '../src/services/financialCenter.js'

const sales = [
  { id: 's1', total: 100, paymentMethod: 'cash', businessDate: '2026-09-27' },
  { id: 's2', total: 50, paymentMethod: 'electronic', businessDate: '2026-09-27' },
  { id: 's3', total: 20, paymentMethod: 'cash', businessDate: '2026-09-28' },
]
const expenses = [{ id: 'e1', amount: 10, person: 'علي', employeeId: 'ali', employeeNameSnapshot: 'علي', businessDate: '2026-09-27' }]
const transactions = [{ id: 'w1', type: 'withdrawal', amount: 15, employeeId: 'ali', employeeNameSnapshot: 'علي', businessDate: '2026-09-27' }, { id: 'd1', type: 'deposit', amount: 5, businessDate: '2026-09-27' }]

assert.equal(calculateSettlement({ sales, expenses, transactions }).expectedCash, 100)
assert.equal(calculateFinancialReport({ sales, expenses, transactions, from: '2026-09-27', to: '2026-09-27' }).daily.length, 1)
assert.equal(calculateFinancialReport({ sales, expenses, transactions, from: '2026-09-27', to: '2026-09-27' }).orderCount, 2)
assert.equal(calculateEmployeeExpenseReport(expenses, transactions, { from: '2026-09-27', to: '2026-09-27' })[0].total, 25)
assert.equal(makeSettlementIdempotencyKey('day-1'), 'settlement:day-1')
console.log('FINANCIAL_CENTER_REGRESSION=PASS')
